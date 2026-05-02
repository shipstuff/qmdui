# P1 Test Report

This report captures the current P1 validation state for the QMDUI backend plus Open WebUI integration.

## Environment

- QMDUI backend: `http://127.0.0.1:8765`
- Open WebUI backend: `http://127.0.0.1:8080`
- Open WebUI frontend: `http://127.0.0.1:5173`
- Open WebUI is run from `.external/open-webui`, which is ignored and not vendored into this repository.

## Smoke Fixture

The local smoke fixture creates:

- source folder: `.qmdui/smoke-source`
- generated QMD index mirror: `.qmdui/generated/smoke`
- collection: `smoke`
- documents:
  - `notes.md`
  - `runbook.txt`, converted to generated markdown

The `notes.md` fixture contains the expected retrieval answer:

```text
The deployment checklist includes indexing, access policy validation, and retrieval testing.
```

## Validated Behaviors

### Backend

- QMDUI service starts and serves generated Open WebUI artifacts.
- Folder-based ingestion works for markdown and plain text.
- Generated files are written under `.qmdui/generated`.
- Source files are not modified.
- QMD update indexes the generated collection.
- Embedding job completed successfully:
  - documents processed: `2`
  - chunks embedded: `2`
  - errors: `0`
- Dashboard reports:
  - `needsEmbedding: 0`
  - `hasVectorIndex: true`

### Open WebUI Integration

- `QMD Retrieve` imports as a Workspace Tool.
- `QMD Admin Tools` imports as a Workspace Tool.
- `QMD Assistant` imports as a Function/Pipe.
- A regular-user-facing `Company Knowledge` model can call the attached QMD retrieval tool without the user manually enabling tools.
- Admin diagnostic tools work from Open WebUI.
- Regular user model access can be gated by Open WebUI model permissions.

### Access Control

- QMDUI collection policy for `smoke` was validated in group mode:

```json
{
  "collection": "smoke",
  "mode": "groups",
  "groups": ["qa"],
  "users": [],
  "exposeSourcePaths": false
}
```

- `qmd_evaluate_access` with role `user` and group `qa` returns allowed.
- Regular user retrieval through `Company Knowledge` succeeds when the user is in Open WebUI group `qa`.
- The generated Open WebUI artifacts now resolve Open WebUI group membership at runtime through `Groups.get_groups_by_member_id(user.id)` and forward both group IDs and group names to QMDUI.

### Retrieval Modes

All three retrieval modes were validated against query `deployment checklist`:

- Quick: returns `notes.md`.
- Semantic: returns `notes.md` as strongest result, with `runbook.txt` as a weaker secondary result.
- Deep: returns `notes.md` as strongest result, with `runbook.txt` as a secondary result.

## Known P1 Gaps

### Raw Body Metadata Leakage

Generated markdown includes frontmatter such as:

- `source_collection`
- `original_path`
- `original_relative_path`
- converter metadata

The citation policy hides `originalPath` when `exposeSourcePaths` is false, but the retrieval body/snippet can still include frontmatter when raw generated document text is returned to Open WebUI. This is a leakage risk for regular users.

Before broader use, regular-user retrieval responses should strip or redact generated frontmatter and other admin-only metadata from `body`, `snippet`, and tool output. Admin diagnostics can continue to show full metadata.

### Tool-Command UX

Admin chat tools are useful for P1 diagnostics, but they are not the final admin UX. Admin workflows should move to clickable Open WebUI admin pages in the next phase.

### Process Management

The local development setup currently runs QMDUI, Open WebUI backend, and Open WebUI frontend as separate long-running processes. If Codex or a terminal session exits, processes may need to be restarted manually.

## P1 Status

P1 retrieval and RBAC integration are functionally validated.

Security hardening for regular-user source metadata redaction remains a required follow-up before treating the integration as production-safe.
