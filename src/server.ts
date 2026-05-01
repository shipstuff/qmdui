import http, { type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, URL } from "node:url";
import { loadConfig } from "./config.js";
import { identityFromHeaders, requireAdmin, requireApprovedUser } from "./identity.js";
import { IngestionService } from "./ingestion/IngestionService.js";
import { JobRunner } from "./jobs.js";
import { adminOpenApi, combinedOpenApi, retrievalOpenApi } from "./openapi.js";
import { QmdCli } from "./qmdCli.js";
import { QmdService } from "./qmdService.js";
import { canAccessCollection, filterCollectionsForIdentity, redactCollection } from "./rbac.js";
import { StateStore } from "./stateStore.js";
import type { AppConfig, Collection, CollectionPolicy, ContextEntry, Identity, SearchMode, SearchRequest, SearchResult } from "./types.js";
import { adminFunctionPython, pipePython } from "./integrations/openwebuiArtifacts.js";

type HandlerContext = {
  config: AppConfig;
  state: StateStore;
  qmd: QmdService;
  cli: QmdCli;
  ingestion: IngestionService;
  jobs: JobRunner;
};

type JsonValue = Record<string, unknown> | unknown[];

async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function send(res: ServerResponse, statusCode: number, payload: unknown, contentType = "application/json"): void {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(contentType === "application/json" ? JSON.stringify(payload, null, 2) : String(payload));
}

function sendError(res: ServerResponse, error: unknown): void {
  const statusCode = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : 500;
  send(res, Number.isFinite(statusCode) ? statusCode : 500, {
    error: error instanceof Error ? error.message : String(error)
  });
}

function pathId(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined;
  const rest = pathname.slice(prefix.length);
  return rest && !rest.includes("/") ? decodeURIComponent(rest) : undefined;
}

function actionPathId(pathname: string, prefix: string, suffix: string): string | undefined {
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined;
  const rest = pathname.slice(prefix.length, -suffix.length);
  return rest && !rest.includes("/") ? decodeURIComponent(rest) : undefined;
}

function sanitizeResults(identity: Identity, policies: Map<string, CollectionPolicy>, results: SearchResult[]): SearchResult[] {
  return results.map((result) => {
    const policy = policies.get(result.citation.collectionId);
    if (identity.role === "admin" || policy?.exposeSourcePaths) return result;
    return {
      ...result,
      citation: {
        ...result.citation,
        originalSourcePath: undefined
      }
    };
  });
}

async function resolveAllowedCollections(
  identity: Identity,
  state: StateStore,
  requested?: string[]
): Promise<{ collections: Collection[]; policies: Map<string, CollectionPolicy> }> {
  const collections = await state.listCollections();
  const policies = await state.policiesByCollection();
  const allowed = filterCollectionsForIdentity(identity, collections, policies);
  const filtered = requested?.length ? allowed.filter((collection) => requested.includes(collection.id)) : allowed;
  return { collections: filtered, policies };
}

async function withManifestCitationMetadata(ctx: HandlerContext, results: SearchResult[]): Promise<SearchResult[]> {
  const collections = await ctx.state.listCollections();
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const manifestEntries = new Map<string, { sourcePath: string; relativePath: string; outputPath: string }>();

  for (const collection of collections) {
    const manifest = await ctx.ingestion.getManifest(collection.id);
    for (const entry of manifest?.entries ?? []) {
      manifestEntries.set(entry.outputPath, entry);
      manifestEntries.set(entry.relativePath, entry);
      manifestEntries.set(`${entry.relativePath}.md`, entry);
      manifestEntries.set(pathBasenameKey(entry.outputPath), entry);
    }
  }

  return results.map((result) => {
    if (result.citation.originalSourcePath && result.citation.originalRelativePath) return result;
    const collection = byId.get(result.citation.collectionId);
    const qmdPath = result.citation.qmdPath ?? result.citation.docid;
    const candidates = [
      qmdPath,
      qmdPath && collection ? resolveWithin(collection.generatedPath, qmdPath) : undefined,
      qmdPath && pathBasenameKey(qmdPath)
    ].filter(Boolean) as string[];
    const entry = candidates.map((candidate) => manifestEntries.get(candidate)).find(Boolean);
    if (!entry) return result;
    return {
      ...result,
      citation: {
        ...result.citation,
        originalRelativePath: result.citation.originalRelativePath ?? entry.relativePath,
        originalSourcePath: result.citation.originalSourcePath ?? entry.sourcePath,
        qmdPath: result.citation.qmdPath ?? entry.outputPath
      }
    };
  });
}

