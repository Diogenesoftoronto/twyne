import { describe, expect, test } from "bun:test";
import { applyDocumentMeta, computeDocumentMeta, countWords } from "./document";

/**
 * `countWords` replaced `text.trim().split(/\s+/).filter(Boolean).length`,
 * which allocated one string per word in the manuscript on every keystroke.
 * These pin the behaviour of the scanning version to the version it replaced.
 */
describe("countWords", () => {
  test("counts words separated by single spaces", () => {
    expect(countWords("one two three")).toBe(3);
  });

  test("is zero for empty and whitespace-only input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("\n\n\t ")).toBe(0);
  });

  test("collapses runs of whitespace rather than counting empties", () => {
    expect(countWords("  one   two  ")).toBe(2);
    expect(countWords("one\n\ntwo\tthree\r\nfour")).toBe(4);
  });

  test("treats a non-breaking space as a separator", () => {
    // Tiptap emits NBSP for a run of spaces, so counting it as part of a word
    // would silently merge two words into one.
    expect(countWords("one two")).toBe(2);
  });

  test("counts punctuation-only tokens, matching the split it replaced", () => {
    expect(countWords("hello — world")).toBe(3);
  });

  test("agrees with the naive split on prose", () => {
    const prose =
      "The manuscript, once mirrored to disk, is\nno longer at risk.  ";
    const naive = prose.trim().split(/\s+/).filter(Boolean).length;
    expect(countWords(prose)).toBe(naive);
  });
});

describe("computeDocumentMeta", () => {
  test("derives a title from a markdown heading", () => {
    expect(computeDocumentMeta("# The Wreck\n\nBody text.").title).toBe(
      "The Wreck",
    );
  });

  test("falls back to the first sentence", () => {
    expect(computeDocumentMeta("A plain opening. Then more.").title).toBe(
      "A plain opening",
    );
  });

  test("reading time is at least one minute", () => {
    expect(computeDocumentMeta("word").readingTime).toBe(1);
  });
});

describe("applyDocumentMeta", () => {
  test("writes changed fields into the existing object", () => {
    const meta = computeDocumentMeta("# Old\n\nsome words here");
    const before = meta;
    applyDocumentMeta(meta, "# New\n\nsome words here now");

    // Same object — replacing it would invalidate every Qwik subscriber that
    // reads any field, which is the thing this function exists to avoid.
    expect(meta).toBe(before);
    expect(meta.title).toBe("New");
    // "#", "New", "some", "words", "here", "now" — the heading marker is its
    // own token, exactly as it was under the split this replaced.
    expect(meta.wordCount).toBe(6);
  });

  test("leaves untouched fields strictly equal", () => {
    const meta = computeDocumentMeta("# Title\n\nalpha beta");
    const title = meta.title;
    // Same word count, different characters: only characterCount moves.
    applyDocumentMeta(meta, "# Title\n\nalpha gamma");
    expect(meta.title).toBe(title);
    expect(meta.wordCount).toBe(4);
  });
});
