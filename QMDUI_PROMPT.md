# QMDUI One-Shot Build Prompt

You are building `qmdui`, a QMD admin/retrieval module built on top of Open WebUI for the `@tobilu/qmd` local markdown search engine.

## Goal

Create QMD admin panels inside Open WebUI, not a separate standalone application.

Regular users should see the normal Open WebUI experience: ChatGPT-like chat, chat list/history, user profile/settings, and any QMD-backed tools/pipes/models their groups are allowed to use. Do not build a separate regular-user chat UI in QMDUI.

Admin users should see Open WebUI with additional QMD admin controls integrated into the existing Open WebUI admin experience: Open WebUI user/group management where available, QMD dashboard metrics, QMD collection management, ingestion/conversion configuration, context management, job controls, access policy mapping, MCP configuration, and Open WebUI retrieval integration settings.

Use QMD under the hood. Prefer the `@tobilu/qmd` SDK for supported operations, and use a small, audited child-process wrapper around the `qmd` CLI only for features not exposed by the SDK.

QMD primarily indexes markdown. This app must additionally support non-markdown source files by converting them into markdown or plain text before indexing, while preserving a clear link back to the original source file.

The primary user workflow is folder-based: humans point QMDUI at source folders as collections. QMDUI discovers, normalizes, converts, and indexes those folders. Manual single-file add/upload is not a core workflow for the first build.

## Repository State

This workspace may be empty. Scaffold the app from scratch.

## Tech Stack

- Build on top of Open WebUI, not beside it.
- Use Open WebUI as the primary frontend and identity/RBAC host.
- Add QMD admin pages/components/routes inside Open WebUI's existing admin surface where possible.
- If Open WebUI's extension surface is insufficient for admin pages, make a minimal, clearly isolated Open WebUI fork/module rather than a separate standalone UI.
- Keep QMD backend/control code in a separate module/service boundary that Open WebUI calls through internal APIs.
- Node >= 22 for QMD/QMDUI backend functionality.
- TypeScript for QMDUI backend/admin integration code where applicable.
- Follow Open WebUI's existing frontend stack, component style, routing, admin navigation, icons, and theming conventions.
- Use server-side APIs for all filesystem/QMD operations.
- Bind QMD backend/internal APIs to localhost or internal network only unless explicitly configured.
- Provide scripts/docs for running Open WebUI plus QMDUI integration locally.

## Open WebUI Extension Architecture

The implementation should treat Open WebUI as the application shell:

- Regular user routes remain Open WebUI's normal chat/profile/history routes.
- Admin QMD routes are added under Open WebUI admin navigation, for example Admin -> QMD.
- Open WebUI auth/session/RBAC is the source of truth for whether a user is admin, regular user, or pending.
- QMDUI admin components must use Open WebUI's existing layout, sidebar/admin navigation, tables, forms, modals, notifications, and theme tokens.
- QMD-backed chat should appear to regular users as Open WebUI tools/pipes/models, not as a separate QMDUI chat page.
- QMD backend APIs should be internal to the integrated deployment and protected by Open WebUI admin/user permissions.
- Avoid maintaining a second unrelated React app unless it is only used as an implementation fallback for admin panels embedded into Open WebUI.

## Core Integration

Install and use `@tobilu/qmd`.

Create a backend `QmdService` that opens a QMD store using:

- default QMD db path from `getDefaultDbPath()`
- default config path when it exists
- selected `--index` equivalent when the UI changes active index

Use SDK methods where possible:

- `search`
- `searchLex`
- `searchVector`
- `expandQuery`
- `get`
- `getDocumentBody`
- `multiGet`
- `addCollection`
- `removeCollection`
- `renameCollection`
- `listCollections`
- `getDefaultCollectionNames`
- `addContext`
- `removeContext`
- `setGlobalContext`
- `getGlobalContext`
- `listContexts`
- `update`
- `embed`
- `getStatus`
- `getIndexHealth`
- `Maintenance` for cleanup-style tasks where applicable

Use CLI fallback for:

- `qmd pull`
- `qmd mcp --http`, `qmd mcp --http --daemon`, `qmd mcp stop`
- `qmd skill show/install`
- `qmd bench`
- `collection update-cmd`
- `collection include/exclude`
- any exact output-format export not naturally represented by SDK

