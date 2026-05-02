import { constants, access } from "node:fs/promises";
import { extname } from "node:path";

export type ConverterPlan = {
  id: string;
  outputExtension: ".md";
  binary: boolean;
  available: boolean;
  reason?: string;
};

const markdownExts = new Set([".md", ".mdx", ".markdown"]);
const textExts = new Set([
  ".txt", ".log", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".toml",
  ".xml", ".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go",
  ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".sh", ".sql",
]);
const pandocExts = new Set([".docx", ".odt", ".rtf", ".epub"]);

export async function planConverter(path: string): Promise<ConverterPlan> {
  const ext = extname(path).toLowerCase();
  if (markdownExts.has(ext)) {
    return { id: "markdown-passthrough", outputExtension: ".md", binary: false, available: true };
  }
  if (textExts.has(ext)) {
    return { id: "plain-text", outputExtension: ".md", binary: false, available: true };
  }
  if (pandocExts.has(ext)) {
    const available = await executableExists("pandoc");
    return {
      id: "pandoc-markdown",
      outputExtension: ".md",
      binary: true,
      available,
      reason: available ? undefined : "pandoc is not available on PATH",
    };
  }
  if (ext === ".pdf") {
    const available = await executableExists("pdftotext");
    return {
      id: "pdf-text",
      outputExtension: ".md",
      binary: true,
      available,
      reason: available ? undefined : "pdftotext is not available on PATH",
    };
  }
  return {
    id: "unsupported",
    outputExtension: ".md",
    binary: true,
    available: false,
    reason: `Unsupported file extension: ${ext || "(none)"}`,
  };
}

async function executableExists(command: string): Promise<boolean> {
  const paths = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of paths) {
    try {
      await access(`${dir}/${command}`, constants.X_OK);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}
