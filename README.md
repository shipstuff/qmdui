# QMDUI

QMDUI is a Node 22 backend/control plane for `@tobilu/qmd` designed to be used from Open WebUI native extension surfaces: OpenAPI Tools, Functions, and Pipes. It is not an Open WebUI fork and does not provide a standalone regular-user chat UI.

## V1 Shape

- Open WebUI owns chat, users, roles, groups, history, profiles, and models.
- QMDUI owns QMD collection state, ingestion/conversion, jobs, retrieval, citations, and policy enforcement.
- Regular users call retrieval through Open WebUI tools/pipes and only see allowed collections.
- Admins call collection, ingestion, policy, job, and diagnostics endpoints through admin-only Open WebUI Functions/Tools.
- App state defaults to `~/.local/state/qmdui`, outside source folders.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Default URL: `http://127.0.0.1:3217`

Useful specs/artifacts:

- Retrieval-safe OpenAPI: `GET /api/openapi/retrieval.json`
- Admin OpenAPI: `GET /api/openapi/admin.json`
- Combined OpenAPI: `GET /api/openapi.json`
- Open WebUI Pipe: `GET /api/integrations/open-webui/pipe.py`
- Open WebUI admin Function: `GET /api/integrations/open-webui/admin_function.py`

The retrieval-safe spec exposes status, allowed collections, Quick/Semantic/Deep retrieval, query expansion, document reads, and RAG prompt helpers. The admin spec is separate and should only be imported into an Open WebUI admin-only tool/function space.

## Identity And RBAC Contract

QMDUI expects Open WebUI to be the identity authority. Calls must include a QMDUI API token and Open WebUI identity headers:

- `Authorization: Bearer <QMDUI_API_TOKEN>`
- `x-open-webui-user-id`
- `x-open-webui-user-email` optional
- `x-open-webui-user-name` optional
- `x-open-webui-role`: `admin`, `user`, or `pending`
- `x-open-webui-groups`: comma-separated or JSON array

For local development, `QMDUI_AUTH_MODE=dev` trusts these headers. For deployment, set `QMDUI_AUTH_MODE=signed` and `QMDUI_OPENWEBUI_SHARED_SECRET`. Signed mode requires:

- `x-open-webui-timestamp`: epoch milliseconds, max five minutes skew
- `x-open-webui-signature`: HMAC-SHA256 over `timestamp + "\n" + userId + "\n" + role + "\n" + groups`

Pending users are denied all QMDUI access. Admin endpoints require `role=admin`. Collection access policies support `all`, `groups`, `users`, and `admin`.

## Safety Flags

Shell-adjacent functionality is disabled by default.

- `QMDUI_ENABLE_QMD_CLI=true` enables audited `qmd` child-process fallback calls.
- `QMDUI_ENABLE_ADMIN_DANGER=true` enables admin-dangerous QMD jobs such as update/embed through the CLI.
- `QMDUI_ENABLE_EXTERNAL_CONVERTERS=true` is reserved for future explicit external converters.

All child processes use argument arrays with `shell: false`; there is no arbitrary shell execution endpoint.

The generated Pipe defaults to returning a grounded prompt/context packet so Open WebUI remains responsible for generation. Set `OPENWEBUI_BASE_URL`, `OPENWEBUI_API_KEY`, `OPENWEBUI_MODEL_ID`, and `RETURN_CONTEXT_ONLY=false` in the Pipe valves when you want the Pipe to call an Open WebUI model directly.

## Collection Workflow

Collections are folder-first. Internally each collection has an immutable UUID, and display names are mutable. Generated markdown lives under the app state root:

```text
~/.local/state/qmdui/generated/<collection-id>/
~/.local/state/qmdui/manifests/<collection-id>.json
```

Source files are never modified, moved, renamed, or deleted. Unsupported file types are recorded as warnings. Removing a collection removes QMDUI config/policy only, not source data.

Initial conversion support:

- Markdown passthrough: `.md`, `.mdx`, `.markdown`
- Plain text/code wrapping: common text, config, source, and log formats
- Unsupported binary files are skipped with manifest warnings

## Verification

```bash
npm run build
npm test
```
