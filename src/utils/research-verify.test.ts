import { describe, expect, test } from "bun:test";
import {
  evidencePassage,
  isRateLimited,
  keywordQuery,
  researchQueries,
  settledVerdict,
  supportReadings,
  supportRequest,
} from "./research-verify";
import type { ResearchTarget } from "../types";

const target = (over: Partial<ResearchTarget>): ResearchTarget => ({
  id: "t",
  kind: "claim",
  anchor: "",
  query: "",
  reason: "",
  importance: 3,
  ...over,
});

describe("queries", () => {
  test("a sentence becomes its terms", () => {
    expect(
      keywordQuery(
        "In 1903 the Wright brothers flew the first powered aircraft at Kitty Hawk.",
      ),
    ).toBe("1903 Wright brothers flew first powered aircraft Kitty Hawk");
  });

  test("a verbatim hosted query is tried after its keywords", () => {
    const anchor =
      "Studies show that 40% of early aviators in Ohio were self-taught bicycle mechanics.";
    const queries = researchQueries(target({ anchor, query: anchor }));
    expect(queries[0]).toBe(
      "Studies show 40% early aviators Ohio self-taught bicycle mechanics",
    );
    expect(queries).toContain(anchor);
  });

  test("a model's query stays first, and a quotation is searched as a phrase", () => {
    const queries = researchQueries(
      target({
        kind: "quote",
        anchor:
          'Orville wrote, "The age of flight had come at last," after the trial.',
        query: "Orville Wright age of flight had come at last",
      }),
    );
    expect(queries[0]).toBe("Orville Wright age of flight had come at last");
    expect(queries[1]).toBe('"The age of flight had come at last,"');
    expect(queries.length).toBeLessThanOrEqual(3);
  });
});

describe("evidence passage", () => {
  test("picks the paragraphs that carry the claim's terms and figures", () => {
    const page = [
      "Visitor information: the memorial is open daily from 9 to 5, and parking is free.",
      "On December 17, 1903, the Wright brothers made four flights at Kitty Hawk; the first lasted 12 seconds.",
      "The gift shop sells models of the Flyer and books about early aviation history.",
    ].join("\n\n");
    expect(
      evidencePassage(
        "The first flight at Kitty Hawk in 1903 lasted 12 seconds.",
        page,
      ),
    ).toBe(
      "On December 17, 1903, the Wright brothers made four flights at Kitty Hawk; the first lasted 12 seconds.",
    );
  });
});

describe("support verdicts", () => {
  test("asks one choice per source and reads the answers back in order", () => {
    const request = supportRequest("claim text", [
      { url: "https://a.test", title: "A", passage: "pa" },
      { url: "https://b.test", title: "B", passage: "pb" },
    ]);
    expect(Object.keys(request.questions)).toEqual(["source0", "source1"]);
    expect(request.questions.source0.criteria).toEqual([
      "supports",
      "contradicts",
      "unrelated",
    ]);
    const readings = supportReadings(2, {
      ok: true,
      answers: {
        source0: {
          choice: "supports",
          probabilities: { supports: 0.9, contradicts: 0.05, unrelated: 0.05 },
        },
        source1: {
          choice: "contradicts",
          probabilities: { supports: 0.3, contradicts: 0.5, unrelated: 0.2 },
        },
      },
    });
    expect(readings.map(settledVerdict)).toEqual(["supports", null]);
  });

  test("a failed judgement settles nothing", () => {
    expect(
      supportReadings(1, { ok: false, error: "provider" }).map(settledVerdict),
    ).toEqual([null]);
  });

  test("rate limits are recognised as a reason to wait", () => {
    expect(isRateLimited("Too many requests. Try again in 41s.")).toBe(true);
    expect(isRateLimited("The search service could not answer.")).toBe(false);
  });
});
