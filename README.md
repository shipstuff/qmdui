# QMDUI

QMDUI is an Open WebUI-native QMD backend/control module. V1 provides:

- a local QMDUI backend service
- an OpenAPI surface for QMD retrieval and admin workflows
- generated Open WebUI Tool/Pipe/Admin Tool artifacts
- server-side role/group filtering for QMD collection access
- folder-based ingestion into generated markdown/text files

Regular users stay in Open WebUI chat. The current implementation exposes Open WebUI tools/pipes for integration testing; the intended product flow is an admin-configured QMD-backed model that regular users can use without manually enabling or naming tools.

## Current Status

P1 retrieval and access-control integration has been validated locally:

- regular users can use an admin-configured `Company Knowledge` model without manually enabling QMD tools
- QMD collection access is enforced server-side using Open WebUI role/group identity
- Quick, Semantic, and Deep retrieval modes return expected results for the smoke collection
- embeddings complete successfully and the vector index is detected
- regular-user retrieval responses strip generated frontmatter/source metadata from returned bodies and snippets when source paths are not allowed by policy

## Run

```bash
npm install
npm run dev
```

The API defaults to `http://127.0.0.1:8765`.

Generated Open WebUI artifacts are served from:

- `GET /admin`
- `GET /api/openwebui/tool.py`
- `GET /api/openwebui/pipe.py`
- `GET /api/openwebui/admin_tools.py`
- `GET /api/openapi.json`

The built-in admin UI at `/admin` can manage QMD collections, run update/embed/seed jobs, edit the active QMD YAML config, and test retrieval. Admin API calls require `x-open-webui-role: admin`; if `QMDUI_API_TOKEN` is set, enter the same token in the admin UI.

Fresh Open WebUI environments can be provisioned after the first admin account exists:

1. Sign in to Open WebUI as an admin.
2. Enable API keys if needed: `Admin Panel -> Settings -> General -> Enable API Keys`.
3. Create an admin API key: profile/avatar menu -> `Settings` -> `Account` -> `API Key` -> `Create new secret key`.
4. Run the bootstrap:

```bash
OPEN_WEBUI_API_KEY=your-open-webui-admin-key npm run bootstrap:openwebui
```

The bootstrap creates or updates the default QMDUI group, retrieval/admin tools, assistant pipe, `Company Knowledge` model, model/tool access grants, and default/pinned model settings.

Useful bootstrap overrides:

```bash
OPEN_WEBUI_BASE_URL=http://127.0.0.1:8080 \
QMDUI_BASE_URL=http://127.0.0.1:8765 \
OPEN_WEBUI_API_KEY=your-open-webui-admin-key \
QMDUI_API_TOKEN=optional-qmdui-token \
QMDUI_COMPANY_GROUP=qa \
QMDUI_RETRIEVAL_MODE=deep \
npm run bootstrap:openwebui
```

Check the two-service integration:

```bash
npm run check:openwebui
```

QMDUI defaults to `http://127.0.0.1:8765`; this repo's source-mode Open WebUI backend is checked at `http://127.0.0.1:8080` unless `OPEN_WEBUI_BASE_URL` is set.

## Local Open WebUI

For integration testing, clone Open WebUI into `.external/open-webui` and run it beside QMDUI. The `.external/` directory is ignored so the upstream checkout is not vendored into QMDUI.

Runtime layout:

- QMDUI API: `http://127.0.0.1:8765`
- Open WebUI backend API: `http://127.0.0.1:8080`
- Open WebUI frontend dev server: `http://127.0.0.1:5173`

Wrapper scripts are available after the Open WebUI dependencies are installed:

```bash
npm run openwebui:backend
npm run openwebui:frontend
```

After creating an Open WebUI admin account and API token, import/update the QMDUI artifacts:

```bash
OPEN_WEBUI_API_KEY=your-open-webui-token npm run import:openwebui
```

## Auth Headers

For local development, pass Open WebUI-like identity headers:

- `x-open-webui-user-id`
- `x-open-webui-role`: `admin`, `user`, or `pending`
- `x-open-webui-groups`: comma-separated group IDs/names

If `QMDUI_API_TOKEN` is set, requests must include `Authorization: Bearer <token>`.

## Docs

- [Original build prompt](docs/QMDUI_PROMPT.md)
- [Open WebUI setup](docs/OPENWEBUI_SETUP.md)
- [P1 test report](docs/P1_TEST_REPORT.md)
- [Next phase implementation plan](docs/NEXT_PHASE_IMPLEMENTATION.md)

## Kubernetes

QMDUI deploys into the existing `open-webui` namespace with ingress host `qmdui.local`:

```bash
./deploy/deploy.sh
```

GitHub Actions builds `registry.local:30500/shipstuff/qmdui` and runs the deploy on `shipstuff-runners` after merges to `main`.

The Kubernetes profile defaults embeddings to Ollama at `http://ollama-mini-01:11434` with `embeddinggemma` and `QMDUI_OLLAMA_BATCH_SIZE=128`. Tune the endpoint/model/batch in `deploy/k8s/configmap.yaml`; changing those values only requires a config rollout, not a Docker rebuild.

The OpenClaw seed source in Kubernetes is `/data/seeds/openclaw`. From a machine that can read `/home/carl/.openclaw`, populate it and trigger the seed job with:

```bash
scripts/seed-openclaw-k8s.sh
```

Warm embedding provider comparisons can be run locally with:

```bash
BENCH_MODES=direct,qmd-e2e BENCH_MODELS=embeddinggemma,qwen3-embedding:8b BENCH_BATCHES=64,128 npm run bench:embeddings
```