## Search UX

Quick, Semantic, and Deep are retrieval modes, not regular-user buttons.

Regular users should not need to choose between QMD search commands. They ask questions in normal Open WebUI chat. QMD retrieval is invoked through Open WebUI tools/pipes/models according to admin configuration, model behavior, and group policy.

Admins can configure and test retrieval modes:

- A QMD Open WebUI Tool, for example `qmd_retrieve`, should expose a `mode` parameter: `quick | semantic | deep`.
- Admins can configure whether the model may choose the retrieval mode or whether mode is fixed per model/group/collection.
- A QMD Pipe/model, for example `QMD Assistant` or `Company Knowledge`, can hide mode selection entirely and use admin defaults.
- Optional Open WebUI Action Functions may add message actions like "Search company knowledge", but these are not the primary regular-user workflow.
- Admin diagnostics should provide explicit Quick/Semantic/Deep controls to test speed, quality, embeddings, reranking, and access-policy behavior.

Mode semantics:

- **Quick Search**: fast keyword search, backed by `qmd search` / SDK `searchLex`.
  - Use for exact terms, names, filenames, symbols, error strings, and quoted phrases.
  - Does not require embeddings or local LLM models.
  - Should be the default retrieval mode for lightweight tool calls.
- **Semantic Search**: meaning-based vector search, backed by `qmd vsearch` / SDK `searchVector`.
  - Use when the human does not know the exact words.
  - Requires embeddings.
  - Does not use reranking.
- **Deep Search**: highest quality hybrid search, backed by `qmd query` / SDK `search`.
  - Uses query expansion, BM25/vector retrieval, and optional LLM reranking.
  - May load local models, use GPU, and take longer.
  - Must run as a job or clearly show loading/progress when model work is active.
  - Admin diagnostics should expose advanced controls: intent, candidate limit, no rerank, explain, structured `lex`/`vec`/`hyde` query builder.

Admin diagnostics may show implementation details in tooltips or advanced panels, for example "Quick Search runs qmd search", but regular users should only see normal Open WebUI chat/tool/pipe behavior.

## Open WebUI Integration

QMDUI should own retrieval, indexing, source normalization, collection management, admin dashboards, and provenance. Open WebUI should own the normal user chat experience, chat history/list, profile/settings, and generation.

Use Open WebUI's existing roles/groups model instead of inventing a parallel user system. Open WebUI has admin/user/pending roles and group-based access controls. QMDUI should respect that boundary:

- Admins can access QMDUI dashboard and QMD management functions.
- Regular users primarily see the normal Open WebUI chat UI.
- Regular users can use QMD-backed chat/retrieval only for collections their role/group may access.
- Regular users must not see source folder paths, ingestion logs, update commands, converter logs, cleanup controls, or collection mutation controls unless explicitly permitted.

The goal is retrieval-augmented chat without duplicating QMDUI's ingestion/indexing work inside Open WebUI:

```text
human asks in Open WebUI
  -> Open WebUI tool/pipe calls QMDUI
  -> QMDUI runs Quick/Semantic/Deep search
  -> QMDUI returns ranked context with source metadata
  -> Open WebUI model summarizes/answers
  -> answer includes citations/source links
```

Do not upload or sync source documents into Open WebUI Knowledge by default. That would duplicate ingestion, chunking, embeddings, and metadata. QMDUI remains the source of truth for collections and retrieval.

Role and group behavior:

- Admin role:
  - view dashboard metrics
  - add/remove/modify collections
  - configure source folders, globs, ignore rules, ingestion, conversion, and context
  - run update/embed/cleanup/model-pull/benchmark jobs
  - configure Open WebUI integration
  - map QMD collections to Open WebUI users/groups
- User role:
  - use Open WebUI chat normally
  - access QMD-backed retrieval through approved tools/pipes/models
  - see only allowed collection names, document titles/snippets, citations, and source metadata permitted by policy
  - no access to admin dashboard, mutation endpoints, source folder paths, shell-backed settings, or maintenance jobs
- Pending role:
  - no QMDUI or QMD-backed retrieval access until approved by an admin

Collection access policy:

- Each QMD collection should support an access-control mapping to Open WebUI groups/users.
- Admins can choose whether a collection is visible to all users, specific groups, specific users, or admin-only.
- Retrieval endpoints must filter collections by the authenticated Open WebUI user/group context.
- Citations shown to regular users must avoid leaking hidden absolute source paths unless the collection policy allows it.
- Admin views may show full source paths and diagnostics.

Support two integration modes:

- **OpenAPI Tool Mode**
  - QMDUI exposes an OpenAPI spec for safe retrieval endpoints.
  - Open WebUI can import QMDUI as an OpenAPI/function-calling tool server.
  - Tool endpoints include Quick Search, Semantic Search, Deep Search, document get, collection list, and context-aware retrieval.
- **Open WebUI Pipe Mode**
  - QMDUI can generate or serve a small Open WebUI Pipe/Function file.
  - The pipe appears in Open WebUI as a model, for example `QMD Deep Research`.
  - The pipe receives a user prompt, calls QMDUI Deep Search, packs top results into a context prompt, calls the selected Open WebUI/Ollama model, and returns an answer with citations.

Open WebUI settings:

- base URL, default `http://localhost:3000`
- API key/token
- default model ID
- retrieval mode: Quick, Semantic, or Deep
- top K results
- min score
- max context characters/tokens
- include snippets only vs full documents
- include source metadata/citations
- rerank enabled/disabled for Deep Search

Company branding and theming:

- Admins need a way to configure company-specific branding for deployments where allowed, including company name, logo, favicon, primary/accent colors, and optional chat background.
- Open WebUI supports full white-labeling/custom branding through its Enterprise customization path. Standard/non-enterprise Open WebUI deployments have branding restrictions and generally must keep Open WebUI branding visible and unmodified.
- QMDUI must preserve Open WebUI branding where required and only rebrand/customize areas allowed by the deployment's Open WebUI licensing/configuration.
- Provide a branding settings screen in QMDUI for QMDUI-owned admin pages.
- QMDUI-owned admin pages can use the company logo, company name, favicon, primary/accent colors, and dashboard title.
- For Open WebUI user-facing chat pages:
  - keep Open WebUI branding visible where required;
  - apply company customization only through supported/allowed mechanisms;
  - allow subordinate company identity in allowed areas such as banners, permitted theme settings, deployment-specific pages, or QMDUI admin surfaces;
  - if enterprise/white-label mode is available, expose the fuller replacement controls through supported Open WebUI customization mechanisms.
- Store branding settings separately from QMD collection settings, for example `.qmdui/branding.json`.
- Branding settings should support per-company deployment defaults, not per-user personal themes.

QMDUI UI features for this integration:

- Dashboard card for Open WebUI connection health and configured model.
- "Ask with Open WebUI" action from Search results and Document views.
- "Copy RAG prompt" action that copies retrieved context plus citations for manual use.
- "Generate Open WebUI Tool Spec" action that exposes/copies the OpenAPI URL.
- "Generate Open WebUI Pipe" action that shows/downloads the Pipe/Function code and setup instructions.
- Citations must include original source path, QMD generated path, title, docid, and line when available.

Security constraints:

- Open WebUI integration endpoints must be read-only retrieval/generation helpers.
- Do not expose collection mutation, cleanup, update-command, or converter execution through the Open WebUI tool spec.
- Require an explicit QMDUI API token for Open WebUI calls unless the app is intentionally running in unauthenticated localhost-only dev mode.
- Admin-only QMDUI endpoints must require admin authorization.
- User-facing retrieval endpoints must enforce collection-level group/user access.
- Treat Open WebUI as the identity/RBAC authority when integrated.

## Non-Markdown Ingestion

Add a first-class ingestion layer for source files that QMD does not index directly as markdown.

The collection model is folder-first:

- A collection points to a source directory, glob patterns, ignore patterns, and ingestion settings.
- Humans add folders as collections rather than adding individual files manually.
- QMDUI scans source folders, builds a generated index mirror, and asks QMD to index the generated mirror.
- For converted collections, QMD should index only generated markdown/plain-text files, not raw non-markdown source files.
- Humans can refresh a collection manually.
- Optionally support folder watching later, but keep it controlled per collection.
- Auto-convert/update and auto-embed should be separate per-collection settings.
- Auto-convert/update is generally safe because it writes only to app-owned generated files.
- Auto-embed may be expensive or GPU-heavy, so it should default to manual unless explicitly enabled.