function pathBasenameKey(filePath: string): string {
  return filePath.split(/[\\/]/).slice(-1)[0] ?? filePath;
}

function resolveWithin(root: string, candidate: string): string | undefined {
  if (candidate.startsWith("/")) return candidate;
  return `${root.replace(/\/$/, "")}/${candidate}`;
}

function buildRagPrompt(query: string, results: SearchResult[]): string {
  const context = results
    .map((result, index) => {
      const citation = result.citation;
      const source = citation.originalRelativePath ?? citation.title ?? citation.qmdPath ?? result.id;
      return [`[${index + 1}] ${source}`, result.snippet ?? result.body ?? ""].join("\n");
    })
    .join("\n\n");
  const citations = results
    .map((result, index) => {
      const citation = result.citation;
      return `[${index + 1}] ${citation.collectionName}: ${citation.originalRelativePath ?? citation.title ?? citation.qmdPath ?? result.id}`;
    })
    .join("\n");
  return `Answer the question using only the QMD context below. Include citations by bracket number.\n\nContext:\n${context}\n\nCitations:\n${citations}\n\nQuestion: ${query}`;
}

async function handleSearch(mode: SearchMode, req: IncomingMessage, identity: Identity, ctx: HandlerContext): Promise<JsonValue> {
  requireApprovedUser(identity);
  const body = await readBody<SearchRequest>(req);
  if (!body.query || typeof body.query !== "string") {
    throw Object.assign(new Error("query is required"), { statusCode: 400 });
  }
  const { collections, policies } = await resolveAllowedCollections(identity, ctx.state, body.collections);
  if (!collections.length) {
    return { mode, results: [] };
  }
  const results = await withManifestCitationMetadata(ctx, await ctx.qmd.search(mode, { ...body, mode }, collections));
  return { mode, results: sanitizeResults(identity, policies, results) };
}

async function createCollection(req: IncomingMessage, ctx: HandlerContext): Promise<JsonValue> {
  const body = await readBody<Partial<Collection> & { displayName?: string; sourcePath?: string }>(req);
  if (!body.displayName || !body.sourcePath) {
    throw Object.assign(new Error("displayName and sourcePath are required"), { statusCode: 400 });
  }
  const collection = await ctx.state.createCollection({
    displayName: body.displayName,
    sourcePath: body.sourcePath,
    includeGlobs: body.includeGlobs,
    ignoreGlobs: body.ignoreGlobs,
    ingestionMode: body.ingestionMode,
    autoConvert: body.autoConvert,
    autoEmbed: body.autoEmbed
  });
  await ctx.qmd.addCollection(collection);
  return { collection };
}

