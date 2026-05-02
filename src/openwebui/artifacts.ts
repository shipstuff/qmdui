import type { AppConfig } from "../config.js";

function baseUrl(config: AppConfig): string {
  return `http://${config.host}:${config.port}`;
}

export function openWebUiRetrievalTool(config: AppConfig): string {
  return `"""
title: QMD Retrieve
author: QMDUI
version: 0.1.0
description: Retrieve ranked context from QMD collections with Open WebUI-aware access filtering.
"""

from typing import Optional, List, Literal
from pydantic import BaseModel, Field
import httpx


class Tools:
    class Valves(BaseModel):
        QMDUI_BASE_URL: str = Field(default="${baseUrl(config)}")
        QMDUI_API_TOKEN: str = Field(default="", description="Optional QMDUI bearer token")
        DEFAULT_MODE: str = Field(default="quick", description="quick, semantic, or deep")
        TOP_K: int = Field(default=8)
        MIN_SCORE: float = Field(default=0.0)

    def __init__(self):
        self.valves = self.Valves()

    async def _group_values(self, user: dict):
        values = []

        def add(value):
            if value is None:
                return
            value = str(value)
            if value and value not in values:
                values.append(value)

        for group in user.get("groups", []) or []:
            if isinstance(group, dict):
                add(group.get("id"))
                add(group.get("name"))
            else:
                add(group)

        info = user.get("info", {}) or {}
        for group in info.get("groups", []) or []:
            if isinstance(group, dict):
                add(group.get("id"))
                add(group.get("name"))
            else:
                add(group)

        user_id = user.get("id")
        if user_id:
            try:
                from open_webui.models.groups import Groups
                for group in await Groups.get_groups_by_member_id(str(user_id)):
                    add(getattr(group, "id", None))
                    add(getattr(group, "name", None))
            except Exception:
                pass

        return values

    async def _headers(self, __user__: Optional[dict] = None):
        headers = {}
        if self.valves.QMDUI_API_TOKEN:
            headers["Authorization"] = f"Bearer {self.valves.QMDUI_API_TOKEN}"
        user = __user__ or {}
        headers["x-open-webui-user-id"] = str(user.get("id", "anonymous"))
        headers["x-open-webui-role"] = str(user.get("role", "user"))
        groups = await self._group_values(user)
        if groups:
            headers["x-open-webui-groups"] = ",".join(groups)
        return headers

    async def qmd_retrieve(
        self,
        query: str,
        mode: Optional[Literal["quick", "semantic", "deep"]] = None,
        collections: Optional[List[str]] = None,
        top_k: Optional[int] = None,
        min_score: Optional[float] = None,
        intent: Optional[str] = None,
        __user__: Optional[dict] = None,
    ) -> str:
        """Retrieve relevant QMD context for answering questions. Use this for company/internal knowledge."""
        payload = {
            "query": query,
            "mode": mode or self.valves.DEFAULT_MODE,
            "collections": collections,
            "topK": top_k or self.valves.TOP_K,
            "minScore": self.valves.MIN_SCORE if min_score is None else min_score,
            "intent": intent,
        }
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{self.valves.QMDUI_BASE_URL}/api/search/retrieve",
                json=payload,
                headers=await self._headers(__user__),
            )
            response.raise_for_status()
            data = response.json()

        results = data.get("results", [])
        if not results:
            return "No QMD results found."

        lines = []
        for index, result in enumerate(results, start=1):
            citation = result.get("citation", {})
            title = result.get("title") or citation.get("title") or "Untitled"
            path = citation.get("originalPath") or citation.get("qmdPath") or result.get("qmdPath")
            score = result.get("score", 0)
            snippet = result.get("snippet") or result.get("body") or ""
            lines.append(f"[{index}] {title} ({score:.2f}) — {path}\\n{snippet}")
        return "\\n\\n".join(lines)
`;
}

