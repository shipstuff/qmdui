import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createStore, type QMDStore } from "@tobilu/qmd";
import type { AppConfig } from "../src/config.js";
import { generateOllamaEmbeddings } from "../src/ollamaEmbedding.js";

type Endpoint = {
  name: string;
  baseUrl: string;
};

type BenchResult = {
  mode: "direct" | "qmd-e2e" | "native-qmd";
  endpoint: string;
  model: string;
  batchSize?: number;
  docs?: number;
  chunks?: number;
  dims?: number | null;
  durationMs: number;
  chunksPerSec?: number;
  docsPerSec?: number;
  run: string;
};

const DEFAULT_NATIVE_MODEL = "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
const DEFAULT_TEXT = "QMDUI memory indexing compares embedding providers for markdown retrieval. " +
  "The document discusses OpenClaw, merge deploys, Kubernetes admin configuration, semantic search validation, " +
  "right sizing batch throughput, and enterprise memory indexing. ";

const modes = listEnv("BENCH_MODES", ["direct", "qmd-e2e"]);
const models = listEnv("BENCH_MODELS", ["embeddinggemma", "qwen3-embedding:8b"]);
const batches = intListEnv("BENCH_BATCHES", [16, 64, 128]);
const repeats = intEnv("BENCH_REPEATS", 2);
const docs = intEnv("BENCH_DOCS", 64);
const repeatParagraphs = intEnv("BENCH_REPEAT_PARAGRAPHS", 8);
const nativeModel = process.env.BENCH_NATIVE_MODEL ?? DEFAULT_NATIVE_MODEL;
const endpoints = endpointList();
const allResults: BenchResult[] = [];

for (const endpoint of endpoints) {
  for (const model of models) {
    const maxBatch = Math.max(...batches);
    if (modes.includes("direct")) {
      console.error(`warming direct ${endpoint.name} ${model}`);
      await runDirect(endpoint, model, maxBatch, "warmup-discarded");

      for (const batchSize of batches) {
        for (let run = 1; run <= repeats; run++) {
          const result = await runDirect(endpoint, model, batchSize, `warm-${run}`);
          allResults.push(result);
          console.log(JSON.stringify(result));
        }
      }
    }

    if (modes.includes("qmd-e2e")) {
      console.error(`warming qmd-e2e ${endpoint.name} ${model}`);
      await runDirect(endpoint, model, Math.min(maxBatch, docs), "warmup-discarded");

      for (const batchSize of batches) {
        for (let run = 1; run <= repeats; run++) {
          const result = await runQmdE2E(endpoint, model, batchSize, `warm-${run}`);
          allResults.push(result);
          console.log(JSON.stringify(result));
        }
      }
    }
  }
}

if (modes.includes("native")) {
  const result = await runNativeQmd();
  allResults.push(result);
  console.log(JSON.stringify(result));
}

const summary = summarize(allResults);
console.error("BENCH_SUMMARY_JSON=" + JSON.stringify(summary));
console.error(toMarkdown(summary));

async function runDirect(endpoint: Endpoint, model: string, batchSize: number, run: string): Promise<BenchResult> {
  const input = makeInputs(batchSize);
  const started = performance.now();
  const embeddings = await embedAuto(endpoint.baseUrl, model, input);
  const durationMs = Math.round(performance.now() - started);
  return {
    mode: "direct",
    endpoint: endpoint.name,
    model,
    batchSize,
    chunks: input.length,
    dims: embeddings[0]?.length ?? null,
    durationMs,
    chunksPerSec: perSecond(input.length, durationMs),
    run,
  };
}

