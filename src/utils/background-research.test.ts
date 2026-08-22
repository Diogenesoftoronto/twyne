import { describe, expect, test } from "bun:test";
import { directedResearchTarget } from "./research-targets";
import {
  researchSelection,
  snapshot,
  steerBackgroundResearch,
} from "./background-research";

describe("directedResearchTarget", () => {
  test("uses the selected passage as the default query", () => {
    const target = directedResearchTarget({
      anchor: "  The study followed 1,200 households.  ",
    });

    expect(target?.anchor).toBe("The study followed 1,200 households.");
    expect(target?.query).toBe("The study followed 1,200 households.");
    expect(target?.kind).toBe("claim");
    expect(target?.importance).toBe(5);
  });

  test("combines steering with the selected passage", () => {
    const target = directedResearchTarget({
      anchor: "Fear is the mind-killer.",
      instructions: "find the original publication",
      kind: "quote",
    });

    expect(target?.query).toBe(
      "Fear is the mind-killer. find the original publication",
    );
    expect(target?.reason).toBe("find the original publication");
    expect(target?.kind).toBe("quote");
  });

  test("keeps an explicit search query and rejects blank selections", () => {
    expect(
      directedResearchTarget({
        anchor: "Barton Fink (1991)",
        query: "Barton Fink 1991 production notes",
        instructions: "prefer primary sources",
      })?.query,
    ).toBe("Barton Fink 1991 production notes");
    expect(directedResearchTarget({ anchor: "   " })).toBeNull();
  });
});

/**
 * The gates that decide whether the Apparatus calls a model at all. They run
 * before any provider or Convex work, so a fresh module — no folio started —
 * exercises them directly: every one of these must refuse *without* spending
 * an AI call, and must say why in words the writer can act on.
 */
describe("Apparatus trigger gates", () => {
  test("stays idle until a folio is started", () => {
    expect(snapshot().status).toBe("idle");
  });

  test("refuses a blank steering direction before anything else", async () => {
    const result = await steerBackgroundResearch("   ");

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Write a direction first.");
  });

  test("will not steer a pass with no folio and no draft text", async () => {
    const result = await steerBackgroundResearch("prefer primary sources");

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Open a folio with draft text first.");
  });

  test("will not research a selection with no active folio", async () => {
    const result = await researchSelection({
      anchor: "The study followed 1,200 households.",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("That selection belongs to another folio.");
  });

  test("refusing a trigger leaves the panel idle rather than stuck running", () => {
    expect(snapshot().status).toBe("idle");
  });
});
