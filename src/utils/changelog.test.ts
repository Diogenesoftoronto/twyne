import { describe, expect, test } from "bun:test";
import { parseChangelog } from "./changelog";

describe("parseChangelog", () => {
  test("reads versions, dates, and top-level bullets", () => {
    const entries = parseChangelog(
      [
        "# Changelog",
        "",
        "## 0.18.0",
        "<sub>2026-08-27</sub>",
        "",
        "- **My Desk turns usage into a writing history.** A new workspace.",
        "- Second highlight.",
        "  - nested detail, not a highlight",
        "",
        "## 0.17.0",
        "",
        "- Older highlight.",
        "",
      ].join("\n"),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      version: "0.18.0",
      date: "2026-08-27",
    });
    expect(entries[0].highlights).toEqual([
      "My Desk turns usage into a writing history. A new workspace.",
      "Second highlight.",
    ]);
    expect(entries[1]).toMatchObject({ version: "0.17.0", date: null });
  });

  test("trims long entries to a readable handful", () => {
    const bullets = Array.from({ length: 20 }, (_, i) => `- point ${i}`).join(
      "\n",
    );
    const [entry] = parseChangelog(
      `## 1.0.0\n<sub>2026-01-01</sub>\n\n${bullets}\n`,
    );
    expect(entry.highlights).toHaveLength(6);
  });

  test("skips sections without a version", () => {
    expect(parseChangelog("# Changelog\n\nNo releases yet.\n")).toEqual([]);
  });
});
