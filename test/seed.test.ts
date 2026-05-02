import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedConfiguredCollection, seedOptionsFromEnv } from "../src/seed.js";
import type { AppConfig } from "../src/config.js";

const tempDirs: string[] = [];

function makeConfig(): AppConfig {
  const dir = mkdtempSync(join(tmpdir(), "qmdui-seed-"));
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

describe("seedOptionsFromEnv", () => {
  it("parses OpenClaw seed env without exposing source paths by default", () => {
    const options = seedOptionsFromEnv({
      QMDUI_SEED_COLLECTION: "openclaw",
      QMDUI_SEED_SOURCE_ROOT: "/data/seeds/openclaw",
      QMDUI_SEED_ACCESS_MODE: "groups",
      QMDUI_SEED_ACCESS_GROUPS: "qa,engineering",
    } as NodeJS.ProcessEnv);

    expect(options.collection).toBe("openclaw");
    expect(options.sourceRoot).toBe("/data/seeds/openclaw");
    expect(options.pattern).toBe("**/*.md");
    expect(options.includeHidden).toBe(true);
    expect(options.useDefaultIgnore).toBe(false);
    expect(options.flattenOutput).toBe(true);
    expect(options.cleanOutput).toBe(true);
    expect(options.accessMode).toBe("groups");
    expect(options.accessGroups).toEqual(["qa", "engineering"]);
    expect(options.exposeSourcePaths).toBe(false);
  });
});

describe("seedConfiguredCollection", () => {
  it("skips a missing optional source root", async () => {
    const result = await seedConfiguredCollection({
      config: makeConfig(),
      ingestion: {} as any,
      qmd: {} as any,
      policies: {} as any,
    }, {
      ...seedOptionsFromEnv({} as NodeJS.ProcessEnv),
      sourceRoot: "/definitely/missing/qmdui/source",
      requireSource: false,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("Seed source does not exist");
  });
});
