import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccessPolicyStore } from "../src/accessPolicy.js";
import type { AppConfig } from "../src/config.js";
import { QmdService } from "../src/qmdService.js";

const tempDirs: string[] = [];

function makeConfig(): AppConfig {
  const dir = mkdtempSync(join(tmpdir(), "qmdui-qmd-service-"));
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

function generatedBody(originalPath: string, body: string): string {
  return [
    "---",
    'source_collection: "docs"',
    `original_path: "${originalPath}"`,
    'original_relative_path: "note.md"',
    "content_hash: abc123",
    "converter: markdown-passthrough",
    "converted_at: 2026-05-01T00:00:00.000Z",
    "---",
    "",
    body,
  ].join("\n");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("QmdService retrieval normalization", () => {
  it("omits full bodies unless includeFullDocument is requested", async () => {
    const config = makeConfig();
    const policies = new AccessPolicyStore(config);
    policies.set("docs", { collection: "docs", mode: "all", groups: [], users: [], exposeSourcePaths: false });

    const generatedPath = join(config.rootDir, "generated-note.md");
    const rawBody = generatedBody("/private/source/note.md", "# Deployment\n\nChecklist text");
    writeFileSync(generatedPath, rawBody);

    const service = new QmdService(config, policies);
    const fakeStore = {
      listCollections: async () => [{ name: "docs" }],
      searchLex: async () => [{
        docid: "abc",
        score: 1,
        title: "note.md",
        displayPath: "docs/note.md",
        filepath: generatedPath,
        snippet: rawBody,
        body: rawBody,
      }],
    };
    (service as any).storePromise = Promise.resolve(fakeStore);

    const results = await service.retrieve(
      { query: "deployment", mode: "quick" },
      { userId: "user", role: "user", groups: [] },
    );

    expect(results[0].body).toBeUndefined();
    expect(results[0].snippet).toContain("# Deployment");
    expect(results[0].snippet).not.toContain("original_path");
    expect(results[0].snippet).not.toContain("/private/source/note.md");
    expect(results[0].originalPath).toBeUndefined();
  });

  it("returns sanitized full bodies when includeFullDocument is requested", async () => {
    const config = makeConfig();
    const policies = new AccessPolicyStore(config);
    policies.set("docs", { collection: "docs", mode: "all", groups: [], users: [], exposeSourcePaths: false });

    const generatedPath = join(config.rootDir, "generated-note.md");
    const rawBody = generatedBody("/private/source/note.md", "# Deployment\n\nChecklist text");
    writeFileSync(generatedPath, rawBody);

    const service = new QmdService(config, policies);
    const fakeStore = {
      listCollections: async () => [{ name: "docs" }],
      searchLex: async () => [{
        docid: "abc",
        score: 1,
        title: "note.md",
        displayPath: "docs/note.md",
        filepath: generatedPath,
        snippet: "source_collection: \"docs\"\noriginal_path: \"/private/source/note.md\"\n\nChecklist text",
      }],
      getDocumentBody: async () => rawBody,
    };
    (service as any).storePromise = Promise.resolve(fakeStore);

    const results = await service.retrieve(
      { query: "deployment", mode: "quick", includeFullDocument: true },
      { userId: "user", role: "user", groups: [] },
    );

    expect(results[0].body).toBe("# Deployment\n\nChecklist text");
    expect(results[0].snippet).toBe("Checklist text");
    expect(results[0].body).not.toContain("original_path");
    expect(results[0].body).not.toContain("/private/source/note.md");
  });

  it("preserves original path metadata when policy allows source path exposure", async () => {
    const config = makeConfig();
    const policies = new AccessPolicyStore(config);
    policies.set("docs", { collection: "docs", mode: "all", groups: [], users: [], exposeSourcePaths: true });

    const generatedPath = join(config.rootDir, "generated-note.md");
    const rawBody = generatedBody("/private/source/note.md", "# Deployment\n\nChecklist text");
    writeFileSync(generatedPath, rawBody);

    const service = new QmdService(config, policies);
    const fakeStore = {
      listCollections: async () => [{ name: "docs" }],
      searchLex: async () => [{
        docid: "abc",
        score: 1,
        title: "note.md",
        displayPath: "docs/note.md",
        filepath: generatedPath,
        snippet: rawBody,
        body: rawBody,
      }],
    };
    (service as any).storePromise = Promise.resolve(fakeStore);

    const results = await service.retrieve(
      { query: "deployment", mode: "quick", includeFullDocument: true },
      { userId: "user", role: "user", groups: [] },
    );

    expect(results[0].originalPath).toBe('"/private/source/note.md"');
    expect(results[0].body).toContain("original_path");
  });
});

describe("QmdService embedding job status", () => {
  it("throws when QMD reports embedding errors", async () => {
    const config = makeConfig();
    const policies = new AccessPolicyStore(config);
    const service = new QmdService(config, policies);
    const fakeStore = {
      getStatus: async () => ({ totalDocuments: 2, needsEmbedding: 2, hasVectorIndex: false, collections: [] }),
      embed: async () => ({ docsProcessed: 2, chunksEmbedded: 1, errors: 1, durationMs: 100 }),
    };
    (service as any).storePromise = Promise.resolve(fakeStore);

    await expect(service.embed()).rejects.toThrow("1 embedding chunk failed");
  });

  it("throws when embedding returns without clearing pending documents", async () => {
    const config = makeConfig();
    const policies = new AccessPolicyStore(config);
    const service = new QmdService(config, policies);
    let calls = 0;
    const fakeStore = {
      getStatus: async () => {
        calls++;
        return {
          totalDocuments: 4,
          needsEmbedding: calls === 1 ? 4 : 3,
          hasVectorIndex: true,
          collections: [],
        };
      },
      embed: async () => ({ docsProcessed: 4, chunksEmbedded: 2, errors: 0, durationMs: 100 }),
    };
    (service as any).storePromise = Promise.resolve(fakeStore);

    await expect(service.embed()).rejects.toThrow("3 documents still need embeddings");
  });

  it("allows partial embedding when completion is not required", async () => {
    const config = makeConfig();
    const policies = new AccessPolicyStore(config);
    const service = new QmdService(config, policies);
    let calls = 0;
    const fakeStore = {
      getStatus: async () => {
        calls++;
        return {
          totalDocuments: 4,
          needsEmbedding: calls === 1 ? 4 : 3,
          hasVectorIndex: true,
          collections: [],
        };
      },
      embed: async () => ({ docsProcessed: 4, chunksEmbedded: 2, errors: 0, durationMs: 100 }),
    };
    (service as any).storePromise = Promise.resolve(fakeStore);

    await expect(service.embed({ requireComplete: false })).resolves.toMatchObject({
      result: { chunksEmbedded: 2, errors: 0 },
    });
  });
});
