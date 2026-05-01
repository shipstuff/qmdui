# QMDUI One-Shot Build Prompt

You are building `qmdui`, a local-first web UI for managing QMD, the `@tobilu/qmd` local markdown search engine.

## Goal

Create a complete usable UI that exposes every QMD CLI feature through a human-friendly interface, with a compact dashboard for index health and common actions. Use QMD under the hood. Prefer the `@tobilu/qmd` SDK for supported operations, and use a small, audited child-process wrapper around the `qmd` CLI only for features not exposed by the SDK.

QMD primarily indexes markdown. This app must additionally support non-markdown source files by converting them into markdown or plain text before indexing, while preserving a clear link back to the original source file.

The primary user workflow is folder-based: humans point QMDUI at source folders as collections. QMDUI discovers, normalizes, converts, and indexes those folders. Manual single-file add/upload is not a core workflow for the first build.

## Repository State

This workspace may be empty. Scaffold the app from scratch.

## Tech Stack

- Node >= 22
- TypeScript
- Vite + React frontend
- Express backend API
- Use plain CSS or a small local styling setup; do not create a marketing landing page
- Use lucide-react icons
- Use server-side APIs for all filesystem/QMD operations
- Bind backend to localhost only
- Provide npm scripts: `dev`, `build`, `start`, `test` if tests are feasible

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

Expose search by human-facing modes, not raw QMD command names.

- **Quick Search**: fast keyword search, backed by `qmd search` / SDK `searchLex`.
  - Use for exact terms, names, filenames, symbols, error strings, and quoted phrases.
  - Does not require embeddings or local LLM models.
  - Should be the default global/header search mode.
- **Semantic Search**: meaning-based vector search, backed by `qmd vsearch` / SDK `searchVector`.
  - Use when the human does not know the exact words.
  - Requires embeddings.
  - Does not use reranking.
- **Deep Search**: highest quality hybrid search, backed by `qmd query` / SDK `search`.
  - Uses query expansion, BM25/vector retrieval, and optional LLM reranking.
  - May load local models, use GPU, and take longer.
  - Must run as a job or clearly show loading/progress when model work is active.
  - Expose advanced controls: intent, candidate limit, no rerank, explain, structured `lex`/`vec`/`hyde` query builder.

The UI may show implementation details in tooltips or advanced panels, for example "Quick Search runs qmd search", but the primary labels should be Quick, Semantic, and Deep.

## Open WebUI Integration

QMDUI should own retrieval, indexing, source normalization, collection management, and provenance. Open WebUI should own chat/generation.

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

## Frontend Screens

1. Dashboard
   - health cards: documents, embeddings pending, vector index, collections, DB/index path, MCP state
   - Open WebUI connection card with base URL, model, and health
   - ingestion cards: converted files, skipped files, failed conversions
   - recent jobs with live status
   - action buttons for scan folder, convert folder, update, embed, pull models, cleanup, start/stop MCP
   - collection/context/conversion warnings

2. Search
   - primary modes/tabs: Quick Search, Semantic Search, Deep Search
   - Quick Search is the default and uses fast keyword/BM25 search
   - Semantic Search uses vector similarity and clearly indicates embeddings are required
   - Deep Search supports query, intent, collections, limit, min score, candidate limit, no rerank, explain, full, line numbers
   - Deep Search includes a structured query builder for multiple rows of `lex`, `vec`, `hyde`, plus optional intent
   - Advanced panels/tooltips may show the QMD command equivalents: `qmd search`, `qmd vsearch`, `qmd query`
   - Results show score, docid, title, qmd path, original source path when converted, context, line/snippet
   - Click result to open document drawer/full page
   - "Ask with Open WebUI" and "Copy RAG prompt" actions for selected results
   - Export results as JSON/CSV/Markdown/XML/files where possible

3. Documents
   - collection/file browser equivalent to `qmd ls`
   - get document by path/docid
   - line slicing controls: from line, max lines, line numbers
   - multi-get form for glob or comma-separated paths with max bytes and max lines
   - show original source metadata for converted documents

4. Collections
   - list collections with path, pattern, file count, updated age, include/exclude state
   - add collection: source folder path, name, glob pattern, ignore patterns, ingestion mode
   - remove, rename, show details
   - set/clear update command
   - include/exclude from default queries
   - ignore patterns if available through config
   - conversion diagnostics and "Scan Folder" / "Convert Folder" / "Refresh Collection" / "Convert + update" actions
   - per-collection toggles for folder watching, auto-convert/update, and auto-embed
   - clear warning that collection removal never deletes source files

5. Contexts
   - list global and collection/path contexts
   - add global context
   - add context for qmd://collection/path
   - remove context

6. Maintenance
   - update index
   - scan and convert non-markdown source folders
   - embed, force embed, max docs per batch, max batch MB, chunk strategy auto/regex
   - pull models with refresh option
   - cleanup database/cache
   - benchmark fixture runner
   - show raw logs for jobs

7. MCP & Integrations
   - start foreground HTTP MCP on selected port
   - start daemon HTTP MCP on selected port
   - stop daemon
   - show health URL and MCP endpoint
   - configure Open WebUI base URL, API key/token, default model, retrieval mode, top K, min score, context size
   - show OpenAPI tool URL for importing QMDUI retrieval into Open WebUI
   - generate/show Open WebUI Pipe/Function code for QMD-backed chat
   - test Open WebUI connection and run a sample retrieval-augmented answer
   - skill show
   - skill install local/global with force/yes options

## Design Requirements

- This is an operational tool, not a landing page.
- First screen is the dashboard/app shell.
- Use a restrained, dense interface suitable for repeated work.
- Sidebar navigation plus main content.
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
- Surface command and conversion output logs.

## Implementation Quality

- Keep backend QMD integration isolated in `server/qmdService.ts`.
- Keep CLI fallback isolated in `server/qmdCli.ts`.
- Keep job runner isolated in `server/jobs.ts`.
- Keep ingestion/conversion logic isolated in `server/ingestion/`.
- Use shared TypeScript types between frontend/backend where practical.
- Add focused tests for command construction, job lifecycle, ingestion manifest behavior, converter selection, and query payload handling if feasible.
- After implementation, run install/build/test.
- Start the dev server and provide the local URL.

## Acceptance Criteria

- A human can perform every documented QMD CLI workflow from the UI.
- Dashboard accurately reflects QMD status and ingestion/conversion status.
- Search works for Quick Search, Semantic Search, Deep Search, and structured Deep Search query documents.
- Collection, context, document retrieval, update, embed, cleanup, MCP, model pull, skill, and bench workflows are reachable.
- Non-markdown files can be converted into markdown/plain text and indexed without mutating source files.
- Search results preserve original source file identity for converted documents.
- QMDUI can expose read-only retrieval to Open WebUI through an OpenAPI tool spec and/or generated Pipe.
- Open WebUI can use QMDUI search results as context for LLM answers with citations.
- The primary collection workflow is folder-based: add source folder, scan, convert, update, embed.
- Source files are never deleted or modified by QMDUI.
- Cleanup and stale-file handling only affect app-owned `.qmdui/` data and require confirmation for physical deletion.
- Long-running work shows progress/logs without freezing the UI.
- The app builds cleanly.
