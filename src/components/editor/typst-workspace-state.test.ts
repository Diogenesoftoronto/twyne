import { describe, expect, test } from "bun:test";
import { isTypstProofActive } from "./typst-workspace-state";

describe("Typst workspace proof activation", () => {
  for (const [mode, split, active] of [
    ["write", false, false],
    ["write", true, true],
    ["source", false, true],
    ["source", true, true],
    ["proof", false, true],
    ["proof", true, true],
  ] as const) {
    test(`${mode} with split=${split} activates proof=${active}`, () => {
      expect(isTypstProofActive(mode, split)).toBe(active);
    });
  }

  test("opening and closing Split from Write activates only the visible proof", () => {
    expect(
      [false, true, false].map((split) => isTypstProofActive("write", split)),
    ).toEqual([false, true, false]);
  });

  test("moving from Proof to Write+Split keeps the proof active", () => {
    expect(isTypstProofActive("proof", false)).toBe(true);
    expect(isTypstProofActive("write", true)).toBe(true);
  });

  test("closing Source+Split preserves source validation", () => {
    expect(isTypstProofActive("source", true)).toBe(true);
    expect(isTypstProofActive("source", false)).toBe(true);
  });
});
