import { describe, expect, it } from "vitest";
import { matchesAny } from "../src/ingestion/glob.js";

describe("glob matching", () => {
  it("matches recursive includes and ignores", () => {
    expect(matchesAny("docs/a.md", ["**/*.md"])).toBe(true);
    expect(matchesAny("node_modules/pkg/index.js", ["**/node_modules/**"])).toBe(true);
    expect(matchesAny("docs/a.md", ["**/*.txt"])).toBe(false);
  });
});
