import { describe, expect, test } from "bun:test";
import type { DetectedCitation } from "../types";
import {
  buildBibEntryFromFormattedCitation,
  formatCitation,
  footnoteCite,
  hasResolvableUrl,
  formatMla,
} from "./bibliography";

const citation: DetectedCitation = {
  id: "doi-12",
  text: "10.1234/example",
  from: 12,
  to: 27,
  type: "doi",
  lookupUrl: "https://doi.org/10.1234/example",
};

describe("bibliography citation formatting", () => {
  test("preserves AI-formatted text, date, year, and style", () => {
    const entry = buildBibEntryFromFormattedCitation(
      citation,
      {
        title: "Against Flat Sources",
        author: "Rivera, Mara",
        year: "2024",
        date: "2024",
        url: "https://example.com/source",
        doi: "10.1234/example",
        publisher: "Example Press",
        formatted:
          "Rivera, Mara. \"Against Flat Sources.\" Example Press, 2024.",
        style: "mla",
      },
      "folio-active",
      1234,
    );

    expect(entry).toMatchObject({
      id: "ai-fmt-folio-active-doi-12",
      folioId: "folio-active",
      year: "2024",
      date: "2024",
      style: "mla",
      formattedCitation:
        "Rivera, Mara. \"Against Flat Sources.\" Example Press, 2024.",
      accessedAt: 1234,
      createdAt: 1234,
    });
    expect(formatCitation(entry, "mla")).toBe(
      "Rivera, Mara. \"Against Flat Sources.\" Example Press, 2024.",
    );
  });

  test("does not reuse AI-formatted text for a different requested style", () => {
    const entry = buildBibEntryFromFormattedCitation(
      citation,
      {
        title: "Against Flat Sources",
        author: "Rivera, Mara",
        year: "2024",
        formatted: "MLA-only formatted citation.",
        style: "mla",
      },
      "folio-active",
      1234,
    );

    expect(formatCitation(entry, "apa")).not.toBe("MLA-only formatted citation.");
    expect(formatCitation(entry, "apa")).toContain("(2024)");
  });

  test("uses the explicit year for inserted short cites", () => {
    const entry = buildBibEntryFromFormattedCitation(
      citation,
      {
        title: "Against Flat Sources",
        author: "Rivera, Mara",
        year: "2024",
        style: "apa",
      },
      "folio-active",
    );

    expect(footnoteCite(entry, "apa")).toBe("(Rivera, 2024)");
  });

  test("formats entries without a URL without adding an empty retrieved line", () => {
    const entry = buildBibEntryFromFormattedCitation(
      { ...citation, lookupUrl: undefined },
      {
        title: "Against Flat Sources",
        author: "Rivera, Mara",
        year: "2024",
        style: "apa",
      },
      "folio-active",
    );

    expect(formatCitation(entry, "apa")).toBe(
      "Rivera, Mara (2024). Against Flat Sources.",
    );
  });

  test("does not treat a blank URL as resolvable", () => {
    expect(hasResolvableUrl("")).toBe(false);
    expect(hasResolvableUrl("   ")).toBe(false);
    expect(hasResolvableUrl("https://example.com")).toBe(true);
  });

  test("omits the accessed URL line from MLA when the entry has no URL", () => {
    const entry = buildBibEntryFromFormattedCitation(
      { ...citation, lookupUrl: undefined },
      {
        title: "Against Flat Sources",
        author: "Rivera, Mara",
        year: "2024",
        style: "mla",
      },
      "folio-active",
      1234,
    );

    expect(formatMla(entry)).toBe('Rivera, Mara. "Against Flat Sources." 2024,');
    expect(formatMla(entry)).not.toContain("accessed");
  });
});
