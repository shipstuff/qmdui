export type Role = "admin" | "user" | "pending";

export type Identity = {
  userId: string;
  email?: string;
  name?: string;
  role: Role;
  groups: string[];
  trusted: boolean;
};

export type AccessMode = "all" | "groups" | "users" | "admin";

export type CollectionPolicy = {
  collectionId: string;
  mode: AccessMode;
  groups: string[];
  users: string[];
  exposeSourcePaths: boolean;
};

export type Collection = {
  id: string;
  displayName: string;
  sourcePath: string;
  generatedPath: string;
  includeGlobs: string[];
  ignoreGlobs: string[];
  ingestionMode: "markdown" | "convert";
  qmdCollectionName: string;
  includeInDefault?: boolean;
  updateCommand?: string;
  autoConvert: boolean;
  autoEmbed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ContextEntry = {
  id: string;
  scope: "global" | "collection" | "path";
  collectionId?: string;
  path?: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type Citation = {
  collectionId: string;
  collectionName: string;
  docid?: string;
  title?: string;
  qmdPath?: string;
  originalRelativePath?: string;
  originalSourcePath?: string;
  line?: number;
};

export type SearchResult = {
  id: string;
  score?: number;
  title?: string;
  snippet?: string;
  body?: string;
  citation: Citation;
  metadata?: Record<string, unknown>;
};

export type SearchMode = "quick" | "semantic" | "deep";

export type SearchRequest = {
  query: string;
  mode?: SearchMode;
  collections?: string[];
  limit?: number;
  minScore?: number;
  includeFullDocuments?: boolean;
  structured?: Array<{ type: "lex" | "vec" | "hyde"; query: string }>;
  intent?: string;
  noRerank?: boolean;
};

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type Job = {
  id: string;
  type: string;
  status: JobStatus;
  progress: number;
  logs: string[];
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
};

export type IngestionManifestEntry = {
  sourcePath: string;
  relativePath: string;
  outputPath: string;
  sourceHash: string;
  sourceModifiedAt: string;
  convertedAt: string;
  pipelineId: string;
  planner: "deterministic" | "local-model";
  stale: boolean;
  warnings: string[];
  errors: string[];
};

export type IngestionManifest = {
  collectionId: string;
  generatedPath: string;
  updatedAt: string;
  entries: IngestionManifestEntry[];
};

export type AppConfig = {
  host: string;
  port: number;
  stateDir: string;
  authMode: "dev" | "signed";
  apiToken?: string;
  openWebuiSharedSecret?: string;
  enableQmdCli: boolean;
  enableAdminDanger: boolean;
  enableExternalConverters: boolean;
  qmdBin: string;
};
