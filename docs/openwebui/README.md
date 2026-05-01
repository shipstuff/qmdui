# Open WebUI Integration

Import `http://127.0.0.1:3217/api/openapi/retrieval.json` as the regular retrieval-safe OpenAPI Tool. It only exposes status, allowed collection listing, retrieval, and document reads.

Import `http://127.0.0.1:3217/api/openapi/admin.json` only into an admin-only Open WebUI tool/function space. It exposes collection mutation, ingestion, jobs, and access policy endpoints.

For Pipe mode, install the Python file served at:

```text
http://127.0.0.1:3217/api/integrations/open-webui/pipe.py
```

For admin Function mode, install the Python helper served at:

```text
http://127.0.0.1:3217/api/integrations/open-webui/admin_function.py
```

Both artifacts are intentionally small wrappers around QMDUI’s backend API so Open WebUI remains the UI/auth shell and QMDUI remains the QMD control plane.

Recommended v1 setup:

1. Run QMDUI on `127.0.0.1` or an internal-only network.
2. Import the retrieval OpenAPI spec for normal user-accessible tools.
3. Restrict the admin OpenAPI spec and `admin_function.py` to Open WebUI admins.
4. Configure identity headers from Open WebUI into QMDUI. Use `QMDUI_AUTH_MODE=dev` only for local testing; use signed mode and a shared secret for deployment.
5. Configure collection policies with immutable collection IDs. Display names can change without changing policy IDs.

The Pipe valves can either return a grounded prompt/context packet or call an Open WebUI model directly when `OPENWEBUI_API_KEY`, `OPENWEBUI_MODEL_ID`, and `RETURN_CONTEXT_ONLY=false` are configured.
