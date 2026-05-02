# Next Phase Implementation

This document captures the next product phase after the current backend-first QMDUI prototype.

## Current Finding

The current implementation proves that QMDUI can run as a backend service and that Open WebUI can call QMDUI through imported Tools and Pipes. That is useful for integration testing, but it is not the final product experience.

P1 testing validated the backend retrieval path, Open WebUI tool calls, regular-user model access through an attached QMD retrieval tool, group-gated QMD collection access, embeddings, and Quick/Semantic/Deep retrieval. See [P1 Test Report](P1_TEST_REPORT.md).

The regular-user experience is currently too manual:

- Admin users can access imported tools because Open WebUI admins have broad tool access.
- Regular users do not automatically get tool access just because they can see a model.
- Regular users generally should not have Workspace / Tools permission, because Open WebUI treats tools/functions as code execution surfaces.
- A regular user should not need to type `use qmd_retrieve` or know that QMD exists.
- If a regular user asks "do you have access to QMD tools?", the model may not know unless the active chat/model has the QMD tool or QMD pipe attached in Open WebUI metadata.

The desired product behavior is:

```text
admin configures Company Knowledge
  -> admin assigns it to users/groups and optionally makes it default
  -> regular user opens normal Open WebUI chat
  -> regular user asks a normal question
  -> QMD retrieval runs behind the scenes
  -> model answers with allowed citations
```

## Product Direction

QMDUI should keep the backend/control boundary, but the Open WebUI side needs a real integration layer rather than relying on manual tool prompts.

Regular-user QMD access should be delivered through one or both of these native Open WebUI paths:

- **Pipe-as-model path**: expose `Company Knowledge` / `QMD Assistant` as a model. The pipe retrieves from QMD and calls the configured base model. This hides tool selection from regular users.
- **Model-with-attached-tool path**: create or configure an Open WebUI model whose metadata includes the QMD retrieval tool. The model can call `qmd_retrieve` without the user manually enabling tools.

For most users, the Pipe-as-model path should be the first polished path because it gives the clearest control over retrieval behavior and avoids asking users to manage tools.

Admin QMD management should move from chat-driven admin tools to clickable Open WebUI admin pages.

## Phase 2 Priorities

1. Native regular-user QMD model
   - Create a `Company Knowledge` pipe/model with admin-configured valves.
   - Allow admins to select the base generation model.
   - Allow admins to choose default retrieval mode: quick, semantic, or deep.
   - Allow admins to set top K, min score, max context size, and citation behavior.
   - Ensure regular users can select or be defaulted into this model without managing tools.

2. Open WebUI provisioning
   - Add a QMDUI provisioning module that can configure Open WebUI using an admin API token.
   - Import/update QMDUI Tool, Pipe, and Admin Tool artifacts.
   - Configure model metadata so QMD retrieval is attached where appropriate.
   - Set `DEFAULT_MODELS` so all new chats can default to the QMD-backed model when requested.
   - Optionally set pinned models so `Company Knowledge` is visible in the model picker/sidebar.
   - Keep admin diagnostic tools admin-only and avoid exposing them to regular users.

3. Clickable admin UI inside Open WebUI
   - Add a small Open WebUI integration patch for QMD admin pages.
   - Target route: `/admin/qmd`.
   - Add admin navigation entry: `QMD`.
   - Use Open WebUI's existing admin layout, spacing, tables, modals, buttons, dark/light mode, and toast patterns.
   - Keep QMDUI backend as a separate service; the Open WebUI page should call QMDUI APIs.

4. Admin dashboard page
   - Show QMD health: total docs, embeddings pending, vector index status, stale age.
   - Show collection count and recent update/embed job status.
   - Show Open WebUI integration status: QMD pipe imported, retrieval tool imported, default model configured.
   - Show warnings for missing embeddings, inaccessible QMDUI backend, or missing QMD collections.

