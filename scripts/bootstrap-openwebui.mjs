#!/usr/bin/env node

const qmdUiBaseUrl = env("QMDUI_BASE_URL", "http://127.0.0.1:8765");
const openWebUiBaseUrl = env("OPEN_WEBUI_BASE_URL", "http://127.0.0.1:8080");
const token = process.env.OPEN_WEBUI_API_KEY ?? "";
const qmdUiToken = process.env.QMDUI_API_TOKEN ?? "";

const companyGroupName = env("QMDUI_COMPANY_GROUP", "qa");
const companyModelId = env("QMDUI_COMPANY_MODEL_ID", "company-knowledge");
const companyModelName = env("QMDUI_COMPANY_MODEL_NAME", "Company Knowledge");
const assistantFunctionId = "qmd_assistant";
const assistantPipeModelId = `${assistantFunctionId}.qmd-assistant`;
const companyModelBaseId = env("QMDUI_COMPANY_MODEL_BASE_ID", assistantPipeModelId);
const retrievalMode = env("QMDUI_RETRIEVAL_MODE", "deep");
const topK = numberEnv("QMDUI_TOP_K", 8);
const minScore = numberEnv("QMDUI_MIN_SCORE", 0);
const maxContextChars = numberEnv("QMDUI_MAX_CONTEXT_CHARS", 12000);
const setDefaultModel = boolEnv("QMDUI_SET_DEFAULT_MODEL", true);
const setPinnedModel = boolEnv("QMDUI_SET_PINNED_MODEL", true);

if (!token) {
  console.error("OPEN_WEBUI_API_KEY is required. Run this with an Open WebUI admin API token.");
  process.exit(1);
}

const summary = [];

const retrievalTool = await text(`${qmdUiBaseUrl}/api/openwebui/tool.py`);
const adminTools = await text(`${qmdUiBaseUrl}/api/openwebui/admin_tools.py`);
const pipe = await text(`${qmdUiBaseUrl}/api/openwebui/pipe.py`);

const group = await ensureGroup(companyGroupName, {
  description: "QMDUI managed company knowledge access group.",
  permissions: {},
  data: { qmduiManaged: true },
});

await upsertTool("qmd_retrieve", {
  name: "QMD Retrieve",
  content: retrievalTool,
  meta: {
    description: "Retrieve ranked context from QMDUI/QMD collections.",
  },
  access_grants: [grant("group", group.id, "read")],
});

await updateToolValves("qmd_retrieve", {
  QMDUI_BASE_URL: qmdUiBaseUrl,
  QMDUI_API_TOKEN: qmdUiToken,
  DEFAULT_MODE: retrievalMode,
  TOP_K: topK,
  MIN_SCORE: minScore,
});

await upsertTool("qmd_admin_tools", {
  name: "QMD Admin Tools",
  content: adminTools,
  meta: {
    description: "Admin-only QMDUI collection, ingestion, job, context, and policy tools.",
  },
  access_grants: [],
});

await updateToolValves("qmd_admin_tools", {
  QMDUI_BASE_URL: qmdUiBaseUrl,
  QMDUI_API_TOKEN: qmdUiToken,
});

const assistant = await upsertFunction(assistantFunctionId, {
  name: "QMD Assistant",
  content: pipe,
  meta: {
    description: "QMD-backed Open WebUI Pipe/model.",
  },
});

await ensureFunctionState(assistantFunctionId, assistant, { is_active: true, is_global: true });
await updateFunctionValves(assistantFunctionId, {
  QMDUI_BASE_URL: qmdUiBaseUrl,
  QMDUI_API_TOKEN: qmdUiToken,
  BASE_MODEL: env("QMDUI_BASE_MODEL", ""),
  RETRIEVAL_MODE: retrievalMode,
  TOP_K: topK,
  MIN_SCORE: minScore,
  MAX_CONTEXT_CHARS: maxContextChars,
});

await upsertModel(companyModelId, {
  name: companyModelName,
  base_model_id: companyModelBaseId,
  meta: {
    description: "Company knowledge assistant backed by QMDUI retrieval.",
    tags: ["QMDUI", "Company Knowledge"],
    toolIds: ["qmd_retrieve"],
    qmduiManaged: true,
  },
  params: {},
  access_grants: [grant("group", group.id, "read")],
  is_active: true,
});

if (setDefaultModel || setPinnedModel) {
  await updateModelConfig(companyModelId, { setDefaultModel, setPinnedModel });
}

console.log("QMDUI Open WebUI bootstrap complete.");
for (const line of summary) {
  console.log(`- ${line}`);
}