All files should pass through a normalization pipeline before QMD indexing:

```text
discover source files from collection folder
  -> identify file type
  -> plan allowed conversion pipeline
  -> extract or convert content
  -> normalize to markdown/plain text
  -> add source metadata
  -> write generated shadow file
  -> update ingestion manifest
  -> run QMD update/embed against generated files
```

Requirements:

- Let humans create collections from markdown and non-markdown files.
- For each collection, allow an input file glob and an output/indexing mode:
  - markdown passthrough for `.md`, `.mdx`, `.markdown`
  - plain text extraction for text-like files
  - markdown conversion when a converter is available
  - skip unsupported binary files with a visible warning
- Converter selection must be deterministic by default: extension, MIME sniffing, magic bytes, and available converter detection.
- Optionally support a local model-assisted planner, for example Qwen via a local runtime, but only as an advisory classifier/planner.
- The local model planner may recommend one of the app's pre-registered safe pipelines and explain confidence. It must never emit or execute arbitrary shell commands.
- Maintain a generated shadow directory, for example `.qmdui/generated/<collection-name>/`, containing converted `.md` or `.txt.md` files that QMD indexes.
- Do not mutate source files.
- Preserve source metadata in generated files as frontmatter or a stable heading block:
  - original absolute path
  - original relative path
  - source extension/MIME type
  - source modified time
  - conversion time
  - converter name/version where applicable
  - content hash
- Track generated files so stale conversions are removed when source files disappear.
- Reconvert only when source hash or converter settings change.
- Surface conversion status in the dashboard and collection detail view:
  - converted files
  - skipped files
  - failed conversions
  - stale/generated files removed
- Source files that disappear from the source folder should be marked stale in the manifest and excluded from future indexing. Do not delete source files.
- Conversion errors must be visible in job logs and per-collection diagnostics.
- Search results and document views must show both the QMD generated path and original source path.
- Opening a result should make it obvious whether the displayed content is original markdown or converted text.

Normalization components:

- `FileDiscoverer`: expands collection globs, applies ignore patterns, and identifies source files.
- `FileIdentifier`: determines extension, MIME type, magic bytes, text/binary status, and basic file stats.
- `ConverterRegistry`: declares every allowed converter and its supported input types.
- `PipelinePlanner`: chooses the converter pipeline. Use deterministic rules first; optionally ask a local model for ambiguous cases.
- `ContentExtractor`: runs the selected converter using safe argument arrays.
- `MarkdownNormalizer`: cleans extracted text, preserves headings/tables/code blocks when possible, and emits stable markdown.
- `ManifestStore`: records source hash, output path, chosen pipeline, converter versions, warnings, errors, and timestamps.
- `IngestionService`: orchestrates conversion jobs and hands generated directories to QMD.

Pipeline planner behavior:

- Known extensions should route without model involvement.
- Ambiguous or failed extraction cases may call a local model in advisory mode.
- The model response must be validated against a strict schema:

```json
{
  "recommendedPipeline": "pdf-text",
  "confidence": 0.91,
  "reason": "PDF appears to contain selectable text",
  "fallbackPipeline": "pdf-ocr"
}
```

- `recommendedPipeline` and `fallbackPipeline` must match IDs in `ConverterRegistry`.
- If confidence is low or the recommendation is unavailable, fall back to deterministic behavior and surface a warning.
- Store the planner type (`deterministic` or `local-model`) in the manifest for each file.

Initial converter support:

- Native passthrough:
  - `.md`, `.mdx`, `.markdown`
