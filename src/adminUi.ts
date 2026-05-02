export function adminUiHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QMDUI Admin</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f6f7f9;
        --panel: #ffffff;
        --text: #18202a;
        --muted: #667085;
        --border: #d8dee8;
        --accent: #0f766e;
        --accent-strong: #115e59;
        --danger: #b42318;
        --warn: #b7791f;
        --code: #101828;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #101418;
          --panel: #171c22;
          --text: #eceff3;
          --muted: #9aa4b2;
          --border: #2d3642;
          --accent: #2dd4bf;
          --accent-strong: #5eead4;
          --danger: #f97066;
          --warn: #f6c56b;
          --code: #f4f6f8;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 64px;
        padding: 14px 20px;
        border-bottom: 1px solid var(--border);
        background: var(--panel);
      }
      h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: 0; }
      h2 { margin: 0 0 12px; font-size: 15px; font-weight: 650; letter-spacing: 0; }
      h3 { margin: 0 0 8px; font-size: 13px; color: var(--muted); font-weight: 650; letter-spacing: 0; text-transform: uppercase; }
      main {
        display: grid;
        grid-template-columns: minmax(360px, 0.9fr) minmax(420px, 1.1fr);
        gap: 16px;
        padding: 16px;
        max-width: 1480px;
        margin: 0 auto;
      }
      section {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 14px;
        min-width: 0;
      }
      .stack { display: grid; gap: 16px; align-content: start; }
      .bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .split { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .metric {
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 10px;
        min-height: 64px;
      }
      .metric b { display: block; font-size: 20px; margin-top: 4px; }
      .metric span { color: var(--muted); font-size: 12px; }
      label { display: grid; gap: 5px; font-size: 12px; color: var(--muted); }
      input, select, textarea {
        width: 100%;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel) 94%, var(--bg));
        color: var(--text);
        border-radius: 6px;
        padding: 8px 10px;
        font: inherit;
        min-height: 36px;
      }
      textarea {
        min-height: 280px;
        resize: vertical;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--code);
      }
      button {
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel) 92%, var(--bg));
        color: var(--text);
        border-radius: 6px;
        min-height: 36px;
        padding: 0 12px;
        font: inherit;
        cursor: pointer;
        white-space: nowrap;
      }
      button.primary {
        border-color: var(--accent);
        background: var(--accent);
        color: #ffffff;
      }
      button.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
      button:disabled { cursor: wait; opacity: 0.62; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
      th { color: var(--muted); font-weight: 650; }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        word-break: break-word;
      }
      .muted { color: var(--muted); }
      .ok { color: var(--accent-strong); }
      .warn { color: var(--warn); }
      .error { color: var(--danger); }
      .list { display: grid; gap: 8px; }
      .item {
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 10px;
      }
      .item p { margin: 4px 0 0; color: var(--muted); }
      .log {
        min-height: 40px;
        max-height: 220px;
        overflow: auto;
        white-space: pre-wrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--muted);
      }
      @media (max-width: 900px) {
        header { align-items: stretch; flex-direction: column; }
        main { grid-template-columns: 1fr; padding: 10px; }
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>QMDUI Admin</h1>
      <div class="bar">
        <input id="token" type="password" autocomplete="off" placeholder="QMDUI API token" />
        <button data-action="save-token">Save Token</button>
        <button class="primary" data-action="refresh">Refresh</button>
      </div>
    </header>

    <main>
      <div class="stack">
        <section>
          <div class="split">
            <h2>Index</h2>
            <div class="bar">
              <button data-action="reload">Reload</button>
              <button class="primary" data-action="update">Update</button>
              <button data-action="embed">Embed</button>
              <button data-action="seed">Seed OpenClaw</button>
            </div>
          </div>
          <div id="metrics" class="grid"></div>
          <div id="runtime" class="list" style="margin-top: 12px;"></div>
        </section>

        <section>
          <div class="split">
            <h2>QMD Config</h2>
            <button class="primary" data-action="save-config">Save Config</button>
          </div>
          <textarea id="qmd-config" spellcheck="false"></textarea>
        </section>

        <section>
          <h2>Jobs</h2>
          <div id="jobs" class="list"></div>
        </section>
      </div>

      <div class="stack">
        <section>
          <h2>Collections</h2>
          <div id="collections"></div>
        </section>

        <section>
          <h2>Add Collection</h2>
          <div class="grid">
            <label>Name <input id="add-name" value="openclaw" /></label>
            <label>Source Path <input id="add-path" value="/data/seeds/openclaw" /></label>
            <label>Pattern <input id="add-pattern" value="**/*.md" /></label>
            <label>Ignore <input id="add-ignore" placeholder="glob, glob" /></label>
          </div>
          <div class="bar" style="margin-top: 10px;">
            <label style="display:flex; align-items:center; gap:8px;"><input id="add-ingest" type="checkbox" checked style="width:auto;" /> Ingest into generated markdown</label>
            <button class="primary" data-action="add-collection">Add</button>
          </div>
        </section>

        <section>
          <h2>Access Policy</h2>
          <div class="grid">
            <label>Collection <select id="policy-collection"></select></label>
            <label>Mode
              <select id="policy-mode">
                <option value="admin">Admin</option>
                <option value="groups">Groups</option>
                <option value="users">Users</option>
                <option value="all">All Users</option>
              </select>
            </label>
            <label>Groups <input id="policy-groups" placeholder="qa, engineering" /></label>
            <label>Users <input id="policy-users" placeholder="user-id, user-id" /></label>
          </div>
          <div class="bar" style="margin-top: 10px;">
            <label style="display:flex; align-items:center; gap:8px;"><input id="policy-expose" type="checkbox" style="width:auto;" /> Expose source paths</label>
            <button class="primary" data-action="save-policy">Save Policy</button>
          </div>
        </section>

        <section>
          <h2>Retrieval Test</h2>
          <div class="grid">
            <label>Query <input id="search-query" placeholder="deployment checklist" /></label>
            <label>Mode
              <select id="search-mode">
                <option value="quick">Quick</option>
                <option value="semantic">Semantic</option>
                <option value="deep">Deep</option>
              </select>
            </label>
          </div>
          <div class="bar" style="margin-top: 10px;">
            <button class="primary" data-action="search">Search</button>
          </div>
          <div id="search-results" class="list" style="margin-top: 12px;"></div>
        </section>

        <section>
          <h2>Events</h2>
          <div id="log" class="log"></div>
        </section>
      </div>
    </main>

    <script>
      const state = {
        token: localStorage.getItem("qmdui.token") || "",
        dashboard: null,
        collections: [],
        policies: [],
        jobs: [],
        runtime: null
      };

      const el = (id) => document.getElementById(id);
      el("token").value = state.token;

      document.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;
        const action = button.getAttribute("data-action");
        try {
          button.disabled = true;
          if (action === "save-token") saveToken();
          if (action === "refresh") await refreshAll();
          if (action === "reload") await postAndRefresh("/api/admin/reload", {});
          if (action === "update") await postAndRefresh("/api/jobs/update", {});
          if (action === "embed") await postAndRefresh("/api/jobs/embed", { force: false });
          if (action === "seed") await postAndRefresh("/api/admin/seed", {});
          if (action === "save-config") await saveConfig();
          if (action === "add-collection") await addCollection();
          if (action === "save-policy") await savePolicy();
          if (action === "search") await runSearch();
          if (action === "remove-collection") await removeCollection(button.getAttribute("data-name"));
        } catch (error) {
          log(error.message || String(error), "error");
        } finally {
          button.disabled = false;
        }
      });

      el("policy-collection").addEventListener("change", fillPolicyForm);

      async function api(path, options) {
        const init = options || {};
        const headers = Object.assign({
          "x-open-webui-role": "admin",
          "x-open-webui-user-id": "qmdui-admin"
        }, init.headers || {});
        if (state.token) headers.authorization = "Bearer " + state.token;
        if (init.body !== undefined) headers["content-type"] = "application/json";
        const response = await fetch(path, Object.assign({}, init, {
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body)
        }));
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { text }; }
        if (!response.ok) {
          const detail = data && (data.error || data.message || data.text);
          throw new Error((init.method || "GET") + " " + path + " failed with HTTP " + response.status + (detail ? ": " + detail : ""));
        }
        return data;
      }

      function saveToken() {
        state.token = el("token").value.trim();
        localStorage.setItem("qmdui.token", state.token);
        log("Token saved");
      }

      async function refreshAll() {
        const results = await Promise.all([
          api("/api/admin/runtime"),
          api("/api/dashboard"),
          api("/api/collections"),
          api("/api/access/policies"),
          api("/api/jobs"),
          api("/api/admin/qmd-config")
        ]);
        state.runtime = results[0];
        state.dashboard = results[1];
        state.collections = results[2].collections || [];
        state.policies = results[3].policies || [];
        state.jobs = results[4].jobs || [];
        el("qmd-config").value = results[5].content || "";
        renderAll();
        log("Refreshed");
      }

      async function postAndRefresh(path, body) {
        const result = await api(path, { method: "POST", body });
        log(JSON.stringify(result, null, 2));
        await refreshAll();
      }

      async function saveConfig() {
        const result = await api("/api/admin/qmd-config", {
          method: "PUT",
          body: { content: el("qmd-config").value }
        });
        log("Saved " + result.path);
        await refreshAll();
      }

      async function addCollection() {
        const payload = {
          name: el("add-name").value.trim(),
          sourcePath: el("add-path").value.trim(),
          pattern: el("add-pattern").value.trim() || undefined,
          ignore: list(el("add-ignore").value),
          ingest: el("add-ingest").checked
        };
        const result = await api("/api/collections", { method: "POST", body: payload });
        log(JSON.stringify(result, null, 2));
        await refreshAll();
      }

      async function removeCollection(name) {
        if (!name || !confirm("Remove collection " + name + "? Source files are not deleted.")) return;
        const result = await api("/api/collections/" + encodeURIComponent(name), { method: "DELETE" });
        log(JSON.stringify(result, null, 2));
        await refreshAll();
      }

      async function savePolicy() {
        const collection = el("policy-collection").value;
        if (!collection) throw new Error("Select a collection");
        const payload = {
          mode: el("policy-mode").value,
          groups: list(el("policy-groups").value),
          users: list(el("policy-users").value),
          exposeSourcePaths: el("policy-expose").checked
        };
        const result = await api("/api/access/policies/" + encodeURIComponent(collection), {
          method: "PUT",
          body: payload
        });
        log(JSON.stringify(result, null, 2));
        await refreshAll();
      }

      async function runSearch() {
        const query = el("search-query").value.trim();
        if (!query) throw new Error("Enter a query");
        const data = await api("/api/search/retrieve", {
          method: "POST",
          body: { query, mode: el("search-mode").value, topK: 5, includeFullDocument: false }
        });
        el("search-results").innerHTML = (data.results || []).map((item) => (
          '<div class="item"><b>' + h(item.title) + '</b>' +
          '<p><code>' + h(item.qmdPath || "") + '</code> score ' + h(String(item.score || 0)) + '</p>' +
          '<p>' + h(item.snippet || "") + '</p></div>'
        )).join("") || '<span class="muted">No results.</span>';
      }

      function renderAll() {
        renderMetrics();
        renderRuntime();
        renderCollections();
        renderPolicies();
        renderJobs();
      }

      function renderMetrics() {
        const status = state.dashboard && state.dashboard.status ? state.dashboard.status : {};
        const health = state.dashboard && state.dashboard.health ? state.dashboard.health : {};
        const metrics = [
          ["Collections", state.collections.length],
          ["Documents", value(status.documents, status.totalDocuments, status.docs, 0)],
          ["Needs Embedding", value(status.needsEmbedding, health.needsEmbedding, 0)],
          ["Vector", value(health.vectorIndex, status.vectorIndex, "unknown")]
        ];
        el("metrics").innerHTML = metrics.map((item) => (
          '<div class="metric"><span>' + h(item[0]) + '</span><b>' + h(String(item[1])) + '</b></div>'
        )).join("");
      }

      function renderRuntime() {
        const runtime = state.runtime || {};
        const rows = [
          ["Index", runtime.qmdIndexName],
          ["DB", runtime.qmdDbPath],
          ["Config", runtime.qmdConfigPath],
          ["Embedding", runtime.embedProvider === "qmd" ? "qmd (local CPU)" : runtime.embedProvider],
          ["Embed Model", runtime.activeEmbedModel || runtime.ollamaEmbedModel],
          ["Embed Timeout", runtime.embedTimeoutMs ? Math.round(runtime.embedTimeoutMs / 60000) + " min" : ""],
          ["Data", runtime.dataDir],
          ["Seed", runtime.seedSourceRoot]
        ];
        if (runtime.embedProvider === "ollama") {
          rows.splice(5, 0, ["Ollama", runtime.ollamaBaseUrl]);
        }
        el("runtime").innerHTML = rows.map((row) => (
          '<div class="item"><h3>' + h(row[0]) + '</h3><code>' + h(row[1] || "") + '</code></div>'
        )).join("");
      }

      function renderCollections() {
        const rows = state.collections.map((collection) => (
          '<tr><td><b>' + h(collection.name) + '</b></td>' +
          '<td><code>' + h(collection.pwd || collection.path || "") + '</code></td>' +
          '<td>' + h(String(collection.doc_count || collection.documents || 0)) + '</td>' +
          '<td><code>' + h(collection.glob_pattern || collection.pattern || "") + '</code></td>' +
          '<td><button class="danger" data-action="remove-collection" data-name="' + hAttr(collection.name) + '">Remove</button></td></tr>'
        )).join("");
        el("collections").innerHTML = '<table><thead><tr><th>Name</th><th>Path</th><th>Docs</th><th>Pattern</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
      }

      function renderPolicies() {
        const select = el("policy-collection");
        const current = select.value;
        select.innerHTML = state.collections.map((collection) => (
          '<option value="' + hAttr(collection.name) + '">' + h(collection.name) + '</option>'
        )).join("");
        if (current) select.value = current;
        fillPolicyForm();
      }

      function fillPolicyForm() {
        const collection = el("policy-collection").value;
        const policy = state.policies.find((item) => item.collection === collection) || {};
        el("policy-mode").value = policy.mode || "admin";
        el("policy-groups").value = (policy.groups || []).join(", ");
        el("policy-users").value = (policy.users || []).join(", ");
        el("policy-expose").checked = Boolean(policy.exposeSourcePaths);
      }

      function renderJobs() {
        const jobs = state.jobs.slice().reverse().slice(0, 8);
        el("jobs").innerHTML = jobs.map((job) => (
          '<div class="item"><div class="split"><b>' + h(job.type) + '</b><span class="' + jobClass(job.status) + '">' + h(job.status) + '</span></div>' +
          '<p>' + h(job.id) + '</p>' +
          '<pre class="log">' + h((job.logs || []).slice(-8).join("\\n")) + '</pre></div>'
        )).join("") || '<span class="muted">No jobs yet.</span>';
      }

      function jobClass(status) {
        if (status === "completed") return "ok";
        if (status === "failed") return "error";
        if (status === "running") return "warn";
        return "muted";
      }

      function log(message, level) {
        const box = el("log");
        const prefix = new Date().toLocaleTimeString() + " ";
        box.textContent = prefix + message + "\\n" + box.textContent;
        box.className = "log" + (level === "error" ? " error" : "");
      }

      function list(value) {
        return (value || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
      }

      function value() {
        for (const item of arguments) {
          if (item !== undefined && item !== null && item !== "") return item;
        }
        return "";
      }

      function h(value) {
        return String(value == null ? "" : value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function hAttr(value) {
        return h(value).replaceAll("'", "&#39;");
      }

      refreshAll().catch((error) => log(error.message || String(error), "error"));
    </script>
  </body>
</html>`;
}
