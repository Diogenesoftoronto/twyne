import { describe, expect, test } from "bun:test";
import type { Persona, ProjectBrief, WriterProfile } from "../types";
import {
  EDITORIAL_POLICY_RULES,
  EDITORIAL_POLICY_VERSION,
  buildEditorialPolicyQuestions,
  buildEditorialPolicyState,
  readEditorialPolicyAssessment,
} from "./editorial-policy";
import { applyEditorialPolicy, readNoteVerdict } from "./note-gate";
import type { SystemOneAnswer } from "./system-one";

const persona = {
  id: "sceptic",
  name: "Marquise",
  role: "Sceptical editor",
  color: "#000",
  icon: "M",
  description: "A sceptical editorial voice.",
  focus: "Soundness of argument.",
  criticalMethod: "Reads for unsupported claims.",
  voice: "Tight, dry.",
  avoidances: ["Never softens a verdict."],
  providerId: "secret-provider",
  model: "secret-model",
} satisfies Persona;

const brief = {
  answers: {
    audience: "editors",
    goal: "earn trust",
    tone: "measured",
    constraints: "no invented citations",
    successSignal: "the reader sees the next move",
  },
} as ProjectBrief;

const profile = {
  displayName: "Ada",
  personalFacts: "Private fact",
  feedbackNotes: "Be direct",
  feedbackAvoid: "Do not flatter me",
} as WriterProfile;

function noulAnswers(value: number): Record<string, SystemOneAnswer> {
  return Object.fromEntries(
    EDITORIAL_POLICY_RULES.map((rule) => [
      rule.id,
      { type: "noul", noul: value },
    ]),
  );
}

function strongNoteAnswers(): Record<string, SystemOneAnswer> {
  const legend = {
    "0": "low",
    "1": "fair",
    "2": "good",
    "3": "strong",
    "4": "excellent",
  };
  const answer = {
    type: "score" as const,
    score: 4,
    legend,
    probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 },
    confidence: 1,
  };
  return { helpful: answer, actionable: answer, servesGoal: answer };
}

describe("editorial policy", () => {
  test("catalogues independent Noul rules with source and repair text", () => {
    const questions = buildEditorialPolicyQuestions();
    expect(Object.keys(questions)).toEqual(
      EDITORIAL_POLICY_RULES.map((rule) => rule.id),
    );
    expect(
      EDITORIAL_POLICY_RULES.every((rule) => rule.question.type === "noul"),
    ).toBe(true);
    expect(
      EDITORIAL_POLICY_RULES.every((rule) => rule.source && rule.repair),
    ).toBe(true);
  });

  test("projects bounded evidence without leaking provider or model settings", () => {
    const state = buildEditorialPolicyState({
      note: "Use the passage.",
      quote: "The exact passage.",
      draft: "draft",
      persona,
      brief,
      profile,
      operation: "feedback",
      userMessage: "What should I change?",
    });
    expect(state.policyVersion).toBe(EDITORIAL_POLICY_VERSION);
    expect(state.policyReply).toBe("Use the passage.");
    expect(state.policyPassage).toBe("The exact passage.");
    expect(state.policyOperation).toBe("feedback");
    expect(state.policyUserMessage).toBe("What should I change?");
    expect(JSON.stringify(state)).not.toContain("secret-provider");
    expect(JSON.stringify(state)).not.toContain("secret-model");
  });

  test("separates definite failure from uncertainty", () => {
    const answers = noulAnswers(0.1);
    answers.identity_invented = { type: "noul", noul: 0.9 };
    answers.brief_commitment_ignored = { type: "noul", noul: 0.5 };
    const assessment = readEditorialPolicyAssessment(answers);
    expect(assessment.status).toBe("fail");
    expect(assessment.failed.map((check) => check.id)).toEqual([
      "identity_invented",
    ]);
    expect(assessment.uncertain.map((check) => check.id)).toEqual([
      "brief_commitment_ignored",
    ]);
    expect(assessment.failed[0]?.severity).toBe("critical");
  });

  test("missing or wrongly typed answers remain unknown", () => {
    const assessment = readEditorialPolicyAssessment({});
    expect(assessment.status).toBe("unknown");
    expect(assessment.failed).toEqual([]);
    expect(assessment.uncertain).toHaveLength(EDITORIAL_POLICY_RULES.length);
  });

  test("critical policy failures veto while major failures only route repair", () => {
    const criticalAnswers = {
      ...strongNoteAnswers(),
      ...noulAnswers(0.1),
      identity_invented: { type: "noul" as const, noul: 0.9 },
    };
    const critical = applyEditorialPolicy(
      readNoteVerdict(criticalAnswers),
      readEditorialPolicyAssessment(criticalAnswers),
    );
    expect(critical.vetoed).toBe(true);
    expect(critical.pass).toBe(false);
    expect(critical.rewriteKind).toBe("accuracy");

    const majorAnswers = {
      ...strongNoteAnswers(),
      ...noulAnswers(0.1),
      operation_scope_broken: { type: "noul" as const, noul: 0.9 },
    };
    const major = applyEditorialPolicy(
      readNoteVerdict(majorAnswers),
      readEditorialPolicyAssessment(majorAnswers),
    );
    expect(major.vetoed).toBe(false);
    expect(major.pass).toBe(false);
    expect(major.rewriteKind).toBe("substance");
  });
});
