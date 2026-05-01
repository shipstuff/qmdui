import crypto from "node:crypto";
import path from "node:path";
import { ensureDir, readJson, writeJson } from "./fsJson.js";
import type { Collection, CollectionPolicy, ContextEntry } from "./types.js";

type StateFiles = {
  collections: Collection[];
  policies: CollectionPolicy[];
  contexts: ContextEntry[];
};

export class StateStore {
  constructor(private readonly stateDir: string) {}

  async init(): Promise<void> {
    await ensureDir(this.stateDir);
    await ensureDir(path.join(this.stateDir, "generated"));
    await ensureDir(path.join(this.stateDir, "manifests"));
    await ensureDir(path.join(this.stateDir, "logs"));
  }

  private file(name: keyof StateFiles): string {
    return path.join(this.stateDir, `${name}.json`);
  }

  async listCollections(): Promise<Collection[]> {
    return readJson(this.file("collections"), []);
  }

  async getCollection(id: string): Promise<Collection | undefined> {
    return (await this.listCollections()).find((collection) => collection.id === id);
  }

  async createCollection(input: {
    displayName: string;
    sourcePath: string;
    includeGlobs?: string[];
    ignoreGlobs?: string[];
    ingestionMode?: "markdown" | "convert";
    autoConvert?: boolean;
    autoEmbed?: boolean;
  }): Promise<Collection> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const collection: Collection = {
      id,
      displayName: input.displayName,
      sourcePath: path.resolve(input.sourcePath),
      generatedPath: path.join(this.stateDir, "generated", id),
      includeGlobs: input.includeGlobs?.length ? input.includeGlobs : ["**/*"],
      ignoreGlobs: input.ignoreGlobs ?? ["**/node_modules/**", "**/.git/**"],
      ingestionMode: input.ingestionMode ?? "convert",
      qmdCollectionName: id,
      includeInDefault: true,
      autoConvert: input.autoConvert ?? false,
      autoEmbed: input.autoEmbed ?? false,
      createdAt: now,
      updatedAt: now
    };
    const collections = await this.listCollections();
    collections.push(collection);
    await writeJson(this.file("collections"), collections);
    await this.upsertPolicy({
      collectionId: id,
      mode: "admin",
      groups: [],
      users: [],
      exposeSourcePaths: false
    });
    return collection;
  }

  async updateCollection(id: string, patch: Partial<Omit<Collection, "id" | "createdAt" | "generatedPath" | "qmdCollectionName">>): Promise<Collection> {
    const collections = await this.listCollections();
    const index = collections.findIndex((collection) => collection.id === id);
    if (index === -1) throw Object.assign(new Error("Collection not found"), { statusCode: 404 });
    collections[index] = { ...collections[index], ...patch, updatedAt: new Date().toISOString() };
    await writeJson(this.file("collections"), collections);
    return collections[index];
  }

  async removeCollection(id: string): Promise<void> {
    const collections = (await this.listCollections()).filter((collection) => collection.id !== id);
    await writeJson(this.file("collections"), collections);
    const policies = (await this.listPolicies()).filter((policy) => policy.collectionId !== id);
    await writeJson(this.file("policies"), policies);
  }

  async listPolicies(): Promise<CollectionPolicy[]> {
    return readJson(this.file("policies"), []);
  }

  async policiesByCollection(): Promise<Map<string, CollectionPolicy>> {
    return new Map((await this.listPolicies()).map((policy) => [policy.collectionId, policy]));
  }

  async upsertPolicy(policy: CollectionPolicy): Promise<CollectionPolicy> {
    const policies = await this.listPolicies();
    const index = policies.findIndex((item) => item.collectionId === policy.collectionId);
    if (index === -1) policies.push(policy);
    else policies[index] = policy;
    await writeJson(this.file("policies"), policies);
    return policy;
  }

  async listContexts(): Promise<ContextEntry[]> {
    return readJson(this.file("contexts"), []);
  }

  async addContext(input: {
    scope: ContextEntry["scope"];
    collectionId?: string;
    path?: string;
    text: string;
  }): Promise<ContextEntry> {
    const now = new Date().toISOString();
    const context: ContextEntry = {
      id: crypto.randomUUID(),
      scope: input.scope,
      collectionId: input.collectionId,
      path: input.path,
      text: input.text,
      createdAt: now,
      updatedAt: now
    };
    const contexts = await this.listContexts();
    contexts.push(context);
    await writeJson(this.file("contexts"), contexts);
    return context;
  }

  async removeContext(id: string): Promise<boolean> {
    const contexts = await this.listContexts();
    const next = contexts.filter((context) => context.id !== id);
    await writeJson(this.file("contexts"), next);
    return next.length !== contexts.length;
  }

  manifestPath(collectionId: string): string {
    return path.join(this.stateDir, "manifests", `${collectionId}.json`);
  }

  getStateDir(): string {
    return this.stateDir;
  }
}
