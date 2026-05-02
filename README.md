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

- `GET /api/openwebui/tool.py`
- `GET /api/openwebui/pipe.py`
- `GET /api/openwebui/admin_tools.py`

Fresh Open WebUI environments can be provisioned with:

```bash
OPEN_WEBUI_API_KEY=your-open-webui-admin-token npm run bootstrap:openwebui
```

The bootstrap creates or updates the default QMDUI group, retrieval/admin tools, assistant pipe, `Company Knowledge` model, model/tool access grants, and default/pinned model settings.
- `GET /api/openapi.json`

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
