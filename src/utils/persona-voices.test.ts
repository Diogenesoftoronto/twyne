import { describe, expect, test } from "bun:test";
import {
  buildUserPrompt,
  buildSystemPrompt,
  buildSynthesisPrompt,
  buildRubricReviewPrompt,
  toAgentPersona,
} from "../../convex/agentPrompts";
import { PERSONAS } from "./personas";

describe("persona voices", () => {
  test("every default persona ships a distinct voice spec", () => {
    for (const p of PERSONAS) {
      expect(p.voice, `${p.id} should have a voice`).toBeTruthy();
      expect(
        (p.sampleLines ?? []).length,
        `${p.id} should have sample lines`,
      ).toBeGreaterThan(0);
    }
    const voices = PERSONAS.map((p) => p.voice);
    expect(new Set(voices).size).toBe(PERSONAS.length);
  });

  test("the system prompt injects the persona's voice and lore", () => {
    const devil = PERSONAS.find((p) => p.id === "devil")!;
    const reader = PERSONAS.find((p) => p.id === "reader")!;
    const devilPrompt = buildSystemPrompt(toAgentPersona(devil));
    const readerPrompt = buildSystemPrompt(toAgentPersona(reader));

    expect(devilPrompt).toContain("WHO YOU ARE");
    expect(devilPrompt).toContain(devil.voice!.slice(0, 24));
    // Two different editors must produce materially different prompts.
    expect(devilPrompt).not.toBe(readerPrompt);
  });

  test("personas with no voice fall back to the generic instruction", () => {
    const prompt = buildSystemPrompt({
      id: "x",
      name: "Plain",
      role: "tester",
      description: "d",
      focus: "f",
    });
    expect(prompt).toContain("Speak in your own voice");
  });
});

describe("synthesis + review prompts", () => {
  test("synthesis prompt lists each editor's memo", () => {
    const out = buildSynthesisPrompt(
      [
        { personaName: "A", role: "critic", text: "memo-a" },
        { personaName: "B", role: "reader", text: "memo-b" },
      ],
      null,
    );
    expect(out).toContain("A (critic)");
    expect(out).toContain("memo-a");
    expect(out).toContain("memo-b");
  });

  test("brief attachments are serialized into prompt context", () => {
    const out = buildUserPrompt({
      persona: toAgentPersona(PERSONAS[0]),
      brief: {
        answers: {
          workingTitle: "Libraries as Civic Infrastructure",
          format: "Essay",
          audience: "City officials",
          goal: "Defend funding",
          tone: "Calm",
          constraints: "Use public evidence",
          successSignal: "Budget survives",
        },
        attachments: [
          {
            id: "att-doc",
            kind: "document",
            title: "Budget notes",
            text: "Libraries improve access to jobs and public services.",
            why: "Ground the case in measurable outcomes.",
            addedAt: 1,
          },
          {
            id: "att-link",
            kind: "link",
            title: "City audit",
            url: "https://example.com/audit",
            why: "Use the published numbers.",
            addedAt: 2,
          },
        ],
        completedAt: 1,
        updatedAt: 2,
      },
      draftText: "A draft.",
      instruction: "feedback",
    });
    expect(out).toContain("REFERENCE MATERIAL");
    expect(out).toContain('"Budget notes"');
    expect(out).toContain("Ground the case in measurable outcomes.");
    expect(out).toContain('"City audit"');
  });

  test("rubric review prompt carries the grade and judge verdicts", () => {
    const out = buildRubricReviewPrompt({
      combined: 72,
      grade: "B-",
      judgeMean: 7,
      staticTotal: 6.5,
      judges: [{ personaId: "devil", score: 6, rationale: "thin in the middle" }],
      staticFeedback: ["Citations are sparse."],
      brief: null,
      draftText: "A draft.",
    });
    expect(out).toContain("72/100");
    expect(out).toContain("B-");
    expect(out).toContain("devil: 6/10");
    expect(out).toContain("thin in the middle");
  });
});
