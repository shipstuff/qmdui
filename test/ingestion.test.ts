import { existsSync, readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { IngestionService } from "../src/ingestion/IngestionService.js";

const tempDirs: string[] = [];

function makeConfig(): AppConfig {
  const dir = mkdtempSync(join(tmpdir(), "qmdui-ingest-"));
  tempDirs.push(dir);
  return {
    host: "127.0.0.1",
    port: 8765,
    rootDir: dir,
    dataDir: join(dir, ".qmdui"),
    generatedDir: join(dir, ".qmdui", "generated"),
    manifestDir: join(dir, ".qmdui", "manifests"),
    policyPath: join(dir, ".qmdui", "access-policies.json"),
    qmdIndexName: "index",
    qmdDbPath: join(dir, "index.sqlite"),
    qmdConfigPath: join(dir, "index.yml"),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("IngestionService", () => {
  it("converts markdown and text files into generated markdown without mutating source", async () => {
    const config = makeConfig();
    const source = join(config.rootDir, "source");
    mkdirSync(source, { recursive: true });
    const markdown = join(source, "note.md");
    const text = join(source, "runbook.txt");
    writeFileSync(markdown, "# Alpha\n\nOriginal markdown");
    writeFileSync(text, "Plain text runbook");

    const service = new IngestionService(config);
    const result = await service.ingest({ collection: "docs", sourceRoot: source });

    expect(result.converted).toBe(2);
    expect(readFileSync(markdown, "utf-8")).toBe("# Alpha\n\nOriginal markdown");
    expect(readFileSync(text, "utf-8")).toBe("Plain text runbook");

    const generatedNote = join(config.generatedDir, "docs", "note.md.md");
    const generatedText = join(config.generatedDir, "docs", "runbook.txt.md");
    expect(existsSync(generatedNote)).toBe(true);
    expect(existsSync(generatedText)).toBe(true);
    expect(readFileSync(generatedText, "utf-8")).toContain("original_path:");
    expect(readFileSync(generatedText, "utf-8")).toContain("Plain text runbook");
  });

  it("moves stale generated files under a hidden cache instead of deleting source files", async () => {
    const config = makeConfig();
    const source = join(config.rootDir, "source");
    mkdirSync(source, { recursive: true });
    const sourceFile = join(source, "old.txt");
    writeFileSync(sourceFile, "Old text");

    const service = new IngestionService(config);
    await service.ingest({ collection: "docs", sourceRoot: source });
    unlinkSync(sourceFile);

    const result = await service.ingest({ collection: "docs", sourceRoot: source });
    const stalePath = join(config.generatedDir, "docs", ".stale", "old.txt.md");
    const manifest = service.readManifest("docs");

    expect(result.stale).toBe(1);
    expect(existsSync(stalePath)).toBe(true);
    expect(manifest?.entries.find((entry) => entry.relativePath === "old.txt")?.stale).toBe(true);
  });
});
