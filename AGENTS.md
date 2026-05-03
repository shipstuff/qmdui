# AGENTS.md

## Project

QMDUI is a Node 22 TypeScript service that exposes QMD retrieval, collection management, Open WebUI integration artifacts, and a built-in admin UI.

## Commands

- Install dependencies: `npm ci`
- Build: `npm run build`
- Test: `npm test`
- Check generated Open WebUI artifacts: `npm run check:artifacts`
- Check bootstrap syntax: `npm run check:bootstrap`
- Run locally: `npm run dev`
- Run a compiled server: `npm run build && npm start`
- Seed a compiled index from environment: `npm run build && npm run seed`

## Runtime

- API default: `http://127.0.0.1:8765`
- Admin UI: `/admin`
- Health: `/health`
- OpenAPI: `/api/openapi.json`
- Generated Open WebUI artifacts:
  - `/api/openwebui/tool.py`
  - `/api/openwebui/pipe.py`
  - `/api/openwebui/admin_tools.py`

Admin JSON endpoints require `x-open-webui-role: admin`. If `QMDUI_API_TOKEN` is set, protected API calls also require `Authorization: Bearer <token>`. The admin UI stores the token only in browser localStorage.

## Kubernetes Deploys

Deploy manifests live under `deploy/k8s`, and GitHub Actions deploys on `main` use the `shipstuff-runners` runner scale set.

- Namespace: `open-webui`
- Service: `qmdui`
- Ingress host: `qmdui.local`
- Image: `registry.local:30500/shipstuff/qmdui`
- Persistent data mount: `/data`
- Seed source inside the pod: `/data/seeds/openclaw`

Do not commit real secrets. `deploy/deploy.sh` creates `qmdui-secrets` with a generated `QMDUI_API_TOKEN` if it is missing.

## OpenClaw Seed

The local source path `/home/carl/.openclaw` is not present on the Kubernetes nodes. Use `scripts/seed-openclaw-k8s.sh` from a machine that can read Carl's files; it copies markdown files into the QMDUI PVC and triggers `/api/admin/seed`.

The seed defaults are controlled by:

- `QMDUI_SEED_COLLECTION=openclaw`
- `QMDUI_SEED_SOURCE_ROOT=/data/seeds/openclaw` in Kubernetes
- `QMDUI_SEED_PATTERN=**/*.md`
- `QMDUI_SEED_INCLUDE_HIDDEN=true`
- `QMDUI_SEED_USE_DEFAULT_IGNORE=false`
- `QMDUI_SEED_FLATTEN_OUTPUT=true`
- `QMDUI_SEED_CLEAN_OUTPUT=true`
- `QMDUI_SEED_ACCESS_MODE=groups`
- `QMDUI_SEED_ACCESS_GROUPS=qa`
- `QMDUI_SEED_EXPOSE_SOURCE_PATHS=false`

## Validation Notes

Use these checks when changing deployment, retrieval, embeddings, or Open WebUI artifacts:

- Always run `npm run build` and `npm test` before pushing.
- For Kubernetes smoke checks, verify the deployed image and runtime env:
  - `kubectl -n open-webui get deploy qmdui -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'`
  - `kubectl -n open-webui exec deploy/qmdui -- env | rg 'QMDUI_(EMBED_PROVIDER|OLLAMA|EMBED_TIMEOUT)|QMD_|TMPDIR'`
- Confirm the admin/runtime config matches the QMD config exposed by the API:
  - `GET /api/admin/runtime`
  - `GET /api/admin/qmd-config`
- Confirm Open WebUI artifacts served by QMDUI contain expected tools:
  - `GET /api/openwebui/tool.py` should include both `qmd_retrieve` and `qmd_get_document`.
  - Open WebUI's imported `qmd_retrieve` tool specs should expose both methods after bootstrap/import.
- For retrieval validation, run `/api/search/retrieve` with `mode=deep` and verify results include non-empty `snippet` content, `qmdPath`, and `docid`. Vector results can otherwise look like metadata-only citations.
- For file access validation, call `/api/documents/get` with a `qmdPath` returned by retrieval. The returned body must not include QMDUI-generated frontmatter or `original_path` metadata; source paths belong in structured citation fields only when policy allows them.
- When testing Open WebUI tool behavior directly, execute the imported `qmd_retrieve` tool from the Open WebUI pod with its stored valves. A valid result should include `Content:` text blocks, and `qmd_get_document` should read the same `qmdPath` without requiring a shared filesystem mount.

## Bugs Found During Dogfood

- Remote Ollama embedding errors initially marked jobs completed. Embedding jobs must fail if errors occur or documents remain pending when `QMDUI_EMBED_REQUIRE_COMPLETE=true`.
- The admin QMD config view initially showed the static local `embeddinggemma` model even when runtime embeddings used Ollama. Keep `/api/admin/runtime`, `/api/admin/qmd-config`, and the deployment ConfigMap in sync.
- The first OpenClaw embed run was slow because live `QMDUI_OLLAMA_BATCH_SIZE` was `16`. Warm local synthetic tests showed much higher throughput, but live OpenClaw chunks were the real benchmark.
- The current representative OpenClaw throughput is about 4-6 chunks/sec through Ollama `embeddinggemma`; batch logs showed the time is almost entirely `embedMs`, not SQLite storage. Batched SQLite inserts reduced store time to single or low double-digit milliseconds per batch.
- The earlier 25-40 chunks/sec numbers came from synthetic, repetitive benchmark text. Real OpenClaw markdown/session chunks are larger and tokenize differently; direct Ollama calls with real chunks reproduced the slower rate.
- QMDUI generated `/tmp/qmdui` via `TMPDIR` but did not ensure the directory existed. Startup now creates it.
- Deep/vector retrieval returned body internally but normalized results omitted content when `includeFullDocument=false` and `snippet` was empty. Normalize vector results into safe excerpts so the model receives actual text.
- `qmd_get_document` was only exposed in admin tools. Regular retrieval tools now include a read-only document fetcher so the LLM can read a retrieved file by `qmdPath` or docid.
- Open WebUI tool calls sent Python `None` as JSON `null` for optional line fields; `/api/documents/get` now accepts null/omitted values and the generated tools omit unset line options.
- QMD document reads with line limits can resolve metadata but return no body for some generated `qmdPath` values if delegated to QMD's `getDocumentBody`; QMDUI slices the already-loaded document body instead.
- Generated frontmatter leaked into content for source-path-exposed users. Returned model-visible content should strip QMDUI frontmatter; expose original paths as structured metadata only.

## Editing Rules

- Keep source files and generated index data separate. Removing a collection must never delete source files.
- Preserve server-side access checks. Retrieval must filter by Open WebUI role/group headers and avoid leaking source paths unless the collection policy allows it.
- Prefer focused tests for changes to auth, retrieval normalization, ingestion, config writes, and seed behavior.
- Do not vendor Open WebUI or generated QMD data into this repository.