- Plain text:
  - `.txt`, `.log`, `.csv`, `.tsv`, `.json`, `.jsonl`, `.yaml`, `.yml`, `.toml`, `.xml`, `.html`, `.css`, `.js`, `.ts`, `.tsx`, `.jsx`, `.py`, `.rb`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.h`, `.hpp`, `.cs`, `.sh`, `.sql`
- Optional external converters when installed:
  - `pandoc` for `.docx`, `.odt`, `.rtf`, `.epub`, `.html`
  - `pdftotext` or equivalent for `.pdf`
- Future-ready converter slots:
  - OCR for scanned PDFs/images, for example `tesseract`
  - audio/video transcription, for example local Whisper
  - table-aware spreadsheet extraction for `.xlsx`/`.ods`
- Detect unavailable converters and explain what is missing instead of failing the whole collection.

Implementation guidance:

- Keep conversion code isolated in `server/ingestion/`.
- Create an `IngestionService` that runs before QMD indexing.
- Implement a converter registry with explicit pipeline IDs such as `markdown-passthrough`, `plain-text`, `pandoc-markdown`, `pdf-text`, `pdf-ocr`.
- For converted collections, point QMD at the generated shadow directory.
- Store ingestion manifests in `.qmdui/manifests/<collection-name>.json`.
- Make ingestion part of the same job system as update/embed.
- Provide "Scan Folder", "Convert Folder", "Refresh Collection", and "Convert + update QMD" actions.
- Collection removal must remove QMDUI config/index references only. It must not delete source files.
- Do not allow arbitrary converter shell commands from the browser. Only call explicit known converter binaries with safe argument arrays.
- If local model planning is enabled, expose settings for model provider/runtime, model name/path, and confidence threshold. Keep it disabled by default unless runtime availability is detected.

## File Safety And Deletion Guardrails

Source folders are read-only from QMDUI's perspective.

- Never delete source files.
- Never rename source files.
- Never move source files.
- Never overwrite or modify source files.
- Never write generated files into source folders.
- Only write app-owned data inside `.qmdui/`.
- Generated files should live under `.qmdui/generated/<collection-name>/`.
- Manifests should live under `.qmdui/manifests/<collection-name>.json`.
- Stale generated files should be marked stale in manifests and excluded from indexing by default.
- Physical deletion is allowed only inside `.qmdui/`, and only through explicit cleanup actions.
- Cleanup actions must preview what will be removed and require confirmation.
- Removing a collection must not delete source data.
- If QMD's own cleanup removes index rows or generated cache state, clearly label that it is not deleting source files.

## Backend Requirements

Create REST APIs for:

- `GET /api/status`
- `GET /api/dashboard`
- `GET /api/collections`
- `POST /api/collections`
- `PATCH /api/collections/:name`
- `DELETE /api/collections/:name`
- `POST /api/collections/:name/rename`
- `POST /api/collections/:name/include`
- `POST /api/collections/:name/exclude`
- `POST /api/collections/:name/update-command`
- `GET /api/contexts`
- `POST /api/contexts`
- `DELETE /api/contexts`
- `POST /api/search/quick`
- `POST /api/search/semantic`
- `POST /api/search/deep`
- `POST /api/search/expand`
- `GET /api/openapi.json`
- `GET /api/integrations/open-webui/status`
- `POST /api/integrations/open-webui/ask`
- `POST /api/integrations/open-webui/copy-prompt`
- `GET /api/integrations/open-webui/pipe.py`
- `GET /api/access/policies`
- `PUT /api/access/policies/:collectionName`
- `POST /api/access/evaluate`
- `GET /api/documents`
- `POST /api/documents/get`
- `POST /api/documents/multi-get`
- `POST /api/ingestion/preview`
- `POST /api/ingestion/convert`
- `GET /api/ingestion/:collectionName`
- `POST /api/jobs/update`
- `POST /api/jobs/embed`
- `POST /api/jobs/pull-models`
- `POST /api/jobs/cleanup`
- `POST /api/jobs/bench`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/events` using SSE if practical, otherwise polling
- `POST /api/mcp/start`
- `POST /api/mcp/start-daemon`
- `POST /api/mcp/stop`
- `GET /api/mcp/status`
- `GET /api/skill`
- `POST /api/skill/install`

## Job System

Implement an in-memory job runner with:

- id, type, status, startedAt, completedAt
- progress percentage when available
- logs
- result or error
- cancellation where safe for child processes

Long-running operations must not block the UI.

## Open WebUI User Interface Requirements