export function openWebUiPipe(config: AppConfig): string {
  return `"""
title: QMD Assistant
author: QMDUI
version: 0.1.0
description: A QMD-backed Open WebUI Pipe that retrieves context from QMD before generating an answer.
"""

from pydantic import BaseModel, Field
from fastapi import Request
import httpx

from open_webui.models.users import Users
from open_webui.utils.chat import generate_chat_completion


class Pipe:
    class Valves(BaseModel):
        QMDUI_BASE_URL: str = Field(default="${baseUrl(config)}")
        QMDUI_API_TOKEN: str = Field(default="", description="Optional QMDUI bearer token")
        BASE_MODEL: str = Field(default="", description="Open WebUI model ID used to generate the final answer")
        RETRIEVAL_MODE: str = Field(default="deep", description="quick, semantic, or deep")
        TOP_K: int = Field(default=8)
        MIN_SCORE: float = Field(default=0.0)
        MAX_CONTEXT_CHARS: int = Field(default=12000)

    def __init__(self):
        self.valves = self.Valves()

    def pipes(self):
        return [{"id": "qmd-assistant", "name": "QMD Assistant"}]

    async def _group_values(self, user: dict):
        values = []

        def add(value):
            if value is None:
                return
            value = str(value)
            if value and value not in values:
                values.append(value)

        for group in user.get("groups", []) or []:
            if isinstance(group, dict):
                add(group.get("id"))
                add(group.get("name"))
            else:
                add(group)

        info = user.get("info", {}) or {}
        for group in info.get("groups", []) or []:
            if isinstance(group, dict):
                add(group.get("id"))
                add(group.get("name"))
            else:
                add(group)

        user_id = user.get("id")
        if user_id:
            try:
                from open_webui.models.groups import Groups
                for group in await Groups.get_groups_by_member_id(str(user_id)):
                    add(getattr(group, "id", None))
                    add(getattr(group, "name", None))
            except Exception:
                pass

        return values

    async def _headers(self, __user__: dict):
        headers = {}
        if self.valves.QMDUI_API_TOKEN:
            headers["Authorization"] = f"Bearer {self.valves.QMDUI_API_TOKEN}"
        headers["x-open-webui-user-id"] = str(__user__.get("id", "anonymous"))
        headers["x-open-webui-role"] = str(__user__.get("role", "user"))
        groups = await self._group_values(__user__ or {})
        if groups:
            headers["x-open-webui-groups"] = ",".join(groups)
        return headers

    async def pipe(self, body: dict, __user__: dict, __request__: Request):
        user_message = ""
        for message in reversed(body.get("messages", [])):
            if message.get("role") == "user":
                user_message = message.get("content", "")
                break

        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(
                f"{self.valves.QMDUI_BASE_URL}/api/search/retrieve",
                json={
                    "query": user_message,
                    "mode": self.valves.RETRIEVAL_MODE,
                    "topK": self.valves.TOP_K,
                    "minScore": self.valves.MIN_SCORE,
                },
                headers=await self._headers(__user__),
            )
            response.raise_for_status()
            results = response.json().get("results", [])

        context_blocks = []
        citations = []
        for index, result in enumerate(results, start=1):
            citation = result.get("citation", {})
            path = citation.get("originalPath") or citation.get("qmdPath") or result.get("qmdPath")
            title = result.get("title") or citation.get("title") or "Untitled"
            text = result.get("snippet") or result.get("body") or ""
            block = f"[{index}] {title}\\nSource: {path}\\n{text}"
            context_blocks.append(block)
            citations.append(f"[{index}] {title} — {path}")

        context = "\\n\\n".join(context_blocks)[: self.valves.MAX_CONTEXT_CHARS]
        system = (
            "Answer using the QMD retrieved context below. "
            "If the context does not contain the answer, say so. "
            "Cite sources using bracket numbers like [1].\\n\\n"
            f"QMD context:\\n{context}\\n\\n"
            f"Available citations:\\n" + "\\n".join(citations)
        )

        next_body = dict(body)
        if self.valves.BASE_MODEL:
            next_body["model"] = self.valves.BASE_MODEL
        next_body["messages"] = [{"role": "system", "content": system}] + body.get("messages", [])

        user = await Users.get_user_by_id(__user__["id"])
        return await generate_chat_completion(__request__, next_body, user)
`;
}

