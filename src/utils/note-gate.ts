/**
 * Grading persona notes before the writer ever sees them.
 *
 * This inverts the usual ladder. Everywhere else the cheap engine answers
 * first and the expensive one is the escalation; here the expensive engine
 * answers and the cheap one decides whether the answer was any good. That
 * works because the two failures are asymmetric: a frontier model writing
 * vague, unactionable advice is common, and *recognising* vague advice is easy
 * — much easier than producing good advice in the first place.
 *
 * At ~$0.00006 per batched pass, gating every note costs less than the note
 * did by three orders of magnitude, so the gate is affordable even when it
 * rejects and forces a rewrite.
 *
 * The composition rule is deliberately not a weighted mean. There are three
 * classes, and they compose differently on purpose:
 *
 *   quality      averages   helpful / actionable / servesGoal
 *   constraints  veto       the brief's non-negotiables
 *   accuracy     veto       the passage, quoted exactly or not at all
 *   adherence    routes     does this read as the editor who signed it
 *
 * A note can be the most helpful, most actionable thing the room has ever
 * produced and still be unusable because the writer said "no second person"
 * and it rewrites a line into second person. Averaging those together would
 * let helpfulness buy off a constraint the writer declared non-negotiable,
 * which is exactly backwards.
 *
 * Adherence is the third case and it is neither of the first two. Averaging it
 * in would promote a beautifully in-voice note that says nothing, and sink an
 * off-voice note that sees something nobody else saw. Vetoing on it would
 * throw away real advice to protect a costume. So it never touches `pass` and
 * never touches `overall`; it decides *which rewrite to ask for*. The
 * mechanical guarantee is that `adherence` is not a member of
 * `NOTE_DIMENSIONS`, which is the only thing `overall` averages over.
 */

import type { ProjectBrief, WriterProfile } from "../types";
import {
  noul,
  score as scoreQuestion,
  isScore,
  isNoul,
  scoreOutOf,
  type SystemOneAnswer,
  type SystemOneQuestion,
} from "./system-one";

/** Quality dimensions, worst-first, as the writer would experience them. */
const HELPFUL_LEVELS = [
  "Useless — restates the draft or says nothing the writer did not know",
  "Vague — gestures at a problem without locating it",
  "Fair — names a real issue but shallowly",
  "Helpful — names a real issue and why it matters",
  "Incisive — names something the writer could not have seen alone",
];

const ACTIONABLE_LEVELS = [
  "Not actionable — the writer cannot tell what to change",
  "Barely — implies a direction but no concrete move",
  "Somewhat — a change is implied and could be inferred",
  "Actionable — a specific change to a specific place",
  "Immediately actionable — the writer could apply it without rereading",
];

const SERVES_GOAL_LEVELS = [
  "Works against the goal — following it would hurt the piece",
  "Irrelevant to the goal — true but beside the point",
  "Neutral — a general writing improvement",
  "Serves the goal — advances what this piece is trying to do",
  "Strongly serves the goal — moves the piece toward its success signal",
];

export const NOTE_DIMENSIONS = ["helpful", "actionable", "servesGoal"] as const;
export type NoteDimension = (typeof NOTE_DIMENSIONS)[number];

/**
 * How much the note reads as the editor who signed it. Worst-first.
 *
 * Deliberately about *manner*, not correctness — the substance is already
 * covered by the three quality dimensions, and asking one question to judge
 * both produces a number that means neither.
 */
const ADHERENCE_LEVELS = [
  "Not this editor — could have come from anyone, or reads as a different editor entirely",
  "Faint — the subject is within their remit but the manner is not theirs",
  "Recognisable — broadly their register, with lapses",
  "In character — reads as this editor on an ordinary day",
  "Unmistakable — only this editor would have written it, in their own manner",
];

/**
 * How well the note adheres to and respects the writer's stated facts, background,
 * and lived experience. Worst-first.
 */
