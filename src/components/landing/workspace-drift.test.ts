import { describe, expect, test } from "bun:test";
import { BOARD_TABS } from "../editorial-board/board-tabs";
import { PERSONAS } from "../../utils/personas";
import { editorialDateline, folioNumeral } from "../../utils/editorial-format";
import { SPINE_CRITERIA } from "../../types";
import {
  PREVIEW_CRITERION_IDS,
  PREVIEW_FOLIO_IDS,
  PREVIEW_PERSONAS,
} from "./workspace-preview";
import { TOUR_STOPS } from "./workspace-tour";

/**
 * The landing preview is a mock of the live editor. Mocks drift: a renamed
 * persona, a new board tab, or a relabeled rubric criterion silently leaves
 * the landing page showing yesterday's room. The preview therefore renders
 * from the same sources as the editor (BOARD_TABS, PERSONAS,
 * SPINE_CRITERIA, the shared dateline and numerals), and these tests pin
 * every remaining hand-written id to its source so drift fails loudly.
 */
describe("board tabs", () => {
  test("are the five tabs the room actually has, in order", () => {
    expect(BOARD_TABS.map((t) => t.id)).toEqual([
      "personas",
      "rubric",
      "comments",
      "citations",
      "history",
    ]);
  });

  test("every tab carries its numeral, label, kicker, and accent", () => {
    for (const tab of BOARD_TABS) {
      expect(tab.numeral.trim()).not.toBe("");
      expect(tab.label.trim()).not.toBe("");
      expect(tab.kicker.trim()).not.toBe("");
      expect(tab.accent.trim()).not.toBe("");
    }
  });
});

describe("preview cast", () => {
  test("staffs exactly the resident editors, in order", () => {
    expect(PREVIEW_PERSONAS.map((p) => p.id)).toEqual(
      PERSONAS.map((p) => p.id),
    );
  });

  test("names, roles, colors, and marks come from the source personas", () => {
    for (const preview of PREVIEW_PERSONAS) {
      const real = PERSONAS.find((p) => p.id === preview.id)!;
      expect(preview.name).toBe(real.name);
      expect(preview.role).toBe(real.role);
      expect(preview.color).toBe(real.color);
      expect(preview.icon).toBe(real.icon);
    }
  });

  test("every editor has a margin note with an anchor", () => {
    for (const preview of PREVIEW_PERSONAS) {
      expect(preview.anchor.trim()).not.toBe("");
      expect(preview.note.trim()).not.toBe("");
    }
  });
});

describe("tour stops", () => {
  const tabIds = new Set(BOARD_TABS.map((t) => t.id));

  test("every stop names a real board tab and a real folio", () => {
    expect(TOUR_STOPS.length).toBeGreaterThan(0);
    for (const stop of TOUR_STOPS) {
      expect(tabIds.has(stop.tab)).toBe(true);
      expect(PREVIEW_FOLIO_IDS).toContain(stop.folioId);
    }
  });
});

describe("preview rubric", () => {
  test("grades only real spine criteria", () => {
    const spineIds = new Set(SPINE_CRITERIA.map((c) => c.id));
    expect(PREVIEW_CRITERION_IDS.length).toBeGreaterThan(0);
    for (const id of PREVIEW_CRITERION_IDS) {
      expect(spineIds.has(id)).toBe(true);
    }
  });
});

describe("shared editorial format", () => {
  test("dateline reads like the masthead", () => {
    expect(editorialDateline(new Date(2026, 3, 26))).toBe(
      "Vol. I · No. 116 · Sunday, the 26th of April, 2026",
    );
  });

  test("folio numerals run I–X, then plain numbers", () => {
    expect(folioNumeral(0)).toBe("I");
    expect(folioNumeral(2)).toBe("III");
    expect(folioNumeral(9)).toBe("X");
    expect(folioNumeral(10)).toBe("11");
  });
});
