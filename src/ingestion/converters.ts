import fs from "node:fs/promises";
import path from "node:path";

export type PipelineId = "markdown-passthrough" | "plain-text" | "unsupported";

const markdownExtensions = new Set([".md", ".mdx", ".markdown"]);
const plainTextExtensions = new Set([
  ".txt",
  ".log",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".sh",
  ".sql"
]);

export function choosePipeline(filePath: string): PipelineId {
  const extension = path.extname(filePath).toLowerCase();
  if (markdownExtensions.has(extension)) return "markdown-passthrough";
  if (plainTextExtensions.has(extension)) return "plain-text";
  return "unsupported";
}

export async function convertToMarkdown(input: {
  filePath: string;
  relativePath: string;
  pipelineId: PipelineId;
  metadata: Record<string, string>;
}): Promise<{ content: string; warnings: string[] }> {
  if (input.pipelineId === "unsupported") {
    return { content: "", warnings: [`Unsupported file type for ${input.relativePath}`] };
  }
  const raw = await fs.readFile(input.filePath, "utf8");
  const frontmatter = [
    "---",
    `qmdui_original_path: ${JSON.stringify(input.metadata.originalPath)}`,
    `qmdui_relative_path: ${JSON.stringify(input.relativePath)}`,
    `qmdui_source_extension: ${JSON.stringify(input.metadata.extension)}`,
    `qmdui_source_modified_at: ${JSON.stringify(input.metadata.modifiedAt)}`,
    `qmdui_converted_at: ${JSON.stringify(input.metadata.convertedAt)}`,
    `qmdui_converter: ${JSON.stringify(input.pipelineId)}`,
    `qmdui_content_hash: ${JSON.stringify(input.metadata.hash)}`,
    "---",
    ""
  ].join("\n");

  if (input.pipelineId === "markdown-passthrough") {
    return { content: `${frontmatter}${raw}`, warnings: [] };
  }

  const extension = path.extname(input.filePath).toLowerCase();
  const fence = [".json", ".jsonl", ".yaml", ".yml", ".toml", ".xml", ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".sh", ".sql"].includes(extension);
  const language = extension.replace(/^\./, "") || "text";
  const body = fence ? ["```" + language, raw, "```", ""].join("\n") : raw;
  return { content: `${frontmatter}# ${input.relativePath}\n\n${body}`, warnings: [] };
}