export const FACT_ADHERENCE_LEVELS = [
  "Contradictory — directly contradicts or denies the writer's stated facts or background",
  "Disregarding — ignores stated facts and makes inaccurate or tone-deaf assumptions",
  "Neutral — neither contradicts nor specifically accounts for stated facts",
  "Consistent — respects the writer's facts and background without friction",
  "Deeply grounded — specifically honours the writer's background and lived experience",
];

/**
 * How well the note adheres to the writer's preferences for how they like feedback.
 * Worst-first.
 */
export const FEEDBACK_ADHERENCE_LEVELS = [
  "Defiant — violates the writer's feedback guidance, pressure, or avoidances",
  "Mismatched — tone, pressure, or focus clashes noticeably with what the writer requested",
  "Acceptable — generally compatible with the writer's guidance, with minor lapses",
  "Attuned — well-matched to the writer's requested pressure, tone, and focus",
  "Exemplary — precisely embodies how the writer asked to be critiqued",
];

/* ── Questions ─────────────────────────────────────────────────── */

/**
 * Independent questions batch into one request and run in parallel, so all
 * five below cost roughly what one costs. They cannot see each other's
 * answers, which is fine — none of them needs to.
 */
export function buildNoteQuestions(opts: {
  /** Skip the constraint veto when the brief declares none. */
  hasConstraints: boolean;
  /** Grade voice only when the persona actually specifies one to grade against. */
  hasPersonaVoice?: boolean;
  /** Ask the avoidance question only when the persona declares avoidances. */
  hasAvoidances?: boolean;
  /** Check adherence to the writer's stated facts and background context. */
  hasWriterFacts?: boolean;
  /** Check adherence to how the writer specifically likes feedback. */
  hasFeedbackPreferences?: boolean;
}): Record<string, SystemOneQuestion> {
  const questions: Record<string, SystemOneQuestion> = {
    helpful: scoreQuestion(
      "Rate how helpful this note is to the writer, given the passage it is about and the draft it sits in.",
      HELPFUL_LEVELS,
    ),
    actionable: scoreQuestion(
      "Rate how actionable this note is: could the writer tell exactly what to change, and where?",
      ACTIONABLE_LEVELS,
    ),
    servesGoal: scoreQuestion(
      "Rate how well following this note would serve the stated goal of the piece for its stated audience.",
      SERVES_GOAL_LEVELS,
    ),
    // Asked unconditionally: the passage is always in state, and a note that
    // puts words in the draft's mouth is wrong no matter how helpful it is.
    misquotesPassage: noul(
      "Does the note attribute to the quoted `passage` words, claims, or positions the passage does not contain? Answer yes only for genuine misquotation — a paraphrase that preserves meaning is not misquotation.",
    ),
  };

  // A Noul, not a Score, because this is a yes/no fact about the brief rather
  // than a quality judgement. Asking it as a Score would invite the model to
  // rate *how badly* it violates, which is not a question anyone asked.
  if (opts.hasConstraints) {
    questions.violatesConstraints = noul(
      "Does following this note require breaking any of the writer's stated constraints? Answer yes only if the note is actually incompatible with a constraint, not merely unrelated to it.",
    );
  }

  // Adherence is asked separately from the three quality dimensions and is
  // never averaged with them. See the module header: it routes a rewrite, it
  // does not decide whether the note is good.
  if (opts.hasPersonaVoice) {
    questions.adherence = scoreQuestion(
      "Rate how much this note reads as written by the editor described in `advisor`: their diction, rhythm, and characteristic moves. Judge manner only — whether the advice is correct or useful is asked separately.",
      ADHERENCE_LEVELS,
    );
  }
  if (opts.hasAvoidances) {
    // Noul, and shaped like the constraint question, because it is the same
    // kind of fact: a declared "never". It still does not veto — breaking
    // character is a costume problem, not a correctness problem.
    questions.breaksAvoidance = noul(
      "Does this note do something the editor described in `advisor` explicitly avoids? Answer yes only for a listed avoidance, not for anything merely unusual for them.",
    );
  }

  if (opts.hasWriterFacts) {
    questions.violatesWriterFacts = noul(
      "Does this note contradict, misrepresent, or disregard any of the writer's stated facts, background, or lived experience in `writerFacts`? Answer yes only if the note assumes something incompatible with the stated facts.",
    );
    questions.factAdherence = scoreQuestion(
      "Rate how well this note adheres to and respects the writer's stated facts, background, and domain context in `writerFacts`.",
      FACT_ADHERENCE_LEVELS,
    );
  }

  if (opts.hasFeedbackPreferences) {
    questions.violatesFeedbackPreferences = noul(
      "Does this note disregard or violate the writer's stated preferences on how they like feedback in `feedbackPreferences` (e.g., ignoring requested feedback pressure, engaging in explicit avoidances, or violating their feedback guidance)?",
    );
    questions.feedbackAdherence = scoreQuestion(
      "Rate how well this note adheres to how the writer likes to receive feedback described in `feedbackPreferences`.",
      FEEDBACK_ADHERENCE_LEVELS,
    );
  }

  return questions;
}