async function runQmdE2E(endpoint: Endpoint, model: string, batchSize: number, run: string): Promise<BenchResult> {
  const root = mkdtempSync(join(tmpdir(), "qmdui-provider-bench-"));
  const docsDir = join(root, "docs");
  mkdirSync(docsDir, { recursive: true });
  for (let index = 0; index < docs; index++) {
    writeFileSync(join(docsDir, `doc-${String(index).padStart(4, "0")}.md`), makeDocument(index));
  }

  const store = await createStore({
    dbPath: join(root, "bench.sqlite"),
    config: {
      global_context: "QMDUI provider benchmark",
      collections: {
        bench: {
          path: docsDir,
          pattern: "**/*.md",
          includeByDefault: true,
        },
      },
      models: {
        embed: model,
      },
    },
  });

  try {
    await store.update();
    const started = performance.now();
    const result = await generateOllamaEmbeddings(store as QMDStore, appConfig(endpoint.baseUrl, model, batchSize, root), {
      force: true,
      maxDocsPerBatch: docs,
      maxBatchBytes: 64 * 1024 * 1024,
    });
    const durationMs = Math.round(performance.now() - started);
    return {
      mode: "qmd-e2e",
      endpoint: endpoint.name,
      model,
      batchSize,
      docs: result.docsProcessed,
      chunks: result.chunksEmbedded,
      durationMs,
      chunksPerSec: perSecond(result.chunksEmbedded, durationMs),
      docsPerSec: perSecond(result.docsProcessed, durationMs),
      run,
    };
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function runNativeQmd(): Promise<BenchResult> {
  const root = mkdtempSync(join(tmpdir(), "qmdui-native-bench-"));
  const docsDir = join(root, "docs");
  mkdirSync(docsDir, { recursive: true });
  for (let index = 0; index < docs; index++) {
    writeFileSync(join(docsDir, `doc-${String(index).padStart(4, "0")}.md`), makeDocument(index));
  }
  const store = await createStore({
    dbPath: join(root, "native.sqlite"),
    config: {
      global_context: "QMDUI native provider benchmark",
      collections: { bench: { path: docsDir, pattern: "**/*.md", includeByDefault: true } },
      models: { embed: nativeModel },
    },
  });

  try {
    await store.update();
    console.error("warming native-qmd");
    await store.embed({ force: true, model: nativeModel, maxDocsPerBatch: docs, maxBatchBytes: 64 * 1024 * 1024 });
    const started = performance.now();
    const result = await store.embed({ force: true, model: nativeModel, maxDocsPerBatch: docs, maxBatchBytes: 64 * 1024 * 1024 });
    const durationMs = Math.round(performance.now() - started);
    return {
      mode: "native-qmd",
      endpoint: "in-process",
      model: nativeModel,
      docs: result.docsProcessed,
      chunks: result.chunksEmbedded,
      durationMs,
      chunksPerSec: perSecond(result.chunksEmbedded, durationMs),
      docsPerSec: perSecond(result.docsProcessed, durationMs),
      run: "warm",
    };
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function embedAuto(baseUrl: string, model: string, input: string[]): Promise<number[][]> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const attempts = [
    {
      url: `${cleanBase}/api/embed`,
      payload: { model, input, keep_alive: "10m" },
      normalize: (body: any) => normalizeEmbeddings(body.embeddings ?? body.embedding),
    },
    {
      url: `${cleanBase}/api/embeddings`,
      payload: { model, prompt: input.length === 1 ? input[0] : undefined, input },
      normalize: (body: any) => normalizeEmbeddings(body.embeddings ?? body.embedding),
    },
    {
      url: `${cleanBase}/v1/embeddings`,
      payload: { model, input },
      normalize: (body: any) => normalizeEmbeddings(body.data?.map((item: any) => item.embedding)),
    },
  ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    const response = await fetch(attempt.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(attempt.payload),
      signal: AbortSignal.timeout(intEnv("BENCH_REQUEST_TIMEOUT_MS", 240000)),
    }).catch((error) => {
      errors.push(`${attempt.url}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });

    if (!response) continue;
    const text = await response.text();
    if (!response.ok) {
      errors.push(`${attempt.url}: HTTP ${response.status} ${text.slice(0, 160)}`);
      if (![404, 405].includes(response.status)) break;
      continue;
    }

    const body = text ? JSON.parse(text) : {};
    const embeddings = attempt.normalize(body);
    if (embeddings?.length === input.length) return embeddings;
    errors.push(`${attempt.url}: unexpected embedding response`);
  }

  throw new Error(`Embedding failed for ${baseUrl} ${model}: ${errors.join("; ")}`);
}

function normalizeEmbeddings(value: unknown): number[][] | null {
  if (!Array.isArray(value)) return null;
  if (value.every((item) => typeof item === "number")) return [value.map(Number)];
  const vectors = value.map((item) => Array.isArray(item) ? item.map(Number) : null);
  return vectors.every((item) => item?.every(Number.isFinite)) ? vectors as number[][] : null;
}

function makeInputs(count: number): string[] {
  return Array.from({ length: count }, (_, index) => makeDocument(index));
}

function makeDocument(index: number): string {
  return `# Benchmark Document ${index}\n\n${DEFAULT_TEXT.repeat(repeatParagraphs)}\n`;
}

function appConfig(baseUrl: string, model: string, batchSize: number, root: string): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    rootDir: root,
    dataDir: root,
    generatedDir: join(root, "generated"),
    manifestDir: join(root, "manifests"),
    policyPath: join(root, "access-policies.json"),
    qmdIndexName: "bench",
    qmdDbPath: join(root, "bench.sqlite"),
    qmdConfigPath: join(root, "bench.yml"),
    embedProvider: "ollama",
    embedTimeoutMs: intEnv("BENCH_REQUEST_TIMEOUT_MS", 240000),
    embedRequireComplete: true,
    embedFailOnErrors: true,
    ollamaBaseUrl: baseUrl,
    ollamaEmbedModel: model,
    ollamaBatchSize: batchSize,
  };
}

function endpointList(): Endpoint[] {
  const configured = listEnv("BENCH_ENDPOINTS", []);
  const endpoints = configured.map((item) => {
    const [name, ...urlParts] = item.split("=");
    return { name, baseUrl: urlParts.join("=") };
  }).filter((item) => item.name && item.baseUrl);

  if (process.env.BENCH_OLLAMA_URL || endpoints.length === 0) {
    endpoints.unshift({ name: "local-ollama", baseUrl: process.env.BENCH_OLLAMA_URL ?? "http://127.0.0.1:11434" });
  }
  if (process.env.BENCH_LLAMA_CPP_URL) endpoints.push({ name: "llama-cpp", baseUrl: process.env.BENCH_LLAMA_CPP_URL });
  if (process.env.BENCH_NODE_LLAMA_CPP_URL) endpoints.push({ name: "node-llama-cpp", baseUrl: process.env.BENCH_NODE_LLAMA_CPP_URL });
  return endpoints;
}

function summarize(results: BenchResult[]): BenchResult[] {
  const groups = new Map<string, BenchResult[]>();
  for (const result of results) {
    const key = [result.mode, result.endpoint, result.model, result.batchSize ?? "none"].join("|");
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return [...groups.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.durationMs - b.durationMs);
    const best = sorted[0];
    const avgDurationMs = Math.round(group.reduce((sum, item) => sum + item.durationMs, 0) / group.length);
    return {
      ...best,
      durationMs: avgDurationMs,
      chunksPerSec: best.chunks ? perSecond(best.chunks, avgDurationMs) : undefined,
      docsPerSec: best.docs ? perSecond(best.docs, avgDurationMs) : undefined,
      run: `avg-${group.length}`,
    };
  });
}

function toMarkdown(results: BenchResult[]): string {
  const rows = [
    "| Mode | Endpoint | Model | Batch | Docs | Chunks | Avg ms | Chunks/sec | Docs/sec |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map((item) => [
      item.mode,
      item.endpoint,
      `\`${item.model}\``,
      item.batchSize ?? "",
      item.docs ?? "",
      item.chunks ?? "",
      item.durationMs,
      item.chunksPerSec ?? "",
      item.docsPerSec ?? "",
    ].join(" | ")).map((row) => `| ${row} |`),
  ];
  return rows.join("\n");
}

function perSecond(count: number, durationMs: number): number {
  return Number((count / (durationMs / 1000)).toFixed(2));
}

function listEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function intEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function intListEnv(name: string, fallback: number[]): number[] {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0);
  return parsed.length ? parsed.map(Math.round) : fallback;
}