1. Regular User Experience: Open WebUI
   - regular users see the normal Open WebUI screens: chat, chat list/history, profile/settings
   - QMDUI must not replace the normal Open WebUI chat interface for regular users
   - QMD-backed retrieval appears as an approved Open WebUI tool/pipe/model according to group access
   - regular users can ask questions in Open WebUI and receive LLM answers grounded in QMD retrieval context
   - user-visible citations must respect collection policy and avoid leaking hidden admin/source-path details
   - regular users do not see QMD dashboards, ingestion status, source folder paths, converter logs, update commands, cleanup controls, or mutation controls

2. Admin Dashboard
   - implemented as an Open WebUI admin page/panel, not a standalone external dashboard
   - health cards: documents, embeddings pending, vector index, collections, DB/index path, MCP state
   - Open WebUI connection card with base URL, model, and health
   - ingestion cards: converted files, skipped files, failed conversions
   - recent jobs with live status
   - action buttons for scan folder, convert folder, update, embed, pull models, cleanup, start/stop MCP
   - collection/context/conversion warnings

3. Admin Retrieval Diagnostics
   - implemented inside Open WebUI admin navigation
   - explicit diagnostic modes/tabs: Quick Search, Semantic Search, Deep Search
   - these mode buttons are for admins only; regular users should not see three search buttons in chat
   - Quick Search uses fast keyword/BM25 search
   - Semantic Search uses vector similarity and clearly indicates embeddings are required
   - Deep Search supports query, intent, collections, limit, min score, candidate limit, no rerank, explain, full, line numbers
   - Deep Search includes a structured query builder for multiple rows of `lex`, `vec`, `hyde`, plus optional intent
   - Advanced panels/tooltips may show the QMD command equivalents: `qmd search`, `qmd vsearch`, `qmd query`
   - Results show score, docid, title, qmd path, original source path when converted, context, line/snippet
   - Click result to open document drawer/full page
   - "Ask with Open WebUI" and "Copy RAG prompt" actions for selected results
   - Export results as JSON/CSV/Markdown/XML/files where possible

4. Admin Documents
   - implemented inside Open WebUI admin navigation
   - collection/file browser equivalent to `qmd ls`
   - get document by path/docid
   - line slicing controls: from line, max lines, line numbers
   - multi-get form for glob or comma-separated paths with max bytes and max lines
   - show original source metadata for converted documents

5. Admin Collections
   - implemented inside Open WebUI admin navigation
   - list collections with path, pattern, file count, updated age, include/exclude state
   - add collection: source folder path, name, glob pattern, ignore patterns, ingestion mode
   - remove, rename, show details
   - set/clear update command
   - include/exclude from default queries
   - ignore patterns if available through config
   - conversion diagnostics and "Scan Folder" / "Convert Folder" / "Refresh Collection" / "Convert + update" actions
   - per-collection toggles for folder watching, auto-convert/update, and auto-embed
   - access-control panel for mapping each collection to Open WebUI groups/users/admin-only/all-users
   - clear warning that collection removal never deletes source files

6. Admin Contexts
   - implemented inside Open WebUI admin navigation
   - list global and collection/path contexts
   - add global context
   - add context for qmd://collection/path
   - remove context

7. Admin Maintenance
   - implemented inside Open WebUI admin navigation
   - update index
   - scan and convert non-markdown source folders
   - embed, force embed, max docs per batch, max batch MB, chunk strategy auto/regex
   - pull models with refresh option
   - cleanup database/cache
   - benchmark fixture runner
   - show raw logs for jobs

8. Admin MCP & Integrations
   - implemented inside Open WebUI admin navigation
   - start foreground HTTP MCP on selected port
   - start daemon HTTP MCP on selected port
   - stop daemon
   - show health URL and MCP endpoint
   - configure Open WebUI base URL, API key/token, default model, retrieval mode, top K, min score, context size
   - configure company branding for QMDUI-owned admin pages
   - expose Open WebUI branding/theme settings only when supported/allowed by the deployment
   - show OpenAPI tool URL for importing QMDUI retrieval into Open WebUI
   - generate/show Open WebUI Pipe/Function code for QMD-backed chat
   - configure how QMDUI validates Open WebUI user identity, role, and group membership
   - test Open WebUI connection and run a sample retrieval-augmented answer
   - skill show
   - skill install local/global with force/yes options

