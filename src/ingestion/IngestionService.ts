import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import fastGlob from "fast-glob";
import type { AppConfig } from "../config.js";
import type { IngestionManifest, IngestionManifestEntry } from "../types.js";
import { planConverter } from "./converters.js";

type IngestOptions = {
  collection: string;
  sourceRoot: string;
  pattern?: string;
  ignore?: string[];
  onLog?: (message: string) => void;
  onProgress?: (value: number) => void;
};

type IngestResult = {
  collection: string;
  sourceRoot: string;
  generatedRoot: string;
  converted: number;
  skipped: number;
  failed: number;
  stale: number;
  manifestPath: string;
};

type PreviewResult = {
  collection: string;
  sourceRoot: string;
  total: number;
  files: Array<{
    relativePath: string;
    sourcePath: string;
    size: number;
    pipeline: string;
    available: boolean;
    reason?: string;
  }>;
};

export class IngestionService {
  constructor(private readonly config: AppConfig) {}

  manifestPath(collection: string): string {
    return join(this.config.manifestDir, `${collection}.json`);
  }

  generatedRoot(collection: string): string {
    return join(this.config.generatedDir, collection);
  }

  readManifest(collection: string): IngestionManifest | null {
    const path = this.manifestPath(collection);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as IngestionManifest;
  }

  async preview(options: Pick<IngestOptions, "collection" | "sourceRoot" | "pattern" | "ignore">): Promise<PreviewResult> {
    const sourceRoot = resolve(options.sourceRoot);
    const files = await this.discover(sourceRoot, options.pattern, options.ignore);
    const previewFiles = [];
    for (const relativePath of files) {
      const sourcePath = resolve(sourceRoot, relativePath);
      const stat = statSync(sourcePath);
      const plan = await planConverter(sourcePath);
      previewFiles.push({
        relativePath,
        sourcePath,
        size: stat.size,
        pipeline: plan.id,
        available: plan.available,
        reason: plan.reason,
      });
    }
    return {
      collection: options.collection,
      sourceRoot,
      total: previewFiles.length,
      files: previewFiles,
    };
  }

  async ingest(options: IngestOptions): Promise<IngestResult> {
    const sourceRoot = resolve(options.sourceRoot);
    const generatedRoot = this.generatedRoot(options.collection);
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(this.config.manifestDir, { recursive: true });

    const files = await this.discover(sourceRoot, options.pattern, options.ignore);

    const oldManifest = this.readManifest(options.collection);
    const oldEntries = new Map(oldManifest?.entries.map((entry) => [entry.relativePath, entry]) ?? []);
    const seen = new Set<string>();
    const entries: IngestionManifestEntry[] = [];
    let converted = 0;
    let skipped = 0;
    let failed = 0;

    for (let index = 0; index < files.length; index++) {
      const relativePath = files[index]!;
      seen.add(relativePath);
      const sourcePath = resolve(sourceRoot, relativePath);
      const outputPath = join(generatedRoot, `${relativePath}.md`);
      const stat = statSync(sourcePath);
      const sourceHash = hashFile(sourcePath);
      const previous = oldEntries.get(relativePath);
      const plan = await planConverter(sourcePath);
      const warnings: string[] = [];

      options.onProgress?.((index / Math.max(files.length, 1)) * 100);

      if (!plan.available) {
        skipped++;
        warnings.push(plan.reason ?? "Converter unavailable");
        entries.push({
          sourcePath,
          relativePath,
          outputPath,
          sourceHash,
          sourceMtimeMs: stat.mtimeMs,
          sourceSize: stat.size,
          pipeline: plan.id,
          planner: "deterministic",
          convertedAt: previous?.convertedAt ?? new Date().toISOString(),
          stale: false,
          warnings,
          error: plan.reason,
        });
        options.onLog?.(`Skipped ${relativePath}: ${plan.reason}`);
        continue;
      }

      if (
        previous &&
        previous.sourceHash === sourceHash &&
        previous.pipeline === plan.id &&
        existsSync(previous.outputPath)
      ) {
        entries.push({ ...previous, stale: false });
        continue;
      }

      try {
        const body = await convertFile(sourcePath, plan.id);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, withFrontmatter({
          collection: options.collection,
          sourcePath,
          relativePath,
          sourceHash,
          pipeline: plan.id,
          body,
        }), "utf-8");
        converted++;
        entries.push({
          sourcePath,
          relativePath,
          outputPath,
          sourceHash,
          sourceMtimeMs: stat.mtimeMs,
          sourceSize: stat.size,
          pipeline: plan.id,
          planner: "deterministic",
          convertedAt: new Date().toISOString(),
          stale: false,
          warnings,
        });
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        entries.push({
          sourcePath,
          relativePath,
          outputPath,
          sourceHash,
          sourceMtimeMs: stat.mtimeMs,
          sourceSize: stat.size,
          pipeline: plan.id,
          planner: "deterministic",
          convertedAt: new Date().toISOString(),
          stale: false,
          warnings,
          error: message,
        });
        options.onLog?.(`Failed ${relativePath}: ${message}`);
      }
    }

