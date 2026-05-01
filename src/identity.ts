import crypto from "node:crypto";
import type { AppConfig, Identity, Role } from "./types.js";

type HeaderMap = Record<string, string | string[] | undefined>;

function header(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseGroups(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // comma fallback below
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRole(raw?: string): Role {
  if (raw === "admin" || raw === "pending") return raw;
  return "user";
}

function verifySignature(headers: HeaderMap, secret: string): boolean {
  const timestamp = header(headers, "x-open-webui-timestamp");
  const signature = header(headers, "x-open-webui-signature");
  const userId = header(headers, "x-open-webui-user-id") ?? "";
  const role = header(headers, "x-open-webui-role") ?? "";
  const groups = header(headers, "x-open-webui-groups") ?? "";
  if (!timestamp || !signature) return false;

  const skew = Math.abs(Date.now() - Number.parseInt(timestamp, 10));
  if (!Number.isFinite(skew) || skew > 5 * 60 * 1000) return false;

  const canonical = [timestamp, userId, role, groups].join("\n");
  const expected = crypto.createHmac("sha256", secret).update(canonical).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export function requireBearerToken(headers: HeaderMap, config: AppConfig): void {
  if (!config.apiToken) {
    if (config.authMode === "dev") return;
    throw Object.assign(new Error("QMDUI_API_TOKEN is required in signed auth mode"), { statusCode: 500 });
  }
  const auth = header(headers, "authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : header(headers, "x-qmdui-api-token");
  if (token !== config.apiToken) {
    throw Object.assign(new Error("Missing or invalid QMDUI API token"), { statusCode: 401 });
  }
}

export function identityFromHeaders(headers: HeaderMap, config: AppConfig): Identity {
  requireBearerToken(headers, config);

  const role = parseRole(header(headers, "x-open-webui-role"));
  const identity: Identity = {
    userId: header(headers, "x-open-webui-user-id") ?? (config.authMode === "dev" ? "dev-user" : ""),
    email: header(headers, "x-open-webui-user-email"),
    name: header(headers, "x-open-webui-user-name"),
    role,
    groups: parseGroups(header(headers, "x-open-webui-groups")),
    trusted: false
  };

  if (config.authMode === "dev") {
    return { ...identity, trusted: true };
  }

  if (!identity.userId) {
    throw Object.assign(new Error("Missing Open WebUI user id"), { statusCode: 401 });
  }
  if (!config.openWebuiSharedSecret) {
    throw Object.assign(new Error("QMDUI_OPENWEBUI_SHARED_SECRET is required in signed auth mode"), { statusCode: 500 });
  }
  if (!verifySignature(headers, config.openWebuiSharedSecret)) {
    throw Object.assign(new Error("Invalid Open WebUI identity signature"), { statusCode: 401 });
  }
  return { ...identity, trusted: true };
}

export function requireAdmin(identity: Identity): void {
  if (identity.role !== "admin") {
    throw Object.assign(new Error("Admin role required"), { statusCode: 403 });
  }
}

export function requireApprovedUser(identity: Identity): void {
  if (identity.role === "pending") {
    throw Object.assign(new Error("Pending users cannot access QMDUI"), { statusCode: 403 });
  }
}
