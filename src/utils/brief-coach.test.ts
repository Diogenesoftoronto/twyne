import { describe, expect, test } from "bun:test";
import type { ProjectBrief, ProjectInterviewAnswers } from "../types";
import {
  BRIEF_FIELDS,
  briefIsLoadBearing,
  buildBriefQuestions,
  buildBriefState,
  enforceableConstraints,
  noteGateConstraints,
  readBriefAssessment,
  splitConstraints,
  triageFromAssessment,
  type BriefAssessment,
} from "./brief-coach";
import {
  CONSTRAINT_KIND_OPTIONS,
  FIELD_FACETS,
  WRITER_SET,
  type BriefField,
} from "./brief-facets";
import { STRENGTH_KEYS, buildBriefStrengthQuestions } from "./brief-strength";
import type { SystemOneAnswer } from "./system-one";
import { buildNoteState } from "./note-gate";
import { DEFAULT_INTERVIEW_ANSWERS } from "./anti-tabula-rasa";

const emptyAnswers = (): ProjectInterviewAnswers => ({
  ...DEFAULT_INTERVIEW_ANSWERS,
});

const yes = (p: number): SystemOneAnswer => ({ type: "noul", noul: p });

/** Every facet of a field answered so the field derives to `level`. */
const field = (
  name: BriefField,
  level: 1 | 2 | 3 | 4,
): Record<string, SystemOneAnswer> =>
  Object.fromEntries(
    FIELD_FACETS[name].map((def) => [
      STRENGTH_KEYS.facet(name, def.id),
      yes(
        def.role === "core"
          ? level >= 2
            ? 0.9
            : 0.1
          : def.role === "needed"
            ? level >= 3
              ? 0.9
              : 0.1
            : level >= 4
              ? 0.9
              : 0.1,
      ),
    ]),
  );

const [HARD, EDITORIAL, PREFERENCE] = CONSTRAINT_KIND_OPTIONS;

/** One constraint line's three answers. */
const line = (
  i: number,
  option: string,
  checkable = true,
): Record<string, SystemOneAnswer> => ({
  [STRENGTH_KEYS.line(i, "check")]: yes(checkable ? 0.9 : 0.2),
  [STRENGTH_KEYS.line(i, "vague")]: yes(checkable ? 0.1 : 0.9),
  [STRENGTH_KEYS.line(i, "kind")]: {
    type: "choice",
    choice: option,
    probabilities: { [option]: 0.9 },
    confidence: 0.8,
  },
});

const brief = (answers: Partial<ProjectInterviewAnswers>): ProjectBrief => ({
  answers: {
    workingTitle: "",
    format: "",
    audience: "",
    goal: "",
    tone: "",
    constraints: "",
    successSignal: "",
    ...answers,
  },
  attachments: [],
  completedAt: 0,
  updatedAt: 0,
});

describe("splitConstraints", () => {
  test("one per line, which is how writers type them", () => {
    expect(splitConstraints("No second person\nUnder 1200 words")).toEqual([
      "No second person",
      "Under 1200 words",
    ]);
  });

  test("handles bullets and semicolons", () => {
    expect(
      splitConstraints("- No jokes\n• Cite every claim; British spelling"),
    ).toEqual(["No jokes", "Cite every claim", "British spelling"]);
  });

  test("drops fragments that cannot be a constraint", () => {
    expect(splitConstraints("No jokes\n\n-\nok")).toEqual(["No jokes"]);
  });

  test("caps the list rather than sending 60 questions", () => {
    const many = Array.from({ length: 30 }, (_, i) => `rule ${i}`).join("\n");
    expect(splitConstraints(many).length).toBe(12);
  });

  test("empty means empty", () => {
    expect(splitConstraints("")).toEqual([]);
  });
});

