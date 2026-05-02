import express from "express";
import cors from "cors";
import { z } from "zod";
import { getConfig, ensureDataDirs } from "./config.js";
import { authFromRequest, requireAdmin, requireToken } from "./auth.js";
import { AccessPolicyStore } from "./accessPolicy.js";
import { QmdService } from "./qmdService.js";
import { IngestionService } from "./ingestion/IngestionService.js";
import { JobRunner } from "./jobs.js";
import { buildOpenApi } from "./openapi.js";
import { openWebUiAdminTools, openWebUiPipe, openWebUiRetrievalTool } from "./openwebui/artifacts.js";
import { adminUiHtml } from "./adminUi.js";
import { readQmdConfig, writeQmdConfig } from "./qmdConfig.js";
import { seedConfiguredCollection, seedOptionsFromEnv } from "./seed.js";
import type { CollectionAccessPolicy, RetrievalMode } from "./types.js";

const config = getConfig();
ensureDataDirs(config);

const app = express();
const policies = new AccessPolicyStore(config);
const qmd = new QmdService(config, policies);
const ingestion = new IngestionService(config);
const jobs = new JobRunner();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const retrieveSchema = z.object({
  query: z.string().min(1),
  mode: nullableOptional(z.enum(["quick", "semantic", "deep"])),
  collections: nullableOptional(z.array(z.string())),
  topK: nullableOptional(z.number().int().min(1).max(50)),
  minScore: nullableOptional(z.number().min(0).max(1)),
  intent: nullableOptional(z.string()),
  rerank: nullableOptional(z.boolean()),
  includeFullDocument: nullableOptional(z.boolean()),
  explain: nullableOptional(z.boolean()),
});

const collectionSchema = z.object({
  name: z.string().min(1),
  sourcePath: z.string().min(1),
  pattern: nullableOptional(z.string()),
  ignore: nullableOptional(z.array(z.string())),
  ingest: z.boolean().default(true),
});

