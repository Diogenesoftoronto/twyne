import { describe, expect, test } from "bun:test";
import {
  BRIEF_FIXTURES,
  FIELD_FIXTURES,
  HOLDOUT_BRIEF_FIXTURES,
  HOLDOUT_FIELD_FIXTURES,
} from "../../evals/brief-strength-fixtures";
import type { DossierProbe, ProjectInterviewAnswers } from "../types";
import {
  CONSTRAINT_KIND_OPTIONS,
  FIELD_ARCHETYPES,
  FIELD_FACETS,
  FIRST_QUESTIONS,
  TENSION_PAIRS,
  clauseOptions,
  constraintKindFrom,
  constraintsLevel,
  cutClauses,
  deriveLevel,
  meterScore,
  splitConstraints,
  type BriefField,
} from "./brief-facets";
import {
  STRENGTH_KEYS,
  briefStanding,
  buildBriefStrengthQuestions,
  constraintsStrength,
  LEAVE_MS,
  MIN_GAP_MS,
  PAUSE_MS,
  sendDelay,
  facetTally,
  quickFieldStrength,
  readBriefStrengths,
  splitProbe,
  strangersFirstQuestion,
  strengthFor,
  syncSplitProbes,
  toggleBinding,
  triageFromLines,
  weakestField,
  type StrengthView,
} from "./brief-strength";
import type { SystemOneAnswer } from "./system-one";

const EVERY_FIXTURE = [...FIELD_FIXTURES, ...HOLDOUT_FIELD_FIXTURES];

const empty: ProjectInterviewAnswers = {
  workingTitle: "",
  format: "",
  audience: "",
  goal: "",
  tone: "",
  constraints: "",
  successSignal: "",
};

const answers: ProjectInterviewAnswers = {
  workingTitle: "The Late Bus",
  format: "Essay, about 1,500 words for a city newsletter",
  audience:
    "Hospital operations managers who want to understand AI without the vendor hype.",
  goal: "Convince council members to fund night routes rather than more parking",
  tone: "Engaging",
  constraints: "",
  successSignal: "",
};

const yes = (p: number): SystemOneAnswer => ({ type: "noul", noul: p });
const pick = (
  probabilities: Record<string, number>,
  confidence = 0.6,
): SystemOneAnswer => {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  return { type: "choice", choice, probabilities, confidence };
};
/** A response in which each named facet holds with the given probability. */
const facets = (
  field: BriefField,
  p: Record<string, number>,
): Record<string, SystemOneAnswer> =>
  Object.fromEntries(
    Object.entries(p).map(([id, value]) => [
      STRENGTH_KEYS.facet(field, id),
      yes(value),
    ]),
  );

/* ── The fixture set ───────────────────────────────────────────── */

describe("first look, against the labelled answers", () => {
  test("no gamed answer reads above Partial", () => {
    const gamed = EVERY_FIXTURE.filter((f) => f.kind === "gamed");
    expect(gamed.length).toBeGreaterThanOrEqual(15);
    for (const f of gamed)
      expect([
        f.id,
        quickFieldStrength(f.field, f.text).level <= 2,
      ]).toEqual([f.id, true]);
  });

  test("the measured gaming cases stay down", () => {
    expect(
      quickFieldStrength(
        "constraints",
        "must must must cite sources, keep it under max, not over",
      ).level,
    ).toBeLessThanOrEqual(2);
    expect(
      quickFieldStrength(
        "successSignal",
        "They will share and reply and cite and not ignore 100%",
      ).level,
    ).toBe(1);
    expect(
      quickFieldStrength("format", "Words pages blog not memo only").level,
    ).toBeLessThanOrEqual(2);
  });

  test("no sharp terse answer reads below Partial", () => {
    const terse = EVERY_FIXTURE.filter((f) => f.kind === "terse-sharp");
    expect(terse.length).toBeGreaterThanOrEqual(15);
    for (const f of terse)
      expect([
        f.id,
        quickFieldStrength(f.field, f.text).level >= 2,
      ]).toEqual([f.id, true]);
  });

  test("the answers a length heuristic undergraded now read Specific", () => {
    expect(
      quickFieldStrength(
        "tone",
        "Dry, like a lab notebook; no exclamation marks",
      ).level,
    ).toBe(3);
    expect(
      quickFieldStrength(
        "successSignal",
        "Two of three reviewers stop asking for a control group",
      ).level,
    ).toBe(3);
  });

  test("it never awards Sharp; that is a judgement about what is ruled out", () => {
    for (const f of EVERY_FIXTURE)
      expect(quickFieldStrength(f.field, f.text).level).toBeLessThanOrEqual(3);
  });

  test("long and vague is still vague", () => {
    for (const f of EVERY_FIXTURE.filter((f) => f.kind === "vague-long"))
      expect([
        f.id,
        quickFieldStrength(f.field, f.text).level <= 2,
      ]).toEqual([f.id, true]);
  });

  test("it lands within one level of the editor's band nearly always", () => {
    const off = EVERY_FIXTURE.filter((f) => {
      const level = quickFieldStrength(f.field, f.text).level;
      return level < f.band[0] - 1 || level > f.band[1] + 1;
    });
    expect(off.map((f) => f.id)).toEqual(["constraints-editorial"]);
  });

  test("no constraints is an answer, not a weak one", () => {
    for (const f of EVERY_FIXTURE.filter((f) => f.none)) {
      const v = quickFieldStrength("constraints", f.text);
      expect(v.noneDeclared).toBe(true);
      expect(v.label).toBe("None declared");
      expect(v.hint).toBeNull();
    }
  });
});

