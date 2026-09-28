import { describe, expect, test } from "bun:test";
import {
  isEnglishLanguage,
  scalarOffsetToCodeUnit,
  matchesGrammarChoice,
  getGrammarChoices,
  rememberGrammarChoice,
  forgetGrammarChoice,
} from "./grammar";

describe("intentional grammar choices", () => {
  test("matches wording and explanation without suppressing an entire rule", () => {
    const choice = {
      problem: "my wording",
      kind: "Grammar",
      message: "Check agreement",
    };
    expect(matchesGrammarChoice({ ...choice }, choice)).toBe(true);
    expect(
      matchesGrammarChoice({ ...choice, problem: "other wording" }, choice),
    ).toBe(false);
    expect(
      matchesGrammarChoice({ ...choice, message: "Check tense" }, choice),
    ).toBe(false);
  });

  test("persists, deduplicates, and removes intentional choices", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        },
      },
    });
    try {
      const choice = {
        problem: "Twyne",
        kind: "Spelling",
        message: "Unknown word",
      };
      rememberGrammarChoice(choice);
      rememberGrammarChoice(choice);
      expect(getGrammarChoices()).toEqual([choice]);
      forgetGrammarChoice(choice);
      expect(getGrammarChoices()).toEqual([]);
      values.set("twyne:grammar-dictionary:v1", "broken json");
      expect(getGrammarChoices()).toEqual([]);
    } finally {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
});

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
