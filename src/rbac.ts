import type { Collection, CollectionPolicy, Identity } from "./types.js";

export function canAccessCollection(identity: Identity, policy: CollectionPolicy | undefined): boolean {
  if (identity.role === "pending") return false;
  if (identity.role === "admin") return true;
  if (!policy) return false;
  if (policy.mode === "admin") return false;
  if (policy.mode === "all") return true;
  if (policy.mode === "users") return policy.users.includes(identity.userId) || (identity.email ? policy.users.includes(identity.email) : false);
  if (policy.mode === "groups") return policy.groups.some((group) => identity.groups.includes(group));
  return false;
}

export function filterCollectionsForIdentity(
  identity: Identity,
  collections: Collection[],
  policies: Map<string, CollectionPolicy>
): Collection[] {
  return collections.filter((collection) => canAccessCollection(identity, policies.get(collection.id)));
}

export function redactCollection(collection: Collection, identity: Identity, policy?: CollectionPolicy): Omit<Collection, "sourcePath" | "generatedPath"> & {
  sourcePath?: string;
  generatedPath?: string;
} {
  if (identity.role === "admin" || policy?.exposeSourcePaths) return collection;
  const { sourcePath: _sourcePath, generatedPath: _generatedPath, ...safe } = collection;
  return safe;
}
