const identityHeaders = [
  { name: "Authorization", in: "header", required: true, schema: { type: "string" }, description: "Bearer QMDUI API token." },
  { name: "x-open-webui-user-id", in: "header", required: true, schema: { type: "string" } },
  { name: "x-open-webui-role", in: "header", required: true, schema: { type: "string", enum: ["admin", "user", "pending"] } },
  { name: "x-open-webui-groups", in: "header", required: false, schema: { type: "string" }, description: "Comma-separated or JSON array group ids." }
];

function doc(title: string, paths: Record<string, unknown>): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title,
      version: "0.1.0",
      description: "QMDUI Open WebUI-native backend/control-plane API."
    },
    servers: [{ url: "http://127.0.0.1:3217" }],
    paths,
    components: {
      securitySchemes: {
        qmduiBearer: { type: "http", scheme: "bearer" }
      }
    },
    security: [{ qmduiBearer: [] }]
  };
}

const searchBody = {
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          collections: { type: "array", items: { type: "string" }, description: "Immutable collection ids." },
          limit: { type: "integer", default: 8 },
          minScore: { type: "number" },
          includeFullDocuments: { type: "boolean" }
        }
      }
    }
  }
};

export function retrievalOpenApi(): Record<string, unknown> {
  return doc("QMDUI Retrieval API", {
    "/api/status": {
      get: { operationId: "qmd_status", parameters: identityHeaders, responses: { "200": { description: "QMDUI/QMD status" } } }
    },
    "/api/collections": {
      get: { operationId: "qmd_allowed_collections", parameters: identityHeaders, responses: { "200": { description: "Collections visible to caller" } } }
    },
    "/api/search/quick": {
      post: { operationId: "qmd_retrieve_quick", parameters: identityHeaders, requestBody: searchBody, responses: { "200": { description: "Keyword retrieval results" } } }
    },
    "/api/search/semantic": {
      post: { operationId: "qmd_retrieve_semantic", parameters: identityHeaders, requestBody: searchBody, responses: { "200": { description: "Vector retrieval results" } } }
    },
    "/api/search/deep": {
      post: { operationId: "qmd_retrieve_deep", parameters: identityHeaders, requestBody: searchBody, responses: { "200": { description: "Hybrid/deep retrieval results" } } }
    },
    "/api/search/expand": {
      post: {
        operationId: "qmd_expand_query",
        parameters: identityHeaders,
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["query"], properties: { query: { type: "string" } } } } }
        },
        responses: { "200": { description: "Query expansion result" } }
      }
    },
    "/api/documents/get": {
      post: {
        operationId: "qmd_get_document",
        parameters: identityHeaders,
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["collectionId", "docid"], properties: { collectionId: { type: "string" }, docid: { type: "string" } } } } }
        },
        responses: { "200": { description: "Document body when allowed" } }
      }
    },
    "/api/documents/multi-get": {
      post: {
        operationId: "qmd_multi_get_documents",
        parameters: identityHeaders,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["collectionId", "docids"],
                properties: { collectionId: { type: "string" }, docids: { type: "array", items: { type: "string" } } }
              }
            }
          }
        },
        responses: { "200": { description: "Document bodies when allowed" } }
      }
    },
    "/api/integrations/open-webui/copy-prompt": {
      post: { operationId: "qmd_copy_rag_prompt", parameters: identityHeaders, requestBody: searchBody, responses: { "200": { description: "Grounded RAG prompt and citations" } } }
    },
    "/api/integrations/open-webui/ask": {
      post: { operationId: "qmd_prepare_grounded_answer", parameters: identityHeaders, requestBody: searchBody, responses: { "200": { description: "Grounded prompt for Open WebUI generation" } } }
    },
    "/api/integrations/open-webui/status": {
      get: { operationId: "qmd_openwebui_integration_status", parameters: identityHeaders, responses: { "200": { description: "Integration status and artifact paths" } } }
    }
  });
}