export function buildNoteState(input: {
  note: string;
  quote: string;
  persona?: string;
  brief?: ProjectBrief | null;
  /** Surrounding draft, for whether the note is redundant with what's there. */
  draftExcerpt?: string;
  writerProfile?: WriterProfile | null;
}): Record<string, string> {
  const state: Record<string, string> = {
    note: input.note,
    passage: input.quote,
  };
  if (input.persona) state.advisor = input.persona;
  if (input.draftExcerpt) state.draft = input.draftExcerpt;

  const a = input.brief?.answers;
  if (a) {
    if (a.audience) state.audience = a.audience;
    if (a.goal) state.goal = a.goal;
    if (a.tone) state.tone = a.tone;
    if (a.constraints) state.constraints = a.constraints;
    if (a.successSignal) state.successSignal = a.successSignal;
  }

  if (input.writerProfile) {
    const wp = input.writerProfile;
    if (wp.personalFacts?.trim()) {
      state.writerFacts = wp.personalFacts.trim();
    }
    const prefLines: string[] = [];
    prefLines.push(`Feedback pressure: ${wp.feedbackStyle}`);
    if (wp.critiqueTone) {
      prefLines.push(`Critique delivery tone: ${wp.critiqueTone}`);
    }
    if (wp.praisePreference) {
      prefLines.push(`Praise preference: ${wp.praisePreference}`);
    }
    if (wp.factChecking) {
      prefLines.push(`Fact adherence mode: ${wp.factChecking}`);
    }
    if (wp.feedbackFocus && wp.feedbackFocus.length > 0) {
      prefLines.push(`Priority focus areas: ${wp.feedbackFocus.join(", ")}`);
    }
    if (wp.feedbackNotes?.trim()) {
      prefLines.push(`Feedback guidance: ${wp.feedbackNotes.trim()}`);
    }
    if (wp.feedbackAvoid?.trim()) {
      prefLines.push(`Things to avoid in feedback: ${wp.feedbackAvoid.trim()}`);
    }
    state.feedbackPreferences = prefLines.join("\n");
  }

  return state;
}

/* ── Verdict ───────────────────────────────────────────────────── */

export interface NoteDimensionScore {
  /** 0–10. */
  score: number;
  confidence: number;
  /** The level description the score landed nearest — the rewrite feedback. */
  nearestLevel: string;
}

export interface NoteVerdict {
  dimensions: Partial<Record<NoteDimension, NoteDimensionScore>>;
  /** Mean of the graded dimensions, 0–10. */
  overall: number;
  /** Probability the note breaks a stated constraint. */
  violationRisk: number | null;
  /** Probability the note misquotes the passage it comments on. */
  quoteRisk: number | null;
  /**
   * How much the note reads as its signatory. Deliberately outside
   * `dimensions`, so it cannot reach `overall` or `pass`.
   */
  adherence: NoteDimensionScore | null;
  /** Probability the note does something this editor declared they never do. */
  breaksAvoidance: number | null;
  /** How well the note adheres to the writer's stated facts and background context. */
  factAdherence: NoteDimensionScore | null;
  /** Probability the note contradicts or misrepresents stated facts. */
  factViolationRisk: number | null;
  /** How well the note adheres to how the writer likes feedback. */
  feedbackAdherence: NoteDimensionScore | null;
  /** Probability the note disregards feedback guidance. */
  preferenceViolationRisk: number | null;
  /** Vetoed on brief constraints or severe fact contradiction, regardless of quality. */
  vetoed: boolean;
  pass: boolean;
  /** Why it failed, in the writer's terms — also the rewrite instruction. */
  reasons: string[];
  /**
   * What a retry should fix. `null` when nothing needs fixing. Substance,
   * voice, facts, and preferences are separable repairs.
   */
  rewriteKind: RewriteKind | null;
}

