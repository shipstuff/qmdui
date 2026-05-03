import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type AppConfig = {
  host: string;
  port: number;
  rootDir: string;
  dataDir: string;
  generatedDir: string;
  manifestDir: string;
  policyPath: string;
  apiToken?: string;
  qmdIndexName: string;
  qmdDbPath: string;
  qmdConfigPath: string;
  embedProvider: "qmd" | "ollama";
  embedTimeoutMs: number;
  embedRequireComplete: boolean;
  embedFailOnErrors: boolean;
  ollamaBaseUrl: string;
  ollamaEmbedModel: string;
  ollamaBatchSize: number;
};

function defaultQmdConfigPath(indexName: string): string {
  const base = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "qmd")
    : join(homedir(), ".config", "qmd");
  return join(base, `${indexName}.yml`);
}

function defaultQmdDbPath(indexName: string): string {
  const base = process.env.XDG_CACHE_HOME
    ? join(process.env.XDG_CACHE_HOME, "qmd")
    : join(homedir(), ".cache", "qmd");
  return join(base, `${indexName}.sqlite`);
}

export function getConfig(): AppConfig {
  const rootDir = resolve(process.env.QMDUI_ROOT ?? process.cwd());
  const dataDir = resolve(process.env.QMDUI_DATA_DIR ?? join(rootDir, ".qmdui"));
  const generatedDir = resolve(process.env.QMDUI_GENERATED_DIR ?? join(dataDir, "generated"));
  const manifestDir = resolve(process.env.QMDUI_MANIFEST_DIR ?? join(dataDir, "manifests"));
  const qmdIndexName = process.env.QMD_INDEX ?? "index";
  const qmdConfigPath = resolve(
    process.env.QMD_CONFIG_PATH ?? defaultQmdConfigPath(qmdIndexName),
  );
  const qmdDbPath = resolve(process.env.QMD_DB_PATH ?? process.env.INDEX_PATH ?? defaultQmdDbPath(qmdIndexName));

  return {
    host: process.env.QMDUI_HOST ?? "127.0.0.1",
    port: Number(process.env.QMDUI_PORT ?? 8765),
    rootDir,
    dataDir,
    generatedDir,
    manifestDir,
    policyPath: resolve(process.env.QMDUI_POLICY_PATH ?? join(dataDir, "access-policies.json")),
    apiToken: process.env.QMDUI_API_TOKEN,
    qmdIndexName,
    qmdDbPath,
    qmdConfigPath,
    embedProvider: envChoice(process.env.QMDUI_EMBED_PROVIDER, ["qmd", "ollama"], "qmd"),
    embedTimeoutMs: numberEnv(process.env.QMDUI_EMBED_TIMEOUT_MS, 6 * 60 * 60 * 1000),
    embedRequireComplete: boolEnv(process.env.QMDUI_EMBED_REQUIRE_COMPLETE, true),
    embedFailOnErrors: boolEnv(process.env.QMDUI_EMBED_FAIL_ON_ERRORS, true),
    ollamaBaseUrl: process.env.QMDUI_OLLAMA_BASE_URL ?? "http://ollama-mini-01:11434",
    ollamaEmbedModel: process.env.QMDUI_OLLAMA_EMBED_MODEL ?? "qwen3-embedding:8b",
    ollamaBatchSize: numberEnv(process.env.QMDUI_OLLAMA_BATCH_SIZE, 128),
  };
}

export function ensureDataDirs(config: AppConfig): void {
  const tmpDir = process.env.TMPDIR ? resolve(process.env.TMPDIR) : undefined;
  for (const path of [
    config.dataDir,
    config.generatedDir,
    config.manifestDir,
    dirname(config.qmdDbPath),
    dirname(config.qmdConfigPath),
    ...(tmpDir ? [tmpDir] : []),
  ]) {
    if (!existsSync(path)) mkdirSync(path, { recursive: true });
  }
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envChoice<T extends string>(value: string | undefined, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? value as T : fallback;
}
