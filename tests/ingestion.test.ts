import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IngestionService } from "../src/ingestion/IngestionService.js";
import type { Collection } from "../src/types.js";

describe("ingestion", () => {
  it("converts supported files into app-owned generated markdown and leaves source intact", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "qmdui-ingest-"));
    const source = path.join(root, "source");
    const generated = path.join(root, "state", "generated", "c1");
    const manifestPath = path.join(root, "state", "manifests", "c1.json");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "note.txt"), "hello qmd\n");
    await fs.writeFile(path.join(source, "skip.bin"), Buffer.from([0, 1, 2]));
    const collection: Collection = {
      id: "c1",
      displayName: "Docs",
      sourcePath: source,
      generatedPath: generated,
      includeGlobs: ["**/*"],
      ignoreGlobs: [],
      ingestionMode: "convert",
      qmdCollectionName: "c1",
      autoConvert: false,
      autoEmbed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const service = new IngestionService(() => manifestPath);

    const manifest = await service.convert(collection);

    expect(await fs.readFile(path.join(source, "note.txt"), "utf8")).toBe("hello qmd\n");
    expect(await fs.readFile(path.join(generated, "note.txt.md"), "utf8")).toContain("qmdui_original_path");
    expect(manifest.entries.find((entry) => entry.relativePath === "skip.bin")?.warnings[0]).toContain("Unsupported");
  });
});