export type RewriteKind =
  | "constraint"
  | "accuracy"
  | "substance"
  | "voice"
  | "facts"
  | "preference"
  | "both";

export interface NoteGateThresholds {
  /** Mean quality a note must reach. */
  minOverall: number;
  /** A single dimension this low sinks the note even if the mean is fine. */
  minDimension: number;
  /**
   * Veto above this probability of breaking a constraint. Not 0.5: a Noul at
   * 0.5 means *genuinely uncertain*, and discarding a note on a coin flip
   * throws away good advice. Err toward showing it and letting the writer
   * judge, because they are the one who wrote the constraint.
   */
  maxViolationRisk: number;
  /**
   * Below this, the note is worth re-asking in voice. Set lower than
   * `minDimension`: a note only mildly out of character is not worth a
   * frontier call, and chasing perfect mimicry produces pastiche.
   */
  minAdherence: number;
  /** Treat a misquotation of the passage as disqualifying above this risk. */
  maxQuoteRisk: number;
  /** Treat a declared avoidance as broken above this probability. */
  maxAvoidanceRisk: number;
  /** Treat stated writer facts as violated above this probability. */
  maxFactViolationRisk: number;
  /** Minimum acceptable score for adhering to stated writer facts. */
  minFactAdherence: number;
  /** Treat declared feedback preferences/avoidances as violated above this risk. */
  maxPreferenceViolationRisk: number;
  /** Minimum acceptable score for adhering to feedback preferences. */
  minFeedbackAdherence: number;
}

export const DEFAULT_NOTE_THRESHOLDS: NoteGateThresholds = {
  minOverall: 5,
  minDimension: 3,
  maxViolationRisk: 0.75,
  maxQuoteRisk: 0.75,
  minAdherence: 2.5,
  maxAvoidanceRisk: 0.75,
  maxFactViolationRisk: 0.75,
  minFactAdherence: 3,
  maxPreferenceViolationRisk: 0.75,
  minFeedbackAdherence: 3,
};

function nearest(legend: Record<string, string>, level: number): string {
  return legend[String(Math.round(level))] ?? "";
}

