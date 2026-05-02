import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.QMDUI_BASE_URL ?? "http://127.0.0.1:8765";
const root = resolve(process.env.QMDUI_SMOKE_ROOT ?? ".qmdui/smoke-source");
const collection = process.env.QMDUI_SMOKE_COLLECTION ?? "smoke";
const adminHeaders = {
  "content-type": "application/json",
  "x-open-webui-role": "admin",
  "x-open-webui-user-id": "smoke-admin",
};
const userHeaders = {
  "content-type": "application/json",
  "x-open-webui-role": "user",
  "x-open-webui-user-id": "smoke-user",
  "x-open-webui-groups": "qa",
};

async function main() {
  await request("/health");

  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(
    resolve(root, "notes.md"),
    "# Deployment Notes\n\nQMDUI smoke alpha handles folder ingestion and quick retrieval. The deployment checklist includes indexing, access policy validation, and retrieval testing.\n",
  );
  await writeFile(resolve(root, "runbook.txt"), "The smoke runbook says qmd quick search should find alpha signals.\n");

  console.log(`Created smoke source folder: ${root}`);

  const preview = await request("/api/ingestion/preview", {
    method: "POST",
    headers: adminHeaders,
    body: { collection, sourceRoot: root, pattern: "**/*" },
  });
  console.log(`Previewed ${preview.total} files.`);

  await request(`/api/collections/${collection}`, { method: "DELETE", headers: adminHeaders }).catch(() => undefined);

  const added = await request("/api/collections", {
    method: "POST",
    headers: adminHeaders,
    body: { name: collection, sourcePath: root, pattern: "**/*", ingest: true },
  });
  console.log(`Added collection '${added.collection}' indexing ${added.qmdPath}`);

  const updateJob = await request("/api/jobs/update", {
    method: "POST",
    headers: adminHeaders,
    body: { collections: [collection] },
  });
  await waitForJob(updateJob.job.id);
  console.log("QMD update completed.");

  await request(`/api/access/policies/${collection}`, {
    method: "PUT",
    headers: adminHeaders,
    body: { mode: "groups", groups: ["qa"], users: [], exposeSourcePaths: false },
  });
  console.log("Applied group access policy.");

  const userResults = await request("/api/search/retrieve", {
    method: "POST",
    headers: userHeaders,
    body: { query: "deployment checklist", mode: "quick", collections: [collection], topK: 5 },
  });
  const count = userResults.results?.length ?? 0;
  console.log(`Regular user retrieved ${count} result(s).`);
  if (count < 1) throw new Error("Expected at least one retrieval result");

  const denied = await request("/api/search/retrieve", {
    method: "POST",
    headers: { ...userHeaders, "x-open-webui-groups": "sales" },
    body: { query: "deployment checklist", mode: "quick", collections: [collection], topK: 5 },
  });
  if ((denied.results?.length ?? 0) !== 0) {
    throw new Error("Expected unauthorized user to receive zero results");
  }
  console.log("Unauthorized group received zero results.");
  console.log("Local smoke test passed.");
}

async function waitForJob(id) {
  for (let i = 0; i < 60; i++) {
    const data = await request(`/api/jobs/${id}`, { headers: adminHeaders });
    if (data.job.status === "completed") return data.job;
    if (data.job.status === "failed") throw new Error(data.job.error || "Job failed");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for job ${id}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
  }
  return data;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