describe("buildBriefQuestions", () => {
  test("asks the form's own questions, so desk and review cannot disagree", () => {
    const b = brief({
      audience: "tax lawyers",
      goal: "persuade",
      constraints: "No second person",
    });
    expect(buildBriefQuestions(b)).toEqual(
      buildBriefStrengthQuestions(b.answers, BRIEF_FIELDS, { whole: true }),
    );
  });

  test("only grades fields the writer answered", () => {
    const q = buildBriefQuestions(brief({ audience: "tax lawyers" }));
    expect(q[STRENGTH_KEYS.facet("audience", "reader")]).toBeDefined();
    expect(q[STRENGTH_KEYS.facet("goal", "aim")]).toBeUndefined();
  });

  test("always asks the whole-brief questions", () => {
    // Not the mean of the fields: a brief can have seven adequate answers and
    // still not say what the piece is.
    const q = buildBriefQuestions(brief({}));
    expect(q.sufficient.type).toBe("noul");
    expect(q.contradictory.type).toBe("noul");
  });

  test("interrogates each constraint separately, quoting it back", () => {
    const q = buildBriefQuestions(
      brief({ constraints: "No second person\nUnder 1200 words" }),
    );
    expect(q[STRENGTH_KEYS.line(0, "kind")].type).toBe("choice");
    expect(q[STRENGTH_KEYS.line(1, "check")].type).toBe("noul");
    expect(q[STRENGTH_KEYS.line(2, "kind")]).toBeUndefined();
    expect(q[STRENGTH_KEYS.line(0, "kind")].instructions).toContain(
      "No second person",
    );
  });

  test("stays inside the batch cap on a maximal brief", () => {
    const full = Object.fromEntries(
      BRIEF_FIELDS.map((f) => [f, "something"]),
    ) as unknown as ProjectInterviewAnswers;
    const q = buildBriefQuestions(
      brief({
        ...full,
        constraints: Array.from({ length: 30 }, (_, i) => `rule ${i}`).join(
          "\n",
        ),
      }),
    );
    expect(Object.keys(q).length).toBeLessThanOrEqual(64);
  });
});

describe("buildBriefState", () => {
  test("omits fields the writer left blank", () => {
    const state = buildBriefState(brief({ goal: "persuade" }));
    expect(state).toEqual({ goal: "persuade" });
  });

  test("counts attachments as information the brief carries", () => {
    // A thin goal backed by three annotated sources is not a thin goal alone.
    const b = brief({ goal: "persuade" });
    b.attachments = [
      {
        id: "a",
        kind: "link",
        title: "The 2019 ruling",
        why: "the case everything turns on",
        addedAt: 0,
      },
    ];
    expect(buildBriefState(b).attachments).toContain("The 2019 ruling");
  });
});

describe("readBriefAssessment", () => {
  const filled = brief({
    audience: "Tax lawyers who doubt the ruling",
    goal: "They brief clients on it",
    tone: "Dry",
    successSignal: "People like it",
  });
  const answers = (
    extra: Record<string, SystemOneAnswer> = {},
  ): Record<string, SystemOneAnswer> => ({
    ...field("audience", 4),
    ...field("goal", 3),
    ...field("successSignal", 1),
    sufficient: yes(0.7),
    contradictory: yes(0.1),
    incompatible: yes(0.3),
    ...extra,
  });

  test("levels come from the checklist, with points for older callers", () => {
    const a = readBriefAssessment(filled, answers());
    const byField = Object.fromEntries(a.fields.map((f) => [f.field, f]));
    expect(byField.audience.level).toBe(4);
    expect(byField.audience.score).toBe(10);
    expect(byField.successSignal.label).toBe("Vague");
    expect(byField.successSignal.score).toBe(2.5);
  });

  test("hands back the thing to add, not a grade", () => {
    const a = readBriefAssessment(filled, answers());
    const weak = a.fields.find((f) => f.field === "successSignal");
    expect(weak?.diagnosis).toBe(FIELD_FACETS.successSignal[0].add);
    expect(weak?.facets.map((f) => f.met)).toEqual([false, false, false]);
  });

  test("prompts on load-bearing answers first, then weakest first", () => {
    const a = readBriefAssessment(
      filled,
      answers({ ...field("tone", 1), ...field("goal", 2) }),
    );
    expect(a.weakest.map((f) => f.field)).toEqual([
      "successSignal",
      "goal",
      "tone",
    ]);
  });

  test("a Partial tone is not worth interrupting for; a Partial goal is", () => {
    const a = readBriefAssessment(
      filled,
      answers({ ...field("tone", 2), ...field("goal", 2) }),
    );
    const names = a.weakest.map((f) => f.field);
    expect(names).toContain("goal");
    expect(names).not.toContain("tone");
    expect(names).not.toContain("audience");
  });

  test("carries the whole-brief probabilities through", () => {
    const a = readBriefAssessment(filled, answers());
    expect(a.sufficiency).toBe(0.7);
    expect(a.contradiction).toBeCloseTo(0.2);
  });

  test("reports null rather than zero when a question did not come back", () => {
    const a = readBriefAssessment(filled, field("goal", 3));
    expect(a.sufficiency).toBeNull();
    expect(a.contradiction).toBeNull();
  });
});