    let stale = 0;
    for (const previous of oldEntries.values()) {
      if (!seen.has(previous.relativePath)) {
        stale++;
        const staleOutputPath = join(generatedRoot, ".stale", `${previous.relativePath}.md`);
        if (existsSync(previous.outputPath)) {
          mkdirSync(dirname(staleOutputPath), { recursive: true });
          renameSync(previous.outputPath, staleOutputPath);
        }
        entries.push({ ...previous, outputPath: staleOutputPath, stale: true });
      }
    }

    const manifest: IngestionManifest = {
      collection: options.collection,
      sourceRoot,
      generatedRoot,
      updatedAt: new Date().toISOString(),
      entries,
    };
    writeFileSync(this.manifestPath(options.collection), JSON.stringify(manifest, null, 2));
    options.onProgress?.(100);

    return {
      collection: options.collection,
      sourceRoot,
      generatedRoot,
      converted,
      skipped,
      failed,
      stale,
      manifestPath: this.manifestPath(options.collection),
    };
  }

  private async discover(sourceRoot: string, pattern = "**/*", ignore: string[] = []): Promise<string[]> {
    return fastGlob(pattern, {
      cwd: sourceRoot,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: [
        "**/.git/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        ...ignore,
      ],
    });
  }
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function convertFile(path: string, pipeline: string): Promise<string> {
  if (pipeline === "markdown-passthrough") return readFileSync(path, "utf-8");
  if (pipeline === "plain-text") return fencedIfCode(path, readFileSync(path, "utf-8"));
  if (pipeline === "pandoc-markdown") return runCommand("pandoc", [path, "-t", "gfm"]);
  if (pipeline === "pdf-text") return runCommand("pdftotext", ["-layout", path, "-"]);
  throw new Error(`Unsupported pipeline: ${pipeline}`);
}

function fencedIfCode(path: string, content: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const codeExtensions = new Set(["js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "cpp", "h", "hpp", "cs", "sh", "sql", "css"]);
  if (!codeExtensions.has(extension)) return content;
  return `\`\`\`${extension}\n${content}\n\`\`\`\n`;
}

function withFrontmatter(input: {
  collection: string;
  sourcePath: string;
  relativePath: string;
  sourceHash: string;
  pipeline: string;
  body: string;
}): string {
  return [
    "---",
    `source_collection: ${yamlScalar(input.collection)}`,
    `original_path: ${yamlScalar(input.sourcePath)}`,
    `original_relative_path: ${yamlScalar(input.relativePath)}`,
    `content_hash: ${input.sourceHash}`,
    `converter: ${input.pipeline}`,
    `converted_at: ${new Date().toISOString()}`,
    "---",
    "",
    `# ${input.relativePath}`,
    "",
    input.body,
  ].join("\n");
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}
