import { describe, expect, test } from "bun:test";
import {
  gradeVerdict,
  nextMoveFor,
  scoreWord,
  shapeFeedback,
} from "./rubric-copy";

const JARGON =
  /type-token|standard deviation|static feature|variance|citation-like|regex/i;

describe("rubric copy", () => {
  test("a score reads as a word before a number", () => {
    expect(scoreWord(9, 10)).toBe("strong");
    expect(scoreWord(6.5, 10)).toBe("solid");
    expect(scoreWord(4, 10)).toBe("uneven");
    expect(scoreWord(2, 10)).toBe("weak");
  });

  test("every measured criterion speaks plainly", () => {
    const lines = [
      shapeFeedback.structure(3, 20, 3),
      shapeFeedback.pacing(26, 3),
      shapeFeedback.pacing(15, 7),
      shapeFeedback.vocabulary(0.3),
      shapeFeedback.paragraphs(8, 0.6, 0),
      shapeFeedback.capped(4.4, 2),
      shapeFeedback.evidence(0, 0),
      shapeFeedback.integrity(1, 0.02, 0.01, 0),
      gradeVerdict(55),
      nextMoveFor("pacing"),
    ];
    for (const line of lines) expect(line).not.toMatch(JARGON);
  });

  test("counts agree in number", () => {
    expect(shapeFeedback.structure(1, 1, 5)).toStartWith(
      "1 paragraph, 1 sentence.",
    );
    expect(shapeFeedback.integrity(1, 0, 0, 0)).toContain(
      "1 sweeping claim with nothing behind it",
    );
    expect(shapeFeedback.evidence(1, 2)).toStartWith("1 reference found");
  });

  test("every spine criterion has a next move", async () => {
    const { SPINE_CRITERIA } = await import("../types");
    const fallback = nextMoveFor("unknown");
    for (const c of SPINE_CRITERIA)
      expect(nextMoveFor(c.id)).not.toBe(fallback);
  });
});
