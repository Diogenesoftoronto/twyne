import { describe, expect, test } from "bun:test";
import { detectCitations } from "./citations";

describe("detectCitations", () => {
  test("trims trailing punctuation from URL and DOI citations", () => {
    const found = detectCitations(
      "See https://example.com/report). The DOI is doi:10.1234/abc.2024.",
    );

    expect(found.map((c) => [c.type, c.text])).toEqual([
      ["url", "https://example.com/report"],
      ["doi", "10.1234/abc.2024"],
    ]);
  });

  test("prefers a DOI over the overlapping doi.org URL wrapper", () => {
    const found = detectCitations("Read https://doi.org/10.5555/example.2024.");

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      type: "doi",
      text: "10.5555/example.2024",
      lookupUrl: "https://doi.org/10.5555/example.2024",
    });
  });

  test("detects parenthetical and narrative author-year citations", () => {
    const found = detectCitations(
      "The pattern is established (van der Waals & Smith, 2021: 44). Smith et al. (2020) disagree.",
    );

    expect(found.map((c) => c.text)).toEqual([
      "(van der Waals & Smith, 2021: 44)",
      "Smith et al. (2020)",
    ]);
    expect(found.map((c) => c.metadata)).toEqual([
      { author: "van der Waals & Smith", year: "2021" },
      { author: "Smith et al.", year: "2020" },
    ]);
  });

  test("applies the base offset to citation ranges and ids", () => {
    const found = detectCitations("A source [12]", 30);

    expect(found[0]).toMatchObject({
      id: "fn-39",
      from: 39,
      to: 43,
      text: "[12]",
    });
  });

  test("does not treat array indexes or month-year dates as citations", () => {
    const found = detectCitations("array[1] was updated in (May, 2020).");

    expect(found).toEqual([]);
  });
});