5. Collection management page
   - List collections with name, source path, generated path, pattern, doc count, include-by-default state, and access policy.
   - Add collection from folder path.
   - Preview ingestion before conversion.
   - Convert folder into `.qmdui/generated`.
   - Run QMD update.
   - Run embeddings.
   - Rename/remove collection references.
   - Make source-file deletion guardrails visible: QMDUI never deletes, renames, moves, overwrites, or modifies source files.

6. Access policy page
   - Map QMD collections to Open WebUI groups/users.
   - Support all-users, admin-only, specific groups, and specific users.
   - Configure whether source paths can be exposed in citations.
   - Provide a test panel that evaluates a selected user/group against selected collections.

7. Contexts and retrieval diagnostics
   - Add global context and collection/path context controls.
   - Add admin-only Quick/Semantic/Deep retrieval test panels.
   - Keep explicit mode buttons admin-only.
   - Keep regular-user chat free of mode selection unless an admin intentionally exposes it.

8. Job/log UI
   - Show update, embed, ingestion, and conversion jobs.
   - Show status, progress, timestamps, and logs.
   - Provide polling first; SSE can follow.
   - Keep dangerous cleanup actions behind confirmation and limited to app-owned `.qmdui/` data.

## Open WebUI Integration Notes

Open WebUI already has relevant concepts:

- Admin settings for default models.
- Admin settings for pinned models.
- Model metadata that can carry attached tool IDs.
- Tools and Functions/Pipes stored in the workspace.
- Admin/user/pending roles.
- Group-based access surfaces.

The next phase should use those mechanisms directly instead of relying on users to manually enable tools.

One P1 implementation detail matters for RBAC: Open WebUI's tool `__user__` payload does not include group memberships by default. QMDUI's generated Open WebUI artifacts therefore resolve group memberships inside Open WebUI with `Groups.get_groups_by_member_id(user.id)` and forward both group IDs and group names to QMDUI. Future provisioning/admin UI work should preserve this behavior or replace it with a stronger server-side identity validation flow.

Another P1 implementation detail matters for source privacy: regular-user retrieval strips generated frontmatter and leading generated metadata lines from result text unless collection policy explicitly allows source-path exposure. Future document browser/admin UI work should preserve that boundary by defaulting user-facing views to sanitized text and admin-facing diagnostics to full metadata.

Implementation should inspect and use the Open WebUI APIs backing:

- Admin model settings.
- Workspace model editor.
- Tool import/update.
- Function/Pipe import/update.
- Model metadata `toolIds`.
- Default model configuration.
- Group/user permissions.

If Open WebUI lacks a stable public API for one of these actions, prefer a small, well-isolated integration patch over broad forking.

## Security Rules

- Regular users should not receive QMD admin tools.
- Regular users should not need Workspace / Tools permission.
- Regular users should only receive QMD retrieval through an approved model/pipe/tool assignment.
- QMDUI backend must still enforce collection access server-side.
- User-facing retrieval must not leak admin-only paths, converter logs, source folder diagnostics, update commands, or maintenance controls.
- User-facing retrieval must strip generated frontmatter and source metadata from all result text unless the collection explicitly permits source-path exposure.
- Admin pages may show full diagnostics and source paths.
- Open WebUI remains the identity and chat host.
- QMDUI remains the QMD, ingestion, conversion, policy, and retrieval authority.

## Acceptance Criteria

- An admin can configure `Company Knowledge` as a QMD-backed model from a clickable admin page.
- An admin can set `Company Knowledge` as the default model for all users.
- A regular user can open a new chat and ask a normal question without enabling or naming QMD tools.
- The answer is grounded in QMD retrieval results and includes allowed citations.
- A regular user without collection access receives no leaked content.
- Admins can manage dashboard, collections, ingestion, embeddings, contexts, jobs, and policies through clickable Open WebUI admin pages.
- Chat-driven admin tools remain available only as diagnostics or fallback, not as the primary admin UX.
