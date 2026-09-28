import { describe, expect, test } from "bun:test";
import {
  runAdaptiveEditorialDraft,
  type EditorialDraftCandidate,
} from "./adaptive-editorial-draft";
import type { NoteVerdict } from "./note-gate";

function verdict(overrides: Partial<NoteVerdict> = {}): NoteVerdict {
  return {
    dimensions: {
      helpful: { score: 8, confidence: 0.9, nearestLevel: "Helpful" },
      actionable: { score: 8, confidence: 0.9, nearestLevel: "Actionable" },
      servesGoal: {
        score: 8,
        confidence: 0.9,
        nearestLevel: "Serves the goal",
      },
    },
    overall: 8,
    violationRisk: 0,
    quoteRisk: 0,
    adherence: null,
    breaksAvoidance: 0,
    factAdherence: null,
    factViolationRisk: 0,
    feedbackAdherence: null,
    preferenceViolationRisk: 0,
    vetoed: false,
    pass: true,
    reasons: [],
    rewriteKind: null,
    ...overrides,
  };
}

function candidate(text: string): EditorialDraftCandidate<string> {
  return { value: text, text, anchor: "The exact passage." };
}

describe("runAdaptiveEditorialDraft", () => {
  test("turns a failed review into private repair and raises reasoning", async () => {
    const generations: Array<{
      reasoning: string;
      repair: readonly string[];
    }> = [];
    let reviews = 0;

    const result = await runAdaptiveEditorialDraft({
      operation: "feedback",
      generate: async (input) => {
        generations.push({ reasoning: input.reasoning, repair: input.repair });
        return candidate(
          generations.length === 1 ? "bad candidate" : "repaired candidate",
        );
      },
      review: async () => {
        reviews += 1;
        return reviews === 1
          ? verdict({
              overall: 2,
              pass: false,
              reasons: ["substance: Vague"],
              rewriteKind: "substance",
            })
          : verdict();
      },
    });

    expect(result.status).toBe("released");
    expect(result.candidate?.value).toBe("repaired candidate");
    expect(generations.map(({ reasoning }) => reasoning)).toEqual([
      "low",
      "medium",
    ]);
    expect(generations[1]?.repair[0]).toContain("specific sentence or phrase");
    expect(generations[1]?.repair[0]).not.toContain("bad candidate");
    expect(result.receipt.attempts.map(({ status }) => status)).toEqual([
      "unknown",
      "pass",
    ]);
  });

  test("does not spend more reasoning on a voice-only repair", async () => {
    const levels: string[] = [];
    let attempt = 0;

    const result = await runAdaptiveEditorialDraft({
      operation: "feedback",
      generate: async (input) => {
        levels.push(input.reasoning);
        attempt += 1;
        return candidate(`candidate ${attempt}`);
      },
      review: async () =>
        attempt === 1
          ? verdict({
              pass: false,
              overall: 8,
              reasons: ["voice: Faint"],
              rewriteKind: "voice",
            })
          : verdict(),
    });

    expect(result.status).toBe("released");
    expect(levels).toEqual(["low", "low"]);
  });

  test("releases an unreviewed candidate when the judgement transport is unavailable", async () => {
    let generated = 0;
    const result = await runAdaptiveEditorialDraft({
      generate: async () => {
        generated += 1;
        return candidate("available response");
      },
      review: async () => null,
    });

    expect(result.status).toBe("unreviewed");
    expect(result.candidate?.value).toBe("available response");
    expect(generated).toBe(1);
    expect(result.receipt.reason).toBe("review-unavailable");
  });

  test("withholds a response after repeated critical failures", async () => {
    const result = await runAdaptiveEditorialDraft({
      generate: async ({ attempt }) => candidate(`vetoed ${attempt}`),
      review: async () =>
        verdict({
          pass: false,
          vetoed: true,
          overall: 8,
          reasons: ["policy: anchor the claim"],
          rewriteKind: "accuracy",
        }),
    });

    expect(result.status).toBe("withheld");
    expect(result.candidate).toBeUndefined();
    expect(result.receipt.attempts).toHaveLength(3);
  });
});
