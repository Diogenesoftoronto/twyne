import { describe, expect, test } from "bun:test";
import type { ProjectInterviewAnswers } from "../types";
import {
  buildBriefStrengthQuestions,
  quickFieldStrength,
  readBriefStrengths,
  strengthFor,
  weakestField,
  type StrengthView,
} from "./brief-strength";
import type { SystemOneAnswer } from "./system-one";

const answers: ProjectInterviewAnswers = {
  workingTitle: "The Late Bus",
  format: "Essay, about 1,500 words for a city newsletter",
  audience: "General readers",
  goal: "Convince council members to fund night routes rather than more parking",
  tone: "Engaging",
  constraints: "",
  successSignal: "",
};

const levels = (n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), `L${i}`]));

describe("quick read", () => {
  test("an empty answer is Missing and asks for something", () => {
    const v = quickFieldStrength("audience", "  ");
    expect(v.level).toBe(0);
    expect(v.label).toBe("Missing");
    expect(v.hint).toBeTruthy();
  });

  test("generic stand-ins read as Vague", () => {
    expect(quickFieldStrength("audience", "General readers").level).toBe(1);
    expect(quickFieldStrength("tone", "Engaging").level).toBe(1);
  });

  test("a concrete answer that rules something out reaches Sharp", () => {
    const v = quickFieldStrength(
      "audience",
      "Transit planners who already know the ridership data but doubt that night service pays for itself, not commuters",
    );
    expect(v.level).toBe(4);
    expect(v.hint).toBeNull();
  });

  test("format with a length and venue is Specific", () => {
    expect(quickFieldStrength("format", answers.format).level).toBe(3);
  });
});

describe("Jev reading", () => {
  test("only filled fields are asked about; sufficiency waits for enough brief", () => {
    const q = buildBriefStrengthQuestions(answers, ["audience", "constraints"]);
    expect(Object.keys(q)).toContain("score_audience");
    expect(Object.keys(q)).toContain("gap_audience");
    expect(Object.keys(q)).not.toContain("score_constraints");
    expect(Object.keys(q)).toContain("sufficient");
    const thin = buildBriefStrengthQuestions(
      { ...answers, goal: "", tone: "", format: "" },
      ["audience"],
    );
    expect(Object.keys(thin)).not.toContain("sufficient");
  });

  test("a confident gap choice selects its authored hint, pinned to the text", () => {
    const response: Record<string, SystemOneAnswer> = {
      score_audience: {
        type: "score",
        score: 1.1,
        legend: levels(5),
        probabilities: { "0": 0.05, "1": 0.8, "2": 0.15, "3": 0, "4": 0 },
        confidence: 0.7,
      },
      gap_audience: {
        type: "choice",
        choice: "It names a demographic or category, not an actual reader",
        probabilities: {},
        confidence: 0.6,
      },
      sufficient: { type: "noul", noul: 0.22 },
    };
    const read = readBriefStrengths(answers, ["audience"], response);
    const audience = read.fields.audience!;
    expect(audience.level).toBe(1);
    expect(audience.source).toBe("jev");
    expect(audience.hint).toContain("one reader");
    expect(audience.value).toBe("General readers");
    expect(read.sufficiency).toBe(0.22);

    expect(strengthFor("audience", "General readers", audience).source).toBe(
      "jev",
    );
    // Typing again hands back to the quick read until Jev catches up.
    expect(
      strengthFor("audience", "General readers who", audience).source,
    ).toBe("quick");
  });

  test("a split distribution uses the modal level and says it was close", () => {
    const read = readBriefStrengths(answers, ["goal"], {
      score_goal: {
        type: "score",
        score: 2.1,
        legend: levels(5),
        probabilities: {
          "0": 0.02,
          "1": 0.45,
          "2": 0.06,
          "3": 0.05,
          "4": 0.42,
        },
        confidence: 0.2,
      },
    });
    expect(read.fields.goal!.level).toBe(1);
    expect(read.fields.goal!.uncertain).toBe(true);
  });

  test("'nothing missing' never silences the hint on a weak answer", () => {
    const read = readBriefStrengths(answers, ["tone"], {
      score_tone: {
        type: "score",
        score: 1,
        legend: levels(5),
        probabilities: { "1": 1 },
        confidence: 0.9,
      },
      gap_tone: {
        type: "choice",
        choice: "Nothing important — the tone distinguishes this piece",
        probabilities: {},
        confidence: 0.9,
      },
    });
    expect(read.fields.tone!.hint).toBeTruthy();
  });
});

test("weakestField skips missing and strong answers", () => {
  const v = (level: StrengthView["level"]) => ({ level }) as StrengthView;
  expect(
    weakestField(
      { workingTitle: v(0), audience: v(2), goal: v(1), tone: v(4) },
      ["workingTitle", "audience", "goal", "tone"],
    ),
  ).toBe("goal");
  expect(weakestField({ goal: v(3), tone: v(0) }, ["goal", "tone"])).toBeNull();
});
