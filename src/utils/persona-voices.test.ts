import { describe, expect, test } from "bun:test";
import {
  buildUserPrompt,
  buildSystemPrompt,
  buildSynthesisPrompt,
  buildRubricReviewPrompt,
  buildEvidenceJudgeSystemPrompt,
  buildEvidenceJudgePrompt,
  buildIntegrityJudgeSystemPrompt,
  buildIntegrityJudgePrompt,
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
      minJudge: 6,
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

describe("dedicated rubric judge prompts", () => {
  test("evidence judge system frames the assignment and warns against citation-shaped decoration", () => {
    const sys = buildEvidenceJudgeSystemPrompt();
    expect(sys).toContain("research editor");
    expect(sys.toLowerCase()).toContain("support the claims");
    expect(sys.toLowerCase()).toContain("citation");
    // Either as the literal hyphenated term or as "citation marks... still fail",
    // the prompt must warn that citation-shaped noise is not the same as support.
    const low = sys.toLowerCase();
    const warnsAgainstDecoration =
      low.includes("citation-stuffing") ||
      low.includes("citation marks") ||
      low.includes("citing the appearance of support") ||
      low.includes("citation decoration");
    expect(warnsAgainstDecoration).toBe(true);
  });

  test("integrity judge system frames the assignment without penalizing legitimate emphasis", () => {
    const sys = buildIntegrityJudgeSystemPrompt();
    expect(sys.toLowerCase()).toContain("bullshit detector");
    expect(sys.toLowerCase()).toContain("confident");
    expect(sys.toLowerCase()).toContain("first-person");
  });

  test("evidence judge prompt carries goal, audience, draft, and asks for a 1-10 score", () => {
    const out = buildEvidenceJudgePrompt({
      goal: "Defend library funding",
      audience: "City officials",
      draftText: "Studies show that X.",
      staticNote: "Citation count: 3",
    });
    expect(out).toContain("Defend library funding");
    expect(out).toContain("City officials");
    expect(out).toContain("Studies show that X.");
    expect(out).toContain("Citation count: 3");
    expect(out).toContain("integer score from 1 to 10");
    expect(out).toContain('"score": <integer 1-10>');
  });

  test("integrity judge prompt carries goal, audience, draft, and asks for a 1-10 score", () => {
    const out = buildIntegrityJudgePrompt({
      goal: "Argue honestly",
      audience: "Newsletter readers",
      draftText: "Everyone knows that X.",
      staticNote: "Regex signals: filler 5",
    });
    expect(out).toContain("Argue honestly");
    expect(out).toContain("Newsletter readers");
    expect(out).toContain("Everyone knows that X.");
    expect(out).toContain("Regex signals: filler 5");
    expect(out).toContain("integer score from 1 to 10");
    expect(out).toContain('"score": <integer 1-10>');
  });

  test("evidence and integrity prompts are materially different so the two roles do not collapse", () => {
    const ev = buildEvidenceJudgePrompt({
      goal: "g",
      audience: "a",
      draftText: "d",
      staticNote: "s",
    });
    const it = buildIntegrityJudgePrompt({
      goal: "g",
      audience: "a",
      draftText: "d",
      staticNote: "s",
    });
    expect(ev).not.toBe(it);
    // Each prompt names which one it is.
    expect(ev.toLowerCase()).toContain("evidence actually supports");
    expect(it.toLowerCase()).toContain("resists bullshit");
  });
});

describe("particulars reach the judges", () => {
  const brief = {
    answers: {
      workingTitle: "The Levy",
      format: "Op-ed",
      audience: "City planners",
      goal: "Argue the levy pays for itself",
      tone: "Exact",
      constraints: "No jargon",
      successSignal: "They can restate the case",
    },
    attachments: [],
    completedAt: 0,
    updatedAt: 0,
    probes: [
      {
        id: "p1",
        kind: "choice" as const,
        prompt: "Which objection matters most?",
        options: ["Cost", "Timeline"],
        answer: "Cost",
      },
      {
        id: "p2",
        kind: "scale" as const,
        prompt: "How technical?",
        min: 1,
        max: 5,
        minLabel: "plain",
        maxLabel: "wonkish",
        answer: 4,
      },
    ],
  };

  test("answered probes appear in the shared user prompt", () => {
    const prompt = buildUserPrompt({
      persona: toAgentPersona(PERSONAS[0]),
      brief,
      draftText: "Some draft text about the levy.",
      instruction: "feedback",
    });
    expect(prompt).toContain("PARTICULARS");
    expect(prompt).toContain("Which objection matters most? → Cost");
    expect(prompt).toContain("4 of 5 (1=plain, 5=wonkish)");
  });

  test("a brief with no probes produces no particulars block", () => {
    const prompt = buildUserPrompt({
      persona: toAgentPersona(PERSONAS[0]),
      brief: { ...brief, probes: undefined },
      draftText: "Some draft text.",
      instruction: "feedback",
    });
    expect(prompt).not.toContain("PARTICULARS");
  });

  test("an unanswered probe is not presented as a commitment", () => {
    const prompt = buildUserPrompt({
      persona: toAgentPersona(PERSONAS[0]),
      brief: {
        ...brief,
        probes: [
          { id: "p3", kind: "choice" as const, prompt: "Unanswered?", options: ["a", "b"] },
        ],
      },
      draftText: "Some draft text.",
      instruction: "feedback",
    });
    expect(prompt).not.toContain("Unanswered?");
  });
});

describe("the background room's prompt", () => {
  test("aims the note at new material and carries the trajectory", () => {
    const prompt = buildUserPrompt({
      persona: toAgentPersona(PERSONAS[0]),
      brief: null,
      draftText: "The whole draft, which is long.",
      newMaterial: "The two paragraphs just written.",
      trajectory: "Over the last 20m: +340 words net, 2 paragraphs added.",
      instruction: "feedback",
    });
    expect(prompt).toContain("SINCE YOUR LAST READ");
    expect(prompt).toContain("+340 words net");
    expect(prompt).toContain("NEW MATERIAL");
    expect(prompt).toContain("The two paragraphs just written.");
    // A passing remark, not a filed report.
    expect(prompt).toContain("40-120 words");
  });

  test("an ordinary convene is unchanged", () => {
    const prompt = buildUserPrompt({
      persona: toAgentPersona(PERSONAS[0]),
      brief: null,
      draftText: "The whole draft.",
      instruction: "feedback",
    });
    expect(prompt).not.toContain("SINCE YOUR LAST READ");
    expect(prompt).not.toContain("NEW MATERIAL");
    expect(prompt).not.toContain("40-120 words");
  });
});
