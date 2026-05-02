import type { AppConfig } from "./config.js";

export function buildOpenApi(config: AppConfig) {
  const baseUrl = `http://${config.host}:${config.port}`;
  return {
    openapi: "3.1.0",
    info: {
      title: "QMDUI API",
      version: "0.1.0",
      description: "QMD retrieval and admin API for Open WebUI Tools, Pipes, and admin-only Functions.",
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        RetrieveRequest: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            mode: { type: "string", enum: ["quick", "semantic", "deep"] },
            collections: { type: "array", items: { type: "string" } },
            topK: { type: "integer", minimum: 1, maximum: 50 },
            minScore: { type: "number", minimum: 0, maximum: 1 },
            intent: { type: "string" },
            rerank: { type: "boolean" },
          },
        },
        CollectionRequest: {
          type: "object",
          required: ["name", "sourcePath"],
          properties: {
            name: { type: "string" },
            sourcePath: { type: "string" },
            pattern: { type: "string" },
            ignore: { type: "array", items: { type: "string" } },
            ingest: { type: "boolean" },
          },
        },
        IngestionRequest: {
          type: "object",
          required: ["collection", "sourceRoot"],
          properties: {
            collection: { type: "string" },
            sourceRoot: { type: "string" },
            pattern: { type: "string" },
            ignore: { type: "array", items: { type: "string" } },
          },
        },
        AccessPolicy: {
          type: "object",
          required: ["mode"],
          properties: {
            mode: { type: "string", enum: ["all", "admin", "groups", "users"] },
            groups: { type: "array", items: { type: "string" } },
            users: { type: "array", items: { type: "string" } },
            exposeSourcePaths: { type: "boolean" },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/search/retrieve": {
        post: {
          operationId: "qmd_retrieve",
          summary: "Retrieve QMD context",
          description: "Read-only retrieval over QMD collections filtered by Open WebUI role/group headers.",
          parameters: identityHeaders(),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RetrieveRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Ranked retrieval results with citations.",
            },
          },
        },
      },
      "/api/search/quick": searchPath("qmd_search_quick", "Run Quick Search", "Read-only keyword/BM25 retrieval."),
      "/api/search/semantic": searchPath("qmd_search_semantic", "Run Semantic Search", "Read-only vector retrieval."),
      "/api/search/deep": searchPath("qmd_search_deep", "Run Deep Search", "Read-only hybrid retrieval with optional reranking."),
      "/api/search/expand": {
        post: {
          operationId: "qmd_expand_query",
          summary: "Expand a query",
          description: "Admin-only query expansion diagnostics.",
          parameters: identityHeaders(),
          requestBody: jsonBody({
            type: "object",
            required: ["query"],
            properties: {
              query: { type: "string" },
              intent: { type: "string" },
            },
          }),
          responses: { "200": { description: "Expanded query variants." } },
        },
      },
      "/api/documents/get": {
        post: {
          operationId: "qmd_get_document",
          summary: "Get one QMD document",
          description: "Read-only document retrieval filtered by Open WebUI role/group headers.",
          parameters: identityHeaders(),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["path"],
                  properties: {
                    path: { type: "string" },
                    fromLine: { type: "integer" },
                    maxLines: { type: "integer" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Document body and metadata." } },
        },
      },
      "/api/status": {
        get: {
          operationId: "qmd_status",
          summary: "QMD status",
          description: "Admin-only status endpoint.",
          parameters: identityHeaders(),
          responses: { "200": { description: "QMD status." } },
        },
      },
      "/api/dashboard": {
        get: {
          operationId: "qmd_dashboard",
          summary: "QMD dashboard",
          description: "Admin-only dashboard/status rollup.",
          parameters: identityHeaders(),
          responses: { "200": { description: "QMD dashboard metrics." } },
        },
      },
      "/api/collections": {
        get: {
          operationId: "qmd_list_collections",
          summary: "List QMD collections",
          description: "Admin-only collection list.",
          parameters: identityHeaders(),
          responses: { "200": { description: "Collections." } },
        },
        post: {
          operationId: "qmd_add_collection",
          summary: "Add QMD collection",
          description: "Admin-only: add a source folder as a collection, optionally ingesting into generated markdown.",
          parameters: identityHeaders(),
          requestBody: jsonBody({ $ref: "#/components/schemas/CollectionRequest" }),
          responses: { "201": { description: "Collection added." } },
        },
      },
      "/api/collections/{name}": {
        delete: {
          operationId: "qmd_remove_collection",
          summary: "Remove QMD collection",
          description: "Admin-only: remove a collection reference. Source files are never deleted.",
          parameters: [...identityHeaders(), pathParam("name")],
          responses: { "200": { description: "Collection removed." } },
        },
      },
      "/api/collections/{name}/rename": {
        post: {
          operationId: "qmd_rename_collection",
          summary: "Rename QMD collection",
          description: "Admin-only: rename a QMD collection.",
          parameters: [...identityHeaders(), pathParam("name")],
          requestBody: jsonBody({
            type: "object",
            required: ["newName"],
            properties: { newName: { type: "string" } },
          }),
          responses: { "200": { description: "Collection renamed." } },
        },
      },
      "/api/contexts": {
        get: {
          operationId: "qmd_list_contexts",
          summary: "List QMD contexts",
          description: "Admin-only: list global and collection contexts.",
          parameters: identityHeaders(),
          responses: { "200": { description: "Contexts." } },
        },
        post: {
          operationId: "qmd_add_context",
          summary: "Add QMD context",
          description: "Admin-only: add context for a collection/path prefix.",
          parameters: identityHeaders(),
          requestBody: contextBody(),
          responses: { "200": { description: "Context added." } },
        },
        delete: {
          operationId: "qmd_remove_context",
          summary: "Remove QMD context",
          description: "Admin-only: remove context for a collection/path prefix.",
          parameters: identityHeaders(),
          requestBody: jsonBody({
            type: "object",
            required: ["collection"],
            properties: {
              collection: { type: "string" },
              pathPrefix: { type: "string" },
            },
          }),
          responses: { "200": { description: "Context removed." } },
        },
      },
      "/api/ingestion/preview": {
        post: {
          operationId: "qmd_ingestion_preview",
          summary: "Preview source folder ingestion",
          description: "Admin-only preview of converter choices for a source folder.",
          parameters: identityHeaders(),
          requestBody: jsonBody({ $ref: "#/components/schemas/IngestionRequest" }),
          responses: { "200": { description: "Ingestion preview." } },
        },
      },
      "/api/ingestion/convert": {
        post: {
          operationId: "qmd_ingestion_convert",
          summary: "Convert source folder",
          description: "Admin-only: start a conversion job into QMDUI-generated markdown.",
          parameters: identityHeaders(),
          requestBody: jsonBody({ $ref: "#/components/schemas/IngestionRequest" }),
          responses: { "202": { description: "Job accepted." } },
        },
      },
      "/api/ingestion/{collection}": {
        get: {
          operationId: "qmd_ingestion_manifest",
          summary: "Get ingestion manifest",
          description: "Admin-only: read the conversion manifest for a collection.",
          parameters: [...identityHeaders(), pathParam("collection")],
          responses: { "200": { description: "Manifest." } },
        },
      },
      "/api/jobs/update": {
        post: {
          operationId: "qmd_start_update",
          summary: "Start QMD update job",
          description: "Admin-only: start a QMD update job.",
          parameters: identityHeaders(),
          requestBody: jsonBody({
            type: "object",
            properties: {
              collections: { type: "array", items: { type: "string" } },
            },
          }),
          responses: { "202": { description: "Job accepted." } },
        },
      },
      "/api/jobs/embed": {
        post: {
          operationId: "qmd_start_embed",
          summary: "Start QMD embed job",
          description: "Admin-only: start embedding documents.",
          parameters: identityHeaders(),
          requestBody: jsonBody({
            type: "object",
            properties: {
              force: { type: "boolean" },
              maxDocsPerBatch: { type: "integer" },
              maxBatchBytes: { type: "integer" },
            },
          }),
          responses: { "202": { description: "Job accepted." } },
        },
      },
      "/api/jobs": {
        get: {
          operationId: "qmd_list_jobs",
          summary: "List QMDUI jobs",
          description: "Admin-only job list.",
          parameters: identityHeaders(),
          responses: { "200": { description: "Jobs." } },
        },
      },
      "/api/jobs/{id}": {
        get: {
          operationId: "qmd_get_job",
          summary: "Get QMDUI job",
          description: "Admin-only: inspect one job with logs/result/error.",
          parameters: [...identityHeaders(), pathParam("id")],
          responses: { "200": { description: "Job." }, "404": { description: "Job not found." } },
        },
      },
      "/api/access/policies": {
        get: {
          operationId: "qmd_list_access_policies",
          summary: "List collection access policies",
          description: "Admin-only: list QMD collection access policies.",
          parameters: identityHeaders(),
          responses: { "200": { description: "Access policies." } },
        },
      },
      "/api/access/policies/{collection}": {
        put: {
          operationId: "qmd_set_access_policy",
          summary: "Set collection access policy",
          description: "Admin-only: map a collection to Open WebUI users/groups/admins.",
          parameters: [...identityHeaders(), pathParam("collection")],
          requestBody: jsonBody({ $ref: "#/components/schemas/AccessPolicy" }),
          responses: { "200": { description: "Saved access policy." } },
        },
      },
      "/api/access/evaluate": {
        post: {
          operationId: "qmd_evaluate_access",
          summary: "Evaluate collection access",
          description: "Admin-only: test a hypothetical Open WebUI user's collection access.",
          parameters: identityHeaders(),
          requestBody: jsonBody({
            type: "object",
            required: ["collection"],
            properties: {
              collection: { type: "string" },
              userId: { type: "string" },
              role: { type: "string", enum: ["admin", "user", "pending"] },
              groups: { type: "array", items: { type: "string" } },
            },
          }),
          responses: { "200": { description: "Access evaluation result." } },
        },
      },
    },
  };
}

function searchPath(operationId: string, summary: string, description: string) {
  return {
    post: {
      operationId,
      summary,
      description,
      parameters: identityHeaders(),
      requestBody: jsonBody({ $ref: "#/components/schemas/RetrieveRequest" }),
      responses: {
        "200": {
          description: "Ranked retrieval results with citations.",
        },
      },
    },
  };
}

function jsonBody(schema: Record<string, unknown>) {
  return {
    required: true,
    content: {
      "application/json": {
        schema,
      },
    },
  };
}

function contextBody() {
  return jsonBody({
    type: "object",
    required: ["collection", "context"],
    properties: {
      collection: { type: "string" },
      pathPrefix: { type: "string" },
      context: { type: "string" },
    },
  });
}

function pathParam(name: string) {
  return {
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  };
}

function identityHeaders() {
  return [
    {
      name: "x-open-webui-user-id",
      in: "header",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "x-open-webui-role",
      in: "header",
      required: false,
      schema: { type: "string", enum: ["admin", "user", "pending"] },
    },
    {
      name: "x-open-webui-groups",
      in: "header",
      required: false,
      schema: { type: "string" },
      description: "Comma-separated Open WebUI group IDs/names.",
    },
  ];
}
