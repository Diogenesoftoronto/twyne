import { describe, expect, test } from "bun:test";
import { WRITING_FORMAT_SUGGESTIONS } from "./writing-formats";

describe("writing format suggestions", () => {
  test("defaults the suggestion list to Essay and offers a broad unique set", () => {
    expect(WRITING_FORMAT_SUGGESTIONS[0]).toBe("Essay");
    expect(WRITING_FORMAT_SUGGESTIONS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(WRITING_FORMAT_SUGGESTIONS).size).toBe(
      WRITING_FORMAT_SUGGESTIONS.length,
    );
  });

  test("keeps the dossier field suggestion-backed instead of a closed select", async () => {
    const source = await Bun.file(
      "src/components/onboarding/writing-format-input.tsx",
    ).text();

    expect(source).toContain('list: "twyne-writing-formats"');
    expect(source).toContain("<datalist");
    expect(source).toContain("onValueChange$(input.value)");
    expect(source).not.toContain("<select");
  });
});
