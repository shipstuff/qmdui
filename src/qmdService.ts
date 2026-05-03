import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  createStore,
  type ChunkStrategy,
  type EmbedProgress,
  type EmbedResult,
  type IndexStatus,
  type QMDStore,
} from "@tobilu/qmd";
import type { AccessPolicyStore } from "./accessPolicy.js";
import type { AppConfig } from "./config.js";
import { generateOllamaEmbeddings, searchVectorWithOllama } from "./ollamaEmbedding.js";
import { writeQmdConfigFromCollections } from "./qmdConfig.js";
import type { AuthContext, RetrievalRequest, RetrievalResult } from "./types.js";

type QmdSearchResult = {
  docid?: string;
  score?: number;
  title?: string;
  file?: string;
  filepath?: string;
  displayPath?: string;
  context?: string | null;
  snippet?: string;
  body?: string;
  bestChunk?: string;
  chunkPos?: number;
  line?: number;
};

type SourceMetadata = {
  originalPath?: string;
  originalRelativePath?: string;
  sourceCollection?: string;
};

export type QmdUiEmbedOptions = {
  force?: boolean;
  model?: string;
  provider?: "qmd" | "ollama";
  maxDocsPerBatch?: number;
  maxBatchBytes?: number;
  chunkStrategy?: ChunkStrategy;
  requireComplete?: boolean;
  failOnErrors?: boolean;
  onProgress?: (info: EmbedProgress) => void;
  onLog?: (message: string) => void;
  onMetric?: (values: Record<string, string | number | boolean | null | undefined>) => void;
};

type EmbedEnvelope = {
  provider: "qmd" | "ollama";
  result: EmbedResult;
  before: IndexStatus;
  after: IndexStatus;
};