export function readNoteVerdict(
  answers: Record<string, SystemOneAnswer>,
  thresholds: NoteGateThresholds = DEFAULT_NOTE_THRESHOLDS,
): NoteVerdict {
  const dimensions: Partial<Record<NoteDimension, NoteDimensionScore>> = {};
  for (const dim of NOTE_DIMENSIONS) {
    const a = answers[dim];
    if (!isScore(a)) continue;
    dimensions[dim] = {
      score: scoreOutOf(a, 10),
      confidence: a.confidence,
      nearestLevel: nearest(a.legend, a.score),
    };
  }

  const present = Object.values(dimensions);
  const overall = present.length
    ? present.reduce((s, d) => s + d.score, 0) / present.length
    : 0;

  const violation = answers.violatesConstraints;
  const violationRisk = isNoul(violation) ? violation.noul : null;
  const quote = answers.misquotesPassage;
  const quoteRisk = isNoul(quote) ? quote.noul : null;

  const adherenceAnswer = answers.adherence;
  const adherence = isScore(adherenceAnswer)
    ? {
        score: scoreOutOf(adherenceAnswer, 10),
        confidence: adherenceAnswer.confidence,
        nearestLevel: nearest(adherenceAnswer.legend, adherenceAnswer.score),
      }
    : null;
  const avoidanceAnswer = answers.breaksAvoidance;
  const breaksAvoidance = isNoul(avoidanceAnswer) ? avoidanceAnswer.noul : null;

  const factViolationAnswer = answers.violatesWriterFacts;
  const factViolationRisk = isNoul(factViolationAnswer)
    ? factViolationAnswer.noul
    : null;
  const factAdherenceAnswer = answers.factAdherence;
  const factAdherence = isScore(factAdherenceAnswer)
    ? {
        score: scoreOutOf(factAdherenceAnswer, 10),
        confidence: factAdherenceAnswer.confidence,
        nearestLevel: nearest(
          factAdherenceAnswer.legend,
          factAdherenceAnswer.score,
        ),
      }
    : null;

  const prefViolationAnswer = answers.violatesFeedbackPreferences;
  const preferenceViolationRisk = isNoul(prefViolationAnswer)
    ? prefViolationAnswer.noul
    : null;
  const feedbackAdherenceAnswer = answers.feedbackAdherence;
  const feedbackAdherence = isScore(feedbackAdherenceAnswer)
    ? {
        score: scoreOutOf(feedbackAdherenceAnswer, 10),
        confidence: feedbackAdherenceAnswer.confidence,
        nearestLevel: nearest(
          feedbackAdherenceAnswer.legend,
          feedbackAdherenceAnswer.score,
        ),
      }
    : null;

  const constraintVetoed =
    violationRisk !== null && violationRisk > thresholds.maxViolationRisk;
  const quoteVetoed = quoteRisk !== null && quoteRisk > thresholds.maxQuoteRisk;
  const factVetoed =
    factViolationRisk !== null &&
    factViolationRisk > thresholds.maxFactViolationRisk;
  const vetoed = constraintVetoed || quoteVetoed || factVetoed;

  const reasons: string[] = [];
  if (constraintVetoed) {
    reasons.push("Conflicts with a constraint stated in the brief.");
  }
  if (quoteVetoed) {
    reasons.push("Misquotes the passage it comments on.");
  }
  if (factVetoed) {
    reasons.push(
      "Contradicts or misrepresents the writer's stated facts or background context.",
    );
  }
  for (const [dim, d] of Object.entries(dimensions) as [
    NoteDimension,
    NoteDimensionScore,
  ][]) {
    if (d.score < thresholds.minDimension) {
      // The level description, not the number: "Vague — gestures at a problem
      // without locating it" tells a model what to fix. "helpful: 2.1" does not.
      reasons.push(`${dim}: ${d.nearestLevel}`);
    }
  }
  if (!vetoed && overall < thresholds.minOverall && reasons.length === 0) {
    reasons.push("Below the quality bar overall without one clear weak spot.");
  }

  const substanceFailed =
    overall < thresholds.minOverall ||
    present.some((d) => d.score < thresholds.minDimension);
  const voiceFailed =
    (adherence !== null && adherence.score < thresholds.minAdherence) ||
    (breaksAvoidance !== null && breaksAvoidance > thresholds.maxAvoidanceRisk);
  const factsFailed =
    factVetoed ||
    (factAdherence !== null &&
      factAdherence.score < thresholds.minFactAdherence);
  const preferenceFailed =
    (preferenceViolationRisk !== null &&
      preferenceViolationRisk > thresholds.maxPreferenceViolationRisk) ||
    (feedbackAdherence !== null &&
      feedbackAdherence.score < thresholds.minFeedbackAdherence);

  // Voice, fact, and preference reasons are recorded after quality
  if (voiceFailed) {
    if (
      breaksAvoidance !== null &&
      breaksAvoidance > thresholds.maxAvoidanceRisk
    ) {
      reasons.push("Does something this editor is described as never doing.");
    } else if (adherence) {
      reasons.push(`voice: ${adherence.nearestLevel}`);
    }
  }
  if (factsFailed && !factVetoed && factAdherence) {
    reasons.push(`facts: ${factAdherence.nearestLevel}`);
  }
  if (preferenceFailed) {
    if (
      preferenceViolationRisk !== null &&
      preferenceViolationRisk > thresholds.maxPreferenceViolationRisk
    ) {
      reasons.push(
        "Disregards how the writer likes to receive feedback or engages in declared avoidances.",
      );
    } else if (feedbackAdherence) {
      reasons.push(`feedback style: ${feedbackAdherence.nearestLevel}`);
    }
  }

  const rewriteKind: RewriteKind | null = constraintVetoed
    ? "constraint"
    : quoteVetoed
      ? "accuracy"
      : factVetoed || factsFailed
        ? "facts"
        : preferenceFailed
          ? "preference"
          : substanceFailed && voiceFailed
            ? "both"
            : substanceFailed
              ? "substance"
              : voiceFailed
                ? "voice"
                : null;

  return {
    dimensions,
    overall,
    violationRisk,
    quoteRisk,
    adherence,
    breaksAvoidance,
    factAdherence,
    factViolationRisk,
    feedbackAdherence,
    preferenceViolationRisk,
    vetoed,
    pass:
      !vetoed &&
      overall >= thresholds.minOverall &&
      present.every((d) => d.score >= thresholds.minDimension),
    reasons,
    rewriteKind,
  };
}

