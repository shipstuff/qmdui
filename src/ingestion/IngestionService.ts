import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, readJson, writeJson } from "../fsJson.js";
import type { Collection, IngestionManifest, IngestionManifestEntry } from "../types.js";
import { choosePipeline, convertToMarkdown } from "./converters.js";
import { matchesAny } from "./glob.js";

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function sha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

export class IngestionService {
  constructor(private readonly manifestPathFor: (collectionId: string) => string) {}

  async preview(collection: Collection): Promise<{ files: string[]; unsupported: string[] }> {
    const files = await this.discover(collection);
    return {
      files,
      unsupported: files.filter((file) => choosePipeline(file) === "unsupported")
    };
  }

  async convert(collection: Collection): Promise<IngestionManifest> {
    await ensureDir(collection.generatedPath);
    const existing = await readJson<IngestionManifest>(this.manifestPathFor(collection.id), {
      collectionId: collection.id,
      generatedPath: collection.generatedPath,
      updatedAt: new Date().toISOString(),
      entries: []
    });
    const existingBySource = new Map(existing.entries.map((entry) => [entry.sourcePath, entry]));
    const now = new Date().toISOString();
    const discovered = await this.discover(collection);
    const discoveredSet = new Set(discovered);
    const entries: IngestionManifestEntry[] = [];

    for (const filePath of discovered) {
      const stats = await fs.stat(filePath);
      const relativePath = path.relative(collection.sourcePath, filePath).replaceAll("\\", "/");
      const sourceHash = await sha256(filePath);
      const pipelineId = choosePipeline(filePath);
      const prior = existingBySource.get(filePath);
      const outputPath = path.join(collection.generatedPath, `${relativePath}.md`);
      const sourceModifiedAt = stats.mtime.toISOString();
      const baseEntry: IngestionManifestEntry = {
        sourcePath: filePath,
        relativePath,
        outputPath,
        sourceHash,
        sourceModifiedAt,
        convertedAt: prior?.convertedAt ?? now,
        pipelineId,
        planner: "deterministic",
        stale: false,
        warnings: [],
        errors: []
      };

      if (pipelineId === "unsupported") {
        entries.push({ ...baseEntry, warnings: [`Unsupported file type for ${relativePath}`] });
        continue;
      }

      if (prior && prior.sourceHash === sourceHash && prior.pipelineId === pipelineId) {
        entries.push({ ...prior, stale: false });
        continue;
      }

      try {
        const converted = await convertToMarkdown({
          filePath,
          relativePath,
          pipelineId,
          metadata: {
            originalPath: filePath,
            extension: path.extname(filePath).toLowerCase(),
            modifiedAt: sourceModifiedAt,
            convertedAt: now,
            hash: sourceHash
          }
        });
        await ensureDir(path.dirname(outputPath));
        await fs.writeFile(outputPath, converted.content, { mode: 0o600 });
        entries.push({ ...baseEntry, convertedAt: now, warnings: converted.warnings });
      } catch (error) {
        entries.push({ ...baseEntry, errors: [error instanceof Error ? error.message : String(error)] });
      }
    }

    for (const entry of existing.entries) {
      if (!discoveredSet.has(entry.sourcePath)) {
        entries.push({ ...entry, stale: true });
      }
    }

    const manifest: IngestionManifest = {
      collectionId: collection.id,
      generatedPath: collection.generatedPath,
      updatedAt: now,
      entries
    };
    await writeJson(this.manifestPathFor(collection.id), manifest);
    return manifest;
  }

  async getManifest(collectionId: string): Promise<IngestionManifest | undefined> {
    const fallback = undefined as IngestionManifest | undefined;
    return readJson(this.manifestPathFor(collectionId), fallback);
  }

  private async discover(collection: Collection): Promise<string[]> {
    const sourceRoot = path.resolve(collection.sourcePath);
    const files = await walk(sourceRoot);
    return files.filter((file) => {
      const relativePath = path.relative(sourceRoot, file).replaceAll("\\", "/");
      return matchesAny(relativePath, collection.includeGlobs) && !matchesAny(relativePath, collection.ignoreGlobs);
    });
  }
}
