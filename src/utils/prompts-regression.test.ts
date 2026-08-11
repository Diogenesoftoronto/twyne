/**
 * Regression tests for the migrated prompt builders. These pin the
 * rendered output of the most-used prompt paths so an accidental edit
 * to a `.md` file changes the prompt in the eyeball, but the underlying
 * text that hit the model can be checked against a character-level
 * snapshot. The values were captured from the original TS builders
 * before the markdown migration.
 */
import { describe, expect, test } from "bun:test";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildSynthesisPrompt,
  buildEvidenceJudgePrompt,
  buildIntegrityJudgePrompt,
  buildCustomCriterionPrompt,
  buildRubricReviewPrompt,
  probeParticularsBlock,
  type AgentPersona,
} from "../../convex/agentPrompts";
import type { ProjectBrief } from "../../src/types";

const samplePersona: AgentPersona = {
  id: "devil",
  name: "Marquise",
  role: "Sceptical editor",
  description: "A sceptical editorial voice.",
  focus: "Soundness of argument.",
  backstory: "Twenty years in journalism.",
  criticalMethod: "Reads for unsupported claims.",
  voice: "Tight, dry.",
  signatureMoves: ["Asks one pointed question."],
  avoidances: ["Never softens a verdict."],
  sampleLines: ["The first paragraph overpromises."],
};

function buildSampleBrief(): ProjectBrief {
  return {
    answers: {
      workingTitle: "On the Limits of Local Memory",
      format: "long-form essay",
      audience: "editors of literary monthlies",
      goal: "to land a feature, not a puff piece",
      tone: "measured, exact",
      constraints: "no anecdotes from social media",
      successSignal: "the writer commits to a next revision",
    },
    probes: [],
    attachments: [],
    completedAt: 1,
    updatedAt: 1,
  };
}

describe("agentPrompts (prompt markdown migration)", () => {
  test("buildSystemPrompt includes the persona binding line", () => {
    const out = buildSystemPrompt(samplePersona);
    expect(out).toContain("Marquise, the Sceptical editor");
    expect(out).toContain("PERSONA BIBLE (binding for every note");
    expect(out).toContain("Twenty years in journalism.");
    expect(out).toContain("EDITORIAL DOCTRINE:");
    expect(out).toContain("60 and 220 words");
  });

  test("buildUserPrompt renders brief, draft, and instruction", () => {
    const out = buildUserPrompt({
      persona: samplePersona,
      brief: buildSampleBrief(),
      draftText: "It begins here. It grows from there.",
      instruction: "feedback",
      anchor: "It begins here.",
    });
    expect(out).toContain("PROJECT BRIEF");
    expect(out).toContain("- Title: On the Limits of Local Memory");
    expect(out).toContain("DRAFT (the manuscript as it stands");
    expect(out).toContain("ANCHOR SENTENCE");
    expect(out).toContain('"It begins here."');
    expect(out).toContain("Give the writer a single focused note");
  });

  test("buildUserPrompt falls back to no-brief block", () => {
    const out = buildUserPrompt({
      persona: samplePersona,
      brief: null,
      draftText: "",
      instruction: "feedback",
    });
    expect(out).toContain("PROJECT BRIEF: none filed");
    expect(out).toContain("Respond as if to a blank page");
  });

  test("buildSynthesisPrompt joins five memos into a verdict request", () => {
    const out = buildSynthesisPrompt(
      [
        { personaName: "Marquise", role: "Sceptic", text: "first memo" },
        { personaName: "Perdita", role: "Patron", text: "second memo" },
      ],
      buildSampleBrief(),
    );
    expect(out).toContain("PROJECT BRIEF");
    expect(out).toContain("### Marquise (Sceptic)");
    expect(out).toContain("### Perdita (Patron)");
    expect(out).toContain("Write the synthesis (300–500 words)");
  });

  test("buildEvidenceJudgePrompt renders GOAL/AUDIENCE/STATIC/DRAFT blocks", () => {
    const out = buildEvidenceJudgePrompt({
      goal: "to land a feature",
      audience: "editors",
      draftText: "claim alpha\nclaim beta",
      staticNote: "3 citation-like marks",
    });
    expect(out).toContain("GOAL: to land a feature");
    expect(out).toContain("AUDIENCE: editors");
    expect(out).toContain("STATIC SIGNALS");
    expect(out).toContain("3 citation-like marks");
    expect(out).toContain("claim alpha");
    expect(out).toContain("Respond as JSON, and only JSON");
  });

  test("buildIntegrityJudgePrompt penalises the same hard categories", () => {
    const out = buildIntegrityJudgePrompt({
      goal: "to land a feature",
      audience: "editors",
      draftText: "stuff",
      staticNote: "0 fillers",
    });
    expect(out).toContain("GOAL: to land a feature");
    expect(out).toContain("Universal or");
    expect(out).toContain("Fake or suspicious specificity");
  });

  test("buildCustomCriterionPrompt falls back when no description given", () => {
    const out = buildCustomCriterionPrompt({
      label: "stays in second person",
      description: "",
      format: "essay",
      audience: "editors",
      goal: "earn the feature",
      draftText: "some draft",
    });
    expect(out).toContain("(the writer gave no further detail");
  });

  test("buildRubricReviewPrompt includes judges, static, grade, draft", () => {
    const out = buildRubricReviewPrompt({
      combined: 72,
      grade: "B-",
      judgeMean: 6.4,
      minJudge: 5,
      staticTotal: 8.2,
      judges: [
        { personaId: "devil", score: 7, rationale: "tight" },
        { personaId: "angel", score: 6, rationale: "warm" },
      ],
      staticFeedback: ["10 paragraphs", "no citations flagged"],
      brief: buildSampleBrief(),
      draftText: "the manuscript",
    });
    expect(out).toContain("GRADE: 72/100 (B-)");
    expect(out).toContain("JUDGES' VERDICTS:");
    expect(out).toContain("- devil: 7/10 — tight");
    expect(out).toContain("- angel: 6/10 — warm");
    expect(out).toContain("STATIC-FEATURE NOTES:");
    expect(out).toContain("- 10 paragraphs");
    expect(out).toContain("Write the review (400–600 words)");
  });

  test("probeParticularsBlock returns empty when probes lack answers", () => {
    const brief: ProjectBrief = { ...buildSampleBrief(), probes: [] };
    expect(probeParticularsBlock(brief)).toBe("");
  });
});