async function route(req: IncomingMessage, res: ServerResponse, ctx: HandlerContext): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/openapi.json") return send(res, 200, combinedOpenApi());
  if (req.method === "GET" && pathname === "/api/openapi/retrieval.json") return send(res, 200, retrievalOpenApi());
  if (req.method === "GET" && pathname === "/api/openapi/admin.json") return send(res, 200, adminOpenApi());
  if (req.method === "GET" && pathname === "/api/integrations/open-webui/pipe.py") return send(res, 200, pipePython(), "text/x-python; charset=utf-8");
  if (req.method === "GET" && pathname === "/api/integrations/open-webui/admin_function.py") return send(res, 200, adminFunctionPython(), "text/x-python; charset=utf-8");

  const identity = identityFromHeaders(req.headers, ctx.config);

  if (req.method === "GET" && pathname === "/api/status") {
    return send(res, 200, await ctx.qmd.status(ctx.state.getStateDir()));
  }

  if (req.method === "GET" && pathname === "/api/collections") {
    const collections = await ctx.state.listCollections();
    const policies = await ctx.state.policiesByCollection();
    const allowed = filterCollectionsForIdentity(identity, collections, policies).map((collection) =>
      redactCollection(collection, identity, policies.get(collection.id))
    );
    return send(res, 200, { collections: allowed });
  }

  if (req.method === "POST" && pathname === "/api/search/quick") return send(res, 200, await handleSearch("quick", req, identity, ctx));
  if (req.method === "POST" && pathname === "/api/search/semantic") return send(res, 200, await handleSearch("semantic", req, identity, ctx));
  if (req.method === "POST" && pathname === "/api/search/deep") return send(res, 200, await handleSearch("deep", req, identity, ctx));

  if (req.method === "POST" && pathname === "/api/search/expand") {
    requireApprovedUser(identity);
    const body = await readBody<{ query?: string }>(req);
    if (!body.query) throw Object.assign(new Error("query is required"), { statusCode: 400 });
    return send(res, 200, await ctx.qmd.expandQuery(body.query));
  }

  if (req.method === "POST" && pathname === "/api/documents/get") {
    requireApprovedUser(identity);
    const body = await readBody<{ collectionId: string; docid: string }>(req);
    const collection = await ctx.state.getCollection(body.collectionId);
    const policy = (await ctx.state.policiesByCollection()).get(body.collectionId);
    if (!collection || !canAccessCollection(identity, policy)) throw Object.assign(new Error("Document not found"), { statusCode: 404 });
    const document = await ctx.qmd.getDocument(collection, body.docid);
    return send(res, 200, document);
  }

  if (req.method === "POST" && pathname === "/api/documents/multi-get") {
    requireApprovedUser(identity);
    const body = await readBody<{ collectionId: string; docids: string[] }>(req);
    if (!Array.isArray(body.docids)) throw Object.assign(new Error("docids must be an array"), { statusCode: 400 });
    const collection = await ctx.state.getCollection(body.collectionId);
    const policy = (await ctx.state.policiesByCollection()).get(body.collectionId);
    if (!collection || !canAccessCollection(identity, policy)) throw Object.assign(new Error("Collection not found"), { statusCode: 404 });
    return send(res, 200, { documents: await ctx.qmd.multiGet(collection, body.docids.slice(0, 25)) });
  }

  if (req.method === "GET" && pathname === "/api/integrations/open-webui/status") {
    requireApprovedUser(identity);
    return send(res, 200, {
      ok: true,
      authMode: ctx.config.authMode,
      retrievalOpenApi: "/api/openapi/retrieval.json",
      pipe: "/api/integrations/open-webui/pipe.py",
      adminFunction: identity.role === "admin" ? "/api/integrations/open-webui/admin_function.py" : undefined
    });
  }

  if (req.method === "POST" && (pathname === "/api/integrations/open-webui/copy-prompt" || pathname === "/api/integrations/open-webui/ask")) {
    requireApprovedUser(identity);
    const body = await readBody<SearchRequest>(req);
    if (!body.query) throw Object.assign(new Error("query is required"), { statusCode: 400 });
    const mode = body.mode ?? "deep";
    const { collections, policies } = await resolveAllowedCollections(identity, ctx.state, body.collections);
    const results = collections.length
      ? sanitizeResults(identity, policies, await withManifestCitationMetadata(ctx, await ctx.qmd.search(mode, { ...body, mode }, collections)))
      : [];
    const prompt = buildRagPrompt(body.query, results);
    return send(res, 200, {
      mode,
      prompt,
      results,
      note:
        pathname.endsWith("/ask")
          ? "V1 returns the grounded prompt for Open WebUI/Pipe execution; Open WebUI remains responsible for generation."
          : undefined
    });
  }

  requireAdmin(identity);

  if (req.method === "GET" && pathname === "/api/dashboard") {
    const collections = await ctx.state.listCollections();
    const manifests = await Promise.all(collections.map((collection) => ctx.ingestion.getManifest(collection.id)));
    const converted = manifests.reduce((count, manifest) => count + (manifest?.entries.filter((entry) => !entry.stale && !entry.errors.length).length ?? 0), 0);
    const failed = manifests.reduce((count, manifest) => count + (manifest?.entries.filter((entry) => entry.errors.length).length ?? 0), 0);
    return send(res, 200, {
      qmd: await ctx.qmd.status(ctx.state.getStateDir()),
      collections: collections.length,
      ingestion: { converted, failed },
      jobs: ctx.jobs.list().slice(0, 10)
    });
  }

  if (req.method === "GET" && pathname === "/api/contexts") {
    return send(res, 200, { contexts: await ctx.state.listContexts() });
  }

  if (req.method === "POST" && pathname === "/api/contexts") {
    const body = await readBody<Partial<ContextEntry>>(req);
    if (!body.text || !body.scope) throw Object.assign(new Error("scope and text are required"), { statusCode: 400 });
    return send(res, 200, {
      context: await ctx.state.addContext({
        scope: body.scope,
        collectionId: body.collectionId,
        path: body.path,
        text: body.text
      })
    });
  }

  if (req.method === "DELETE" && pathname === "/api/contexts") {
    const body = await readBody<{ id?: string }>(req);
    if (!body.id) throw Object.assign(new Error("id is required"), { statusCode: 400 });
    return send(res, 200, { ok: await ctx.state.removeContext(body.id) });
  }

  if (req.method === "POST" && pathname === "/api/collections") return send(res, 200, await createCollection(req, ctx));

  const renameCollectionId = actionPathId(pathname, "/api/collections/", "/rename");
  if (renameCollectionId && req.method === "POST") {
    const body = await readBody<{ displayName?: string }>(req);
    if (!body.displayName) throw Object.assign(new Error("displayName is required"), { statusCode: 400 });
    const collection = await ctx.state.getCollection(renameCollectionId);
    if (!collection) throw Object.assign(new Error("Collection not found"), { statusCode: 404 });
    await ctx.qmd.renameCollection(collection, body.displayName);
    return send(res, 200, { collection: await ctx.state.updateCollection(renameCollectionId, { displayName: body.displayName }) });
  }

  const includeCollectionId = actionPathId(pathname, "/api/collections/", "/include");
  if (includeCollectionId && req.method === "POST") {
    return send(res, 200, { collection: await ctx.state.updateCollection(includeCollectionId, { includeInDefault: true }) });
  }

  const excludeCollectionId = actionPathId(pathname, "/api/collections/", "/exclude");
  if (excludeCollectionId && req.method === "POST") {
    return send(res, 200, { collection: await ctx.state.updateCollection(excludeCollectionId, { includeInDefault: false }) });
  }

  const updateCommandCollectionId = actionPathId(pathname, "/api/collections/", "/update-command");
  if (updateCommandCollectionId && req.method === "POST") {
    ctx.cli.assertAdminDangerEnabled();
    const body = await readBody<{ updateCommand?: string }>(req);
    return send(res, 200, { collection: await ctx.state.updateCollection(updateCommandCollectionId, { updateCommand: body.updateCommand ?? "" }) });
  }

  const collectionId = pathId(pathname, "/api/collections/");
  if (collectionId && req.method === "PATCH") {
    const patch = await readBody<Partial<Collection>>(req);
    return send(res, 200, { collection: await ctx.state.updateCollection(collectionId, patch) });
  }
  if (collectionId && req.method === "DELETE") {
    const collection = await ctx.state.getCollection(collectionId);
    if (collection) await ctx.qmd.removeCollection(collection);
    await ctx.state.removeCollection(collectionId);
    return send(res, 200, { ok: true, deletedSourceFiles: false });
  }

  if (req.method === "POST" && pathname === "/api/ingestion/preview") {
    const { collectionId } = await readBody<{ collectionId: string }>(req);
    const collection = await ctx.state.getCollection(collectionId);
    if (!collection) throw Object.assign(new Error("Collection not found"), { statusCode: 404 });
    return send(res, 200, await ctx.ingestion.preview(collection));
  }

  if (req.method === "POST" && pathname === "/api/ingestion/convert") {
    const { collectionId } = await readBody<{ collectionId: string }>(req);
    const collection = await ctx.state.getCollection(collectionId);
    if (!collection) throw Object.assign(new Error("Collection not found"), { statusCode: 404 });
    const job = ctx.jobs.start("ingestion.convert", async (runningJob) => {
      const manifest = await ctx.ingestion.convert(collection);
      runningJob.logs.push(`Converted ${manifest.entries.filter((entry) => !entry.errors.length && !entry.stale).length} files`);
      return manifest;
    });
    return send(res, 202, { job });
  }

  const ingestionId = pathId(pathname, "/api/ingestion/");
  if (ingestionId && req.method === "GET") {
    return send(res, 200, { manifest: await ctx.ingestion.getManifest(ingestionId) });
  }

  if (req.method === "POST" && pathname === "/api/jobs/update") {
    const body = await readBody<{ collectionIds?: string[] }>(req);
    const collections = await ctx.state.listCollections();
    const selected = body.collectionIds?.length ? collections.filter((collection) => body.collectionIds?.includes(collection.id)) : collections;
    const job = ctx.jobs.start("qmd.update", async () => ctx.cli.update(selected.map((collection) => collection.qmdCollectionName)));
    return send(res, 202, { job });
  }

  if (req.method === "POST" && pathname === "/api/jobs/embed") {
    const body = await readBody<{ collectionIds?: string[] }>(req);
    const collections = await ctx.state.listCollections();
    const selected = body.collectionIds?.length ? collections.filter((collection) => body.collectionIds?.includes(collection.id)) : collections;
    const job = ctx.jobs.start("qmd.embed", async () => ctx.cli.embed(selected.map((collection) => collection.qmdCollectionName)));
    return send(res, 202, { job });
  }

  if (req.method === "POST" && pathname === "/api/jobs/cleanup") {
    ctx.cli.assertAdminDangerEnabled();
    const body = await readBody<{ collectionIds?: string[]; confirm?: boolean }>(req);
    const collections = await ctx.state.listCollections();
    const selected = body.collectionIds?.length ? collections.filter((collection) => body.collectionIds?.includes(collection.id)) : collections;
    const job = ctx.jobs.start("qmdui.cleanup", async (runningJob) => {
      const staleOutputs: string[] = [];
      for (const collection of selected) {
        const manifest = await ctx.ingestion.getManifest(collection.id);
        for (const entry of manifest?.entries ?? []) {
          if (entry.stale) staleOutputs.push(entry.outputPath);
        }
      }
      if (!body.confirm) {
        runningJob.logs.push(`Preview only: ${staleOutputs.length} stale generated files would be removed`);
        return { preview: true, staleOutputs };
      }
      for (const outputPath of staleOutputs) {
        const resolvedOutput = path.resolve(outputPath);
        const collection = selected.find((item) => resolvedOutput.startsWith(path.resolve(item.generatedPath) + path.sep));
        if (!collection) throw new Error(`Refusing to remove non-generated path: ${outputPath}`);
        await fs.rm(resolvedOutput, { force: true });
      }
      runningJob.logs.push(`Removed ${staleOutputs.length} stale generated files from app-owned state`);
      return { preview: false, removed: staleOutputs.length };
    });
    return send(res, 202, { job });
  }

  if (req.method === "GET" && pathname === "/api/jobs") return send(res, 200, { jobs: ctx.jobs.list() });
  const jobEventsId = actionPathId(pathname, "/api/jobs/", "/events");
  if (jobEventsId && req.method === "GET") {
    const job = ctx.jobs.get(jobEventsId);
    if (!job) throw Object.assign(new Error("Job not found"), { statusCode: 404 });
    const lines = [`event: status`, `data: ${JSON.stringify(job)}`, ""].join("\n");
    return send(res, 200, lines, "text/event-stream; charset=utf-8");
  }

  const jobId = pathId(pathname, "/api/jobs/");
  if (jobId && req.method === "GET") {
    const job = ctx.jobs.get(jobId);
    if (!job) throw Object.assign(new Error("Job not found"), { statusCode: 404 });
    return send(res, 200, { job });
  }

  if (req.method === "GET" && pathname === "/api/access/policies") return send(res, 200, { policies: await ctx.state.listPolicies() });
  if (req.method === "POST" && pathname === "/api/access/evaluate") {
    const body = await readBody<{ identity?: Identity; collectionIds?: string[] }>(req);
    const evaluatedIdentity = body.identity ?? identity;
    const collections = await ctx.state.listCollections();
    const policies = await ctx.state.policiesByCollection();
    const selected = body.collectionIds?.length ? collections.filter((collection) => body.collectionIds?.includes(collection.id)) : collections;
    return send(res, 200, {
      identity: {
        userId: evaluatedIdentity.userId,
        role: evaluatedIdentity.role,
        groups: evaluatedIdentity.groups
      },
      collections: selected.map((collection) => ({
        collectionId: collection.id,
        displayName: collection.displayName,
        allowed: canAccessCollection(evaluatedIdentity, policies.get(collection.id))
      }))
    });
  }
  const policyId = pathId(pathname, "/api/access/policies/");
  if (policyId && req.method === "PUT") {
    const body = await readBody<Omit<CollectionPolicy, "collectionId">>(req);
    return send(res, 200, {
      policy: await ctx.state.upsertPolicy({
        collectionId: policyId,
        mode: body.mode,
        groups: body.groups ?? [],
        users: body.users ?? [],
        exposeSourcePaths: Boolean(body.exposeSourcePaths)
      })
    });
  }

  send(res, 404, { error: "Not found" });
}

export async function createServer(config = loadConfig()): Promise<http.Server> {
  const state = new StateStore(config.stateDir);
  await state.init();
  const cli = new QmdCli(config);
  const ctx: HandlerContext = {
    config,
    state,
    cli,
    qmd: new QmdService(cli),
    ingestion: new IngestionService((collectionId) => state.manifestPath(collectionId)),
    jobs: new JobRunner()
  };
  return http.createServer((req, res) => {
    route(req, res, ctx).catch((error) => sendError(res, error));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const server = await createServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`QMDUI listening on http://${config.host}:${config.port}`);
  });
}