function env(name, fallback) {
  const value = process.env[name];
  return value == null || value === "" ? fallback : value;
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function grant(principal_type, principal_id, permission) {
  return { principal_type, principal_id, permission };
}

function headers() {
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

async function text(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return response.text();
}

async function api(path, options = {}) {
  const response = await fetch(`${openWebUiBaseUrl}${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed with HTTP ${response.status}: ${await response.text()}`);
  }

  if (response.status === 204) return null;
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

async function safeApi(path, options = {}) {
  const response = await fetch(`${openWebUiBaseUrl}${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = { detail: body };
  }
  return { ok: response.ok, status: response.status, data };
}

async function ensureGroup(name, payload) {
  const groups = await api("/api/v1/groups/");
  const existing = groups.find((group) => group.name === name);
  if (existing) {
    const updated = await api(`/api/v1/groups/id/${existing.id}/update`, {
      method: "POST",
      body: JSON.stringify({ name, ...payload }),
    });
    summary.push(`Updated group: ${name} (${updated.id})`);
    return updated;
  }

  const created = await api("/api/v1/groups/create", {
    method: "POST",
    body: JSON.stringify({ name, ...payload }),
  });
  summary.push(`Created group: ${name} (${created.id})`);
  return created;
}

async function upsertTool(id, payload) {
  const body = { id, ...payload };
  const create = await safeApi("/api/v1/tools/create", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (create.ok) {
    summary.push(`Created tool: ${id}`);
    return create.data;
  }

  if (!isAlreadyExists(create)) {
    throw new Error(`Failed creating tool ${id}: ${JSON.stringify(create.data)}`);
  }

  const updated = await api(`/api/v1/tools/id/${id}/update`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  summary.push(`Updated tool: ${id}`);
  return updated;
}

async function updateToolValves(id, valves) {
  await api(`/api/v1/tools/id/${id}/valves/update`, {
    method: "POST",
    body: JSON.stringify(valves),
  });
  summary.push(`Configured tool valves: ${id}`);
}

async function upsertFunction(id, payload) {
  const body = { id, ...payload };
  const create = await safeApi("/api/v1/functions/create", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (create.ok) {
    summary.push(`Created function/pipe: ${id}`);
    return create.data;
  }

  if (!isAlreadyExists(create)) {
    throw new Error(`Failed creating function ${id}: ${JSON.stringify(create.data)}`);
  }

  const updated = await api(`/api/v1/functions/id/${id}/update`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  summary.push(`Updated function/pipe: ${id}`);
  return updated;
}

async function ensureFunctionState(id, current, desired) {
  let state = current;
  if (desired.is_active && !state.is_active) {
    state = await api(`/api/v1/functions/id/${id}/toggle`, { method: "POST" });
    summary.push(`Activated function/pipe: ${id}`);
  }

  if (desired.is_global && !state.is_global) {
    state = await api(`/api/v1/functions/id/${id}/toggle/global`, { method: "POST" });
    summary.push(`Made function/pipe global: ${id}`);
  }
}

async function updateFunctionValves(id, valves) {
  await api(`/api/v1/functions/id/${id}/valves/update`, {
    method: "POST",
    body: JSON.stringify(valves),
  });
  summary.push(`Configured function valves: ${id}`);
}

async function upsertModel(id, payload) {
  const body = { id, ...payload };
  const create = await safeApi("/api/v1/models/create", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (create.ok) {
    summary.push(`Created model: ${id}`);
    return create.data;
  }

  if (!isAlreadyExists(create)) {
    throw new Error(`Failed creating model ${id}: ${JSON.stringify(create.data)}`);
  }

  const updated = await api("/api/v1/models/model/update", {
    method: "POST",
    body: JSON.stringify(body),
  });
  summary.push(`Updated model: ${id}`);
  return updated;
}

async function updateModelConfig(modelId, options) {
  const current = await api("/api/v1/configs/models");
  const next = { ...current };

  if (options.setDefaultModel) {
    next.DEFAULT_MODELS = modelId;
  }

  if (options.setPinnedModel) {
    const pinned = splitList(current.DEFAULT_PINNED_MODELS);
    if (!pinned.includes(modelId)) pinned.push(modelId);
    next.DEFAULT_PINNED_MODELS = pinned.join(",");
  }

  await api("/api/v1/configs/models", {
    method: "POST",
    body: JSON.stringify(next),
  });
  summary.push(`Updated model defaults: default=${next.DEFAULT_MODELS ?? "unchanged"}, pinned=${next.DEFAULT_PINNED_MODELS ?? ""}`);
}

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAlreadyExists(response) {
  const detail = JSON.stringify(response.data ?? {}).toLowerCase();
  return [400, 401, 409].includes(response.status) && (detail.includes("taken") || detail.includes("already"));
}
