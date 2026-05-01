import { homedir } from "node:os";
import path from "node:path";
import type { AppConfig } from "./types.js";

function boolEnv(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function loadConfig(): AppConfig {
  return {
    host: process.env.QMDUI_HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.QMDUI_PORT ?? "3217", 10),
    stateDir:
      process.env.QMDUI_STATE_DIR && process.env.QMDUI_STATE_DIR.trim() !== ""
        ? path.resolve(process.env.QMDUI_STATE_DIR)
        : path.join(homedir(), ".local", "state", "qmdui"),
    authMode: process.env.QMDUI_AUTH_MODE === "signed" ? "signed" : "dev",
    apiToken: process.env.QMDUI_API_TOKEN || (process.env.QMDUI_AUTH_MODE === "signed" ? undefined : "dev-token"),
    openWebuiSharedSecret: process.env.QMDUI_OPENWEBUI_SHARED_SECRET,
    enableQmdCli: boolEnv("QMDUI_ENABLE_QMD_CLI"),
    enableAdminDanger: boolEnv("QMDUI_ENABLE_ADMIN_DANGER"),
    enableExternalConverters: boolEnv("QMDUI_ENABLE_EXTERNAL_CONVERTERS"),
    qmdBin: process.env.QMDUI_QMD_BIN || "qmd"
  };
}