export function openWebUiAdminTools(config: AppConfig): string {
  return `"""
title: QMD Admin Tools
author: QMDUI
version: 0.1.0
description: Admin-only QMD management, ingestion, job, and access-policy helpers for Open WebUI.
"""

from typing import Optional, List, Literal, Any, Dict
from pydantic import BaseModel, Field
import httpx


class Tools:
    class Valves(BaseModel):
        QMDUI_BASE_URL: str = Field(default="${baseUrl(config)}")
        QMDUI_API_TOKEN: str = Field(default="", description="Optional QMDUI bearer token")

    def __init__(self):
        self.valves = self.Valves()

    def _ensure_admin(self, __user__: Optional[dict] = None):
        user = __user__ or {}
        if str(user.get("role", "user")).lower() != "admin":
            raise PermissionError("QMD admin tools require an Open WebUI admin user.")

    async def _group_values(self, user: dict):
        values = []

        def add(value):
            if value is None:
                return
            value = str(value)
            if value and value not in values:
                values.append(value)

        for group in user.get("groups", []) or []:
            if isinstance(group, dict):
                add(group.get("id"))
                add(group.get("name"))
            else:
                add(group)

        info = user.get("info", {}) or {}
        for group in info.get("groups", []) or []:
            if isinstance(group, dict):
                add(group.get("id"))
                add(group.get("name"))
            else:
                add(group)

        user_id = user.get("id")
        if user_id:
            try:
                from open_webui.models.groups import Groups
                for group in await Groups.get_groups_by_member_id(str(user_id)):
                    add(getattr(group, "id", None))
                    add(getattr(group, "name", None))
            except Exception:
                pass

        return values

    async def _headers(self, __user__: Optional[dict] = None):
        user = __user__ or {}
        headers = {
            "x-open-webui-user-id": str(user.get("id", "anonymous")),
            "x-open-webui-role": str(user.get("role", "user")),
        }
        groups = await self._group_values(user)
        if groups:
            headers["x-open-webui-groups"] = ",".join(groups)
        if self.valves.QMDUI_API_TOKEN:
            headers["Authorization"] = f"Bearer {self.valves.QMDUI_API_TOKEN}"
        return headers

    async def qmd_debug_identity(self, __user__: Optional[dict] = None) -> dict:
        """Admin-only: show the Open WebUI user context passed to QMDUI tools."""
        self._ensure_admin(__user__)
        return {
            "openWebUiUser": __user__ or {},
            "qmdHeaders": await self._headers(__user__),
        }

    async def _request(
        self,
        method: str,
        path: str,
        __user__: Optional[dict] = None,
        payload: Optional[Dict[str, Any]] = None,
        timeout: int = 120,
    ) -> dict:
        self._ensure_admin(__user__)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.request(
                method,
                f"{self.valves.QMDUI_BASE_URL}{path}",
                headers=await self._headers(__user__),
                json=payload,
            )
            r.raise_for_status()
            return r.json()

    async def qmd_status(self, __user__: Optional[dict] = None) -> dict:
        """Admin-only: show QMD status, collection health, and dashboard metrics."""
        return await self._request("GET", "/api/dashboard", __user__, timeout=60)

    async def qmd_dashboard(self, __user__: Optional[dict] = None) -> str:
        """Admin-only: show a readable QMDUI mini-dashboard summary."""
        data = await self._request("GET", "/api/dashboard", __user__, timeout=60)
        status = data.get("status", {})
        health = data.get("health", {})
        collections = data.get("collections", [])
        contexts = data.get("contexts", [])
        policies = data.get("accessPolicies", [])

        lines = [
            "# QMDUI Dashboard",
            "",
            "## Health",
            f"- Total documents: {status.get('totalDocuments', 0)}",
            f"- Documents needing embeddings: {status.get('needsEmbedding', health.get('needsEmbedding', 0))}",
            f"- Vector index present: {'yes' if status.get('hasVectorIndex') else 'no'}",
            f"- Days stale: {health.get('daysStale', 0)}",
            "",
            "## Collections",
        ]

        if collections:
            for collection in collections:
                name = collection.get("name", "unknown")
                docs = collection.get("doc_count", collection.get("documents", 0))
                active = collection.get("active_count", docs)
                pattern = collection.get("glob_pattern", collection.get("pattern", ""))
                included = collection.get("includeByDefault")
                updated = collection.get("last_modified", collection.get("lastUpdated", "unknown"))
                lines.extend([
                    f"### {name}",
                    f"- Documents: {docs} total, {active} active",
                    f"- Pattern: {pattern}",
                    f"- Included by default: {'yes' if included else 'no'}",
                    f"- Last updated: {updated}",
                ])
        else:
            lines.append("- No collections configured.")

        lines.extend(["", "## Access Policies"])
        if policies:
            for policy in policies:
                groups = ", ".join(policy.get("groups", [])) or "none"
                users = ", ".join(policy.get("users", [])) or "none"
                lines.append(
                    f"- {policy.get('collection')}: mode={policy.get('mode')}, groups={groups}, users={users}, "
                    f"expose source paths={'yes' if policy.get('exposeSourcePaths') else 'no'}"
                )
        else:
            lines.append("- No explicit access policies configured.")

        lines.extend(["", "## Contexts", f"- Configured contexts: {len(contexts)}"])

        if status.get("needsEmbedding", 0):
            lines.extend([
                "",
                "## Suggested Next Step",
                "- Run qmd_embed_documents if you want Semantic Search or Deep Search with vector retrieval.",
                "- Quick Search can still work before embeddings are generated.",
            ])

        return "\\n".join(lines)

    async def qmd_list_collections(self, __user__: Optional[dict] = None) -> dict:
        """Admin-only: list QMD collections."""
        return await self._request("GET", "/api/collections", __user__, timeout=60)

    async def qmd_add_collection(
        self,
        name: str,
        source_path: str,
        pattern: str = "**/*",
        ingest: bool = True,
        __user__: Optional[dict] = None,
    ) -> dict:
        """Admin-only: add a source folder as a QMD collection. Source files are never modified."""
        return await self._request(
            "POST",
            "/api/collections",
            __user__,
            {"name": name, "sourcePath": source_path, "pattern": pattern, "ingest": ingest},
            timeout=300,
        )

    async def qmd_remove_collection(self, name: str, __user__: Optional[dict] = None) -> dict:
        """Admin-only: remove a QMD collection reference. This does not delete source files."""
        return await self._request("DELETE", f"/api/collections/{name}", __user__, timeout=120)

    async def qmd_rename_collection(self, name: str, new_name: str, __user__: Optional[dict] = None) -> dict:
        """Admin-only: rename a QMD collection."""
        return await self._request(
            "POST",
            f"/api/collections/{name}/rename",
            __user__,
            {"newName": new_name},
            timeout=120,
        )

    async def qmd_preview_ingestion(
        self,
        collection: str,
        source_path: str,
        pattern: str = "**/*",
        ignore: Optional[List[str]] = None,
        __user__: Optional[dict] = None,
    ) -> dict:
        """Admin-only: scan a folder and preview converter decisions before indexing."""
        return await self._request(
            "POST",
            "/api/ingestion/preview",
            __user__,
            {"collection": collection, "sourceRoot": source_path, "pattern": pattern, "ignore": ignore or []},
            timeout=300,
        )

    async def qmd_convert_folder(
        self,
        collection: str,
        source_path: str,
        pattern: str = "**/*",
        ignore: Optional[List[str]] = None,
        __user__: Optional[dict] = None,
    ) -> dict:
        """Admin-only: start a conversion job for a source folder into QMDUI-generated markdown."""
        return await self._request(
            "POST",
            "/api/ingestion/convert",
            __user__,
            {"collection": collection, "sourceRoot": source_path, "pattern": pattern, "ignore": ignore or []},
            timeout=60,
        )

    async def qmd_ingestion_manifest(self, collection: str, __user__: Optional[dict] = None) -> dict:
        """Admin-only: show conversion manifest and per-file warnings/errors for a collection."""
        return await self._request("GET", f"/api/ingestion/{collection}", __user__, timeout=60)

    async def qmd_update_index(self, collections: Optional[List[str]] = None, __user__: Optional[dict] = None) -> dict:
        """Admin-only: start a QMD update job."""
        return await self._request("POST", "/api/jobs/update", __user__, {"collections": collections}, timeout=60)

    async def qmd_embed_documents(
        self,
        force: bool = False,
        provider: Optional[Literal["qmd", "ollama"]] = None,
        model: Optional[str] = None,
        max_docs_per_batch: Optional[int] = None,
        max_batch_bytes: Optional[int] = None,
        require_complete: bool = True,
        fail_on_errors: bool = True,
        __user__: Optional[dict] = None,
    ) -> dict:
        """Admin-only: start a QMD embedding job. Defaults to local CPU QMD embeddings; use provider='ollama' only when a remote endpoint is configured."""
        payload = {
            "force": force,
            "provider": provider,
            "model": model,
            "maxDocsPerBatch": max_docs_per_batch,
            "maxBatchBytes": max_batch_bytes,
            "requireComplete": require_complete,
            "failOnErrors": fail_on_errors,
        }
        return await self._request("POST", "/api/jobs/embed", __user__, payload, timeout=60)

    async def qmd_jobs(self, __user__: Optional[dict] = None) -> dict:
        """Admin-only: list QMDUI jobs."""
        return await self._request("GET", "/api/jobs", __user__, timeout=60)

    async def qmd_get_job(self, job_id: str, __user__: Optional[dict] = None) -> dict:
        """Admin-only: inspect one QMDUI job, including logs and result/error."""
        return await self._request("GET", f"/api/jobs/{job_id}", __user__, timeout=60)

    async def qmd_list_contexts(self, __user__: Optional[dict] = None) -> dict:
        """Admin-only: list QMD global and path-specific contexts."""
        return await self._request("GET", "/api/contexts", __user__, timeout=60)

    async def qmd_add_context(
        self,
        collection: str,
        context: str,
        path_prefix: str = "/",
        __user__: Optional[dict] = None,
    ) -> dict:
        """Admin-only: add QMD context for a collection/path prefix."""
        return await self._request(
            "POST",
            "/api/contexts",
            __user__,
            {"collection": collection, "pathPrefix": path_prefix, "context": context},
            timeout=120,
        )

    async def qmd_remove_context(
        self,
        collection: str,
        path_prefix: str = "/",
        __user__: Optional[dict] = None,
    ) -> dict:
        """Admin-only: remove QMD context for a collection/path prefix."""
        return await self._request(
            "DELETE",
            "/api/contexts",
            __user__,
            {"collection": collection, "pathPrefix": path_prefix},
            timeout=120,
        )

    async def qmd_test_retrieval(
        self,
        query: str,
        mode: Literal["quick", "semantic", "deep"] = "quick",
        collections: Optional[List[str]] = None,
        top_k: int = 8,
        min_score: float = 0.0,
        include_full_document: bool = False,
        __user__: Optional[dict] = None,
    ) -> dict:
        """Admin-only: run explicit Quick/Semantic/Deep retrieval diagnostics."""
        return await self._request(
            "POST",
            "/api/search/retrieve",
            __user__,
            {
                "query": query,
                "mode": mode,
                "collections": collections,
                "topK": top_k,
                "minScore": min_score,
                "includeFullDocument": include_full_document,
            },
            timeout=180,
        )

    async def qmd_get_document(
        self,
        path: str,
        from_line: Optional[int] = None,
        max_lines: Optional[int] = None,
        __user__: Optional[dict] = None,
    ) -> dict:
        """Admin-only: fetch a QMD document by generated path/doc id."""
        return await self._request(
            "POST",
            "/api/documents/get",
            __user__,
            {"path": path, "fromLine": from_line, "maxLines": max_lines},
            timeout=120,
        )

    async def qmd_list_access_policies(self, __user__: Optional[dict] = None) -> dict:
        """Admin-only: list collection access policies."""
        return await self._request("GET", "/api/access/policies", __user__, timeout=60)

    async def qmd_set_collection_access(
        self,
        collection: str,
        mode: Literal["all", "admin", "groups", "users"] = "admin",
        groups: Optional[List[str]] = None,
        users: Optional[List[str]] = None,
        expose_source_paths: bool = False,
        __user__: Optional[dict] = None,
    ) -> dict:
        """Admin-only: map a QMD collection to Open WebUI users/groups/admins."""
        return await self._request(
            "PUT",
            f"/api/access/policies/{collection}",
            __user__,
            {
                "mode": mode,
                "groups": groups or [],
                "users": users or [],
                "exposeSourcePaths": expose_source_paths,
            },
            timeout=120,
        )

    async def qmd_evaluate_access(
        self,
        collection: str,
        user_id: str = "anonymous",
        role: Literal["admin", "user", "pending"] = "user",
        groups: Optional[List[str]] = None,
        __user__: Optional[dict] = None,
    ) -> dict:
        """Admin-only: test whether a hypothetical Open WebUI user can access a collection."""
        return await self._request(
            "POST",
            "/api/access/evaluate",
            __user__,
            {"collection": collection, "userId": user_id, "role": role, "groups": groups or []},
            timeout=60,
        )
`;
}