/**
 * "Is this a real non-negotiable?" — the question the writer asked for. It
 * matters mechanically: the note gate vetoes on these, so a preference
 * recorded as a constraint silently suppresses good advice, and an
 * uncheckable one makes the veto fire at random.
 */
describe("constraint classification", () => {
  const classified = (
    option: string,
    checkable = true,
  ): BriefAssessment =>
    readBriefAssessment(
      brief({ constraints: "No second person" }),
      line(0, option, checkable),
    );

  test("a hard constraint is enforceable and says so plainly", () => {
    const c = classified(HARD).constraints[0];
    expect(c.kind).toBe("hard");
    expect(c.enforceable).toBe(true);
    expect(c.hint).toContain("withheld");
  });

  test("an editorial constraint is enforced as the writer's own rule", () => {
    const c = classified(EDITORIAL).constraints[0];
    expect(c.kind).toBe("editorial");
    expect(c.enforceable).toBe(true);
    expect(c.hint).toContain("Your rule");
  });

  test("a preference is not enforced, and the writer is told why", () => {
    const c = classified(PREFERENCE).constraints[0];
    expect(c.enforceable).toBe(false);
    expect(c.hint).toContain("not as a veto");
  });

  test("a firm rule nobody could check is not enforced either", () => {
    const c = classified(EDITORIAL, false).constraints[0];
    expect(c.kind).toBe("uncheckable");
    expect(c.enforceable).toBe(false);
    expect(c.hint).toContain("yes or no");
  });

  test("keeps the writer's own wording, not the model's label", () => {
    expect(classified(HARD).constraints[0].text).toBe("No second person");
  });

  test("enforceableConstraints is what the note gate may veto on", () => {
    const a = readBriefAssessment(
      brief({ constraints: "Cite every claim\nIdeally warm\nMake it sing" }),
      {
        ...line(0, HARD),
        ...line(1, PREFERENCE),
        ...line(2, EDITORIAL, false),
      },
    );
    expect(enforceableConstraints(a)).toEqual(["Cite every claim"]);
    const constraints = a.fields.find((f) => f.field === "constraints")!;
    expect(constraints.label).toBe("Partial");
  });

  test("a kind the writer set by hand outranks a new reading of that line", () => {
    const b = brief({ constraints: "Avoid sounding preachy" });
    b.constraintTriage = {
      source: "Avoid sounding preachy",
      at: 1,
      lines: [
        {
          text: "Avoid sounding preachy",
          kind: "editorial",
          confidence: WRITER_SET,
        },
      ],
    };
    const a = readBriefAssessment(b, line(0, PREFERENCE));
    expect(a.constraints[0].kind).toBe("editorial");
    expect(triageFromAssessment(b, a)!.lines[0].confidence).toBe(WRITER_SET);
    // Jev's own readings never claim that certainty.
    expect(classified(HARD).constraints[0].confidence).toBeLessThan(WRITER_SET);
  });
});

