import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { AppConfig } from "./config.js";
import type { AuthContext, CollectionAccessPolicy } from "./types.js";

type PolicyFile = {
  policies: CollectionAccessPolicy[];
};

const defaultPolicy = (collection: string): CollectionAccessPolicy => ({
  collection,
  mode: "admin",
  groups: [],
  users: [],
  exposeSourcePaths: false,
});

export class AccessPolicyStore {
  constructor(private readonly config: AppConfig) {}

  list(): CollectionAccessPolicy[] {
    if (!existsSync(this.config.policyPath)) return [];
    const parsed = JSON.parse(readFileSync(this.config.policyPath, "utf-8")) as PolicyFile;
    return Array.isArray(parsed.policies) ? parsed.policies : [];
  }

  get(collection: string): CollectionAccessPolicy {
    return this.list().find((policy) => policy.collection === collection) ?? defaultPolicy(collection);
  }

  set(collection: string, policy: CollectionAccessPolicy): CollectionAccessPolicy {
    const policies = this.list().filter((item) => item.collection !== collection);
    const normalized: CollectionAccessPolicy = {
      collection,
      mode: policy.mode,
      groups: policy.groups ?? [],
      users: policy.users ?? [],
      exposeSourcePaths: Boolean(policy.exposeSourcePaths),
    };
    mkdirSync(dirname(this.config.policyPath), { recursive: true });
    writeFileSync(this.config.policyPath, JSON.stringify({ policies: [...policies, normalized] }, null, 2));
    return normalized;
  }

  canAccess(collection: string, auth: AuthContext): boolean {
    if (auth.role === "admin") return true;
    if (auth.role === "pending") return false;

    const policy = this.get(collection);
    if (policy.mode === "all") return true;
    if (policy.mode === "admin") return false;
    if (policy.mode === "users") return policy.users.includes(auth.userId);
    return policy.groups.some((group) => auth.groups.includes(group));
  }

  filterCollections(collections: string[], auth: AuthContext): string[] {
    return collections.filter((collection) => this.canAccess(collection, auth));
  }

  canExposeSourcePath(collection: string, auth: AuthContext): boolean {
    if (auth.role === "admin") return true;
    return this.get(collection).exposeSourcePaths;
  }
}
