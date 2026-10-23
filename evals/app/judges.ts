/**
 * LLM-as-judge for the app evals.
 *
 * The faithfulness and helpfulness rubrics are imported from `evals/judge.ts`
 * unchanged, so a score here means the same thing as a score from
 * `bun run eval:judge` and from the two Arize template evaluators it mirrors
 * (faithfulness-to-draft, feedback-helpfulness). The rubrics that only make
 * sense with the app's corpus (planted weaknesses, rewrite improvement) are
 * defined below.
 *
 * Judges are optional. `--judge none` scores with the deterministic checks
 * alone, which is what CI and the mock model use.
 */
import { createEvalClient } from "../llm-client";
import {
  CHOICES,
  FAITHFULNESS_TEMPLATE,
  HELPFULNESS_TEMPLATE,
  judgeSystemPrompt,
  parseVerdict,
  type Verdict,
} from "../judge";
import type { Score } from "./scoring";

export type JudgeMode = "none" | "notorganic" | "openai-compatible";

export interface Judge {
  label: string;
  complete(system: string, user: string, signal: AbortSignal): Promise<string>;
}

type Env = Readonly<Record<string, string | undefined>>;

export function createJudge(mode: JudgeMode, env: Env): Judge | null {
  if (mode === "none") return null;
  if (mode === "notorganic") {
    const complete = createEvalClient(env);
    const model = env.JUDGE_MODEL ?? "reasoning";
    return {
      label: `notorganic:${model}`,
      complete: (system, user, signal) =>
        complete(
          {
            model,
            temperature: 0,
            // Same headroom as the app (NO_OUTPUT_CEILING in convex/agents.ts):
            // the gateway's default lets a reasoning model think past it.
            max_tokens: 16_000,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          },
          signal,
        ),
    };
  }
  const baseUrl = env.TWYNE_JUDGE_BASE_URL?.trim().replace(/\/+$/, "");
  const model = env.TWYNE_JUDGE_MODEL?.trim();
  if (!baseUrl || !model)
    throw new Error(
      "TWYNE_JUDGE_BASE_URL and TWYNE_JUDGE_MODEL are required for --judge openai-compatible",
    );
  return {
    label: `openai-compatible:${model}`,
    async complete(system, user, signal) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(env.TWYNE_JUDGE_API_KEY
            ? { authorization: `Bearer ${env.TWYNE_JUDGE_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Judge request failed (${response.status})`);
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string")
        throw new Error("Judge response missing content");
      return content;
    },
  };
}

async function labelled(
  judge: Judge,
  prompt: string,
  valid: Record<string, number>,
): Promise<Verdict> {
  const raw = await judge.complete(
    judgeSystemPrompt(Object.keys(valid)),
    prompt,
    AbortSignal.timeout(120_000),
  );
  return parseVerdict(raw, valid);
}

export function judgeFaithfulness(
  judge: Judge,
  draft: string,
  output: string,
): Promise<Verdict> {
  return labelled(
    judge,
    FAITHFULNESS_TEMPLATE(draft, output),
    CHOICES.faithfulness,
  );
}

export function judgeHelpfulness(
  judge: Judge,
  persona: string,
  draft: string,
  output: string,
): Promise<Verdict> {
  return labelled(
    judge,
    HELPFULNESS_TEMPLATE(persona, draft, output),
    CHOICES.helpfulness,
  );
}

/**
 * A graded read of one editor's note: the faithfulness and helpfulness
 * rubrics above pass nearly every competent note (1.00 and 0.98 on the first
 * Not Organic run), so they cannot rank one room against another. This asks
 * how much the note is worth to the writer, on anchored levels, and states
 * the expected distribution so "competent" lands in the middle.
 */