/* ── Rewriting ─────────────────────────────────────────────────── */

/**
 * At most two retries. A model that has failed the same gate three times is
 * not going to pass it on the fourth; it has misread the passage, and burning
 * further frontier calls on it costs real money for no gain.
 */
export const MAX_REWRITES = 2;

/**
 * Turn a failed verdict into an instruction. Phrased as what to do rather than
 * what went wrong, because "be more specific about which sentence" produces a
 * better second attempt than "your note scored 2.1 on actionable".
 *
 * The instruction is routed by `rewriteKind`. Asking a model to fix its voice
 * when the substance was the problem reliably produces a better-dressed
 * version of the same empty note, and asking it to fix substance when only the
 * voice slipped throws away a good observation.
 */
export function rewriteInstruction(verdict: NoteVerdict): string {
  const lines = ["Revise the note. It did not meet the bar:"];
  for (const reason of verdict.reasons) lines.push(`- ${reason}`);

  switch (verdict.rewriteKind) {
    case "constraint":
      lines.push(
        "Rewrite so it respects the writer's stated constraints. If the point cannot be made without breaking one, drop it and make a different point about this passage.",
      );
      break;
    case "accuracy":
      lines.push(
        "Quote the passage exactly as written. Do not put words in the draft's mouth: paraphrase only without quotation marks, and never treat a paraphrase as evidence for the point.",
      );
      break;
    case "facts":
      lines.push(
        "Rewrite so it adheres strictly to the writer's stated personal facts and background context. Do not make false assumptions or contradict what the writer established.",
      );
      break;
    case "preference":
      lines.push(
        "Rewrite so it honours how the writer likes to receive feedback: match their requested feedback pressure, tone, and focus areas, and observe their guidance.",
      );
      break;
    case "voice":
      lines.push(
        "Keep the observation exactly as it is — it is sound. Rewrite only the manner so it reads as this editor: their diction, their rhythm, their characteristic moves. Do not soften or broaden the point to achieve it.",
      );
      break;
    case "both":
      lines.push(
        "Name the specific sentence or phrase, say what is wrong with it, and say what to do instead. Then make sure it reads as this editor rather than a generic reviewer. Do not restate the passage.",
      );
      break;
    default:
      lines.push(
        "Name the specific sentence or phrase, say what is wrong with it, and say what to do instead. Do not restate the passage.",
      );
  }
  return lines.join("\n");
}

/**
 * Convenience helper to build questions specifically checking adherence to writer facts
 * and feedback preferences.
 */
export function buildAdherenceQuestions(
  profile: WriterProfile,
): Record<string, SystemOneQuestion> {
  return buildNoteQuestions({
    hasConstraints: false,
    hasWriterFacts: Boolean(profile.personalFacts?.trim()),
    hasFeedbackPreferences: true,
  });
}

export interface FeedbackAdherenceReport {
  factAdherence: {
    score: number;
    level: string;
    violationRisk: number | null;
  } | null;
  feedbackAdherence: {
    score: number;
    level: string;
    violationRisk: number | null;
  } | null;
  passes: boolean;
  reasons: string[];
}

