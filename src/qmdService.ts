import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  createStore,
  type QMDStore,
} from "@tobilu/qmd";
import type { AccessPolicyStore } from "./accessPolicy.js";
import type { AppConfig } from "./config.js";
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
  line?: number;
};

type SourceMetadata = {
  originalPath?: string;
  originalRelativePath?: string;
  sourceCollection?: string;
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
  }

  async removeCollection(name: string): Promise<boolean> {
    const store = await this.getStore();
    return store.removeCollection(name);
  }

  async renameCollection(oldName: string, newName: string): Promise<boolean> {
    const store = await this.getStore();
    return store.renameCollection(oldName, newName);
  }

  async update(collections?: string[]): Promise<unknown> {
    const store = await this.getStore();
    return store.update({ collections });
  }

  async embed(options?: { force?: boolean; maxDocsPerBatch?: number; maxBatchBytes?: number }): Promise<unknown> {
    const store = await this.getStore();
    return store.embed(options);
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
      const perCollection = await Promise.all(
        allowedCollections.map((collection) => store.searchVector(request.query, { collection, limit })),
      );
      raw = perCollection.flat() as QmdSearchResult[];
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

    return raw
      .filter((item) => (item.score ?? 0) >= minScore)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit)
      .map((item) => this.normalizeResult(item, auth));
  }

  async expandQuery(query: string, intent?: string): Promise<unknown> {
    const store = await this.getStore();
    return store.expandQuery(query, { intent });
  }

  async getDocument(pathOrDocid: string, auth: AuthContext, opts?: { fromLine?: number; maxLines?: number }): Promise<unknown> {
    const store = await this.getStore();
    const doc = await store.get(pathOrDocid, { includeBody: true });
    if ("error" in doc) return doc;

    const collection = collectionFromDisplayPath(doc.displayPath ?? doc.filepath ?? pathOrDocid);
    if (collection && !this.policies.canAccess(collection, auth)) {
      return { error: "not_allowed", message: "Collection access denied" };
    }

    const body = opts ? await store.getDocumentBody(pathOrDocid, opts) : doc.body;
    const source = this.sourceMetadata(doc.filepath ?? doc.displayPath);
    return {
      ...doc,
      body,
      originalPath: collection && this.policies.canExposeSourcePath(collection, auth) ? source.originalPath : undefined,
      sourceCollection: source.sourceCollection,
    };
  }

  private normalizeResult(item: QmdSearchResult, auth: AuthContext): RetrievalResult {
    const qmdPath = item.displayPath ?? item.file ?? item.filepath ?? "";
    const collection = collectionFromDisplayPath(qmdPath);
    const source = this.sourceMetadata(item.filepath ?? item.file ?? item.displayPath);
    const originalPath = collection && this.policies.canExposeSourcePath(collection, auth)
      ? source.originalPath
      : undefined;
    const title = item.title || basename(qmdPath) || "Untitled";
    return {
      docid: item.docid ? `#${String(item.docid).replace(/^#/, "")}` : undefined,
      score: Number(item.score ?? 0),
      title,
      qmdPath,
      originalPath,
      context: item.context,
      line: item.line,
      snippet: item.snippet ?? item.bestChunk,
      body: item.body,
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
}

function collectionFromDisplayPath(path: string): string | undefined {
  const clean = path.startsWith("qmd://") ? path.slice("qmd://".length) : path;
  return clean.split("/").filter(Boolean)[0];
}
