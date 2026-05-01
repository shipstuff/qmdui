export function pipePython(): string {
  return `"""
QMDUI Open WebUI Pipe.

Install in Open WebUI as a Pipe/Function. Configure valves with the QMDUI URL,
API token, and trusted identity headers supplied by Open WebUI/admin setup.
"""

from pydantic import BaseModel, Field
import requests


class Pipe:
    class Valves(BaseModel):
        QMDUI_BASE_URL: str = Field(default="http://127.0.0.1:3217")
        QMDUI_API_TOKEN: str = Field(default="dev-token")
        OPENWEBUI_BASE_URL: str = Field(default="http://localhost:3000")
        OPENWEBUI_API_KEY: str = Field(default="")
        OPENWEBUI_MODEL_ID: str = Field(default="")
        QMDUI_MODE: str = Field(default="deep")
        QMDUI_TOP_K: int = Field(default=8)
        RETURN_CONTEXT_ONLY: bool = Field(default=True)
        USER_ID_HEADER: str = Field(default="x-open-webui-user-id")
        ROLE_HEADER: str = Field(default="x-open-webui-role")
        GROUPS_HEADER: str = Field(default="x-open-webui-groups")

    def __init__(self):
        self.valves = self.Valves()

    def pipes(self):
        return [{"id": "qmd-assistant", "name": "QMD Assistant"}]

    def pipe(self, body: dict, __user__: dict = None):
        messages = body.get("messages", [])
        prompt = messages[-1].get("content", "") if messages else ""
        user = __user__ or {}
        headers = {
            "Authorization": f"Bearer {self.valves.QMDUI_API_TOKEN}",
            "x-open-webui-user-id": str(user.get("id", "openwebui-user")),
            "x-open-webui-user-email": str(user.get("email", "")),
            "x-open-webui-role": str(user.get("role", "user")),
            "x-open-webui-groups": ",".join(user.get("groups", [])) if isinstance(user.get("groups"), list) else str(user.get("groups", "")),
        }
        response = requests.post(
            f"{self.valves.QMDUI_BASE_URL}/api/search/{self.valves.QMDUI_MODE}",
            headers=headers,
            json={"query": prompt, "limit": self.valves.QMDUI_TOP_K},
            timeout=60,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
        context = "\\n\\n".join(
            f"[{idx + 1}] {item.get('title') or item.get('id')}\\n{item.get('snippet') or ''}"
            for idx, item in enumerate(results)
        )
        citations = "\\n".join(
            f"[{idx + 1}] {item.get('citation', {}).get('collectionName')} / {item.get('citation', {}).get('title') or item.get('citation', {}).get('qmdPath') or item.get('id')}"
            for idx, item in enumerate(results)
        )
        grounded_prompt = f"Use this QMD context to answer the user. Include bracketed citations.\\n\\n{context}\\n\\nCitations:\\n{citations}\\n\\nUser question: {prompt}"
        if self.valves.RETURN_CONTEXT_ONLY or not self.valves.OPENWEBUI_MODEL_ID or not self.valves.OPENWEBUI_API_KEY:
            return grounded_prompt
        chat = requests.post(
            f"{self.valves.OPENWEBUI_BASE_URL}/api/chat/completions",
            headers={"Authorization": f"Bearer {self.valves.OPENWEBUI_API_KEY}"},
            json={"model": self.valves.OPENWEBUI_MODEL_ID, "messages": [{"role": "user", "content": grounded_prompt}]},
            timeout=120,
        )
        chat.raise_for_status()
        data = chat.json()
        return data.get("choices", [{}])[0].get("message", {}).get("content", grounded_prompt)
`;
}

