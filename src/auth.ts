import type { Request, Response, NextFunction } from "express";
import type { AppConfig } from "./config.js";
import type { AuthContext, UserRole } from "./types.js";

const roles = new Set<UserRole>(["admin", "user", "pending"]);

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function authFromRequest(req: Request): AuthContext {
  const roleHeader = headerValue(req.headers["x-open-webui-role"]) ?? "user";
  const role = roles.has(roleHeader as UserRole) ? roleHeader as UserRole : "user";
  const groups = (headerValue(req.headers["x-open-webui-groups"]) ?? "")
    .split(",")
    .map((group) => group.trim())
    .filter(Boolean);

  return {
    userId: headerValue(req.headers["x-open-webui-user-id"]) ?? "anonymous",
    role,
    groups,
  };
}

export function requireToken(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.apiToken) return next();
    const expected = `Bearer ${config.apiToken}`;
    if (req.headers.authorization !== expected) {
      res.status(401).json({ error: "Invalid or missing QMDUI API token" });
      return;
    }
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = authFromRequest(req);
  if (auth.role !== "admin") {
    res.status(403).json({ error: "Admin authorization required" });
    return;
  }
  next();
}
