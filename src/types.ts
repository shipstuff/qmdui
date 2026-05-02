export type UserRole = "admin" | "user" | "pending";

export type AuthContext = {
  userId: string;
  role: UserRole;
  groups: string[];
};

export type AccessMode = "all" | "admin" | "groups" | "users";

export type CollectionAccessPolicy = {
  collection: string;
  mode: AccessMode;
  groups: string[];
  users: string[];
  exposeSourcePaths: boolean;
};

export type RetrievalMode = "quick" | "semantic" | "deep";

export type RetrievalRequest = {
  query: string;
  mode?: RetrievalMode;
  collections?: string[];
  topK?: number;
  minScore?: number;
  intent?: string;
  rerank?: boolean;
  includeFullDocument?: boolean;
  explain?: boolean;
};

export type Citation = {
  docid?: string;
  title?: string;
  qmdPath: string;
  originalPath?: string;
  line?: number;
};

export type RetrievalResult = {
  docid?: string;
  score: number;
  title: string;
  qmdPath: string;
  originalPath?: string;
  context?: string | null;
  line?: number;
  snippet?: string;
  body?: string;
  citation: Citation;
};

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type JobRecord<T = unknown> = {
  id: string;
  type: string;
  status: JobStatus;
  progress?: number;
  logs: string[];
  result?: T;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type IngestionMode = "markdown-passthrough" | "plain-text" | "auto";

export type IngestionManifestEntry = {
  sourcePath: string;
  relativePath: string;
  outputPath: string;
  sourceHash: string;
  sourceMtimeMs: number;
  sourceSize: number;
  pipeline: string;
  planner: "deterministic" | "local-model";
  convertedAt: string;
  stale: boolean;
  warnings: string[];
  error?: string;
};

export type IngestionManifest = {
  collection: string;
  sourceRoot: string;
  generatedRoot: string;
  updatedAt: string;
  entries: IngestionManifestEntry[];
};
