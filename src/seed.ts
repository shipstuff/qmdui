import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { AppConfig } from "./config.js";
import { ensureDataDirs, getConfig } from "./config.js";
import { AccessPolicyStore } from "./accessPolicy.js";
import { IngestionService } from "./ingestion/IngestionService.js";
import { QmdService } from "./qmdService.js";
import type { AccessMode } from "./types.js";

export type SeedOptions = {
  collection: string;
  sourceRoot: string;
  pattern: string;
  ignore: string[];
  ingest: boolean;
  includeHidden: boolean;
  useDefaultIgnore: boolean;
  flattenOutput: boolean;
  cleanOutput: boolean;
  update: boolean;
  embed: boolean;
  embedForce: boolean;
  requireSource: boolean;
  accessMode: AccessMode;
  accessGroups: string[];
  accessUsers: string[];
  exposeSourcePaths: boolean;
};

export type SeedResult = {
  collection: string;
  sourceRoot: string;
  skipped: boolean;
  reason?: string;
  qmdPath?: string;
  qmdPattern?: string;
  ingestion?: unknown;
  update?: unknown;
  embed?: unknown;
  accessPolicy?: unknown;
};

type SeedDependencies = {
  config: AppConfig;
  ingestion: IngestionService;
  qmd: QmdService;
  policies: AccessPolicyStore;
  onLog?: (message: string) => void;
  onProgress?: (value: number) => void;
};

const accessModes = new Set<AccessMode>(["all", "admin", "groups", "users"]);

export function seedOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): SeedOptions {
  const accessMode = envAccessMode(env.QMDUI_SEED_ACCESS_MODE ?? "admin");
  return {
    collection: env.QMDUI_SEED_COLLECTION || "openclaw",
    sourceRoot: env.QMDUI_SEED_SOURCE_ROOT || "/home/carl/.openclaw",
    pattern: env.QMDUI_SEED_PATTERN || "**/*.md",
    ignore: listEnv(env.QMDUI_SEED_IGNORE),
    ingest: boolEnv(env.QMDUI_SEED_INGEST, true),
    includeHidden: boolEnv(env.QMDUI_SEED_INCLUDE_HIDDEN, true),
    useDefaultIgnore: boolEnv(env.QMDUI_SEED_USE_DEFAULT_IGNORE, false),
    flattenOutput: boolEnv(env.QMDUI_SEED_FLATTEN_OUTPUT, true),
    cleanOutput: boolEnv(env.QMDUI_SEED_CLEAN_OUTPUT, true),
    update: boolEnv(env.QMDUI_SEED_UPDATE, true),
    embed: boolEnv(env.QMDUI_SEED_EMBED, false),
    embedForce: boolEnv(env.QMDUI_SEED_EMBED_FORCE, false),
    requireSource: boolEnv(env.QMDUI_SEED_REQUIRE_SOURCE, false),
    accessMode,
    accessGroups: listEnv(env.QMDUI_SEED_ACCESS_GROUPS),
    accessUsers: listEnv(env.QMDUI_SEED_ACCESS_USERS),
    exposeSourcePaths: boolEnv(env.QMDUI_SEED_EXPOSE_SOURCE_PATHS, false),
  };
}

export async function seedConfiguredCollection(
  deps: SeedDependencies,
  options = seedOptionsFromEnv(),
): Promise<SeedResult> {
  const sourceRoot = resolve(options.sourceRoot);
  deps.onLog?.(`Seeding ${options.collection} from ${sourceRoot}`);

  if (!existsSync(sourceRoot)) {
    const reason = `Seed source does not exist: ${sourceRoot}`;
    if (options.requireSource) throw new Error(reason);
    deps.onLog?.(reason);
    return { collection: options.collection, sourceRoot, skipped: true, reason };
  }

  let qmdPath = sourceRoot;
  let qmdPattern = options.pattern;
  let ingestion: unknown;

  if (options.ingest) {
    ingestion = await deps.ingestion.ingest({
      collection: options.collection,
      sourceRoot,
      pattern: options.pattern,
      ignore: options.ignore,
      includeHidden: options.includeHidden,
      useDefaultIgnore: options.useDefaultIgnore,
      flattenOutput: options.flattenOutput,
      cleanOutput: options.cleanOutput,
      onLog: deps.onLog,
      onProgress: (value) => deps.onProgress?.(Math.min(value * 0.55, 55)),
    });
    qmdPath = deps.ingestion.generatedRoot(options.collection);
    qmdPattern = "**/*.md";
  }

  await deps.qmd.addCollection(options.collection, qmdPath, qmdPattern, options.ignore);
  const accessPolicy = deps.policies.set(options.collection, {
    collection: options.collection,
    mode: options.accessMode,
    groups: options.accessGroups,
    users: options.accessUsers,
    exposeSourcePaths: options.exposeSourcePaths,
  });

  let update: unknown;
  if (options.update) {
    deps.onLog?.(`Updating QMD collection ${options.collection}`);
    deps.onProgress?.(65);
    update = await deps.qmd.update([options.collection]);
    deps.onProgress?.(82);
  }

  let embed: unknown;
  if (options.embed) {
    deps.onLog?.(`Embedding QMD collection ${options.collection}`);
    embed = await deps.qmd.embed({ force: options.embedForce });
  }

  deps.onProgress?.(100);
  return {
    collection: options.collection,
    sourceRoot,
    skipped: false,
    qmdPath,
    qmdPattern,
    ingestion,
    update,
    embed,
    accessPolicy,
  };
}

export async function runSeedFromEnv(): Promise<SeedResult> {
  const config = getConfig();
  ensureDataDirs(config);
  const policies = new AccessPolicyStore(config);
  const qmd = new QmdService(config, policies);
  const ingestion = new IngestionService(config);

  try {
    return await seedConfiguredCollection({
      config,
      policies,
      qmd,
      ingestion,
      onLog: (message) => console.log(message),
      onProgress: (value) => console.log(`Progress ${Math.round(value)}%`),
    });
  } finally {
    await qmd.close();
  }
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function listEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function envAccessMode(value: string): AccessMode {
  return accessModes.has(value as AccessMode) ? value as AccessMode : "admin";
}

function isDirectRun(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href : false;
}

if (isDirectRun()) {
  runSeedFromEnv()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
