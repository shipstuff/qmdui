import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { AccessPolicyStore } from "../src/accessPolicy.js";
import type { AppConfig } from "../src/config.js";

const tempDirs: string[] = [];

function config(): AppConfig {
  const dir = mkdtempSync(join(tmpdir(), "qmdui-test-"));
  tempDirs.push(dir);
  return {
    host: "127.0.0.1",
    port: 8765,
    rootDir: dir,
    dataDir: dir,
    generatedDir: join(dir, "generated"),
    manifestDir: join(dir, "manifests"),
    policyPath: join(dir, "policies.json"),
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

describe("AccessPolicyStore", () => {
  it("defaults unknown collections to admin-only", () => {
    const store = new AccessPolicyStore(config());
    expect(store.canAccess("secret", { userId: "u1", role: "user", groups: [] })).toBe(false);
    expect(store.canAccess("secret", { userId: "admin", role: "admin", groups: [] })).toBe(true);
  });

  it("allows users by group policy", () => {
    const store = new AccessPolicyStore(config());
    store.set("docs", {
      collection: "docs",
      mode: "groups",
      groups: ["eng"],
      users: [],
      exposeSourcePaths: false,
    });
    expect(store.canAccess("docs", { userId: "u1", role: "user", groups: ["eng"] })).toBe(true);
    expect(store.canAccess("docs", { userId: "u2", role: "user", groups: ["sales"] })).toBe(false);
  });

  it("never allows pending users", () => {
    const store = new AccessPolicyStore(config());
    store.set("docs", {
      collection: "docs",
      mode: "all",
      groups: [],
      users: [],
      exposeSourcePaths: true,
    });
    expect(store.canAccess("docs", { userId: "u1", role: "pending", groups: ["eng"] })).toBe(false);
  });
});
