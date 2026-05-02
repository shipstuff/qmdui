# Open WebUI Setup

QMDUI v1 is API-first. Open WebUI remains the user interface; QMDUI runs as a local/internal backend service.

The generated tools in this guide are a test/integration bridge. They prove that Open WebUI can call QMDUI, but they are not the desired regular-user UX. Regular users should eventually use an admin-configured QMD-backed model or pipe, such as `Company Knowledge`, without manually enabling tools or typing tool names into chat. See [Next Phase Implementation](NEXT_PHASE_IMPLEMENTATION.md).

The current P1 validation state is tracked in [P1 Test Report](P1_TEST_REPORT.md).

## 1. Start QMDUI

```bash
npm install
npm run dev
```

QMDUI listens on:

```text
http://127.0.0.1:8765
```

Optional production-style token:

```bash
QMDUI_API_TOKEN="change-me" npm run dev
```

When a token is set, configure the same value in the Open WebUI Tool/Pipe/Admin Tool valves.

## 2. Import The Retrieval Tool As A Tool

Open:

```text
http://127.0.0.1:8765/api/openwebui/tool.py
```

In Open WebUI:

1. Go to Workspace / Tools.
2. Import the Python file.
3. Review the code.
4. Configure valves:
   - `QMDUI_BASE_URL`: `http://127.0.0.1:8765`
   - `QMDUI_API_TOKEN`: optional
   - `DEFAULT_MODE`: `quick`, `semantic`, or `deep`
5. Attach the tool to a model or group according to Open WebUI policy.

The tool exposes `qmd_retrieve`.

Admins can access all tools for diagnostics. Regular users normally need tools assigned to a model by an admin; they should not need Workspace / Tools permission just to ask company-knowledge questions.

Do not save this file under Open WebUI Functions. It defines `class Tools`, so Open WebUI must load it as a Tool.

## 3. Import The QMD Assistant Pipe As A Function

Open:

```text
http://127.0.0.1:8765/api/openwebui/pipe.py
```

In Open WebUI:

1. Go to Workspace / Functions.
2. Import the Python file.
3. Review the code.
4. Configure valves:
   - `QMDUI_BASE_URL`: `http://127.0.0.1:8765`
   - `QMDUI_API_TOKEN`: optional
   - `BASE_MODEL`: the Open WebUI model used to generate final answers
   - `RETRIEVAL_MODE`: usually `deep` for best answers

The pipe appears as `QMD Assistant`.

This file defines `class Pipe`, so it belongs under Open WebUI Functions.

For regular users, the Pipe/model path is the preferred target: the admin configures the pipe, assigns or defaults it like a model, and the user chats normally.

## 4. Import Admin Tools As Tools

Open:

```text
http://127.0.0.1:8765/api/openwebui/admin_tools.py
```

Import only for trusted admins, and import this file under Workspace / Tools. It defines `class Tools`, so saving it under Functions will fail with "No Function class found in the module."

These tools can add collections, start update/embed jobs, and inspect status.

The generated admin tools currently expose:

- `qmd_status`
- `qmd_debug_identity`
- `qmd_list_collections`
- `qmd_add_collection`
- `qmd_remove_collection`
- `qmd_rename_collection`
- `qmd_preview_ingestion`
- `qmd_convert_folder`
- `qmd_ingestion_manifest`
- `qmd_update_index`
- `qmd_embed_documents`
- `qmd_jobs`
- `qmd_get_job`
- `qmd_list_contexts`
- `qmd_add_context`
- `qmd_remove_context`
- `qmd_test_retrieval`
- `qmd_get_document`
- `qmd_list_access_policies`
- `qmd_set_collection_access`
- `qmd_evaluate_access`

After creating/signing in as an Open WebUI admin, you can import or update all generated QMDUI artifacts with an Open WebUI API token:

```bash
OPEN_WEBUI_API_KEY=your-open-webui-token npm run import:openwebui
```

This imports:

- Tool `qmd_retrieve`
- Tool `qmd_admin_tools`
- Function/Pipe `qmd_assistant`

Admin functions rely on Open WebUI passing user context. QMDUI also enforces admin checks on the backend using:

- `x-open-webui-role`
- `x-open-webui-user-id`
- `x-open-webui-groups`

Open WebUI's `__user__` payload does not include group memberships by default for tool calls. The generated QMDUI Tool/Pipe/Admin Tool code resolves memberships inside the Open WebUI runtime with `Groups.get_groups_by_member_id(user.id)`, then forwards both group IDs and group names to QMDUI in `x-open-webui-groups`.

## 5. Check Connectivity

QMDUI and Open WebUI are expected to run as separate services:

- QMDUI backend: default `http://127.0.0.1:8765`
- Open WebUI backend API in this source checkout: `http://127.0.0.1:8080`
- Open WebUI frontend dev server in this source checkout: `http://127.0.0.1:5173`
- Open WebUI Docker/all-in-one deployments commonly expose `http://127.0.0.1:3000`

This repo keeps the upstream Open WebUI checkout under `.external/open-webui`, which is ignored by git. That lets us run and inspect real Open WebUI without forking or vendoring it.

Local source-mode startup:

```bash
npm run dev
npm run openwebui:backend
npm run openwebui:frontend
```

Open WebUI currently requires Node `<=22`; the frontend wrapper uses `nvm use 22` when `~/.nvm/nvm.sh` exists.

With QMDUI running, check both sides:

```bash
npm run check:openwebui
```

Override URLs when needed:

```bash
QMDUI_BASE_URL=http://127.0.0.1:8765 \
OPEN_WEBUI_BASE_URL=http://127.0.0.1:8080 \
OPEN_WEBUI_API_KEY=optional-key \
npm run check:openwebui
```

The API key is only used to test Open WebUI's authenticated models API. Tool/Pipe import is still done manually from the generated Python URLs above.

## 6. Local Smoke Test

With QMDUI running:

```bash
npm run smoke:local
```

This creates a temporary source folder under `.qmdui/`, adds a collection, runs ingestion, updates QMD, applies an access policy, and verifies allowed/denied retrieval.

The smoke fixture includes a `deployment checklist` phrase used by the P1 retrieval tests.

## 7. P1 Retrieval Checks

After running the smoke test and embedding documents, the following diagnostic prompts should work from an Open WebUI admin chat with `QMD Admin Tools` available:

```text
Use qmd_test_retrieval with query "deployment checklist" and mode "quick"
Use qmd_test_retrieval with query "deployment checklist" and mode "semantic"
Use qmd_test_retrieval with query "deployment checklist" and mode "deep"
```

Expected result: `notes.md` is the strongest result and includes:

```text
The deployment checklist includes indexing, access policy validation, and retrieval testing.
```

For the regular-user path, attach `QMD Retrieve` to an Open WebUI model such as `Company Knowledge`, grant that model to the regular user/group, and ask:

```text
What is in the deployment checklist?
```

The user should not need Workspace / Tools access or a manual `use qmd_retrieve` command.

## Notes

- Do not sync QMD collections into Open WebUI Knowledge by default.
- QMDUI owns managed folder ingestion, conversion, provenance, and QMD retrieval.
- Open WebUI owns chat, users, groups, roles, model selection, and chat history.
