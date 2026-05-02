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

## Editing Rules

- Keep source files and generated index data separate. Removing a collection must never delete source files.
- Preserve server-side access checks. Retrieval must filter by Open WebUI role/group headers and avoid leaking source paths unless the collection policy allows it.
- Prefer focused tests for changes to auth, retrieval normalization, ingestion, config writes, and seed behavior.
- Do not vendor Open WebUI or generated QMD data into this repository.