export class QmdService {
  private storePromise: Promise<QMDStore> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly policies: AccessPolicyStore,
  ) {}

  async getStore(): Promise<QMDStore> {
    if (!this.storePromise) {
      this.storePromise = createStore({
        dbPath: this.config.qmdDbPath,
        ...(existsSync(this.config.qmdConfigPath) ? { configPath: this.config.qmdConfigPath } : {}),
      });
    }
    return this.storePromise;
  }

  async close(): Promise<void> {
    if (!this.storePromise) return;
    const store = await this.storePromise;
    await store.close();
    this.storePromise = null;
  }

  async reload(): Promise<void> {
    await this.close();
    await this.getStore();
  }

  async status(): Promise<unknown> {
    const store = await this.getStore();
    return store.getStatus();
  }

  async dashboard(): Promise<unknown> {
    const store = await this.getStore();
    const [status, health, collections, contexts] = await Promise.all([
      store.getStatus(),
      store.getIndexHealth(),
      store.listCollections(),
      store.listContexts(),
    ]);
    return {
      status,
      health,
      collections,
      contexts,
      accessPolicies: this.policies.list(),
    };
  }

  async listCollections(): Promise<any[]> {
    const store = await this.getStore();
    return store.listCollections();
  }

  async addCollection(name: string, path: string, pattern = "**/*.md", ignore?: string[]): Promise<void> {
    const store = await this.getStore();
    await store.addCollection(name, { path, pattern, ignore });
    await this.writeConfigFromStore(store);
  }

  async removeCollection(name: string): Promise<boolean> {
    const store = await this.getStore();
    const removed = await store.removeCollection(name);
    await this.writeConfigFromStore(store);
    return removed;
  }

  async renameCollection(oldName: string, newName: string): Promise<boolean> {
    const store = await this.getStore();
    const renamed = await store.renameCollection(oldName, newName);
    await this.writeConfigFromStore(store);
    return renamed;
  }

  async update(collections?: string[]): Promise<unknown> {
    const store = await this.getStore();
    return store.update({ collections });
  }

  async embed(options: QmdUiEmbedOptions = {}): Promise<EmbedEnvelope> {
    const store = await this.getStore();
    const provider = options.provider ?? this.config.embedProvider;
    const before = await store.getStatus();
    options.onLog?.(
      `Embedding status before ${provider}: docs=${before.totalDocuments}, pending=${before.needsEmbedding}`,
    );
    const result = provider === "ollama"
      ? await generateOllamaEmbeddings(store, this.config, options)
      : await store.embed({
        force: options.force,
        model: options.model,
        maxDocsPerBatch: options.maxDocsPerBatch,
        maxBatchBytes: options.maxBatchBytes,
        chunkStrategy: options.chunkStrategy,
        onProgress: options.onProgress,
      });
    const after = await store.getStatus();
    const envelope = { provider, result, before, after };
    options.onLog?.(
      `Embedding status after ${provider}: docs=${after.totalDocuments}, pending=${after.needsEmbedding}, chunks=${result.chunksEmbedded}, errors=${result.errors}, durationMs=${result.durationMs}`,
    );
    this.assertEmbedCompleted(envelope, options);
    return envelope;
  }

  async listContexts(): Promise<unknown> {
    const store = await this.getStore();
    return store.listContexts();
  }

  async addContext(collection: string, pathPrefix: string, context: string): Promise<boolean> {
    const store = await this.getStore();
    return store.addContext(collection, pathPrefix, context);
  }

  async removeContext(collection: string, pathPrefix: string): Promise<boolean> {
    const store = await this.getStore();
    return store.removeContext(collection, pathPrefix);
  }

  async retrieve(request: RetrievalRequest, auth: AuthContext): Promise<RetrievalResult[]> {
    const store = await this.getStore();
    const allCollections = (await store.listCollections()).map((collection: any) => collection.name as string);
    const requestedCollections = request.collections?.length ? request.collections : allCollections;
    const allowedCollections = this.policies.filterCollections(requestedCollections, auth);
    if (allowedCollections.length === 0) return [];

    const limit = request.topK ?? 8;
    const minScore = request.minScore ?? 0;
    const mode = request.mode ?? "quick";

    let raw: QmdSearchResult[];
    if (mode === "quick") {
      const perCollection = await Promise.all(
        allowedCollections.map((collection) => store.searchLex(request.query, { collection, limit })),
      );
      raw = perCollection.flat() as QmdSearchResult[];
    } else if (mode === "semantic") {
      const perCollection = this.config.embedProvider === "ollama"
        ? [await searchVectorWithOllama(store, this.config, request.query, allowedCollections, limit)]
        : await Promise.all(
          allowedCollections.map((collection) => store.searchVector(request.query, { collection, limit })),
        );
      raw = perCollection.flat() as QmdSearchResult[];
    } else {
      if (this.config.embedProvider === "ollama") {
        const [lexical, vector] = await Promise.all([
          Promise.all(allowedCollections.map((collection) => store.searchLex(request.query, { collection, limit }))),
          searchVectorWithOllama(store, this.config, request.query, allowedCollections, limit),
        ]);
        raw = mergeSearchResults([...lexical.flat(), ...vector]) as QmdSearchResult[];
      } else {
        raw = await store.search({
          query: request.query,
          collections: allowedCollections,
          limit,
          minScore,
          intent: request.intent,
          rerank: request.rerank,
          explain: request.explain,
        }) as QmdSearchResult[];
      }
    }

    const results = await Promise.all(raw
      .filter((item) => (item.score ?? 0) >= minScore)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit)
      .map(async (item) => {
        if (request.includeFullDocument && !item.body) {
          item.body = await this.getResultBody(store, item);
        }
        return this.normalizeResult(item, auth, Boolean(request.includeFullDocument));
      }));

    return results;
  }

  async expandQuery(query: string, intent?: string): Promise<unknown> {
    const store = await this.getStore();
    return store.expandQuery(query, { intent });
  }

  private assertEmbedCompleted(envelope: EmbedEnvelope, options: QmdUiEmbedOptions): void {
    const failOnErrors = options.failOnErrors ?? this.config.embedFailOnErrors;
    const requireComplete = options.requireComplete ?? this.config.embedRequireComplete;
    const errors = Number(envelope.result.errors ?? 0);
    const beforePending = Number(envelope.before.needsEmbedding ?? 0);
    const afterPending = Number(envelope.after.needsEmbedding ?? 0);
    const expectedComplete = beforePending > 0 || Boolean(options.force) || envelope.result.docsProcessed > 0;
    const failures: string[] = [];

    if (failOnErrors && errors > 0) {
      failures.push(`${errors} embedding chunk${errors === 1 ? "" : "s"} failed`);
    }

    if (requireComplete && expectedComplete && afterPending > 0) {
      failures.push(`${afterPending} document${afterPending === 1 ? "" : "s"} still need embeddings`);
    }

    if (failures.length > 0) {
      throw new Error(`QMD embedding failed via ${envelope.provider}: ${failures.join("; ")}`);
    }
  }

  private async writeConfigFromStore(store: QMDStore): Promise<void> {
    writeQmdConfigFromCollections(this.config, await store.listCollections());
  }

  async getDocument(pathOrDocid: string, auth: AuthContext, opts?: { fromLine?: number; maxLines?: number }): Promise<unknown> {
    const store = await this.getStore();
    const doc = await store.get(pathOrDocid, { includeBody: true });
    if ("error" in doc) return doc;

    const collection = collectionFromDisplayPath(doc.displayPath ?? doc.filepath ?? pathOrDocid);
    if (collection && !this.policies.canAccess(collection, auth)) {
      return { error: "not_allowed", message: "Collection access denied" };
    }

    const body = sliceBodyLines(doc.body, opts);
    const source = this.sourceMetadata(doc.filepath ?? doc.displayPath);
    const exposeSourcePaths = Boolean(collection && this.policies.canExposeSourcePath(collection, auth));
    return {
      ...doc,
      body: sanitizeResultText(body, exposeSourcePaths),
      originalPath: exposeSourcePaths ? source.originalPath : undefined,
      sourceCollection: source.sourceCollection,
    };
  }

  private normalizeResult(item: QmdSearchResult, auth: AuthContext, includeFullDocument = false): RetrievalResult {
    const qmdPath = item.displayPath ?? item.file ?? item.filepath ?? "";
    const collection = collectionFromDisplayPath(qmdPath);
    const source = this.sourceMetadata(item.filepath ?? item.file ?? item.displayPath);
    const exposeSourcePaths = Boolean(collection && this.policies.canExposeSourcePath(collection, auth));
    const originalPath = exposeSourcePaths ? source.originalPath : undefined;
    const title = item.title || basename(qmdPath) || "Untitled";
    const snippet = sanitizeResultText(
      item.snippet ?? item.bestChunk ?? excerptBody(item.body, item.chunkPos),
      exposeSourcePaths,
    );
    const body = includeFullDocument ? sanitizeResultText(item.body, exposeSourcePaths) : undefined;
    return {
      docid: item.docid ? `#${String(item.docid).replace(/^#/, "")}` : undefined,
      score: Number(item.score ?? 0),
      title,
      qmdPath,
      originalPath,
      context: sanitizeResultText(item.context, exposeSourcePaths),
      line: item.line,
      snippet,
      body,
      citation: {
        docid: item.docid ? `#${String(item.docid).replace(/^#/, "")}` : undefined,
        title,
        qmdPath,
        originalPath,
        line: item.line,
      },
    };
  }

  private sourceMetadata(path?: string): SourceMetadata {
    if (!path || !existsSync(path)) return {};
    try {
      const head = readFileSync(path, "utf-8").slice(0, 4096);
      const match = head.match(/^---\n([\s\S]*?)\n---/);
      if (!match?.[1]) return {};
      const originalPath = match[1].match(/^original_path:\s*(.+)$/m)?.[1]?.trim();
      const originalRelativePath = match[1].match(/^original_relative_path:\s*(.+)$/m)?.[1]?.trim();
      const sourceCollection = match[1].match(/^source_collection:\s*(.+)$/m)?.[1]?.trim();
      return { originalPath, originalRelativePath, sourceCollection };
    } catch {
      return {};
    }
  }

  private async getResultBody(store: QMDStore, item: QmdSearchResult): Promise<string | undefined> {
    const pathOrDocid = item.displayPath ?? item.file ?? item.filepath ?? item.docid;
    if (!pathOrDocid) return undefined;
    try {
      return await store.getDocumentBody(pathOrDocid) ?? undefined;
    } catch {
      return undefined;
    }
  }
}