export async function judgeNoteValue(
  judge: Judge,
  input: { draft: string; persona: string; note: string; anchor?: string },
): Promise<{ score: number | null; label: string; explanation: string }> {
  const raw = await judge.complete(
    `You are a demanding senior editor grading another editor's note. Respond with a JSON object exactly: ` +
      `{"level": <integer 1-5>, "explanation": "<one sentence naming what the note gets right or wrong>"}. No other text.`,
    `Grade how much this note is worth to the writer of this draft.\n\n` +
      `1 = generic, wrong about the draft, or misreads the passage it quotes.\n` +
      `2 = about this draft but obvious or surface-level: restates the passage, praises or objects without a reason, or offers no usable next move.\n` +
      `3 = specific and correct, with a usable next move; what a competent editor writes.\n` +
      `4 = specific and correct, and names a non-obvious problem or strength with a concrete move that would change the next draft.\n` +
      `5 = the observation a top editor would lead with for this piece; it reframes the draft's main problem or protects its best move.\n\n` +
      `Most competent notes are a 3. Give 4 or 5 only when the note says something a careful writer would likely not have seen themselves. ` +
      `Check the note against the passage it quotes: a note that misdescribes it cannot score above 2.\n\n` +
      `Editor: ${input.persona}\n` +
      (input.anchor ? `Passage the note quotes:\n"${input.anchor}"\n\n` : "") +
      `Note:\n${input.note}\n\nDraft:\n${input.draft}`,
    AbortSignal.timeout(120_000),
  );
  const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  try {
    const parsed = JSON.parse(json) as {
      level?: unknown;
      explanation?: unknown;
    };
    const level = Number(parsed.level);
    if (!Number.isInteger(level) || level < 1 || level > 5)
      throw new Error("level");
    return {
      score: (level - 1) / 4,
      label: `level ${level}`,
      explanation:
        typeof parsed.explanation === "string" ? parsed.explanation : "",
    };
  } catch {
    return {
      score: null,
      label: "judge-error",
      explanation: raw.slice(0, 200),
    };
  }
}

/** Longer label first: the fallback parser matches by substring. */
const IMPROVEMENT = { not_improved: 0, improved: 1 };

export function judgeRewrite(
  judge: Judge,
  input: {
    draft: string;
    original: string;
    problem: string;
    replacement: string;
  },
): Promise<Verdict> {
  return labelled(
    judge,
    `An editor was asked to rewrite one passage of a draft.\n\n` +
      `Draft (context only):\n${input.draft}\n\n` +
      `Original passage:\n${input.original}\n\n` +
      `What was wrong with it:\n${input.problem}\n\n` +
      `Proposed replacement:\n${input.replacement}\n\n` +
      `Answer "improved" if the replacement fixes the stated problem, keeps the ` +
      `passage's meaning and facts, and would read naturally in the draft. ` +
      `Answer "not_improved" if it misses the problem, changes the meaning, ` +
      `drops facts, or reads worse.`,
    IMPROVEMENT,
  );
}

/**
 * How many planted weaknesses the rubric's feedback names. Returns the share
 * found, with the judge's list as the explanation and one item per weakness
 * (`w1`, `w2`, ...) so Jev's reading of the same weaknesses can be joined.
 * A reply with no readable list is a judge failure, not a recall of zero.
 */
export async function judgeWeaknessRecall(
  judge: Judge,
  input: { draft: string; weaknesses: string[]; feedback: string },
): Promise<Score> {
  const numbered = input.weaknesses.map((w, i) => `${i + 1}. ${w}`).join("\n");
  const raw = await judge.complete(
    `You are a strict evaluator. Respond with a JSON object exactly: ` +
      `{"identified": [<numbers of the weaknesses the feedback identifies>], "explanation": "<one sentence>"}. No other text.`,
    `A draft was written with known weaknesses. Decide which of them the ` +
      `reviewers' feedback identifies, in substance and about this draft. ` +
      `General advice that happens to fit does not count.\n\n` +
      `Draft:\n${input.draft}\n\nKnown weaknesses:\n${numbered}\n\n` +
      `Reviewers' feedback:\n${input.feedback}`,
    AbortSignal.timeout(120_000),
  );
  const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  let identified: number[] = [];
  let explanation = "";
  try {
    const parsed = JSON.parse(json) as {
      identified?: unknown;
      explanation?: unknown;
    };
    if (!Array.isArray(parsed.identified)) throw new Error("no list");
    identified = parsed.identified
      .map(Number)
      .filter(
        (n) => Number.isInteger(n) && n >= 1 && n <= input.weaknesses.length,
      );
    explanation =
      typeof parsed.explanation === "string" ? parsed.explanation : "";
  } catch {
    return {
      score: null,
      label: "judge-error",
      explanation: raw.slice(0, 200),
    };
  }
  const found = new Set(identified);
  return {
    score: input.weaknesses.length ? found.size / input.weaknesses.length : 0,
    explanation:
      `${found.size}/${input.weaknesses.length} identified` +
      (explanation ? `: ${explanation}` : ""),
    items: Object.fromEntries(
      input.weaknesses.map((_, i) => [`w${i + 1}`, found.has(i + 1) ? 1 : 0]),
    ),
  };
}