describe("briefIsLoadBearing", () => {
  const filled = brief({
    audience: "Tax lawyers who doubt the ruling",
    goal: "They brief clients on it",
    successSignal: "Three firms cite it",
  });
  const assess = (answers: Record<string, SystemOneAnswer>): BriefAssessment =>
    readBriefAssessment(filled, answers);
  const solid = {
    ...field("audience", 4),
    ...field("goal", 4),
    ...field("successSignal", 3),
    sufficient: yes(0.8),
    contradictory: yes(0.1),
    incompatible: yes(0.1),
  };

  test("true when reader, goal and landing are Specific and the brief holds together", () => {
    const a = assess(solid);
    expect(briefIsLoadBearing(a)).toBe(true);
    expect(a.standing.held).toEqual({
      audience: true,
      goal: true,
      successSignal: true,
    });
  });

  test("false when one load-bearing field is only Partial", () => {
    // targetFit and the veto would then be measuring the brief's vagueness
    // rather than the draft's quality.
    const a = assess({ ...solid, ...field("goal", 2) });
    expect(briefIsLoadBearing(a)).toBe(false);
    expect(a.standing.soft).toEqual(["Goal is partial"]);
  });

  test("false when a stranger could not write the piece from it", () => {
    expect(briefIsLoadBearing(assess({ ...solid, sufficient: yes(0.2) }))).toBe(
      false,
    );
  });

  test("false when two answers pull apart", () => {
    expect(
      briefIsLoadBearing(
        assess({ ...solid, contradictory: yes(0.9), incompatible: yes(0.6) }),
      ),
    ).toBe(false);
  });

  test("false when a rule the writer believes binding cannot be checked", () => {
    const b = brief({ ...filled.answers, constraints: "Make it sing" });
    const a = readBriefAssessment(b, { ...solid, ...line(0, EDITORIAL, false) });
    expect(briefIsLoadBearing(a)).toBe(false);
    expect(a.standing.soft).toEqual(["one rule cannot be checked"]);
  });

  test("false when nothing load-bearing was graded at all", () => {
    expect(briefIsLoadBearing(assess(field("tone", 4)))).toBe(false);
  });
});

describe("noteGateConstraints", () => {
  const brief = (
    constraints: string,
    triage?: ProjectBrief["constraintTriage"],
  ) =>
    ({
      answers: { ...emptyAnswers(), constraints },
      attachments: [],
      completedAt: 0,
      updatedAt: 0,
      ...(triage ? { constraintTriage: triage } : {}),
    }) as ProjectBrief;
  const text = "Under 1,800 words\nAvoid sounding preachy\nMake it feel fresh";
  const triage = {
    source: text,
    at: 1,
    lines: [
      { text: "Under 1,800 words", kind: "hard" as const, confidence: 0.9 },
      {
        text: "Avoid sounding preachy",
        kind: "preference" as const,
        confidence: 0.7,
      },
      {
        text: "Make it feel fresh",
        kind: "uncheckable" as const,
        confidence: 0.8,
      },
    ],
  };

  test("vetoes only on binding lines when the triage is current", () => {
    const out = noteGateConstraints(brief(text, triage));
    expect(out.veto).toBe("- Under 1,800 words");
    expect(out.preferences).toBe("- Avoid sounding preachy");
  });

  test("falls back to the raw text when constraints changed since the triage", () => {
    const edited = `${text}\nNo second person`;
    expect(noteGateConstraints(brief(edited, triage))).toEqual({
      veto: edited,
      preferences: "",
    });
  });

  test("puts constraints into the note gate state through the triage", () => {
    const state = buildNoteState({
      note: "n",
      quote: "q",
      brief: brief(text, triage),
    });
    expect(state.constraints).toBe("- Under 1,800 words");
    expect(state.constraintPreferences).toBe("- Avoid sounding preachy");
  });
});
