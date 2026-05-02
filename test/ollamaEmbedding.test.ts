import { describe, expect, it, vi, afterEach } from "vitest";
import type { AppConfig } from "../src/config.js";
import { OllamaEmbeddingClient } from "../src/ollamaEmbedding.js";

function makeConfig(): AppConfig {
  return {
    host: "127.0.0.1",
    port: 8765,
    rootDir: "/tmp/qmdui",
    dataDir: "/tmp/qmdui/data",
    generatedDir: "/tmp/qmdui/generated",
    manifestDir: "/tmp/qmdui/manifests",
    policyPath: "/tmp/qmdui/policies.json",
    qmdIndexName: "index",
    qmdDbPath: "/tmp/qmdui/index.sqlite",
    qmdConfigPath: "/tmp/qmdui/index.yml",
    embedProvider: "ollama",
    embedTimeoutMs: 600000,
    embedRequireComplete: true,
    embedFailOnErrors: true,
    ollamaBaseUrl: "http://exo-master:52415/ollama",
    ollamaEmbedModel: "mlx-community/Qwen3-Embedding-8B-4bit-DWQ",
    ollamaBatchSize: 16,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OllamaEmbeddingClient", () => {
  it("uses the configured Ollama base URL and Qwen query formatting", async () => {
    const requests: Array<{ url: string; body: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json({ embeddings: [[0.1, 0.2, 0.3]] });
    }));

    const client = new OllamaEmbeddingClient(makeConfig());
    const embedding = await client.embedQuery("deployment checklist");

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    expect(requests[0].url).toBe("http://exo-master:52415/ollama/api/embed");
    expect(requests[0].body.input[0]).toContain("Instruct: Retrieve relevant documents");
  });

  it("falls back to root OpenAI-compatible embeddings when Ollama embedding routes are absent", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      urls.push(String(url));
      if (String(url).endsWith("/v1/embeddings")) {
        return Response.json({ data: [{ embedding: [1, 2, 3] }] });
      }
      return new Response("not allowed", { status: 405 });
    }));

    const client = new OllamaEmbeddingClient(makeConfig());
    const embedding = await client.embedQuery("deployment checklist");

    expect(embedding).toEqual([1, 2, 3]);
    expect(urls).toEqual([
      "http://exo-master:52415/ollama/api/embed",
      "http://exo-master:52415/ollama/api/embeddings",
      "http://exo-master:52415/v1/embeddings",
    ]);
  });
});