/**
 * Run one judged metric. A judge that fails marks that metric "judge-error"
 * instead of failing the case: the app's answer is still worth scoring.
 */
export async function judged(task: () => Promise<Score>): Promise<Score> {
  try {
    return await task();
  } catch (error) {
    return {
      score: null,
      label: "judge-error",
      explanation: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ── Jev (System One) as an evaluator ─────────────────────────────── */

/**
 * Jev answers typed questions with calibrated probabilities instead of
 * writing a verdict. It goes through the app's own System One path
 * (`LocalApp.judge`), so an eval asks it exactly as the editors' review gate
 * does: same transport, metering and limits.
 *
 * Each case batches its questions into one request; they run in parallel and
 * cannot see one another. A Score's expected value is scaled to 0..1 by its
 * top level; a Noul is already a probability.
 */
export type JevAsk = (request: {
  state: Record<string, string>;
  questions: Record<
    string,
    {
      type: "noul" | "choice" | "score";
      instructions: string;
      criteria?: string[];
    }
  >;
}) => Promise<{
  ok: boolean;
  answers?: Record<string, unknown>;
  error?: string;
}>;

export interface JevVerdict {
  score: number | null;
  /** How concentrated Jev's distribution was (Score/Choice), or the Noul. */
  confidence: number | null;
  label?: string;
}

export function readJevAnswer(answer: unknown): JevVerdict {
  const a = (answer ?? {}) as {
    type?: string;
    noul?: number;
    score?: number;
    confidence?: number;
    legend?: Record<string, string>;
    choice?: string;
  };
  if (a.type === "noul" && typeof a.noul === "number")
    return {
      score: a.noul,
      confidence: null,
      label: a.noul >= 0.5 ? "yes" : "no",
    };
  if (a.type === "score" && typeof a.score === "number") {
    const top = Math.max(
      1,
      Object.keys(a.legend ?? { 0: "", 1: "" }).length - 1,
    );
    return {
      score: a.score / top,
      confidence: typeof a.confidence === "number" ? a.confidence : null,
      label: `level ${a.score.toFixed(1)}`,
    };
  }
  if (a.type === "choice" && typeof a.choice === "string")
    return {
      score: null,
      confidence: typeof a.confidence === "number" ? a.confidence : null,
      label: a.choice,
    };
  return { score: null, confidence: null };
}

/** Clairic typed extraction through the app's own path (`LocalApp.extract`). */
export type ClairicAsk = (request: {
  state?: string;
  fields: Record<
    string,
    { type: string; instructions?: string; [key: string]: unknown }
  >;
  reference_date?: string;
}) => Promise<{
  ok: boolean;
  answers?: Record<string, unknown>;
  error?: string;
}>;

/** Run one batched Jev request; a failure marks every question jev-error. */
export async function askJev(
  jev: JevAsk,
  state: Record<string, string>,
  questions: Parameters<JevAsk>[0]["questions"],
): Promise<Record<string, Score>> {
  const ids = Object.keys(questions);
  try {
    const result = await jev({ state, questions });
    if (!result.ok || !result.answers)
      return Object.fromEntries(
        ids.map((id) => [
          id,
          {
            score: null,
            label: "jev-error",
            explanation: result.error ?? "no answer",
          },
        ]),
      );
    return Object.fromEntries(
      ids.map((id) => {
        const v = readJevAnswer(result.answers?.[id]);
        return [
          id,
          {
            score: v.score,
            label: v.label ?? "jev-error",
            explanation:
              v.confidence !== null
                ? `Jev confidence ${v.confidence.toFixed(2)}`
                : "",
          },
        ];
      }),
    );
  } catch (error) {
    return Object.fromEntries(
      ids.map((id) => [
        id,
        {
          score: null,
          label: "jev-error",
          explanation: error instanceof Error ? error.message : String(error),
        },
      ]),
    );
  }
}

/**
 * Jev's read of one editor's note, on the same ladder `judgeNoteValue` uses,
 * so the two evaluators can be compared note for note. Levels describe
 * situations, low to high, each standing on its own.
 */
export const JEV_NOTE_QUESTIONS = {
  jev_note_value: {
    type: "score" as const,
    instructions:
      "How much is `note` worth to the writer of `draft`? `note` is one editor's comment and `anchor` is the passage it quotes.",
    criteria: [
      "The note is generic advice that could apply to any draft, or it misreads or misdescribes the passage it quotes.",
      "The note is about this draft but obvious: it restates the passage, or praises or objects without saying why, and gives no usable next step.",
      "The note is specific and correct about this draft and gives the writer a usable next step, as a competent editor would.",
      "The note names a non-obvious problem or strength in this draft, with a concrete step that would change the next version.",
      "The note is the observation a top editor would lead with for this piece: it reframes the draft's main problem or protects its best move.",
    ],
  },
  jev_grounded: {
    type: "noul" as const,
    instructions:
      "Does `note` make a claim about specific content, wording or argument that appears in `draft`, rather than general writing advice?",
  },
};

/* ── Reading several Jev answers as one metric ───────────────────── */

type JevQuestions = Parameters<JevAsk>[0]["questions"];

/**
 * The mean of several Noul answers, kept per item. With calibrated
 * probabilities the mean is the expected share of items that hold, so a
 * metric built this way reads like its deterministic counterpart (a share of
 * weaknesses named, facts kept, drifts found). `empty` is the score when there
 * are no items, following the suites' "nothing to find" convention.
 * Any missing/invalid answer makes the aggregate null. Numeric item readings
 * remain available for common-support agreement; expectedItems and itemErrors
 * retain the complete denominator and failure reasons without inventing zeros.
 */
export function jevShare(
  answers: Record<string, Score>,
  ids: Record<string, string>,
  options: { empty?: number; emptyLabel?: string; invert?: boolean } = {},
): Score & { expectedItems: string[]; itemErrors: Record<string, string> } {
  const keys = Object.keys(ids);
  if (!keys.length)
    return {
      score: options.empty ?? 1,
      label: options.emptyLabel ?? "nothing to check",
      items: {},
      expectedItems: keys,
      itemErrors: {},
    };
  const items: Record<string, number> = {};
  const itemErrors: Record<string, string> = {};
  for (const item of keys) {
    const answer = answers[ids[item]];
    const value = answer?.score;
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1
    )
      items[item] = options.invert ? 1 - value : value;
    else
      itemErrors[item] =
        answer?.explanation || answer?.label || "missing or invalid answer";
  }
  const values = Object.values(items);
  if (values.length !== keys.length)
    return {
      score: null,
      label: "jev-error",
      explanation:
        `${values.length} of ${keys.length} items scored; ` +
        Object.entries(itemErrors)
          .map(([item, error]) => `${item}: ${error}`)
          .join("; "),
      items,
      expectedItems: keys,
      itemErrors,
    };
  const score = values.reduce((sum, v) => sum + v, 0) / values.length;
  const likely = values.filter((v) => v >= 0.5).length;
  return {
    score,
    label: `jev ${likely} of ${values.length}`,
    explanation: Object.entries(items)
      .map(([item, p]) => `${item} ${p.toFixed(2)}`)
      .join(", "),
    items,
    expectedItems: keys,
    itemErrors,
  };
}

/**
 * A weighted mean of Jev readings, each already on 0..1: the composite
 * scoring pattern, with the weights in code where they can be argued with.
 * Null when any part is missing, so a composite never silently drops a part.
 */
export function jevComposite(parts: Array<[Score | undefined, number]>): Score {
  if (parts.some(([s]) => typeof s?.score !== "number"))
    return {
      score: null,
      label: "jev-error",
      explanation: "a part of the composite is missing",
    };
  const total = parts.reduce((sum, [, w]) => sum + w, 0);
  const score =
    parts.reduce((sum, [s, w]) => sum + (s!.score as number) * w, 0) / total;
  return {
    score,
    label: `jev ${score >= 0.5 ? "pass" : "fail"}`,
    explanation: `weighted mean of ${parts.length} Jev readings`,
  };
}

/** Invert a Noul: the probability that something did not happen. */
export function jevNot(
  answer: Score | undefined,
  yes: string,
  no: string,
): Score {
  if (typeof answer?.score !== "number")
    return {
      score: null,
      label: "jev-error",
      explanation: answer?.explanation ?? "no answer",
    };
  const p = 1 - answer.score;
  return {
    score: p,
    label: p >= 0.5 ? yes : no,
    explanation: `P = ${p.toFixed(2)}`,
  };
}

/* ── Rubric: the four dimensions, read blind ─────────────────────── */

/**
 * Jev's reading of the rubric's four dimensions. The levels follow the
 * anchors the app's own judges are given (prompts/*-judge-user.md at 1, 4,
 * 7 and 10), so level k scaled to 0..1 lines up with an app score of
 * 1 + 9k/3 and the two can be compared directly. The state holds the draft
 * and the commission only: never the app's grades or rationales, which would
 * make agreement circular.
 */
export const JEV_RUBRIC_QUESTIONS = {
  jev_sufficiency: {
    type: "score" as const,
    instructions:
      "How fully does `draft` develop the examples, reasoning, evidence or scenes that `goal` needs?",
    criteria: [
      "The draft is mostly assertion, filler, or drift away from the goal; almost nothing is developed with examples, reasoning or scenes.",
      "The draft starts the case for the goal, but its key moves are asserted rather than built with examples or reasoning.",
      "The draft builds most of the case for the goal with examples, reasoning or scenes, leaving a few parts undeveloped.",
      "The draft develops everything the goal depends on with examples, reasoning or scenes; the goal is fully earned.",
    ],
  },
  jev_evidence: {
    type: "score" as const,
    instructions:
      "How well are the claims `draft` depends on supported, in the way this kind of writing owes its reader?",
    criteria: [
      "The claims the draft depends on are mostly unsupported, or rest on vague appeals such as 'studies show' and 'experts agree'.",
      "Some claims the draft depends on are backed by sources, figures, checkable specifics or first-hand observation, but several are not.",
      "The claims that matter most are backed by sources, figures, checkable specifics or first-hand observation, with minor gaps.",
      "Every claim the draft depends on is backed by a source, a figure, a checkable specific or concrete first-hand observation.",
    ],
  },
  jev_integrity: {
    type: "score" as const,
    instructions:
      "How much of the confident-sounding prose in `draft` is backed by something specific, rather than padding, vague filler, sweeping claims or fake precision?",
    criteria: [
      "Most of the draft is confident prose that says nothing checkable: sweeping claims, vague filler, fake-precise figures, or repetition.",
      "The draft has real, specific points, mixed with a notable amount of vague filler, sweeping claims or repetition.",
      "The draft is mostly specific and honest, with a few vague, padded or unbacked sentences.",
      "Nearly every confident sentence in the draft is backed by something specific; there is almost no filler, padding or fake precision.",
    ],
  },
  jev_target_fit: {
    type: "score" as const,
    instructions:
      "Ignoring how well it is written, how closely does `draft` do the job that `format`, `audience`, `goal` and `successSignal` commission?",
    criteria: [
      "The draft is about a different subject, or written for a different reader, than the commission describes.",
      "The draft is in the commission's territory, but its reader would not get what the commission promised.",
      "The draft does the commissioned job for the commissioned reader, with some sections that drift or promised parts missing.",
      "Every section of the draft does the commissioned job for the commissioned reader.",
    ],
  },
};

export function jevRubricState(
  draft: string,
  brief: Record<string, string | undefined>,
): Record<string, string> {
  return {
    draft,
    format: brief.format?.trim() || "(not stated)",
    audience: brief.audience?.trim() || "(not stated)",
    goal: brief.goal?.trim() || "(not stated)",
    successSignal: brief.successSignal?.trim() || "(not stated)",
  };
}

/**
 * Does the rubric's feedback name each planted weakness? The same question
 * `judgeWeaknessRecall` puts to the LLM judge, one Noul per weakness, so the
 * two can be compared weakness by weakness. The state is the feedback and
 * the weaknesses; the draft is left out because the question is about the
 * feedback, and unrelated text costs Jev accuracy.
 */
export function jevWeaknessRequest(
  feedback: string,
  weaknesses: string[],
): {
  state: Record<string, string>;
  questions: JevQuestions;
  ids: Record<string, string>;
} {
  const state: Record<string, string> = { feedback };
  const questions: JevQuestions = {};
  const ids: Record<string, string> = {};
  weaknesses.forEach((weakness, i) => {
    state[`weakness${i + 1}`] = weakness;
    questions[`named_w${i + 1}`] = {
      type: "noul",
      instructions: `Does \`feedback\` point out the problem described in \`weakness${i + 1}\`, in substance and as a problem in this draft? General advice that happens to fit does not count.`,
    };
    ids[`w${i + 1}`] = `named_w${i + 1}`;
  });
  return { state, questions, ids };
}

/* ── Rewrite: is the stated problem fixed, and nothing else broken? ── */

/**
 * One request per rewrite. Two Scores carry the judgement the LLM judge
 * makes in one word (`improves`): whether the stated problem is gone, and
 * whether everything else the original said survived. Two Nouls catch what
 * a rewrite most often breaks: inventing a fact, a figure or a source, and
 * no longer fitting the sentences around it. One Noul per fact the corpus
 * says must survive mirrors the deterministic `preserves_facts` check, which
 * matches words and so misses paraphrase.
 *
 * The invention question was tested on real rewrites and on copies with a
 * planted study, source or figure: grounded rewrites read 0.02-0.29 and the
 * planted ones 0.90-0.98. An earlier wording ("a fact ... that appears
 * nowhere in the draft") read a grounded paraphrase as an invention.
 */
export function jevRewriteRequest(input: {
  problem: string;
  original: string;
  replacement: string;
  draft: string;
  facts: string[];
}): {
  state: Record<string, string>;
  questions: JevQuestions;
  factIds: Record<string, string>;
} {
  const state: Record<string, string> = {
    problem: input.problem,
    original: input.original,
    replacement: input.replacement,
    // The whole draft, not a window around the passage: a detail the rewrite
    // borrows from three paragraphs away is not an invention.
    draft: input.draft,
  };
  const questions: JevQuestions = {
    jev_fixes_problem: {
      type: "score",
      instructions:
        "`replacement` is a rewrite of `original`, made to fix what `problem` describes. How much of that problem is left in `replacement`?",
      criteria: [
        "The replacement has the problem as badly as the original did, or worse.",
        "The replacement eases the problem, but most of it is still there.",
        "The replacement fixes most of the problem; a small part of it remains.",
        "The replacement fixes the problem completely.",
      ],
    },
    jev_keeps_meaning: {
      type: "score",
      instructions:
        "Leaving aside the change that `problem` asks for, how much of what `original` says does `replacement` keep?",
      criteria: [
        "The replacement says something different from the original, or contradicts it.",
        "The replacement drops or alters a point or fact of the original that the problem did not ask to change.",
        "The replacement keeps the original's points and facts, with a small shift in emphasis or detail.",
        "The replacement keeps every point and fact of the original and changes only what the problem asked for.",
      ],
    },
    invents: {
      type: "noul",
      instructions:
        "Does `replacement` add a figure, date, name, event, study or source that `draft` does not mention? Rewording what the draft already says does not count, and neither does explaining a term.",
    },
    fits: {
      type: "noul",
      instructions:
        "Could `replacement` stand in place of `original` in `draft` without breaking the grammar or the flow of the sentences around it?",
    },
  };
  const factIds: Record<string, string> = {};
  input.facts.forEach((fact, i) => {
    state[`fact${i + 1}`] = fact;
    questions[`keeps_f${i + 1}`] = {
      type: "noul",
      instructions: `Does \`replacement\` still state \`fact${i + 1}\`, in any wording?`,
    };
    factIds[`f${i + 1}`] = `keeps_f${i + 1}`;
  });
  return { state, questions, factIds };
}

/* ── Dossier: are the observations true, and do they find the drift? ── */

/**
 * The dossier check is asked two separate things, so it gets two requests.
 * The first is blind to the corpus: is each observation actually true of the
 * draft, read against the brief? That is the precision the deterministic
 * check cannot measure, since it only compares field names with the planted
 * drifts. The second sees the planted drifts: does some observation describe
 * each one? Putting the drifts in the first request would let the answer key
 * leak into a judgement meant to be independent of it.
 */
export function jevObservationRequest(input: {
  brief: Record<string, string | undefined>;
  draft: string;
  observations: string[];
}): {
  state: Record<string, string>;
  questions: JevQuestions;
  ids: Record<string, string>;
} {
  const state: Record<string, string> = {
    brief: Object.entries(input.brief)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
    draft: input.draft,
  };
  const questions: JevQuestions = {};
  const ids: Record<string, string> = {};
  input.observations.forEach((observation, j) => {
    state[`observation${j + 1}`] = observation;
    questions[`true_o${j + 1}`] = {
      type: "noul",
      instructions: `Is the problem that \`observation${j + 1}\` describes actually present in \`draft\`, judged against \`brief\`?`,
    };
    ids[`o${j + 1}`] = `true_o${j + 1}`;
  });
  return { state, questions, ids };
}

export function jevDriftRequest(input: {
  observations: string;
  drifts: string[];
}): {
  state: Record<string, string>;
  questions: JevQuestions;
  ids: Record<string, string>;
} {
  const state: Record<string, string> = {
    observations: input.observations || "(none)",
  };
  const questions: JevQuestions = {
    claims_overrun: {
      type: "noul",
      instructions:
        "Does any entry in `observations` say the draft is longer than the word limit it was given?",
    },
  };
  const ids: Record<string, string> = {};
  input.drifts.forEach((drift, i) => {
    state[`drift${i + 1}`] = drift;
    questions[`found_d${i + 1}`] = {
      type: "noul",
      instructions: `Does any entry in \`observations\` describe the problem stated in \`drift${i + 1}\`?`,
    };
    ids[`d${i + 1}`] = `found_d${i + 1}`;
  });
  return { state, questions, ids };
}

/**
 * Clairic reads the word limits out of the brief; code counts the words.
 * Neither a judge nor Jev is asked to count, which neither does reliably.
 */
export const CLAIRIC_LENGTH_FIELDS = {
  max_words: {
    type: "number",
    integer: true,
    instructions:
      "The most words the piece may have, from a limit such as 'under 700 words' or '550-700 words'. Null if no upper word limit is given.",
  },
  min_words: {
    type: "number",
    integer: true,
    instructions:
      "The fewest words the piece may have, from a range such as '550-700 words'. Null if no lower word limit is given.",
  },
};

/* ── Interview: what did the writer actually say? ────────────────── */

export const BRIEF_FIELDS = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];

/**
 * Clairic reads each dossier field out of the conversation as a span of the
 * transcript, or null when the writer has not said it. Where the app files a
 * field the writer never stated, or misses one they did, the transcript is
 * the ground truth, not a hand label.
 */
export const CLAIRIC_BRIEF_FIELDS: Record<
  BriefField,
  { type: "text"; instructions: string }
> = Object.fromEntries(
  (
    [
      [
        "workingTitle",
        "The title the writer gives the piece, or the writer's own one-sentence description of what it is.",
      ],
      [
        "format",
        "The kind of piece the writer says it is, such as an essay, review, speech, feature, story or email.",
      ],
      ["audience", "The readers the writer says the piece is for."],
      [
        "goal",
        "What the writer says the piece should achieve, or make its readers think or do.",
      ],
      [
        "tone",
        "The tone or voice the writer says they want the piece to have.",
      ],
      [
        "constraints",
        "A limit the writer sets on the piece: a length, venue, deadline, or something it must include or avoid.",
      ],
      [
        "successSignal",
        "What the writer says would show that the piece has worked.",
      ],
    ] as const
  ).map(([field, what]) => [
    field,
    // Without the last sentence Clairic fills a field with the nearest span
    // (an audience for the success signal); with it, unsaid fields go null
    // more often. Its p_null still runs low on conversation, so the suite
    // also discards spans from the interviewer's lines.
    {
      type: "text" as const,
      instructions: `${what} Only words the writer says. Null if the writer has not said it.`,
    },
  ]),
) as Record<BriefField, { type: "text"; instructions: string }>;

const FIELD_PHRASES: Record<BriefField, string> = {
  workingTitle:
    "a title for the piece, or a one-sentence description of what it is",
  format:
    "what kind of piece it is, such as an essay, review, speech, feature, story or email",
  audience: "who the piece is for",
  goal: "what the piece should achieve, or make its readers think or do",
  tone: "the tone or voice the piece should have",
  constraints:
    "a limit on the piece, such as a length, venue, deadline, or something it must include or avoid",
  successSignal: "what would show that the piece has worked",
};

/**
 * The blind half of the interview check: Jev sees the conversation and the
 * interviewer's new turn, never the dossier the app filed. One Noul per
 * field asks whether the writer has stated it, a second reading of the same
 * thing Clairic extracts. For a question turn, a Score rates the question
 * and a Noul catches the protocol's named failure, asking for something the
 * writer already gave.
 */
export function jevInterviewRequest(input: {
  conversation: string;
  question: string | null;
}): {
  state: Record<string, string>;
  questions: JevQuestions;
  statedIds: Record<BriefField, string>;
} {
  const state: Record<string, string> = { conversation: input.conversation };
  const questions: JevQuestions = {};
  const statedIds = {} as Record<BriefField, string>;
  for (const field of BRIEF_FIELDS) {
    questions[`stated_${field}`] = {
      type: "noul",
      instructions: `In \`conversation\`, has the writer said ${FIELD_PHRASES[field]}?`,
    };
    statedIds[field] = `stated_${field}`;
  }
  if (input.question !== null) {
    state.question = input.question;
    questions.jev_question_value = {
      type: "score",
      instructions:
        "`question` is the interviewer's next turn after `conversation`, in an interview that builds a brief for the writer's piece. How much will the writer's answer to it shape the piece?",
      criteria: [
        "The question is about something that would not change how the piece is written.",
        "The question is relevant to the piece but generic: it could be put to any writer and uses nothing this writer said.",
        "The question builds on what the writer said and asks about a part of the piece that is still open.",
        "The question goes straight to the most important open point, or a contradiction, in what the writer has said.",
      ],
    };
    questions.repeats = {
      type: "noul",
      instructions:
        "Does `question` ask for something the writer has already answered in `conversation`?",
    };
  }
  return { state, questions, statedIds };
}

/** Is each field the app filed true to what the writer said? */
export function jevRecordRequest(input: {
  conversation: string;
  recorded: Partial<Record<BriefField, string>>;
  /** In refine mode, the brief already on file: also the writer's words. */
  onFile?: string;
}): {
  state: Record<string, string>;
  questions: JevQuestions;
  ids: Record<string, string>;
} {
  const state: Record<string, string> = { conversation: input.conversation };
  if (input.onFile) state.brief_on_file = input.onFile;
  const source = input.onFile
    ? "what the writer said in `conversation` or already had in `brief_on_file`"
    : "what the writer said in `conversation`";
  const questions: JevQuestions = {};
  const ids: Record<string, string> = {};
  for (const field of BRIEF_FIELDS) {
    const value = input.recorded[field];
    if (typeof value !== "string" || !value.trim()) continue;
    state[`recorded_${field}`] = value;
    questions[`faithful_${field}`] = {
      type: "noul",
      instructions: `\`recorded_${field}\` is a note on ${FIELD_PHRASES[field]}, filed after \`conversation\`. Does it stay true to ${source}, adding nothing the writer did not say or clearly imply?`,
    };
    ids[field] = `faithful_${field}`;
  }
  return { state, questions, ids };
}

/* ── Clairic ─────────────────────────────────────────────────────── */

export interface ClairicReading {
  value: unknown;
  guess?: unknown;
  p_null?: number;
  confidence?: number;
  span?: [number, number] | null;
}

/** One extraction; a failure is returned as its reason, never thrown. */
export async function askClairic(
  extract: ClairicAsk,
  request: Parameters<ClairicAsk>[0],
): Promise<
  | { ok: true; answers: Record<string, ClairicReading> }
  | { ok: false; error: string }
> {
  try {
    const result = await extract(request);
    if (!result.ok || !result.answers)
      return { ok: false, error: result.error ?? "no answer" };
    return {
      ok: true,
      answers: result.answers as Record<string, ClairicReading>,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
