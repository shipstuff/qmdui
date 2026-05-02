#!/usr/bin/env node

const qmdUiBaseUrl = process.env.QMDUI_BASE_URL ?? "http://127.0.0.1:8765";
const openWebUiBaseUrl = process.env.OPEN_WEBUI_BASE_URL ?? "http://127.0.0.1:8080";
const openWebUiApiKey = process.env.OPEN_WEBUI_API_KEY ?? "";

async function check(name, url, options = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(5000),
    });
    const elapsed = Date.now() - started;
    return {
      name,
      url,
      ok: response.ok,
      status: response.status,
      elapsed,
    };
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const checks = [
  check("QMDUI health", `${qmdUiBaseUrl}/health`),
  check("QMDUI retrieval tool", `${qmdUiBaseUrl}/api/openwebui/tool.py`),
  check("QMDUI admin tools", `${qmdUiBaseUrl}/api/openwebui/admin_tools.py`),
  check("Open WebUI health", `${openWebUiBaseUrl}/health`),
];

if (openWebUiApiKey) {
  checks.push(
    check("Open WebUI models API", `${openWebUiBaseUrl}/api/models`, {
      headers: { Authorization: `Bearer ${openWebUiApiKey}` },
    }),
  );
}

const results = await Promise.all(checks);

let failed = false;
for (const result of results) {
  if (!result.ok) failed = true;
  const status = result.ok ? "ok" : "fail";
  const suffix = result.error ? ` - ${result.error}` : ` - HTTP ${result.status} (${result.elapsed}ms)`;
  console.log(`${status.padEnd(4)} ${result.name}: ${result.url}${suffix}`);
}

if (!openWebUiApiKey) {
  console.log("info OPEN_WEBUI_API_KEY not set; skipped authenticated Open WebUI API check.");
}

if (failed) {
  process.exitCode = 1;
}