function nullableOptional<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullish().transform((value) => value ?? undefined);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "qmdui" });
});

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QMDUI</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; padding: 40px; line-height: 1.5; background: Canvas; color: CanvasText; }
      main { max-width: 780px; }
      h1 { margin: 0 0 8px; font-size: 28px; }
      p { margin: 0 0 24px; color: color-mix(in srgb, CanvasText 72%, Canvas); }
      ul { padding-left: 20px; }
      li { margin: 8px 0; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <main>
      <h1>QMDUI API</h1>
      <p>QMDUI is running. This v1 server is API-first for Open WebUI Tools, Pipes, and admin Functions.</p>
      <ul>
        <li><a href="/admin">Admin</a></li>
        <li><a href="/health">Health</a></li>
        <li><a href="/api/openapi.json">OpenAPI spec</a></li>
        <li><a href="/api/openwebui/tool.py">Open WebUI retrieval Tool</a></li>
        <li><a href="/api/openwebui/pipe.py">Open WebUI Pipe/model</a></li>
        <li><a href="/api/openwebui/admin_tools.py">Open WebUI admin Tools</a></li>
      </ul>
      <p>Admin endpoints expect Open WebUI-style identity headers such as <code>x-open-webui-role: admin</code>.</p>
    </main>
  </body>
</html>`);
});

app.get("/admin", (_req, res) => {
  res.type("html").send(adminUiHtml());
});

app.get("/api/openapi.json", (_req, res) => {
  res.json(buildOpenApi(config));
});

app.get("/api/openwebui/tool.py", (_req, res) => {
  res.type("text/x-python").send(openWebUiRetrievalTool(config));
});

app.get("/api/openwebui/pipe.py", (_req, res) => {
  res.type("text/x-python").send(openWebUiPipe(config));
});

app.get("/api/openwebui/admin_tools.py", (_req, res) => {
  res.type("text/x-python").send(openWebUiAdminTools(config));
});

app.use(requireToken(config));

app.get("/api/admin/runtime", requireAdmin, (_req, res) => {
  const seed = seedOptionsFromEnv();
  res.json({
    service: "qmdui",
    host: config.host,
    port: config.port,
    rootDir: config.rootDir,
    dataDir: config.dataDir,
    generatedDir: config.generatedDir,
    manifestDir: config.manifestDir,
    policyPath: config.policyPath,
    qmdIndexName: config.qmdIndexName,
    qmdDbPath: config.qmdDbPath,
    qmdConfigPath: config.qmdConfigPath,
    embedProvider: config.embedProvider,
    activeEmbedModel: config.embedProvider === "ollama" ? config.ollamaEmbedModel : "embeddinggemma",
    embedTimeoutMs: config.embedTimeoutMs,
    embedRequireComplete: config.embedRequireComplete,
    embedFailOnErrors: config.embedFailOnErrors,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaEmbedModel: config.ollamaEmbedModel,
    ollamaBatchSize: config.ollamaBatchSize,
    tokenEnabled: Boolean(config.apiToken),
    seedCollection: seed.collection,
    seedSourceRoot: seed.sourceRoot,
    seedPattern: seed.pattern,
    seedAccessMode: seed.accessMode,
  });
});

app.get("/api/admin/qmd-config", requireAdmin, (_req, res, next) => {
  try {
    res.json(readQmdConfig(config));
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/qmd-config", requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({ content: z.string() }).parse(req.body);
    const snapshot = writeQmdConfig(config, input.content);
    await qmd.reload();
    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/reload", requireAdmin, async (_req, res, next) => {
  try {
    await qmd.reload();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/seed", requireAdmin, async (req, res, next) => {
  try {
    const base = seedOptionsFromEnv();
    const overrides = z.object({
      collection: z.string().min(1).optional(),
      sourceRoot: z.string().min(1).optional(),
      pattern: z.string().min(1).optional(),
      ignore: z.array(z.string()).optional(),
      ingest: z.boolean().optional(),
      includeHidden: z.boolean().optional(),
      useDefaultIgnore: z.boolean().optional(),
      flattenOutput: z.boolean().optional(),
      cleanOutput: z.boolean().optional(),
      update: z.boolean().optional(),
      embed: z.boolean().optional(),
      embedForce: z.boolean().optional(),
      requireSource: z.boolean().optional(),
      accessMode: z.enum(["all", "admin", "groups", "users"]).optional(),
      accessGroups: z.array(z.string()).optional(),
      accessUsers: z.array(z.string()).optional(),
      exposeSourcePaths: z.boolean().optional(),
    }).parse(req.body ?? {});
    const options = { ...base, ...overrides };
    const job = jobs.start("seed.openclaw", (context) => seedConfiguredCollection({
      config,
      ingestion,
      qmd,
      policies,
      onLog: context.log,
      onProgress: context.progress,
    }, options));
    res.status(202).json({ job });
  } catch (error) {
    next(error);
  }
});

app.get("/api/status", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await qmd.status());
  } catch (error) {
    next(error);
  }
});

app.get("/api/dashboard", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await qmd.dashboard());
  } catch (error) {
    next(error);
  }
});

app.post("/api/search/retrieve", async (req, res, next) => {
  try {
    const input = retrieveSchema.parse(req.body);
    const results = await qmd.retrieve(input, authFromRequest(req));
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

app.post("/api/search/expand", requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({
      query: z.string().min(1),
      intent: z.string().optional(),
    }).parse(req.body);
    res.json({ queries: await qmd.expandQuery(input.query, input.intent) });
  } catch (error) {
    next(error);
  }
});

for (const [path, mode] of [
  ["/api/search/quick", "quick"],
  ["/api/search/semantic", "semantic"],
  ["/api/search/deep", "deep"],
] as Array<[string, RetrievalMode]>) {
  app.post(path, async (req, res, next) => {
    try {
      const input = retrieveSchema.parse({ ...req.body, mode });
      const results = await qmd.retrieve(input, authFromRequest(req));
      res.json({ results });
    } catch (error) {
      next(error);
    }
  });
}

app.get("/api/collections", requireAdmin, async (_req, res, next) => {
  try {
    res.json({ collections: await qmd.listCollections() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/collections", requireAdmin, async (req, res, next) => {
  try {
    const input = collectionSchema.parse(req.body);
    let qmdPath = input.sourcePath;
    let qmdPattern = input.pattern ?? "**/*.md";
    let ingestionResult: unknown = undefined;

    if (input.ingest) {
      ingestionResult = await ingestion.ingest({
        collection: input.name,
        sourceRoot: input.sourcePath,
        pattern: input.pattern ?? "**/*",
        ignore: input.ignore,
      });
      qmdPath = ingestion.generatedRoot(input.name);
      qmdPattern = "**/*.md";
    }

    await qmd.addCollection(input.name, qmdPath, qmdPattern, input.ignore);
    res.status(201).json({ collection: input.name, qmdPath, qmdPattern, ingestion: ingestionResult });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/collections/:name", requireAdmin, async (req, res, next) => {
  try {
    res.json({ removed: await qmd.removeCollection(param(req.params.name)) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/collections/:name/rename", requireAdmin, async (req, res, next) => {
  try {
    const newName = z.object({ newName: z.string().min(1) }).parse(req.body).newName;
    res.json({ renamed: await qmd.renameCollection(param(req.params.name), newName) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/contexts", requireAdmin, async (_req, res, next) => {
  try {
    res.json({ contexts: await qmd.listContexts() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/contexts", requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({
      collection: z.string().min(1),
      pathPrefix: z.string().default("/"),
      context: z.string().min(1),
    }).parse(req.body);
    res.json({ ok: await qmd.addContext(input.collection, input.pathPrefix, input.context) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/contexts", requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({
      collection: z.string().min(1),
      pathPrefix: z.string().default("/"),
    }).parse(req.body);
    res.json({ ok: await qmd.removeContext(input.collection, input.pathPrefix) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/documents/get", async (req, res, next) => {
  try {
    const input = z.object({
      path: z.string().min(1),
      fromLine: z.number().int().positive().optional(),
      maxLines: z.number().int().positive().optional(),
    }).parse(req.body);
    res.json(await qmd.getDocument(input.path, authFromRequest(req), input));
  } catch (error) {
    next(error);
  }
});

app.post("/api/ingestion/convert", requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({
      collection: z.string().min(1),
      sourceRoot: z.string().min(1),
      pattern: z.string().optional(),
      ignore: z.array(z.string()).optional(),
    }).parse(req.body);
    const job = jobs.start("ingestion.convert", (context) => ingestion.ingest({
      ...input,
      onLog: context.log,
      onProgress: context.progress,
    }));
    res.status(202).json({ job });
  } catch (error) {
    next(error);
  }
});

app.post("/api/ingestion/preview", requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({
      collection: z.string().min(1),
      sourceRoot: z.string().min(1),
      pattern: z.string().optional(),
      ignore: z.array(z.string()).optional(),
    }).parse(req.body);
    res.json(await ingestion.preview(input));
  } catch (error) {
    next(error);
  }
});

app.get("/api/ingestion/:collection", requireAdmin, (req, res) => {
  const manifest = ingestion.readManifest(param(req.params.collection));
  if (!manifest) {
    res.status(404).json({ error: "Manifest not found" });
    return;
  }
  res.json({ manifest });
});

app.post("/api/jobs/update", requireAdmin, async (req, res, next) => {
  try {
    const collections = z.object({ collections: z.array(z.string()).optional() }).parse(req.body).collections;
    const job = jobs.start("qmd.update", async (context) => {
      context.log(`Updating ${collections?.join(", ") || "all collections"}`);
      return qmd.update(collections);
    });
    res.status(202).json({ job });
  } catch (error) {
    next(error);
  }
});

app.post("/api/jobs/embed", requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({
      force: z.boolean().optional(),
      provider: z.enum(["qmd", "ollama"]).optional(),
      model: z.string().min(1).optional(),
      maxDocsPerBatch: z.number().int().positive().optional(),
      maxBatchBytes: z.number().int().positive().optional(),
      requireComplete: z.boolean().optional(),
      failOnErrors: z.boolean().optional(),
    }).parse(req.body);
    const job = jobs.start("qmd.embed", async (context) => {
      context.log(`Embedding documents via ${input.provider ?? config.embedProvider}`);
      const result = await qmd.embed({
        ...input,
        onProgress: (info) => {
          if (info.totalBytes > 0) {
            context.progress(Math.min(99, Math.round((info.bytesProcessed / info.totalBytes) * 100)));
          }
        },
      });
      context.progress(100);
      return result;
    });
    res.status(202).json({ job });
  } catch (error) {
    next(error);
  }
});

app.get("/api/jobs", requireAdmin, (_req, res) => {
  res.json({ jobs: jobs.list() });
});

app.get("/api/jobs/:id", requireAdmin, (req, res) => {
  const job = jobs.get(param(req.params.id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ job });
});

app.get("/api/access/policies", requireAdmin, (_req, res) => {
  res.json({ policies: policies.list() });
});

app.post("/api/access/evaluate", requireAdmin, (req, res, next) => {
  try {
    const input = z.object({
      collection: z.string().min(1),
      userId: z.string().default("anonymous"),
      role: z.enum(["admin", "user", "pending"]).default("user"),
      groups: z.array(z.string()).default([]),
    }).parse(req.body);
    const auth = {
      userId: input.userId,
      role: input.role,
      groups: input.groups,
    };
    res.json({
      allowed: policies.canAccess(input.collection, auth),
      exposeSourcePaths: policies.canExposeSourcePath(input.collection, auth),
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/access/policies/:collection", requireAdmin, (req, res, next) => {
  try {
    const collection = param(req.params.collection);
    const policy = z.object({
      mode: z.enum(["all", "admin", "groups", "users"]),
      groups: z.array(z.string()).default([]),
      users: z.array(z.string()).default([]),
      exposeSourcePaths: z.boolean().default(false),
    }).parse(req.body);
    const saved = policies.set(collection, {
      collection,
      ...policy,
    } satisfies CollectionAccessPolicy);
    res.json({ policy: saved });
  } catch (error) {
    next(error);
  }
});

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Validation failed", issues: error.issues });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: message });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`QMDUI API listening on http://${config.host}:${config.port}`);
});

process.on("SIGTERM", async () => {
  server.close();
  await qmd.close();
});
