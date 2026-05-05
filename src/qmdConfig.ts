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

export type QmdConfigCollection = {
  name: string;
  pwd?: string | null;
  path?: string | null;
  glob_pattern?: string | null;
  pattern?: string | null;
  ignore?: string[] | null;
  includeByDefault?: boolean;
};

type QmdConfigDocument = Record<string, unknown>;

export function readQmdConfig(config: AppConfig): QmdConfigSnapshot {
  const exists = existsSync(config.qmdConfigPath);
  const content = exists ? readFileSync(config.qmdConfigPath, "utf-8") : buildQmdConfig(config);
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

export function writeQmdConfigFromCollections(
  config: AppConfig,
  collections: QmdConfigCollection[],
): QmdConfigSnapshot {
  mkdirSync(dirname(config.qmdConfigPath), { recursive: true });
  const base = existsSync(config.qmdConfigPath)
    ? parseQmdConfig(readFileSync(config.qmdConfigPath, "utf-8")) as QmdConfigDocument
    : parseQmdConfig(buildQmdConfig(config)) as QmdConfigDocument;
  base.collections = collectionsToConfig(collections);
  writeFileSync(config.qmdConfigPath, YAML.stringify(base), "utf-8");
  return readQmdConfig(config);
}

export function activeEmbedModel(config: AppConfig): string {
  if (config.embedProvider === "ollama") return config.ollamaEmbedModel;
  try {
    const snapshot = readQmdConfig(config);
    const parsed = snapshot.parsed as QmdConfigDocument;
    const models = parsed.models;
    if (isRecord(models) && typeof models.embed === "string" && models.embed.trim()) {
      return models.embed;
    }
  } catch {
    // Fall back to the local QMD default if an operator is in the middle of editing YAML.
  }
  return "embeddinggemma";
}

function parseQmdConfig(content: string): unknown {
  const parsed = YAML.parse(content || "{}");
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("QMD config must be a YAML object");
  }
  return parsed;
}

export function buildQmdConfig(
  config: AppConfig,
  collections: QmdConfigCollection[] = [],
): string {
  const qmdConfig = {
    global_context: "QMDUI managed memory index",
    collections: collectionsToConfig(collections),
    models: {
      embed: config.embedProvider === "ollama" ? config.ollamaEmbedModel : "embeddinggemma",
      rerank: "ExpedientFalcon/qwen3-reranker:0.6b-q8_0",
    },
  };
  return YAML.stringify(qmdConfig);
}

function collectionsToConfig(collections: QmdConfigCollection[]): Record<string, unknown> {
  return Object.fromEntries(collections.map((collection) => [
    collection.name,
    {
      path: collection.path ?? collection.pwd ?? "",
      pattern: collection.pattern ?? collection.glob_pattern ?? "**/*.md",
      ...(collection.ignore?.length ? { ignore: collection.ignore } : {}),
      includeByDefault: collection.includeByDefault ?? true,
    },
  ]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
