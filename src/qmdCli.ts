import { spawn } from "node:child_process";
import type { AppConfig, SearchMode, SearchRequest } from "./types.js";

export class QmdCli {
  constructor(private readonly config: AppConfig) {}

  private assertCliEnabled(): void {
    if (!this.config.enableQmdCli) {
      throw Object.assign(new Error("QMD CLI fallback is disabled. Set QMDUI_ENABLE_QMD_CLI=true to enable audited qmd subprocess calls."), {
        statusCode: 503
      });
    }
  }

  assertAdminDangerEnabled(): void {
    if (!this.config.enableAdminDanger) {
      throw Object.assign(new Error("Admin-dangerous QMD operations are disabled. Set QMDUI_ENABLE_ADMIN_DANGER=true after reviewing deployment risk."), {
        statusCode: 403
      });
    }
  }

  run(args: string[], options: { cwd?: string; signal?: AbortSignal } = {}): Promise<{ stdout: string; stderr: string }> {
    this.assertCliEnabled();
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.qmdBin, args, {
        cwd: options.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        signal: options.signal
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(Object.assign(new Error(`qmd exited with code ${code}: ${stderr || stdout}`), { statusCode: 502 }));
      });
    });
  }

  async search(mode: SearchMode, request: SearchRequest, collectionNames: string[]): Promise<unknown[]> {
    const command = mode === "quick" ? "search" : mode === "semantic" ? "vsearch" : "query";
    const args = [command, request.query, "--json", "--limit", String(request.limit ?? 8)];
    for (const collection of collectionNames) {
      args.push("--collection", collection);
    }
    const { stdout } = await this.run(args);
    try {
      const parsed = JSON.parse(stdout);
      return Array.isArray(parsed) ? parsed : parsed.results ?? [];
    } catch {
      return stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ title: line, snippet: line }));
    }
  }

  async update(collectionNames: string[]): Promise<string> {
    this.assertAdminDangerEnabled();
    const args = ["update"];
    for (const collection of collectionNames) args.push("--collection", collection);
    return (await this.run(args)).stdout;
  }

  async embed(collectionNames: string[]): Promise<string> {
    this.assertAdminDangerEnabled();
    const args = ["embed"];
    for (const collection of collectionNames) args.push("--collection", collection);
    return (await this.run(args)).stdout;
  }
}
