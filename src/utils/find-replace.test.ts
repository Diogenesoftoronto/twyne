import { describe, expect, test } from "bun:test";
import {
  findTextMatches,
  nextMatchIndex,
  previousMatchIndex,
  replacementForMatch,
  wrapMatchIndex,
} from "./find-replace";

describe("findTextMatches", () => {
  test("finds literal matches in reading order and ignores case by default", () => {
    expect(findTextMatches("One one ONE", "one").matches).toEqual([
      { from: 0, to: 3, text: "One" },
      { from: 4, to: 7, text: "one" },
      { from: 8, to: 11, text: "ONE" },
    ]);
  });

  test("supports case-sensitive and whole-word modes", () => {
    expect(
      findTextMatches("cat Cat scatter cat", "cat", {
        caseSensitive: true,
        wholeWord: true,
      }).matches,
    ).toEqual([
      { from: 0, to: 3, text: "cat" },
      { from: 16, to: 19, text: "cat" },
    ]);
  });

  test("treats regex syntax literally unless regex mode is enabled", () => {
    expect(findTextMatches("a.c abc", "a.c").matches).toEqual([
      { from: 0, to: 3, text: "a.c" },
    ]);
    expect(
      findTextMatches("a.c abc", "a.c", { regex: true }).matches.map(
        (match) => match.text,
      ),
    ).toEqual(["a.c", "abc"]);
  });

  test("reports invalid regular expressions without throwing", () => {
    const result = findTextMatches("text", "[", { regex: true });
    expect(result.matches).toEqual([]);
    expect(result.error).toBeString();
  });

  test("empty searches are an explicit no-op", () => {
    expect(findTextMatches("anything", "")).toEqual({
      matches: [],
      error: null,
    });
  });

  test("zero-width regex matches terminate and advance by Unicode code point", () => {
    expect(
      findTextMatches("😀a", "(?=.)", { regex: true }).matches.map(
        (match) => match.from,
      ),
    ).toEqual([0, 2]);
  });
});

describe("navigation helpers", () => {
  const matches = [
    { from: 2, to: 5 },
    { from: 8, to: 11 },
  ];

  test("wraps positive and negative indexes", () => {
    expect(wrapMatchIndex(2, 2)).toBe(0);
    expect(wrapMatchIndex(-1, 2)).toBe(1);
    expect(wrapMatchIndex(0, 0)).toBe(-1);
  });

  test("chooses next and previous positions with wraparound", () => {
    expect(nextMatchIndex(matches, 6)).toBe(1);
    expect(nextMatchIndex(matches, 20)).toBe(0);
    expect(previousMatchIndex(matches, 7)).toBe(0);
    expect(previousMatchIndex(matches, 0)).toBe(1);
  });
});

describe("replacementForMatch", () => {
  test("literal replacement strings keep dollar signs literal", () => {
    expect(replacementForMatch("cat", "cat", "$&", {}).replacement).toBe("$&");
  });

  test("regex replacement expands capture references", () => {
    expect(
      replacementForMatch("Ada Lovelace", "(\\w+) (\\w+)", "$2, $1", {
        regex: true,
      }).replacement,
    ).toBe("Lovelace, Ada");
  });
});