export function adminOpenApi(): Record<string, unknown> {
  return doc("QMDUI Admin API", {
    "/api/dashboard": {
      get: { operationId: "qmd_admin_dashboard", parameters: identityHeaders, responses: { "200": { description: "Admin dashboard status" } } }
    },
    "/api/collections": {
      post: { operationId: "qmd_admin_add_collection", parameters: identityHeaders, responses: { "200": { description: "Created collection" } } }
    },
    "/api/collections/{id}": {
      patch: { operationId: "qmd_admin_update_collection", parameters: identityHeaders, responses: { "200": { description: "Updated collection" } } },
      delete: { operationId: "qmd_admin_remove_collection", parameters: identityHeaders, responses: { "200": { description: "Removed collection without deleting source files" } } }
    },
    "/api/collections/{id}/rename": {
      post: { operationId: "qmd_admin_rename_collection", parameters: identityHeaders, responses: { "200": { description: "Renamed display name while preserving immutable id" } } }
    },
    "/api/collections/{id}/include": {
      post: { operationId: "qmd_admin_include_collection", parameters: identityHeaders, responses: { "200": { description: "Included collection in default retrieval" } } }
    },
    "/api/collections/{id}/exclude": {
      post: { operationId: "qmd_admin_exclude_collection", parameters: identityHeaders, responses: { "200": { description: "Excluded collection from default retrieval" } } }
    },
    "/api/collections/{id}/update-command": {
      post: { operationId: "qmd_admin_set_update_command", parameters: identityHeaders, responses: { "200": { description: "Configured shell-adjacent update command when danger flag is enabled" } } }
    },
    "/api/contexts": {
      get: { operationId: "qmd_admin_list_contexts", parameters: identityHeaders, responses: { "200": { description: "Contexts" } } },
      post: { operationId: "qmd_admin_add_context", parameters: identityHeaders, responses: { "200": { description: "Created context" } } },
      delete: { operationId: "qmd_admin_remove_context", parameters: identityHeaders, responses: { "200": { description: "Removed context" } } }
    },
    "/api/ingestion/preview": {
      post: { operationId: "qmd_admin_preview_ingestion", parameters: identityHeaders, responses: { "200": { description: "Files discovered for conversion" } } }
    },
    "/api/ingestion/convert": {
      post: { operationId: "qmd_admin_convert_collection", parameters: identityHeaders, responses: { "200": { description: "Conversion job" } } }
    },
    "/api/jobs/update": {
      post: { operationId: "qmd_admin_update_index", parameters: identityHeaders, responses: { "200": { description: "QMD update job" } } }
    },
    "/api/jobs/embed": {
      post: { operationId: "qmd_admin_embed", parameters: identityHeaders, responses: { "200": { description: "QMD embed job" } } }
    },
    "/api/jobs/cleanup": {
      post: { operationId: "qmd_admin_cleanup", parameters: identityHeaders, responses: { "202": { description: "Cleanup preview or confirmed app-owned cleanup job" } } }
    },
    "/api/jobs": {
      get: { operationId: "qmd_admin_jobs", parameters: identityHeaders, responses: { "200": { description: "Jobs" } } }
    },
    "/api/jobs/{id}": {
      get: { operationId: "qmd_admin_job", parameters: identityHeaders, responses: { "200": { description: "Job detail" } } }
    },
    "/api/jobs/{id}/events": {
      get: { operationId: "qmd_admin_job_events", parameters: identityHeaders, responses: { "200": { description: "SSE-style current job status event" } } }
    },
    "/api/access/policies": {
      get: { operationId: "qmd_admin_list_policies", parameters: identityHeaders, responses: { "200": { description: "Policies" } } }
    },
    "/api/access/policies/{collectionId}": {
      put: { operationId: "qmd_admin_set_policy", parameters: identityHeaders, responses: { "200": { description: "Policy" } } }
    },
    "/api/access/evaluate": {
      post: { operationId: "qmd_admin_evaluate_access", parameters: identityHeaders, responses: { "200": { description: "Policy evaluation result" } } }
    }
  });
}

export function combinedOpenApi(): Record<string, unknown> {
  return {
    ...retrievalOpenApi(),
    info: { title: "QMDUI Combined API", version: "0.1.0" },
    paths: {
      ...(retrievalOpenApi().paths as Record<string, unknown>),
      ...(adminOpenApi().paths as Record<string, unknown>)
    }
  };
}
