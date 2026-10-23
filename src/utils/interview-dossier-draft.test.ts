// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  isPlaceholderAnswer,
  normalizeInterviewDossierDraft,
} from "./interview-dossier-draft";

describe("isPlaceholderAnswer", () => {
  test.each([
    "unspecified",
    "Unknown",
    "none stated",
    "Not specified.",
    "n/a",
    "N/A",
    "TBD",
    "tbd...",
    '"unspecified"',
    "(not stated)",
    "unclear",
    "  ",
    "—",
  ])("%j is a placeholder", (value) => {
    expect(isPlaceholderAnswer(value)).toBe(true);
  });

  test.each([
    "unclear — interior myth vs thriller tension",
    "Unknown Pleasures, a memoir",
    "none of the usual gardening columns; the people who read seed catalogues",
    "not specified by the writer, but the examples are all coastal",
    "A reader looks differently at a warped shelf",
    "No more than 2,000 words",
  ])("%j is kept", (value) => {
    expect(isPlaceholderAnswer(value)).toBe(false);
  });
});

describe("normalizeInterviewDossierDraft", () => {
  test("drops placeholder fields and their confidence, keeps the rest", () => {
    const draft = normalizeInterviewDossierDraft({
      brief: {
        workingTitle: "Salt Roads",
        format: "unspecified",
        audience: "Unknown.",
        goal: "unclear — interior myth vs thriller tension",
        tone: "N/A",
        constraints: "none stated",
        successSignal: "TBD",
      },
      confidence: {
        workingTitle: "high",
        format: "low",
        goal: "medium",
        tone: "low",
      },
    });
    expect(draft).toEqual({
      brief: {
        workingTitle: "Salt Roads",
        goal: "unclear — interior myth vs thriller tension",
      },
      confidence: { workingTitle: "high", goal: "medium" },
    });
  });

  test("returns null when every field is a placeholder", () => {
    expect(
      normalizeInterviewDossierDraft({
        brief: { audience: "not specified", goal: "tbd", tone: "" },
        confidence: { audience: "low" },
      }),
    ).toBeNull();
  });

  test("reads a flat brief without the brief wrapper", () => {
    expect(
      normalizeInterviewDossierDraft({ audience: " coastal gardeners " }),
    ).toEqual({ brief: { audience: "coastal gardeners" }, confidence: {} });
  });

  test("ignores non-string values and unknown confidence levels", () => {
    expect(
      normalizeInterviewDossierDraft({
        brief: { audience: 7, goal: "Show the town's weather" },
        confidence: { goal: "certain" },
      }),
    ).toEqual({ brief: { goal: "Show the town's weather" }, confidence: {} });
  });

  test("rejects non-objects", () => {
    expect(normalizeInterviewDossierDraft(null)).toBeNull();
    expect(normalizeInterviewDossierDraft("brief")).toBeNull();
  });
});