describe("level derivation, against the labelled facets", () => {
  test("a fully labelled answer derives into its band", () => {
    let checked = 0;
    for (const f of EVERY_FIXTURE) {
      const defs = FIELD_FACETS[f.field];
      if (!f.facets || !defs.length) continue;
      if (!defs.every((d) => d.id in f.facets!)) continue;
      const level = deriveLevel(f.field, f.facets);
      expect([f.id, level >= f.band[0] && level <= f.band[1]]).toEqual([
        f.id,
        true,
      ]);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(25);
  });

  test("the core facet gates Partial, whatever else holds", () => {
    expect(
      deriveLevel("audience", {
        reader: false,
        knows: true,
        wants: true,
        narrow: true,
      }),
    ).toBe(1);
  });

  test("a reader needs one of knows or wants for Specific, both for Sharp", () => {
    const base = { reader: true, narrow: true };
    expect(deriveLevel("audience", { ...base, knows: false, wants: false })).toBe(
      2,
    );
    expect(deriveLevel("audience", { ...base, knows: true, wants: false })).toBe(
      3,
    );
    expect(deriveLevel("audience", { ...base, knows: true, wants: true })).toBe(
      4,
    );
  });

  test("a goal needs every needed facet; the edge alone separates Sharp", () => {
    const g = { aim: true, change: true, single: true };
    expect(deriveLevel("goal", { ...g, single: false, missable: true })).toBe(2);
    expect(deriveLevel("goal", { ...g, missable: false })).toBe(3);
    expect(deriveLevel("goal", { ...g, missable: true })).toBe(4);
  });

  test("constraints are levelled by what the room can do with each line", () => {
    expect(constraintsLevel(["uncheckable", "uncheckable"])).toBe(1);
    expect(constraintsLevel(["hard", "uncheckable"])).toBe(2);
    expect(constraintsLevel(["preference", "preference"])).toBe(2);
    expect(constraintsLevel(["hard", "preference"])).toBe(3);
    expect(constraintsLevel(["hard", "editorial"])).toBe(4);
  });
});

/* ── First look, in detail ─────────────────────────────────────── */

describe("first look", () => {
  test("an empty answer is Missing and asks for something", () => {
    const v = quickFieldStrength("audience", "  ");
    expect(v.level).toBe(0);
    expect(v.label).toBe("Missing");
    expect(v.hint).toBeTruthy();
  });

  test("generic stand-ins read as Vague and say where they are", () => {
    const audience = quickFieldStrength("audience", "General readers");
    expect(audience.level).toBe(1);
    expect(audience.standIn).toEqual({ start: 0, end: 15 });
    expect(quickFieldStrength("tone", "Engaging").level).toBe(1);
  });

  test("it shows the facets it saw and the words that showed them", () => {
    const v = quickFieldStrength(
      "audience",
      "Transit planners who already know the ridership data but doubt that night service pays for itself",
    );
    expect(v.level).toBe(3);
    const knows = v.facets!.find((f) => f.id === "knows")!;
    expect(knows.met).toBe(true);
    expect(knows.quote).toContain("ridership");
  });

  test("a facet it cannot see is unknown, not failed", () => {
    const v = quickFieldStrength("audience", "Nurses");
    expect(v.facets!.find((f) => f.id === "knows")!.met).toBeNull();
    expect(v.hint).toContain("already");
  });

  test("a cue word counts only when it is about something", () => {
    // "already know and doubt and want things" is all cue.
    const stuffed = quickFieldStrength(
      "audience",
      "skeptical expert practitioners who already know and doubt and want things",
    );
    expect(stuffed.facets!.find((f) => f.id === "knows")!.met).toBeNull();
    expect(stuffed.level).toBeLessThanOrEqual(2);
  });

  test("repetition is padding", () => {
    const padded = quickFieldStrength(
      "goal",
      "Convince the board, convince the board, convince the board to cancel",
    );
    expect(padded.level).toBeLessThanOrEqual(2);
  });

  test("a bare number measures nothing", () => {
    const v = quickFieldStrength("successSignal", "100% of them, 100%");
    expect(v.level).toBe(1);
  });

  test("it stays within one level of the last judgement of a similar text", () => {
    const text = "People who like podcasts";
    const judged = readBriefStrengths(
      { ...empty, audience: text },
      ["audience"],
      facets("audience", { reader: 0.1, knows: 0.1, wants: 0.1, narrow: 0.1 }),
    ).fields.audience!;
    expect(judged.level).toBe(1);
    // Stuffing cue words after a Vague judgement cannot run the meter up.
    const stuffed = `${text} who already know the format and doubt the hosts`;
    expect(quickFieldStrength("audience", stuffed).level).toBe(3);
    expect(quickFieldStrength("audience", stuffed, judged).level).toBe(2);
    // A different answer altogether is read on its own terms.
    const fresh =
      "Transit planners who already know the ridership data but doubt that night service pays";
    expect(quickFieldStrength("audience", fresh, judged).level).toBe(3);
  });
});

/* ── The number on the meter ───────────────────────────────────── */

describe("the meter's number", () => {
  test("each level owns a quarter of the range, so number and label agree", () => {
    for (const f of EVERY_FIXTURE) {
      const v = quickFieldStrength(f.field, f.text);
      if (v.score === undefined || v.level === 0) continue;
      expect([f.id, Math.min(3, Math.floor(v.score / 25)) + 1]).toEqual([
        f.id,
        v.level,
      ]);
    }
    expect(meterScore(1, 0)).toBe(0);
    expect(meterScore(2, 0.5)).toBe(38);
    expect(meterScore(3, 0.99)).toBe(74);
    expect(meterScore(4, 1)).toBe(100);
  });

  test("it moves as the writer sharpens an answer, before any tick flips", () => {
    const steps = [
      "Nurses",
      "ICU nurses",
      "Night-shift ICU nurses at a teaching hospital",
      "Night-shift ICU nurses at a teaching hospital who distrust scheduling software",
      "Night-shift ICU nurses at a teaching hospital who distrust scheduling software after the 2023 rollout",
    ].map((text) => quickFieldStrength("audience", text).score!);
    for (let i = 1; i < steps.length; i++)
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
  });

  test("a judged answer is placed within its level by its facets and its scale", () => {
    const text = answers.audience;
    const at = (knows: number, scale?: number) =>
      readBriefStrengths(answers, ["audience"], {
        ...facets("audience", { reader: 0.9, knows, wants: 0.1, narrow: 0.1 }),
        ...(scale === undefined
          ? {}
          : {
              [STRENGTH_KEYS.scale("audience")]: {
                type: "score" as const,
                score: scale,
                legend: {},
                probabilities: {},
                confidence: 0.8,
              },
            }),
      }).fields.audience!;
    expect(at(0.1).level).toBe(2);
    // Closer to passing reads higher, inside the same level.
    expect(at(0.4).score!).toBeGreaterThan(at(0.1).score!);
    expect(at(0.4).score!).toBeLessThan(50);
    // The scale's position between two levels moves it too.
    expect(at(0.1, 2.8).score!).toBeGreaterThan(at(0.1, 2.1).score!);
    // Two readings a level and a half apart are not a firm one.
    expect(at(0.1, 3.8).uncertain).toBe(true);
    expect(at(0.1, 2.4).uncertain).toBeUndefined();
    expect(text).toBeTruthy();
  });

  test("an unmet facet that is close is marked nearly there", () => {
    const v = readBriefStrengths(
      answers,
      ["audience"],
      facets("audience", { reader: 0.9, knows: 0.45, wants: 0.1, narrow: 0.1 }),
    ).fields.audience!;
    expect(v.facets!.find((f) => f.id === "knows")!.near).toBe(true);
    expect(v.facets!.find((f) => f.id === "wants")!.near).toBeUndefined();
  });

  test("each field with a checklist is also asked its graded scale", () => {
    const q = buildBriefStrengthQuestions(answers, ["audience", "goal"]);
    expect(q[STRENGTH_KEYS.scale("audience")].type).toBe("score");
    expect(q[STRENGTH_KEYS.scale("goal")]).toMatchObject({ type: "score" });
    expect(
      (q[STRENGTH_KEYS.scale("audience")] as { criteria: string[] }).criteria,
    ).toHaveLength(5);
  });

  test("no constraints declared carries no number", () => {
    expect(quickFieldStrength("constraints", "None").score).toBeUndefined();
  });
});

/* ── The judged reading ────────────────────────────────────────── */

describe("questions", () => {
  test("asks each facet of each filled field, and nothing of empty ones", () => {
    const q = buildBriefStrengthQuestions(answers, ["audience", "constraints"]);
    for (const def of FIELD_FACETS.audience)
      expect(q[STRENGTH_KEYS.facet("audience", def.id)].type).toBe("noul");
    expect(Object.keys(q).some((key) => key.startsWith("f_goal_"))).toBe(false);
    expect(Object.keys(q).some((key) => key.startsWith("line_"))).toBe(false);
  });

  test("whole-brief questions wait for enough brief", () => {
    const q = buildBriefStrengthQuestions(answers, ["audience"]);
    expect(Object.keys(q)).toContain("sufficient");
    expect(Object.keys(q)).toContain("contradictory");
    expect(Object.keys(q)).toContain("incompatible");
    expect(Object.keys(q)).toContain("firstq");
    const thin = buildBriefStrengthQuestions(
      { ...answers, goal: "", tone: "", format: "" },
      ["audience"],
    );
    expect(Object.keys(thin)).not.toContain("sufficient");
  });

  test("each constraint line is asked three ways, and only once", () => {
    const withRules = {
      ...answers,
      constraints: "No second person\nUnder 1,200 words",
    };
    const q = buildBriefStrengthQuestions(withRules, ["constraints"]);
    expect(q[STRENGTH_KEYS.line(0, "check")].type).toBe("noul");
    expect(q[STRENGTH_KEYS.line(0, "vague")].type).toBe("noul");
    expect(q[STRENGTH_KEYS.line(1, "kind")].type).toBe("choice");
    expect(q[STRENGTH_KEYS.line(0, "kind")].instructions).toContain(
      "No second person",
    );
    const again = buildBriefStrengthQuestions(withRules, ["constraints"], {
      knownLines: ["No second person"],
    });
    expect(again[STRENGTH_KEYS.line(0, "kind")].instructions).toContain(
      "Under 1,200 words",
    );
    expect(again[STRENGTH_KEYS.line(1, "kind")]).toBeUndefined();
  });

  test("a maximal brief still fits one request", () => {
    const long =
      "Night-shift ICU nurses, who distrust scheduling software, after the 2023 rollout, but want fewer swaps, because of burnout, and so on, and on";
    const q = buildBriefStrengthQuestions(
      {
        workingTitle: long,
        format: long,
        audience: long,
        goal: long,
        tone: long,
        constraints: Array.from({ length: 30 }, (_, i) => `rule ${i}`).join(
          "\n",
        ),
        successSignal: long,
      },
      [
        "workingTitle",
        "format",
        "audience",
        "goal",
        "tone",
        "constraints",
        "successSignal",
      ],
    );
    expect(Object.keys(q).length).toBeLessThanOrEqual(64);
    // The levels survive the cut; the underlines are what goes first.
    expect(q[STRENGTH_KEYS.facet("successSignal", "observable")]).toBeDefined();
    expect(q.sufficient).toBeDefined();
  });

  test("every real fixture brief fits one request", () => {
    for (const brief of [...BRIEF_FIXTURES, ...HOLDOUT_BRIEF_FIXTURES]) {
      const fields = (Object.keys(brief.answers) as BriefField[]).filter((f) =>
        brief.answers[f].trim(),
      );
      const q = buildBriefStrengthQuestions(brief.answers, fields);
      expect(Object.keys(q).length).toBeLessThanOrEqual(64);
      // …with nothing cut: the last question built is still there.
      if (brief.answers.tone.trim())
        expect([brief.id, STRENGTH_KEYS.generic("tone") in q]).toEqual([
          brief.id,
          true,
        ]);
    }
  });
});

describe("judged reading", () => {
  const audience = answers.audience;
  const clauses = clauseOptions(cutClauses(audience));

  test("the level is derived from the facets, pinned to the text", () => {
    const read = readBriefStrengths(
      answers,
      ["audience"],
      facets("audience", { reader: 0.93, knows: 0.12, wants: 0.3, narrow: 0.8 }),
    );
    const v = read.fields.audience!;
    expect(v.level).toBe(2);
    expect(v.label).toBe("Partial");
    expect(v.source).toBe("jev");
    expect(v.value).toBe(audience);
    // The hint is the first unmet facet's, authored, not generated.
    expect(v.hint).toBe(FIELD_FACETS.audience[1].add);
    expect(facetTally(v)).toEqual({ met: 1, of: 3 });

    expect(strengthFor("audience", audience, v).source).toBe("jev");
    // Typing again hands back to the first look until the next judgement.
    expect(strengthFor("audience", `${audience} Also`, v).source).toBe("quick");
  });

  test("the edge is hidden until the needed facets are cleared", () => {
    const partial = readBriefStrengths(
      answers,
      ["audience"],
      facets("audience", { reader: 0.9, knows: 0.1, wants: 0.1, narrow: 0.9 }),
    ).fields.audience!;
    expect(partial.facets!.map((f) => f.id)).toEqual([
      "reader",
      "knows",
      "wants",
    ]);
    const specific = readBriefStrengths(
      answers,
      ["audience"],
      facets("audience", { reader: 0.9, knows: 0.9, wants: 0.9, narrow: 0.4 }),
    ).fields.audience!;
    expect(specific.level).toBe(3);
    expect(specific.facets!.map((f) => f.id)).toContain("narrow");
    expect(specific.hint).toBe(FIELD_FACETS.audience[3].add);
  });

  test("Sharp asks for a clearer yes than Specific does", () => {
    const at = (narrow: number) =>
      readBriefStrengths(
        answers,
        ["audience"],
        facets("audience", { reader: 0.9, knows: 0.9, wants: 0.9, narrow }),
      ).fields.audience!;
    expect(at(0.55).level).toBe(3);
    expect(at(0.7).level).toBe(4);
    expect(at(0.7).hint).toBeNull();
  });

  test("a close call on the deciding facet is reported", () => {
    const v = readBriefStrengths(
      answers,
      ["audience"],
      facets("audience", { reader: 0.9, knows: 0.47, wants: 0.1, narrow: 0.2 }),
    ).fields.audience!;
    expect(v.uncertain).toBe(true);
  });

  test("a field without its level-setting facets gets no reading", () => {
    const read = readBriefStrengths(
      answers,
      ["audience"],
      facets("audience", { reader: 0.9 }),
    );
    expect(read.fields.audience).toBeUndefined();
  });

  test("the stand-in is underlined only when both judgements are firm", () => {
    const base = facets("audience", {
      reader: 0.9,
      knows: 0.1,
      wants: 0.8,
      narrow: 0.2,
    });
    const firm = readBriefStrengths(answers, ["audience"], {
      ...base,
      [STRENGTH_KEYS.generic("audience")]: yes(0.8),
      [STRENGTH_KEYS.standIn("audience")]: pick({
        [clauses[0]]: 0.1,
        [clauses[1]]: 0.7,
        [clauses[2]]: 0.2,
      }),
    }).fields.audience!;
    expect(audience.slice(firm.standIn!.start, firm.standIn!.end)).toBe(
      "who want to understand AI",
    );
    // The unmet facet carries the quote and says what is wrong with it.
    const miss = firm.facets!.find((f) => f.met === false)!;
    expect(miss.quote).toBe("who want to understand AI");
    expect(miss.note).toContain("almost any piece");

    const unsure = readBriefStrengths(answers, ["audience"], {
      ...base,
      [STRENGTH_KEYS.generic("audience")]: yes(0.4),
      [STRENGTH_KEYS.standIn("audience")]: pick({ [clauses[1]]: 0.9 }),
    }).fields.audience!;
    expect(unsure.standIn).toBeNull();
  });

  test("an answer that fits two readings becomes a question", () => {
    const options = FIELD_ARCHETYPES.audience!.options;
    const split = readBriefStrengths(answers, ["audience"], {
      ...facets("audience", { reader: 0.9, knows: 0.1, wants: 0.2, narrow: 0.2 }),
      [STRENGTH_KEYS.arch("audience")]: pick({
        [options[2].option]: 0.44,
        [options[0].option]: 0.38,
        [options[1].option]: 0.18,
      }),
    }).fields.audience!;
    expect(split.split!.options).toEqual([options[2].label, options[0].label]);
    const probe = splitProbe(split.split!);
    expect(probe).toMatchObject({
      id: "split-audience",
      kind: "choice",
      relatesTo: "audience",
    });

    // A settled reading is not a question.
    const settled = readBriefStrengths(answers, ["audience"], {
      ...facets("audience", { reader: 0.9, knows: 0.1, wants: 0.2, narrow: 0.2 }),
      [STRENGTH_KEYS.arch("audience")]: pick({
        [options[2].option]: 0.82,
        [options[0].option]: 0.18,
      }),
    }).fields.audience!;
    expect(settled.split).toBeUndefined();
  });
});

describe("constraint lines", () => {
  const text =
    "Under 1,800 words — the journal's hard limit\nAvoid sounding preachy\nMake it feel fresh";
  const line = (i: number, check: number, vague: number, kind: number) => ({
    [STRENGTH_KEYS.line(i, "check")]: yes(check),
    [STRENGTH_KEYS.line(i, "vague")]: yes(vague),
    [STRENGTH_KEYS.line(i, "kind")]: pick({
      [CONSTRAINT_KIND_OPTIONS[kind]]: 0.9,
    }),
  });
  const response = {
    ...line(0, 0.96, 0.04, 0),
    ...line(1, 0.9, 0.1, 2),
    ...line(2, 0.3, 0.9, 1),
  };

  test("a mid-line dash does not split a rule", () => {
    expect(splitConstraints(text)).toHaveLength(3);
  });

  test("kind follows firmness, then checkability, then source", () => {
    const read = readBriefStrengths(
      { ...empty, constraints: text },
      ["constraints"],
      response,
    );
    expect(Object.values(read.lines).map((l) => l.kind)).toEqual([
      "hard",
      "preference",
      "uncheckable",
    ]);
    const v = constraintsStrength(text, read.lines);
    expect(v.source).toBe("jev");
    expect(v.level).toBe(2);
    expect(v.lines!.map((l) => l.label)).toEqual([
      "Hard · vetoes",
      "Preference · weighs",
      "Uncheckable · ignored",
    ]);
    expect(v.hint).toContain("uncheckable");
  });

  test("a firm line nobody could check is not a veto", () => {
    expect(
      constraintKindFrom({
        checkable: 0.3,
        vague: 0.9,
        kind: { option: CONSTRAINT_KIND_OPTIONS[1], p: 0.8 },
      }).kind,
    ).toBe("uncheckable");
  });

  test("a half-read list keeps its labels and falls back for the level", () => {
    const read = readBriefStrengths(
      { ...empty, constraints: text },
      ["constraints"],
      line(0, 0.96, 0.04, 0),
    );
    const v = constraintsStrength(text, read.lines);
    expect(v.source).toBe("quick");
    expect(v.lines![0].label).toBe("Hard · vetoes");
    expect(v.lines![1].kind).toBeNull();
    expect(triageFromLines(text, read.lines)).toBeNull();
  });

  test("the triage filed with the brief is pinned to the text it read", () => {
    const read = readBriefStrengths(
      { ...empty, constraints: text },
      ["constraints"],
      response,
    );
    const triage = triageFromLines(text, read.lines, 7)!;
    expect(triage.source).toBe(text);
    expect(triage.at).toBe(7);
    expect(triage.lines.map((l) => l.kind)).toEqual([
      "hard",
      "preference",
      "uncheckable",
    ]);
  });

  test("the writer's tap flips a line between binding and weighed", () => {
    expect(toggleBinding("preference")).toBe("editorial");
    expect(toggleBinding("uncheckable")).toBe("editorial");
    expect(toggleBinding("hard")).toBe("preference");
  });
});

describe("whole brief", () => {
  const views = (
    levels: Partial<Record<BriefField, [number, "jev" | "quick"]>>,
  ) =>
    Object.fromEntries(
      Object.entries(levels).map(([field, [level, source]]) => [
        field,
        { level, source } as StrengthView,
      ]),
    ) as Partial<Record<BriefField, StrengthView>>;

  test("tension is the mean of two wordings, and names its pair", () => {
    const filled = {
      ...answers,
      tone: "Snarky, with jokes at the reader's expense",
    };
    const pair = TENSION_PAIRS.find(
      (p) => p.a === "tone" && p.b === "audience",
    )!;
    const read = readBriefStrengths(filled, [], {
      contradictory: yes(0.9),
      incompatible: yes(0.5),
      tension: pick({ [pair.option]: 0.7 }),
      sufficient: yes(0.8),
    });
    expect(read.contradiction).toBeCloseTo(0.7);
    expect(read.tension).toMatchObject({ a: "tone", b: "audience" });
    expect(read.tension!.values).toEqual([filled.tone, filled.audience]);

    // One wording firing alone is a terse brief, not a contradiction.
    const calm = readBriefStrengths(filled, [], {
      contradictory: yes(0.64),
      incompatible: yes(0.16),
      tension: pick({ [pair.option]: 0.7 }),
    });
    expect(calm.tension).toBeNull();
  });

  test("the brief is as strong as its weakest load-bearing answer", () => {
    const s = briefStanding({
      levels: {
        audience: { level: 4, confirmed: true },
        goal: { level: 2, confirmed: true },
        successSignal: { level: 3, confirmed: true },
      },
      sufficiency: 0.9,
      contradiction: 0.1,
      uncheckable: 0,
    });
    expect(s.level).toBe(2);
    expect(s.weakest).toBe("goal");
    expect(s.held).toEqual({ audience: true, goal: false, successSignal: true });
    expect(s.loadBearing).toBe(false);
    expect(s.soft).toEqual(["Goal is partial"]);
  });

  test("only a judged Specific holds; a first look does not", () => {
    const s = briefStanding({
      levels: {
        audience: { level: 3, confirmed: false },
        goal: { level: 3, confirmed: true },
        successSignal: { level: 3, confirmed: true },
      },
      sufficiency: 0.9,
      contradiction: 0.1,
      uncheckable: 0,
    });
    expect(s.held.audience).toBe(false);
    expect(s.loadBearing).toBe(false);
  });

  test("three held answers still need a writable, coherent, checkable brief", () => {
    const held = {
      audience: { level: 3 as const, confirmed: true },
      goal: { level: 4 as const, confirmed: true },
      successSignal: { level: 3 as const, confirmed: true },
    };
    const ok = { sufficiency: 0.8, contradiction: 0.2, uncheckable: 0 };
    expect(briefStanding({ levels: held, ...ok }).loadBearing).toBe(true);
    expect(
      briefStanding({ levels: held, ...ok, sufficiency: 0.4 }).loadBearing,
    ).toBe(false);
    expect(
      briefStanding({ levels: held, ...ok, sufficiency: null }).loadBearing,
    ).toBe(false);
    expect(
      briefStanding({ levels: held, ...ok, contradiction: 0.7 }).loadBearing,
    ).toBe(false);
    expect(
      briefStanding({ levels: held, ...ok, uncheckable: 1 }).soft,
    ).toEqual(["one rule cannot be checked"]);
  });

  test("a stranger's first question goes to the weakest load-bearing answer", () => {
    const filled = { ...answers, successSignal: "People like it" };
    const q = strangersFirstQuestion(
      filled,
      views({
        audience: [3, "jev"],
        goal: [4, "jev"],
        successSignal: [1, "jev"],
        format: [4, "jev"],
      }),
      // Jev's own pick was the reader; the weakest answer outranks it.
      { audience: 0.8, successSignal: 0.1 },
    );
    expect(q).toEqual({
      field: "successSignal",
      question: FIRST_QUESTIONS.successSignal,
    });
  });

  test("…and a blank landing is asked about before a soft goal", () => {
    const q = strangersFirstQuestion(
      answers,
      views({ audience: [3, "jev"], goal: [2, "jev"], format: [4, "jev"] }),
      null,
    );
    expect(q?.field).toBe("successSignal");
  });

  test("Jev's pick breaks a tie between equally weak answers", () => {
    const filled = { ...answers, successSignal: "People like it" };
    const tied = views({
      audience: [1, "jev"],
      goal: [1, "jev"],
      successSignal: [1, "jev"],
    });
    expect(
      strangersFirstQuestion(filled, tied, { audience: 0.7, goal: 0.2 })?.field,
    ).toBe("audience");
    expect(
      strangersFirstQuestion(filled, tied, { audience: 0.2, goal: 0.7 })?.field,
    ).toBe("goal");
  });

  test("a brief that holds has no first question, and a thin one is not asked yet", () => {
    const filled = { ...answers, successSignal: "Dana forwards it to her CFO" };
    expect(
      strangersFirstQuestion(
        filled,
        views({
          audience: [3, "jev"],
          goal: [4, "jev"],
          successSignal: [3, "jev"],
          format: [4, "jev"],
        }),
        null,
      ),
    ).toBeNull();
    expect(
      strangersFirstQuestion({ ...empty, audience: "Nurses" }, {}, null),
    ).toBeNull();
  });
});

/* ── Plumbing ──────────────────────────────────────────────────── */

describe("when to ask for a judgement", () => {
  test("a request waits 350 ms after the last keystroke", () => {
    expect(PAUSE_MS).toBe(350);
    expect(sendDelay("pause", 60_000)).toBe(350);
  });

  test("…and never follows the last request by less than the gap", () => {
    // A burst typist pauses every few words; those pauses share one request.
    expect(sendDelay("pause", 400)).toBe(MIN_GAP_MS - 400);
    expect(sendDelay("pause", MIN_GAP_MS - 100)).toBe(350);
    expect(sendDelay("pause", MIN_GAP_MS)).toBe(350);
  });

  test("leaving the field is read straight away", () => {
    expect(sendDelay("leave", 0)).toBe(LEAVE_MS);
    expect(LEAVE_MS).toBeLessThan(PAUSE_MS);
  });
});

describe("splits filed to Particulars", () => {
  const split: StrengthView = {
    level: 2,
    label: "Partial",
    diagnosis: "",
    hint: null,
    source: "jev",
    split: {
      field: "audience",
      lead: "",
      prompt: "Which reader is this for?",
      options: ["A", "B"],
    },
  };
  const local: DossierProbe = { id: "local-1", kind: "scale", prompt: "How firm?" };

  test("a split files its question ahead of the stock ones", () => {
    const next = syncSplitProbes([local], { audience: split });
    expect(next.map((p) => p.id)).toEqual(["split-audience", "local-1"]);
  });

  test("a resolved split withdraws an unanswered question", () => {
    const filed = syncSplitProbes([local], { audience: split });
    const next = syncSplitProbes(filed, {
      audience: { ...split, split: null },
    });
    expect(next.map((p) => p.id)).toEqual(["local-1"]);
  });

  test("an answered question is the writer's and stays", () => {
    const answered = { ...splitProbe(split.split!), answer: "A" };
    const next = syncSplitProbes([answered, local], {
      audience: { ...split, split: null },
    });
    expect(next[0]).toEqual(answered);
  });

  test("a first look never files a question", () => {
    const next = syncSplitProbes([local], {
      audience: { ...split, source: "quick" },
    });
    expect(next).toEqual([local]);
  });
});

test("weakestField raises load-bearing answers before the rest", () => {
  const v = (level: StrengthView["level"]) => ({ level }) as StrengthView;
  const order: BriefField[] = ["workingTitle", "audience", "goal", "tone"];
  expect(
    weakestField(
      { workingTitle: v(0), audience: v(2), goal: v(1), tone: v(4) },
      order,
    ),
  ).toBe("goal");
  // A Vague tone waits behind a Partial reader.
  expect(weakestField({ audience: v(2), tone: v(1) }, order)).toBe("audience");
  expect(weakestField({ goal: v(3), tone: v(0) }, ["goal", "tone"])).toBeNull();
});
