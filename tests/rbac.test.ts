import { describe, expect, it } from "vitest";
import { canAccessCollection } from "../src/rbac.js";
import type { CollectionPolicy, Identity } from "../src/types.js";

const user: Identity = { userId: "u1", email: "u1@example.com", role: "user", groups: ["eng"], trusted: true };
const admin: Identity = { userId: "a1", role: "admin", groups: [], trusted: true };
const pending: Identity = { userId: "p1", role: "pending", groups: ["eng"], trusted: true };

function policy(patch: Partial<CollectionPolicy>): CollectionPolicy {
  return { collectionId: "c1", mode: "admin", groups: [], users: [], exposeSourcePaths: false, ...patch };
}

describe("collection RBAC", () => {
  it("allows admins regardless of collection policy", () => {
    expect(canAccessCollection(admin, policy({ mode: "admin" }))).toBe(true);
  });

  it("denies pending users", () => {
    expect(canAccessCollection(pending, policy({ mode: "all" }))).toBe(false);
  });

  it("allows group-mapped users", () => {
    expect(canAccessCollection(user, policy({ mode: "groups", groups: ["eng"] }))).toBe(true);
    expect(canAccessCollection(user, policy({ mode: "groups", groups: ["sales"] }))).toBe(false);
  });

  it("allows direct user mappings by id or email", () => {
    expect(canAccessCollection(user, policy({ mode: "users", users: ["u1"] }))).toBe(true);
    expect(canAccessCollection(user, policy({ mode: "users", users: ["u1@example.com"] }))).toBe(true);
  });
});
