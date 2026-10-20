import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";
import {
  extractQuotations,
  groundQuotations,
  linkQuotations,
  resolveQuotation,
} from "./quote-grounding";

const MANUSCRIPT = [
  "Mara promised her brother she would come back before the thaw.",
  "",
  "The ferry left without her. She watched the lights go out across the water, and she didn’t wave.",
  "",
  "By spring the house was empty. Nobody asked where she had gone.",
].join("\n");

describe("extractQuotations", () => {
  it("finds every quoted passage in a note, in order", () => {
    const note =
      'You open with “she would come back before the thaw” and then “The ferry left without her.” Later, "the house was empty" pays it off.';
    expect(extractQuotations(note).map((q) => q.quote)).toEqual([
      "she would come back before the thaw",
      "The ferry left without her",
      "the house was empty",
    ]);
  });

  it("ignores scare-quoted single words and apostrophes", () => {
    expect(
      extractQuotations("This feels ‘intentional’ but don’t worry, it’s fine."),
    ).toEqual([]);
  });

  it("reads Markdown block quotes", () => {
    expect(
      extractQuotations(
        "Look at this:\n> Nobody asked where she had gone.\nIt lands.",
      ).map((q) => q.quote),
    ).toEqual(["Nobody asked where she had gone"]);
  });
});

describe("resolveQuotation", () => {
  it("matches across curly quotes, case and trailing punctuation", () => {
    const r = resolveQuotation("She didn't wave.", MANUSCRIPT);
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(MANUSCRIPT.slice(r.from, r.to)).toBe("she didn’t wave");
  });

  it("follows an elided quotation to one passage", () => {
    const r = resolveQuotation(
      "She watched the lights … she didn't wave",
      MANUSCRIPT,
    );
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(MANUSCRIPT.slice(r.from, r.to)).toMatch(/^She watched.*wave$/);
  });

  it("does not match across paragraphs", () => {
    expect(resolveQuotation("before the thaw. The ferry", MANUSCRIPT)).toEqual({
      status: "unmatched",
    });
  });

  it("leaves words not in the draft unresolved", () => {
    expect(resolveQuotation("she never came home", MANUSCRIPT).status).toBe(
      "unmatched",
    );
  });

  it("uses the note's surrounding words to pick a repeated phrase", () => {
    const doc =
      "At the harbour the bell rang twice and the gulls lifted.\n\nAt the funeral the bell rang twice and nobody moved.";
    const r = resolveQuotation(
      "the bell rang twice",
      doc,
      "At the funeral, when the mourners hold still,",
    );
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(r.from).toBeGreaterThan(doc.indexOf("funeral"));
  });

  it("refuses to guess between repeats the note does not distinguish", () => {
    const doc = "the bell rang twice.\n\nthe bell rang twice.";
    expect(resolveQuotation("the bell rang twice", doc, "this line")).toEqual({
      status: "ambiguous",
      count: 2,
    });
  });
});

describe("linkQuotations", () => {
  it("links each of three quotations to its own passage", () => {
    const note =
      "“she would come back before the thaw”, then “The ferry left without her”, and finally “Nobody asked where she had gone”.";
    const grounded = groundQuotations(note, MANUSCRIPT);
    expect(grounded.map((q) => q.resolution.status)).toEqual([
      "resolved",
      "resolved",
      "resolved",
    ]);
    const starts = grounded.map((q) =>
      q.resolution.status === "resolved" ? q.resolution.from : -1,
    );
    expect(new Set(starts).size).toBe(3);
    const html = linkQuotations(renderMarkdown(note), grounded);
    expect(html.match(/class="quote-link"/g)).toHaveLength(3);
  });

  it("marks quotations that cannot be found, with a reason", () => {
    const note = "You wrote “she never came home” here.";
    const html = linkQuotations(
      renderMarkdown(note),
      groundQuotations(note, MANUSCRIPT),
    );
    expect(html).toContain('class="quote-unresolved"');
    expect(html).not.toContain("quote-link");
  });

  it("links quotations containing apostrophes", () => {
    const note = "The beat “she didn't wave” is doing the work.";
    const html = linkQuotations(
      renderMarkdown(note),
      groundQuotations(note, MANUSCRIPT),
    );
    expect(html).toContain('class="quote-link"');
  });
});