function excerptBody(body: string | undefined, chunkPos: number | undefined, maxChars = 4000): string | undefined {
  if (!body) return undefined;
  const start = Math.max(0, Number.isFinite(chunkPos) ? Number(chunkPos) : 0);
  const excerpt = body.slice(start, start + maxChars);
  if (!excerpt.trim()) return undefined;
  const prefix = start > 0 ? "[...]\n" : "";
  const suffix = start + maxChars < body.length ? "\n[...]" : "";
  return `${prefix}${excerpt}${suffix}`;
}

function sliceBodyLines(body: string | undefined, opts?: { fromLine?: number; maxLines?: number }): string | undefined {
  if (!body || !opts || (opts.fromLine == null && opts.maxLines == null)) return body;
  const lines = body.split(/\r?\n/);
  const start = Math.max(0, (opts.fromLine ?? 1) - 1);
  const end = opts.maxLines == null ? lines.length : start + opts.maxLines;
  return lines.slice(start, end).join("\n");
}

function collectionFromDisplayPath(path: string): string | undefined {
  const clean = path.startsWith("qmd://") ? path.slice("qmd://".length) : path;
  return clean.split("/").filter(Boolean)[0];
}

function mergeSearchResults(results: QmdSearchResult[]): QmdSearchResult[] {
  const byPath = new Map<string, QmdSearchResult>();

  for (const result of results) {
    const key = result.displayPath ?? result.filepath ?? result.file ?? result.docid;
    if (!key) continue;
    const existing = byPath.get(key);
    if (!existing || (result.score ?? 0) > (existing.score ?? 0)) {
      byPath.set(key, result);
    }
  }

  return [...byPath.values()];
}

function sanitizeResultText(text: string | null | undefined, exposeSourcePaths: boolean): string | undefined {
  if (text == null) return undefined;
  const withoutFrontmatter = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const lines = withoutFrontmatter.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (line === "" || isGeneratedMetadataLine(line)) {
      index += 1;
      continue;
    }
    break;
  }

  return lines.slice(index).join("\n").trimStart();
}

function isGeneratedMetadataLine(line: string): boolean {
  return /^(source_collection|original_path|original_relative_path|source_extension|source_mime_type|source_modified_time|source_mtime|converted_at|conversion_time|converter|content_hash):\s*/.test(line);
}
