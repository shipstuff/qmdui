import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(rootDir, "node_modules/@tobilu/qmd/dist/store.js");

if (!existsSync(target)) {
  console.warn("[patch-qmd-embed-timeout] @tobilu/qmd dist/store.js not found; skipping");
  process.exit(0);
}

let source = readFileSync(target, "utf8");

if (source.includes("getQmduiEmbedSessionMaxDurationMs")) {
  process.exit(0);
}

const helperMarker = "/**\n * Generate vector embeddings for documents that need them.";
const helper = `function getQmduiEmbedSessionMaxDurationMs() {
    const value = process.env.QMDUI_EMBED_TIMEOUT_MS ?? process.env.QMD_EMBED_TIMEOUT_MS;
    if (value === undefined || value === "")
        return 30 * 60 * 1000;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 60 * 1000;
}
`;

if (!source.includes(helperMarker)) {
  throw new Error("[patch-qmd-embed-timeout] failed to find helper insertion point");
}
source = source.replace(helperMarker, `${helper}${helperMarker}`);

const oldCall = "    }, { maxDuration: 30 * 60 * 1000, name: 'generateEmbeddings' });";
const newCall = "    }, { maxDuration: getQmduiEmbedSessionMaxDurationMs(), name: 'generateEmbeddings' });";

if (!source.includes(oldCall)) {
  throw new Error("[patch-qmd-embed-timeout] failed to find generateEmbeddings session timeout");
}
source = source.replace(oldCall, newCall);

writeFileSync(target, source);
console.log("[patch-qmd-embed-timeout] patched @tobilu/qmd generateEmbeddings timeout");