export function adminFunctionPython(): string {
  return `"""
QMDUI admin helper for Open WebUI Functions.
Limit this function to Open WebUI admins. It calls QMDUI admin endpoints.
"""

from pydantic import BaseModel, Field
import requests


class Tools:
    class Valves(BaseModel):
        QMDUI_BASE_URL: str = Field(default="http://127.0.0.1:3217")
        QMDUI_API_TOKEN: str = Field(default="dev-token")

    def __init__(self):
        self.valves = self.Valves()

    def _headers(self, user):
        return {
            "Authorization": f"Bearer {self.valves.QMDUI_API_TOKEN}",
            "x-open-webui-user-id": str(user.get("id", "admin")),
            "x-open-webui-role": "admin",
            "x-open-webui-groups": ",".join(user.get("groups", [])) if isinstance(user.get("groups"), list) else "",
        }

    def qmd_dashboard(self, __user__: dict = None) -> dict:
        r = requests.get(f"{self.valves.QMDUI_BASE_URL}/api/dashboard", headers=self._headers(__user__ or {}), timeout=15)
        r.raise_for_status()
        return r.json()

    def qmd_list_collections(self, __user__: dict = None) -> dict:
        r = requests.get(f"{self.valves.QMDUI_BASE_URL}/api/collections", headers=self._headers(__user__ or {}), timeout=15)
        r.raise_for_status()
        return r.json()

    def qmd_add_collection(self, display_name: str, source_path: str, include_globs: list[str] = None, ignore_globs: list[str] = None, __user__: dict = None) -> dict:
        payload = {"displayName": display_name, "sourcePath": source_path}
        if include_globs is not None:
            payload["includeGlobs"] = include_globs
        if ignore_globs is not None:
            payload["ignoreGlobs"] = ignore_globs
        r = requests.post(f"{self.valves.QMDUI_BASE_URL}/api/collections", headers=self._headers(__user__ or {}), json=payload, timeout=15)
        r.raise_for_status()
        return r.json()

    def qmd_update_collection(self, collection_id: str, patch: dict, __user__: dict = None) -> dict:
        r = requests.patch(f"{self.valves.QMDUI_BASE_URL}/api/collections/{collection_id}", headers=self._headers(__user__ or {}), json=patch, timeout=15)
        r.raise_for_status()
        return r.json()

    def qmd_remove_collection(self, collection_id: str, __user__: dict = None) -> dict:
        r = requests.delete(f"{self.valves.QMDUI_BASE_URL}/api/collections/{collection_id}", headers=self._headers(__user__ or {}), timeout=15)
        r.raise_for_status()
        return r.json()

    def qmd_preview_ingestion(self, collection_id: str, __user__: dict = None) -> dict:
        r = requests.post(f"{self.valves.QMDUI_BASE_URL}/api/ingestion/preview", headers=self._headers(__user__ or {}), json={"collectionId": collection_id}, timeout=15)
        r.raise_for_status()
        return r.json()

    def qmd_convert_collection(self, collection_id: str, __user__: dict = None) -> dict:
        r = requests.post(f"{self.valves.QMDUI_BASE_URL}/api/ingestion/convert", headers=self._headers(__user__ or {}), json={"collectionId": collection_id}, timeout=15)
        r.raise_for_status()
        return r.json()

    def qmd_update_index(self, collection_ids: list[str] = None, __user__: dict = None) -> dict:
        r = requests.post(f"{self.valves.QMDUI_BASE_URL}/api/jobs/update", headers=self._headers(__user__ or {}), json={"collectionIds": collection_ids or []}, timeout=15)
        r.raise_for_status()
        return r.json()

    def qmd_embed(self, collection_ids: list[str] = None, __user__: dict = None) -> dict:
        r = requests.post(f"{self.valves.QMDUI_BASE_URL}/api/jobs/embed", headers=self._headers(__user__ or {}), json={"collectionIds": collection_ids or []}, timeout=15)
        r.raise_for_status()
        return r.json()

    def qmd_jobs(self, __user__: dict = None) -> dict:
        r = requests.get(f"{self.valves.QMDUI_BASE_URL}/api/jobs", headers=self._headers(__user__ or {}), timeout=15)
        r.raise_for_status()
        return r.json()

    def qmd_job(self, job_id: str, __user__: dict = None) -> dict:
        r = requests.get(f"{self.valves.QMDUI_BASE_URL}/api/jobs/{job_id}", headers=self._headers(__user__ or {}), timeout=15)
        r.raise_for_status()
        return r.json()

    def qmd_test_retrieval(self, query: str, mode: str = "quick", collection_ids: list[str] = None, __user__: dict = None) -> dict:
        r = requests.post(f"{self.valves.QMDUI_BASE_URL}/api/search/{mode}", headers=self._headers(__user__ or {}), json={"query": query, "collections": collection_ids or []}, timeout=60)
        r.raise_for_status()
        return r.json()

    def qmd_set_policy(self, collection_id: str, mode: str, groups: list[str] = None, users: list[str] = None, expose_source_paths: bool = False, __user__: dict = None) -> dict:
        payload = {"mode": mode, "groups": groups or [], "users": users or [], "exposeSourcePaths": expose_source_paths}
        r = requests.put(f"{self.valves.QMDUI_BASE_URL}/api/access/policies/{collection_id}", headers=self._headers(__user__ or {}), json=payload, timeout=15)
        r.raise_for_status()
        return r.json()
`;
}
