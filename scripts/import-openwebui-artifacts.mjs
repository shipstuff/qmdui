#!/usr/bin/env node

const qmdUiBaseUrl = process.env.QMDUI_BASE_URL ?? "http://127.0.0.1:8765";
const openWebUiBaseUrl = process.env.OPEN_WEBUI_BASE_URL ?? "http://127.0.0.1:8080";
const token = process.env.OPEN_WEBUI_API_KEY ?? "";

if (!token) {
  console.error("OPEN_WEBUI_API_KEY is required. Create/sign in as an Open WebUI admin and use that API token.");
  process.exit(1);
}

async function text(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  }
  return response.text();
}

async function upsert(path, updatePath, payload) {
  const create = await fetch(`${openWebUiBaseUrl}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });

  if (create.ok) {
    return create.json();
  }

  const body = await safeJson(create);
  const detail = JSON.stringify(body).toLowerCase();
  if (!detail.includes("taken") && create.status !== 400) {
    throw new Error(`POST ${path} failed with HTTP ${create.status}: ${JSON.stringify(body)}`);
  }

  const update = await fetch(`${openWebUiBaseUrl}${updatePath}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  if (!update.ok) {
    throw new Error(`POST ${updatePath} failed with HTTP ${update.status}: ${JSON.stringify(await safeJson(update))}`);
  }
  return update.json();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return { detail: await response.text() };
  }
}

function headers() {
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

const retrievalTool = await text(`${qmdUiBaseUrl}/api/openwebui/tool.py`);
const adminTools = await text(`${qmdUiBaseUrl}/api/openwebui/admin_tools.py`);
const pipe = await text(`${qmdUiBaseUrl}/api/openwebui/pipe.py`);

await upsert("/api/v1/tools/create", "/api/v1/tools/id/qmd_retrieve/update", {
  id: "qmd_retrieve",
  name: "QMD Retrieve",
  content: retrievalTool,
  meta: {
    description: "Retrieve ranked context from QMDUI/QMD collections.",
  },
  access_grants: [],
});
console.log("Imported/updated Open WebUI Tool: qmd_retrieve");

await upsert("/api/v1/tools/create", "/api/v1/tools/id/qmd_admin_tools/update", {
  id: "qmd_admin_tools",
  name: "QMD Admin Tools",
  content: adminTools,
  meta: {
    description: "Admin-only QMDUI collection, ingestion, job, context, and policy tools.",
  },
  access_grants: [],
});
console.log("Imported/updated Open WebUI Tool: qmd_admin_tools");

await upsert("/api/v1/functions/create", "/api/v1/functions/id/qmd_assistant/update", {
  id: "qmd_assistant",
  name: "QMD Assistant",
  content: pipe,
  meta: {
    description: "QMD-backed Open WebUI Pipe/model.",
  },
});
console.log("Imported/updated Open WebUI Function/Pipe: qmd_assistant");
