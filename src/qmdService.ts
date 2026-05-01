import fs from "node:fs/promises";
import path from "node:path";
import type { Collection, SearchMode, SearchRequest, SearchResult } from "./types.js";
import { QmdCli } from "./qmdCli.js";

type QmdModule = Record<string, unknown>;

export class QmdService {
  private sdkModule?: QmdModule;
  private sdkLoadError?: string;

  constructor(private readonly cli: QmdCli) {}

  private async loadSdk(): Promise<QmdModule | undefined> {
    if (this.sdkModule || this.sdkLoadError) return this.sdkModule;
    try {
      this.sdkModule = (await import("@tobilu/qmd")) as QmdModule;
    } catch (error) {
      this.sdkLoadError = error instanceof Error ? error.message : String(error);
    }
    return this.sdkModule;
  }

  async status(stateDir: string): Promise<Record<string, unknown>> {
    const sdk = await this.loadSdk();
    const getDefaultDbPath = sdk?.getDefaultDbPath;
    let dbPath: unknown;
    let dbPathError: string | undefined;
    if (typeof getDefaultDbPath === "function") {
      try {
        dbPath = await getDefaultDbPath();
      } catch (error) {
        dbPathError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      ok: true,
      sdkAvailable: Boolean(sdk),
      sdkLoadError: this.sdkLoadError,
      defaultDbPath: dbPath,
      defaultDbPathError: dbPathError,
      stateDir
    };
  }

  async addCollection(collection: Collection): Promise<void> {
    await fs.mkdir(collection.generatedPath, { recursive: true });
    const sdk = await this.loadSdk();
    const addCollection = sdk?.addCollection;
    if (typeof addCollection === "function") {
      await addCollection(collection.qmdCollectionName, collection.generatedPath);
    }
  }

  async removeCollection(collection: Collection): Promise<void> {
    const sdk = await this.loadSdk();
    const removeCollection = sdk?.removeCollection;
    if (typeof removeCollection === "function") {
      await removeCollection(collection.qmdCollectionName);
    }
  }

  async renameCollection(collection: Collection, displayName: string): Promise<void> {
    const sdk = await this.loadSdk();
    const renameCollection = sdk?.renameCollection;
    if (typeof renameCollection === "function") {
      await renameCollection(collection.qmdCollectionName, displayName);
    }
  }

  async search(mode: SearchMode, request: SearchRequest, collections: Collection[]): Promise<SearchResult[]> {
    const sdk = await this.loadSdk();
    const methodName = mode === "quick" ? "searchLex" : mode === "semantic" ? "searchVector" : "search";
    const sdkMethod = sdk?.[methodName];
    let rawResults: unknown[] = [];
    if (typeof sdkMethod === "function") {
      const response = await sdkMethod({
        query: request.query,
        collections: collections.map((collection) => collection.qmdCollectionName),
        limit: request.limit ?? 8,
        minScore: request.minScore,
        structured: request.structured,
        intent: request.intent,
        noRerank: request.noRerank
      });
      rawResults = Array.isArray(response) ? response : ((response as { results?: unknown[] })?.results ?? []);
    } else {
      rawResults = await this.cli.search(mode, request, collections.map((collection) => collection.qmdCollectionName));
    }
    return rawResults.map((result, index) => this.normalizeResult(result, collections, index));
  }

  async getDocument(collection: Collection, docidOrPath: string): Promise<Record<string, unknown>> {
    const sdk = await this.loadSdk();
    const getDocumentBody = sdk?.getDocumentBody;
    if (typeof getDocumentBody === "function") {
      return {
        collectionId: collection.id,
        docid: docidOrPath,
        body: await getDocumentBody(docidOrPath)
      };
    }
    const generatedPath = path.resolve(collection.generatedPath, docidOrPath);
    if (!generatedPath.startsWith(path.resolve(collection.generatedPath))) {
      throw Object.assign(new Error("Document path escapes generated collection root"), { statusCode: 400 });
    }
    return {
      collectionId: collection.id,
      docid: docidOrPath,
      body: await fs.readFile(generatedPath, "utf8")
    };
  }

  async multiGet(collection: Collection, docidsOrPaths: string[]): Promise<Record<string, unknown>[]> {
    const sdk = await this.loadSdk();
    const multiGet = sdk?.multiGet;
    if (typeof multiGet === "function") {
      const response = await multiGet(docidsOrPaths);
      return Array.isArray(response) ? (response as Record<string, unknown>[]) : [response as Record<string, unknown>];
    }
    return Promise.all(docidsOrPaths.map((docidOrPath) => this.getDocument(collection, docidOrPath)));
  }

  async expandQuery(query: string): Promise<Record<string, unknown>> {
    const sdk = await this.loadSdk();
    const expandQuery = sdk?.expandQuery;
    if (typeof expandQuery === "function") {
      const response = await expandQuery(query);
      return response && typeof response === "object" ? (response as Record<string, unknown>) : { query, expanded: response };
    }
    return {
      query,
      expanded: [query],
      sdkAvailable: Boolean(sdk),
      note: "expandQuery is unavailable in the loaded @tobilu/qmd SDK"
    };
  }

  private normalizeResult(raw: unknown, collections: Collection[], index: number): SearchResult {
    const object = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const collectionName = String(object.collection ?? object.collectionName ?? object.qmdCollectionName ?? "");
    const collection =
      collections.find((item) => item.qmdCollectionName === collectionName || item.id === collectionName) ?? collections[0];
    const title = object.title ? String(object.title) : undefined;
    const qmdPath = object.path ? String(object.path) : object.file ? String(object.file) : undefined;
    return {
      id: String(object.id ?? object.docid ?? qmdPath ?? `${collection?.id ?? "result"}:${index}`),
      score: typeof object.score === "number" ? object.score : undefined,
      title,
      snippet: object.snippet ? String(object.snippet) : object.text ? String(object.text).slice(0, 1200) : undefined,
      body: object.body ? String(object.body) : undefined,
      citation: {
        collectionId: collection?.id ?? "unknown",
        collectionName: collection?.displayName ?? collectionName,
        docid: object.docid ? String(object.docid) : undefined,
        title,
        qmdPath,
        originalRelativePath: object.originalRelativePath ? String(object.originalRelativePath) : undefined,
        originalSourcePath: object.originalSourcePath ? String(object.originalSourcePath) : undefined,
        line: typeof object.line === "number" ? object.line : undefined
      },
      metadata: object
    };
  }
}
