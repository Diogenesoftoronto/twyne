import { describe, expect, test } from "bun:test";
import {
  DEFAULT_INTERVIEW_ANSWERS,
  briefTitleFromFolioName,
  withFolioTitle,
} from "./anti-tabula-rasa";

const blank = { ...DEFAULT_INTERVIEW_ANSWERS, workingTitle: "" };

describe("folio name → brief working title", () => {
  test("an unnamed folio contributes no title", () => {
    expect(briefTitleFromFolioName("Untitled folio")).toBe("");
    expect(briefTitleFromFolioName("  ")).toBe("");
    expect(briefTitleFromFolioName(null)).toBe("");
  });

  test("a named folio fills a blank or placeholder title", () => {
    expect(withFolioTitle(blank, " Harbour Notes ").workingTitle).toBe(
      "Harbour Notes",
    );
    expect(
      withFolioTitle(DEFAULT_INTERVIEW_ANSWERS, "Harbour Notes").workingTitle,
    ).toBe("Harbour Notes");
  });

  test("a title the writer typed wins", () => {
    const typed = { ...blank, workingTitle: "Tide Tables" };
    expect(withFolioTitle(typed, "Harbour Notes").workingTitle).toBe(
      "Tide Tables",
    );
  });
});