## Design Requirements

- This is an Open WebUI admin extension/module plus QMD retrieval integration, not a landing page or standalone product shell.
- Regular users should land in Open WebUI chat, not a QMDUI dashboard.
- Admin users should access QMDUI admin controls from Open WebUI's admin navigation.
- Use a restrained, dense interface suitable for repeated work.
- Match Open WebUI's existing admin layout, navigation, spacing, components, dark/light modes, and interaction patterns.
- Avoid nested cards and oversized hero sections.
- Use icons for actions where appropriate.
- Ensure all controls fit on mobile and desktop.
- Make loading, empty, error, and running states explicit.
- Dangerous actions require confirmation.

## Security And Safety

- Because this app can run shell commands via QMD, bind to `127.0.0.1`.
- Validate command inputs.
- Never expose arbitrary shell execution except the explicit QMD CLI wrappers.
- For collection update commands, label clearly that QMD will run the configured shell command during update.
- For converters, only execute known converter binaries with explicit argument arrays.
- Treat source folders as read-only. Never delete, rename, move, overwrite, or modify source files.
- Only write generated content, manifests, logs, and cleanup targets inside `.qmdui/`.
- Open WebUI tool/Pipe integration must only expose read-only retrieval endpoints by default.
- Do not expose mutation, cleanup, shell-backed update commands, or converter execution to Open WebUI.
- Keep Open WebUI branding visible where required. Do not replace, hide, recolor, or obscure Open WebUI branding unless the deployment supports/allows that customization.
- Admin-only dashboard and QMD mutation endpoints must require admin authorization.
- User-facing retrieval must filter by Open WebUI role/group/user access policy.
- Never leak admin-only source paths, converter logs, update commands, or collection diagnostics to regular users.
- Surface command and conversion output logs.

## Implementation Quality

- Keep backend QMD integration isolated in `server/qmdService.ts`.
- Keep CLI fallback isolated in `server/qmdCli.ts`.
- Keep job runner isolated in `server/jobs.ts`.
- Keep ingestion/conversion logic isolated in `server/ingestion/`.
- Keep Open WebUI admin integration isolated in a QMD module/admin route set so future Open WebUI upgrades are manageable.
- Use shared TypeScript types between frontend/backend where practical.
- Add focused tests for command construction, job lifecycle, ingestion manifest behavior, converter selection, and query payload handling if feasible.
- Add focused tests for RBAC filtering: regular users cannot access admin endpoints or unauthorized collections.
- After implementation, run install/build/test.
- Start the dev server and provide the local URL.

## Acceptance Criteria

- An admin can perform every documented QMD CLI workflow from admin controls.
- QMD admin controls are available inside Open WebUI admin navigation, not as a separate standalone admin application.
- Dashboard accurately reflects QMD status and ingestion/conversion status.
- Admin retrieval diagnostics and Open WebUI retrieval tools work for Quick Search, Semantic Search, Deep Search, and structured Deep Search query documents.
- Collection, context, document retrieval, update, embed, cleanup, MCP, model pull, skill, and bench workflows are reachable.
- Non-markdown files can be converted into markdown/plain text and indexed without mutating source files.
- Search results preserve original source file identity for converted documents.
- QMDUI can expose read-only retrieval to Open WebUI through an OpenAPI tool spec and/or generated Pipe.
- Open WebUI can use QMDUI search results as context for LLM answers with citations.
- Admin users can manage QMD collections, contexts, ingestion, conversion, metrics, jobs, and access policies.
- Regular users retain the normal Open WebUI chat experience and only access QMD-backed retrieval allowed by their groups; they do not see QMD admin panels.
- Collection retrieval is filtered by Open WebUI user/group/role policy.
- Admin users can configure company branding for QMDUI-owned surfaces, and Open WebUI user-facing branding is customized only where supported/allowed while preserving required Open WebUI branding.
- The primary collection workflow is folder-based: add source folder, scan, convert, update, embed.
- Source files are never deleted or modified by QMDUI.
- Cleanup and stale-file handling only affect app-owned `.qmdui/` data and require confirmation for physical deletion.
- Long-running work shows progress/logs without freezing the UI.
- The app builds cleanly.
