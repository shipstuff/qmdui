import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import YAML from "yaml";
import type { AppConfig } from "./config.js";

export type QmdConfigSnapshot = {
  path: string;
  exists: boolean;
  content: string;
  parsed?: unknown;
};

export function readQmdConfig(config: AppConfig): QmdConfigSnapshot {
  const exists = existsSync(config.qmdConfigPath);
  const content = exists ? readFileSync(config.qmdConfigPath, "utf-8") : defaultQmdConfig();
  return {
    path: config.qmdConfigPath,
    exists,
    content,
    parsed: parseQmdConfig(content),
  };
}

export function writeQmdConfig(config: AppConfig, content: string): QmdConfigSnapshot {
  parseQmdConfig(content);
  mkdirSync(dirname(config.qmdConfigPath), { recursive: true });
  writeFileSync(config.qmdConfigPath, content.trimEnd() + "\n", "utf-8");
  return readQmdConfig(config);
}

function parseQmdConfig(content: string): unknown {
  const parsed = YAML.parse(content || "{}");
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("QMD config must be a YAML object");
  }
  return parsed;
}

function defaultQmdConfig(): string {
  return [
    "global_context: QMDUI managed memory index",
    "collections: {}",
    "models:",
    "  embed: embeddinggemma",
    "  rerank: ExpedientFalcon/qwen3-reranker:0.6b-q8_0",
    "",
  ].join("\n");
}