export function evaluateFeedbackAdherence(
  answers: Record<string, SystemOneAnswer>,
  thresholds: NoteGateThresholds = DEFAULT_NOTE_THRESHOLDS,
): FeedbackAdherenceReport {
  const verdict = readNoteVerdict(answers, thresholds);
  return {
    factAdherence: verdict.factAdherence
      ? {
          score: verdict.factAdherence.score,
          level: verdict.factAdherence.nearestLevel,
          violationRisk: verdict.factViolationRisk,
        }
      : null,
    feedbackAdherence: verdict.feedbackAdherence
      ? {
          score: verdict.feedbackAdherence.score,
          level: verdict.feedbackAdherence.nearestLevel,
          violationRisk: verdict.preferenceViolationRisk,
        }
      : null,
    passes:
      (verdict.factViolationRisk === null ||
        verdict.factViolationRisk <= thresholds.maxFactViolationRisk) &&
      (verdict.factAdherence === null ||
        verdict.factAdherence.score >= thresholds.minFactAdherence) &&
      (verdict.preferenceViolationRisk === null ||
        verdict.preferenceViolationRisk <=
          thresholds.maxPreferenceViolationRisk) &&
      (verdict.feedbackAdherence === null ||
        verdict.feedbackAdherence.score >= thresholds.minFeedbackAdherence),
    reasons: verdict.reasons.filter(
      (r) =>
        r.includes("facts") ||
        r.includes("feedback") ||
        r.includes("stated facts"),
    ),
  };
}

/* ── Initiation ────────────────────────────────────────────────── */

/**
 * What the gate is allowed to do with a verdict, which depends entirely on who
 * asked for it.
 *
 * `filter` — the room was convened, so the writer asked for notes and not for
 * a critique of the notes. The gate may suppress and retry silently; that is
 * the service being performed.
 *
 * `annotate` — the writer is looking at a note and asked what we make of it.
 * Hiding it now would be answering a question they did not ask, and would hide
 * the very thing they pointed at. Nothing is suppressed; the verdict becomes a
 * label beside the note.
 *
 * The distinction exists because a user-initiated review and a generation-time
 * gate share all of their scoring and none of their authority.
 */
export type NoteGateMode = "filter" | "annotate";

export interface NoteGateAction {
  /** Whether the writer sees the note at all. */
  show: boolean;
  /** What a retry should repair, or `null` to accept as-is. */
  rewrite: RewriteKind | null;
}

/**
 * Policy over a cached verdict. Pure and synchronous, like `viewRubricGrade`:
 * a writer moving a threshold re-renders from the verdict already in hand, and
 * no judgement is ever re-run to answer a slider.
 */
export function noteAction(
  verdict: NoteVerdict,
  mode: NoteGateMode,
  attempt = 0,
): NoteGateAction {
  if (mode === "annotate") {
    // Never hide what the writer explicitly pointed at.
    return { show: true, rewrite: null };
  }
  if (verdict.pass && verdict.rewriteKind === null) {
    return { show: true, rewrite: null };
  }
  if (attempt >= MAX_REWRITES) {
    // Out of retries. A vetoed note is withheld — it breaks something the
    // writer declared — but a merely mediocre one is still shown, because a
    // weak note the writer can ignore beats a silent room.
    return { show: !verdict.vetoed, rewrite: null };
  }
  return { show: !verdict.vetoed, rewrite: verdict.rewriteKind };
}

/**
 * Keep the best attempt, not the last one. A rewrite can come back worse, and
 * having paid for both there is no reason to show the worse one. Vetoed
 * attempts always lose to un-vetoed ones regardless of score.
 */
export function bestAttempt<T>(
  attempts: { note: T; verdict: NoteVerdict }[],
): { note: T; verdict: NoteVerdict } | null {
  if (attempts.length === 0) return null;
  return attempts.reduce((best, a) => {
    if (best.verdict.vetoed !== a.verdict.vetoed) {
      return best.verdict.vetoed ? a : best;
    }
    return a.verdict.overall > best.verdict.overall ? a : best;
  });
}
