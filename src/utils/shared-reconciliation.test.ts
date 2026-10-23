// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import {
  compareSharedPassages,
  resolveSharedPassages,
  sameSharedDraft,
} from "./shared-reconciliation";

const describeBrowser =
  typeof import.meta.glob === "function" ? describe : describe.skip;

describeBrowser("shared manuscript reconciliation", () => {
  test("keeps exact rich blocks, additions, removals and common anchors", () => {
    const local =
      "<h2>Title</h2><p><strong>Local</strong> first.</p><p>Anchor.</p><p>Local last.</p>";
    const shared =
      '<h2>Title</h2><p>Shared first.</p><p>Anchor.</p><p><a href="https://example.test">Shared last.</a></p>';
    const parts = compareSharedPassages(local, shared);
    expect(parts.filter((part) => part.changed)).toHaveLength(2);
    const choices = parts.map((part) =>
      part.shared.includes("Shared last")
        ? ("shared" as const)
        : ("local" as const),
    );
    const result = resolveSharedPassages(parts, choices, { html: local });
    expect(result.html).toBe(
      '<h2>Title</h2><p><strong>Local</strong> first.</p><p>Anchor.</p><p><a href="https://example.test">Shared last.</a></p>',
    );
    expect(
      resolveSharedPassages(
        parts,
        parts.map(() => "shared"),
        { html: shared },
      ).html,
    ).toBe(shared);
  });

  test("handles empty versions and formatting-only differences without losing markup", () => {
    const parts = compareSharedPassages("", "<p><em>Added</em></p>");
    expect(resolveSharedPassages(parts, ["local"], { html: "" }).html).toBe("");
    expect(resolveSharedPassages(parts, ["shared"], { html: "" }).html).toBe(
      "<p><em>Added</em></p>",
    );
    expect(
      compareSharedPassages("<p>Same</p>", "<p><strong>Same</strong></p>")[0]
        .changed,
    ).toBe(true);
  });

  test("detects native-source-only changes and preserves the selected source exactly", () => {
    const local = {
      html: "<p>Same</p>",
      typstSource: "// private source note\nSame",
    };
    const shared = {
      html: local.html,
      typstSource: "// shared source note\nSame",
    };
    expect(sameSharedDraft(local, shared)).toBe(false);
    expect(
      resolveSharedPassages(
        compareSharedPassages(local.html, shared.html),
        ["local"],
        local,
      ),
    ).toEqual(local);
  });

  test("bounds large comparisons and never drops long or repeated content", () => {
    const local = Array.from(
      { length: 600 },
      (_, i) => `<p>Local ${i}</p>`,
    ).join("");
    const shared = Array.from(
      { length: 600 },
      (_, i) => `<p>Shared ${i}</p>`,
    ).join("");
    const parts = compareSharedPassages(local, shared);
    expect(parts).toHaveLength(1);
    expect(resolveSharedPassages(parts, ["local"], { html: local }).html).toBe(
      local,
    );
    expect(
      resolveSharedPassages(parts, ["shared"], { html: shared }).html,
    ).toBe(shared);
  });
});
