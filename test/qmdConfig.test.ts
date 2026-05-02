import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { readQmdConfig, writeQmdConfig } from "../src/qmdConfig.js";

const tempDirs: string[] = [];

function makeConfig(): AppConfig {
  const dir = mkdtempSync(join(tmpdir(), "qmdui-qmd-config-"));
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
    qmdConfigPath: join(dir, "config", "qmd", "index.yml"),
    embedProvider: "qmd",
    embedTimeoutMs: 600000,
    embedRequireComplete: true,
    embedFailOnErrors: true,
    ollamaBaseUrl: "http://exo-master:52415/ollama",
    ollamaEmbedModel: "mlx-community/Qwen3-Embedding-8B-4bit-DWQ",
    ollamaBatchSize: 16,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("QMD config helpers", () => {
  it("returns a default config when the file does not exist", () => {
    const config = makeConfig();
    const snapshot = readQmdConfig(config);

    expect(snapshot.exists).toBe(false);
    expect(snapshot.content).toContain("collections: {}");
  });

  it("validates and writes YAML config", () => {
    const config = makeConfig();
    const content = "collections:\n  docs:\n    path: /docs\n    pattern: '**/*.md'\n";

    writeQmdConfig(config, content);

    expect(existsSync(config.qmdConfigPath)).toBe(true);
    expect(readFileSync(config.qmdConfigPath, "utf-8")).toContain("collections:");
  });

  it("rejects scalar YAML config", () => {
    expect(() => writeQmdConfig(makeConfig(), "not-a-config")).toThrow("YAML object");
  });
});
