import { describe, expect, test } from "bun:test";
import { isEnglishLanguage, scalarOffsetToCodeUnit } from "./grammar";

describe("isEnglishLanguage", () => {
  test("accepts only English language tags", () => {
    expect(isEnglishLanguage("en")).toBe(true);
    expect(isEnglishLanguage("en-CA")).toBe(true);
    expect(isEnglishLanguage("EN_us")).toBe(true);
    expect(isEnglishLanguage("fr-CA")).toBe(false);
    expect(isEnglishLanguage("")).toBe(false);
  });
});

describe("Harper span conversion", () => {
  test("keeps ordinary character offsets unchanged", () => {
    expect(scalarOffsetToCodeUnit("plain prose", 6)).toBe(6);
  });

  test("maps Unicode scalar offsets onto JavaScript UTF-16 positions", () => {
    expect(scalarOffsetToCodeUnit("A🙂 typo", 2)).toBe(3);
    expect(scalarOffsetToCodeUnit("A🙂 typo", 7)).toBe(8);
  });

  test("clamps offsets beyond the end of the string", () => {
    expect(scalarOffsetToCodeUnit("draft", 99)).toBe(5);
  });
});
