import { basename } from "node:path";
import { TextEncoder } from "node:util";
import type { ChunkStrategy, EmbedProgress, EmbedResult, QMDStore, SearchResult } from "@tobilu/qmd";
import type { AppConfig } from "./config.js";

export type EmbedRequestOptions = {
  force?: boolean;
  model?: string;
  maxDocsPerBatch?: number;
  maxBatchBytes?: number;
  chunkStrategy?: ChunkStrategy;
  onProgress?: (info: EmbedProgress) => void;
};

type PendingDoc = {
  hash: string;
  body: string;
  path: string;
  bytes: number;
};

type PendingChunk = {
  hash: string;
  title: string;
  text: string;
  seq: number;
  pos: number;
  bytes: number;
};

type OllamaEmbedResponse = {
  embeddings?: unknown;
  embedding?: unknown;
};

type OpenAiEmbeddingResponse = {
  data?: Array<{ embedding?: unknown }>;
};

class EmbedHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_MAX_DOCS_PER_BATCH = 64;
const DEFAULT_MAX_BATCH_BYTES = 32 * 1024 * 1024;
const CHUNK_SIZE_CHARS = 2700;
const CHUNK_OVERLAP_CHARS = 300;

export class OllamaEmbeddingClient {
  private readonly baseUrl: string;
  private readonly openAiBaseUrl: string;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = config.ollamaBaseUrl.replace(/\/+$/, "");
    this.openAiBaseUrl = this.baseUrl.endsWith("/ollama")
      ? this.baseUrl.slice(0, -"/ollama".length)
      : this.baseUrl;
  }

  model(options?: { model?: string }): string {
    return options?.model ?? this.config.ollamaEmbedModel;
  }

  async embedQuery(query: string, options?: { model?: string }): Promise<number[]> {
    const model = this.model(options);
    const [embedding] = await this.embedBatch([formatQueryForEmbedding(query, model)], model);
    if (!embedding) throw new Error("Ollama did not return a query embedding");
    return embedding;
  }

  async embedDocuments(chunks: Array<{ text: string; title?: string }>, options?: { model?: string }): Promise<number[][]> {
    const model = this.model(options);
    const formatted = chunks.map((chunk) => formatDocForEmbedding(chunk.text, chunk.title, model));
    return this.embedBatch(formatted, model);
  }

  private async embedBatch(input: string[], model: string): Promise<number[][]> {
    if (input.length === 0) return [];
    const payload = { model, input };
    try {
      const data = await this.postJson<OllamaEmbedResponse>(`${this.baseUrl}/api/embed`, payload);
      const embeddings = normalizeEmbeddings(data, input.length);
      if (!embeddings) {
        throw new Error("Ollama /api/embed response did not include embeddings");
      }
      return embeddings;
    } catch (error) {
      if (!isUnsupportedEndpoint(error)) throw error;
    }

    try {
      return await Promise.all(input.map((prompt) => this.embedOneLegacy(prompt, model)));
    } catch (error) {
      if (!isUnsupportedEndpoint(error)) throw error;
    }

    return this.embedOpenAi(input, model);
  }

  private async embedOneLegacy(prompt: string, model: string): Promise<number[]> {
    const data = await this.postJson<OllamaEmbedResponse>(`${this.baseUrl}/api/embeddings`, { model, prompt });
    const embedding = normalizeVector(data.embedding);
    if (!embedding) {
      throw new Error("Ollama /api/embeddings response did not include an embedding");
    }
    return embedding;
  }

  private async embedOpenAi(input: string[], model: string): Promise<number[][]> {
    const data = await this.postJson<OpenAiEmbeddingResponse>(`${this.openAiBaseUrl}/v1/embeddings`, { model, input });
    const embeddings = data.data?.map((item) => normalizeVector(item.embedding));
    if (!embeddings || !embeddings.every(Boolean)) {
      throw new Error("OpenAI-compatible /v1/embeddings response did not include embeddings");
    }
    return embeddings as number[][];
  }

  private async postJson<T>(url: string, payload: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`Ollama embedding request exceeded ${this.config.embedTimeoutMs}ms`)),
      this.config.embedTimeoutMs,
    );
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const excerpt = text.slice(0, 300);
        throw new EmbedHttpError(
          response.status,
          `Embedding request failed with ${response.status}${excerpt ? `: ${excerpt}` : ""}`,
        );
      }
      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function generateOllamaEmbeddings(
  store: QMDStore,
  config: AppConfig,
  options: EmbedRequestOptions = {},
): Promise<EmbedResult> {
  const internal = store.internal;
  const model = options.model ?? config.ollamaEmbedModel;
  const client = new OllamaEmbeddingClient(config);
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  const embeddedAt = new Date().toISOString();

  if (options.force) internal.clearAllEmbeddings();

  const docs = internal.getHashesForEmbedding()
    .map((doc) => ({
      ...doc,
      bytes: encoder.encode(doc.body).length,
    }))
    .filter((doc) => doc.body.trim()) satisfies PendingDoc[];

  if (docs.length === 0) {
    return { docsProcessed: 0, chunksEmbedded: 0, errors: 0, durationMs: 0 };
  }

  const totalBytes = docs.reduce((sum, doc) => sum + doc.bytes, 0);
  const batches = buildDocBatches(docs, options.maxDocsPerBatch, options.maxBatchBytes);
  let chunksEmbedded = 0;
  let errors = 0;
  let totalChunks = 0;
  let bytesProcessed = 0;
  let vectorTableInitialized = false;

  for (const batch of batches) {
    const batchBytes = batch.reduce((sum, doc) => sum + doc.bytes, 0);
    const chunks = batch.flatMap((doc) => chunkPendingDoc(doc, encoder, options.chunkStrategy));
    totalChunks += chunks.length;

    if (chunks.length === 0) {
      bytesProcessed += batchBytes;
      options.onProgress?.({ chunksEmbedded, totalChunks, bytesProcessed, totalBytes, errors });
      continue;
    }

    const batchChunkBytes = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    let batchChunkBytesProcessed = 0;

    for (let index = 0; index < chunks.length; index += config.ollamaBatchSize) {
      const chunkBatch = chunks.slice(index, index + config.ollamaBatchSize);

      try {
        const embeddings = await client.embedDocuments(chunkBatch, { model });
        if (embeddings.length !== chunkBatch.length) {
          throw new Error(`Ollama returned ${embeddings.length} embeddings for ${chunkBatch.length} chunks`);
        }

        if (!vectorTableInitialized) {
          const firstEmbedding = embeddings.find((embedding) => embedding.length > 0);
          if (!firstEmbedding) throw new Error("Ollama returned empty embeddings");
          internal.ensureVecTable(firstEmbedding.length);
          vectorTableInitialized = true;
        }

        for (let offset = 0; offset < chunkBatch.length; offset++) {
          const chunk = chunkBatch[offset];
          const embedding = embeddings[offset];
          if (embedding?.length) {
            internal.insertEmbedding(chunk.hash, chunk.seq, chunk.pos, new Float32Array(embedding), model, embeddedAt);
            chunksEmbedded++;
          } else {
            errors++;
          }
          batchChunkBytesProcessed += chunk.bytes;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Ollama embedding batch failed after ${chunksEmbedded} chunks: ${message}`);
      }

      const proportionalBytes = batchChunkBytes === 0
        ? batchBytes
        : Math.min(batchBytes, Math.round((batchChunkBytesProcessed / batchChunkBytes) * batchBytes));
      options.onProgress?.({
        chunksEmbedded,
        totalChunks,
        bytesProcessed: bytesProcessed + proportionalBytes,
        totalBytes,
        errors,
      });
    }

    bytesProcessed += batchBytes;
    options.onProgress?.({ chunksEmbedded, totalChunks, bytesProcessed, totalBytes, errors });
  }

  return {
    docsProcessed: docs.length,
    chunksEmbedded,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

export async function searchVectorWithOllama(
  store: QMDStore,
  config: AppConfig,
  query: string,
  collections: string[],
  limit: number,
): Promise<SearchResult[]> {
  const client = new OllamaEmbeddingClient(config);
  const embedding = await client.embedQuery(query);
  const results = await Promise.all(
    collections.map((collection) => (
      store.internal.searchVec(query, config.ollamaEmbedModel, limit, collection, undefined, embedding)
    )),
  );
  return results.flat();
}

function isUnsupportedEndpoint(error: unknown): boolean {
  return error instanceof EmbedHttpError && [404, 405].includes(error.status);
}

function normalizeEmbeddings(value: OllamaEmbedResponse, expected: number): number[][] | null {
  if (Array.isArray(value.embeddings)) {
    const embeddings = value.embeddings.map(normalizeVector);
    return embeddings.every(Boolean) ? embeddings as number[][] : null;
  }

  const single = normalizeVector(value.embedding);
  if (single && expected === 1) return [single];
  return null;
}

function normalizeVector(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const vector = value.map((item) => Number(item));
  return vector.every(Number.isFinite) ? vector : null;
}

function buildDocBatches(docs: PendingDoc[], maxDocsPerBatch?: number, maxBatchBytes?: number): PendingDoc[][] {
  const docLimit = Math.max(1, maxDocsPerBatch ?? DEFAULT_MAX_DOCS_PER_BATCH);
  const byteLimit = Math.max(1, maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES);
  const batches: PendingDoc[][] = [];
  let current: PendingDoc[] = [];
  let currentBytes = 0;

  for (const doc of docs) {
    if (current.length > 0 && (current.length >= docLimit || currentBytes + doc.bytes > byteLimit)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(doc);
    currentBytes += doc.bytes;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function chunkPendingDoc(doc: PendingDoc, encoder: TextEncoder, _strategy?: ChunkStrategy): PendingChunk[] {
  const title = extractTitle(doc.body, doc.path);
  return chunkText(doc.body).map((chunk, seq) => ({
    hash: doc.hash,
    title,
    text: chunk.text,
    seq,
    pos: chunk.pos,
    bytes: encoder.encode(chunk.text).length,
  }));
}

function chunkText(text: string): Array<{ text: string; pos: number }> {
  if (text.length <= CHUNK_SIZE_CHARS) return [{ text, pos: 0 }];

  const chunks: Array<{ text: string; pos: number }> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_SIZE_CHARS);
    if (end < text.length) {
      const boundary = findBoundary(text, start, end);
      if (boundary > start) end = boundary;
    }

    chunks.push({ text: text.slice(start, end), pos: start });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP_CHARS);
  }

  return chunks;
}

function findBoundary(text: string, start: number, end: number): number {
  const windowStart = Math.max(start + Math.floor(CHUNK_SIZE_CHARS * 0.5), end - 600);
  const segment = text.slice(windowStart, end);
  const markers = ["\n## ", "\n# ", "\n\n", "\n", ". "];

  for (const marker of markers) {
    const index = segment.lastIndexOf(marker);
    if (index >= 0) return windowStart + index + marker.length;
  }

  return end;
}

function extractTitle(body: string, path: string): string {
  const heading = body.match(/^#{1,2}\s+(.+)$/m);
  return heading?.[1]?.trim() || basename(path) || "Untitled";
}

function isQwenEmbeddingModel(model: string): boolean {
  return /qwen3.*embed|qwen.*embedding/i.test(model);
}

function formatQueryForEmbedding(query: string, model: string): string {
  if (isQwenEmbeddingModel(model)) {
    return `Instruct: Retrieve relevant documents for the given query\nQuery: ${query}`;
  }
  return `task: search result | query: ${query}`;
}

function formatDocForEmbedding(text: string, title: string | undefined, model: string): string {
  if (isQwenEmbeddingModel(model)) return title ? `${title}\n${text}` : text;
  return `title: ${title || "none"} | text: ${text}`;
}
