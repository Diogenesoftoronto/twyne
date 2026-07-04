/**
 * Offline rubric eval for Twyne.
 *
 * Replays the REAL production prompts from `convex/agentPrompts.ts` through the
 * Bifrost gateway for four task types, then scores the outputs with LLM-as-judge
 * rubrics. Mirrors the conventions of `evals/run-experiment.ts` and
 * `evals/judge.ts` (Node/TS via `tsx`, `node:fs`/`node:path` imports,
 * header-only Bifrost auth, case_id keys, main().catch() tail).
 *
 * Tasks:
 *   - rubric-judge    : production `judgeDraft` task. Generates a persona-scored
 *                       {score, rationale} using buildSystemPrompt +
 *                       buildUserPrompt + the verbatim JUDGE TASK suffix from
 *                       convex/agents.ts. Scores structural validity and
 *                       rationale-groundedness, then checks discrimination on
 *                       strong/weak pairs.
 *   - rubric-review   : production `buildRubricReviewPrompt` task. Generates the
 *                       Chief Critic narrative review given a pre-computed
 *                       grade and judges' verdicts. Scores whether the review
 *                       honours the given grade and closes with a revision plan.
 *   - rubric-evidence : production `judgeEvidence` task. Replays
 *                       buildEvidenceJudgeSystemPrompt + buildEvidenceJudgePrompt
 *                       and checks the rationale names a specific grounding
 *                       failure (or grounding) in the draft, and that the score
 *                       discriminates padded vs grounded pairs.
 *   - rubric-integrity: production `judgeIntegrity` task. Replays
 *                       buildIntegrityJudgeSystemPrompt + buildIntegrityJudgePrompt
 *                       and checks the rationale names a specific bullshit
 *                       pattern (or absence) and discriminates honest vs
 *                       polished-but-empty pairs.
 *
 * Usage:
 *   BIFROST_BASE_URL=https://... BIFROST_API_KEY=sk_bf_xxx \
 *     JUDGE_MODEL=neuralwatt/kimi-k2.6 bun run eval:rubric
 *
 * Writes evals/rubric-scores.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRubricReviewPrompt,
  buildRubricReviewSystemPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  buildEvidenceJudgeSystemPrompt,
  buildEvidenceJudgePrompt,
  buildIntegrityJudgeSystemPrompt,
  buildIntegrityJudgePrompt,
  toAgentPersona,
  type AgentPersona,
  type AgentRequest,
} from "../convex/agentPrompts";
import { parseJudgeOutput } from "../src/utils/llm-parsing";
import { PERSONAS } from "../src/utils/personas";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(HERE, "rubric.jsonl");
const SCORES_PATH = resolve(HERE, "rubric-scores.json");

const BIFROST_BASE_URL = process.env.BIFROST_BASE_URL;
const BIFROST_API_KEY = process.env.BIFROST_API_KEY;
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "neuralwatt/kimi-k2.6";

/**
 * The JUDGE TASK suffix appended to the user prompt by `judgeDraft` in
 * `convex/agents.ts`. Copied verbatim — the production rubric depends on this
 * exact wording and the JSON shape. If you change it here, also change it
 * there.
 */
const JUDGE_TASK_SUFFIX = (personaName: string): string =>
  `
JUDGE TASK: As ${personaName}, give the draft a single integer score from 1 to 10. A score of 5 means "the draft is doing the work for the stated audience and goal but has clear, fixable issues." A score of 7 means "the draft is in good shape and the issues are minor." A score of 9 means "publishable as-is." Be honest; most first drafts are in the 3-5 range.

Do not reward confident-sounding bullshit. Penalize generic filler, repeated paragraphs, unsupported universal claims, vibes without evidence, fake specificity, and any passage that sounds polished while dodging the stated audience/goal.

Respond as JSON, and only JSON, in this exact shape:
{"score": <integer 1-10>, "rationale": "<one sentence, your voice>"}`;

interface JudgeVerdict {
  personaId: string;
  score: number;
  rationale: string;
}

interface RubricJudgeRow {
  case_id: string;
  task: "rubric-judge";
  persona: string;
  /** "strong" | "weak" — used by the discrimination check after scoring. */
  draftQuality?: "strong" | "weak";
  draftText: string;
}

interface RubricReviewRow {
  case_id: string;
  task: "rubric-review";
  combined: number;
  grade: string;
  judgeMean: number;
  staticTotal: number;
  judges: JudgeVerdict[];
  staticFeedback: string[];
  draftText: string;
}

interface RubricEvidenceRow {
  case_id: string;
  task: "rubric-evidence";
  /** "grounded" or "padded" — used by the discrimination check. */
  draftQuality?: "grounded" | "padded";
  goal: string;
  audience: string;
  draftText: string;
  /** Static citation signals, verbatim from `describeEvidenceStatic`. */
  staticNote?: string;
}

interface RubricIntegrityRow {
  case_id: string;
  task: "rubric-integrity";
  /** "honest" or "bullshit" — used by the discrimination check. */
  draftQuality?: "honest" | "bullshit";
  goal: string;
  audience: string;
  draftText: string;
  /** Static regex signals, verbatim from `describeIntegrityStatic`. */
  staticNote?: string;
}

type DatasetRow =
  | RubricJudgeRow
  | RubricReviewRow
  | RubricEvidenceRow
  | RubricIntegrityRow;

interface LlmVerdict {
  label: string;
  score: number | null;
  explanation: string;
}

interface JudgeOutput {
  raw: string;
  score: number | null;
  rationale: string | null;
  /** Score landed in [1,10] as an integer. */
  score_in_range: boolean;
}

interface JudgeScore {
  case_id: string;
  task: "rubric-judge";
  persona: string;
  draft_quality: string | null;
  output_excerpt: string;
  judge: JudgeOutput;
  grounded: LlmVerdict;
}

interface ReviewScore {
  case_id: string;
  task: "rubric-review";
  output_excerpt: string;
  faithful_to_grade: LlmVerdict;
  has_revision_plan: LlmVerdict;
}

interface DedicatedJudgeScore {
  case_id: string;
  task: "rubric-evidence" | "rubric-integrity";
  persona: "evidence" | "integrity";
  draft_quality: string | null;
  output_excerpt: string;
  judge: JudgeOutput;
  /** Catches a generic-looking rationale that does not name a specific
   *  grounding failure (or grounding) in this draft. */
  grounded: LlmVerdict;
}

type RubricScore = JudgeScore | ReviewScore | DedicatedJudgeScore;

interface DiscriminationPair {
  /** Either a persona id (judge task) or the dedicated judge name
   *  (evidence / integrity). The first slot of the strong-pair must score
   *  higher than the first slot of the weak-pair (i.e. "grounded" >
   *  "padded", "honest" > "bullshit", persona-typed "strong" > "weak"). */
  persona: string;
  strong_label: string;
  weak_label: string;
  strong_case_id: string;
  weak_case_id: string;
  strong_score: number | null;
  weak_score: number | null;
  passed: boolean;
}

const RATIONALE_GROUNDED_TEMPLATE = (
  draft: string,
  rationale: string,
): string =>
  `You judge whether a judge's one-sentence rationale genuinely engages with the SPECIFIC draft it was scoring, versus generic writing advice that could apply to any text.\n\n` +
  `Draft:\n${draft}\n\nRationale:\n${rationale}\n\n` +
  `Answer "grounded" if the rationale references specific content, claims, or wording from THIS draft. Answer "generic" if it is boilerplate that could apply to any text.`;

const FAITHFUL_TO_GRADE_TEMPLATE = (
  grade: string,
  combined: number,
  judgeMean: number,
  staticTotal: number,
  judges: JudgeVerdict[],
  staticFeedback: string[],
  review: string,
): string => {
  const judgeLines = judges
    .map((j) => `- ${j.personaId}: ${j.score}/10`)
    .join("\n");
  const staticLines = staticFeedback.map((s) => `- ${s}`).join("\n");
  return (
    `You judge whether an AI Chief Critic's narrative review is NUMERICALLY faithful to the GIVEN grade and scores.\n\n` +
    `CONTEXT: The reviewer was ALSO given the full draft text alongside the figures below, so any non-numeric observations it makes about the draft's wording, claims, structure, repeated phrases, or word counts are EXPECTED grounded observations and must NOT be treated as "invented." The "invented" check is strictly about NUMBERS, not about qualitative specifics.\n\n` +
    `GIVEN (do not let the review contradict these):\n` +
    `- combined: ${combined}/100\n` +
    `- grade: ${grade}\n` +
    `- judge mean: ${judgeMean.toFixed(1)}/10\n` +
    `- static features: ${staticTotal.toFixed(1)}/10\n` +
    `- per-judge scores:\n${judgeLines}\n` +
    `- static feedback notes:\n${staticLines}\n\n` +
    `REVIEW:\n${review}\n\n` +
    `Answer "faithful" if EVERY numeric score or letter grade the review states appears in the supplied set (combined /100, the letter grade, judgeMean /10, staticTotal /10, or any of the per-judge X/10 scores listed above) AND the review does not contradict the given grade. ` +
    `Answer "invented" ONLY if the review states a numeric score or letter grade that is NOT in that supplied set, or contradicts the given grade. ` +
    `Non-numeric specifics about the draft (counting how often a phrase appears, naming repeated words, citing the draft's claims, structural observations, etc.) are GROUNDED and never make the review "invented" on their own.`
  );
};

const REVISION_PLAN_TEMPLATE = (review: string): string =>
  `You judge whether an AI Chief Critic's narrative review closes with a concrete, prioritised revision plan.\n\n` +
  `REVIEW:\n${review}\n\n` +
  `Answer "present" if the final section of the review lists multiple (>=2) concrete, specific revision steps the writer can take, ordered by priority. ` +
  `Answer "absent" if the review ends on a general exhortation, a vague suggestion, or no actionable plan at all.`;

const EVIDENCE_RATIONALE_GROUNDED_TEMPLATE = (
  draft: string,
  rationale: string,
): string =>
  `You judge whether an AI research editor's one-sentence rationale for the Evidence & Support score genuinely engages with the SPECIFIC draft — naming a particular citation, claim, or grounding failure — versus generic advice that could apply to any text.\n\n` +
  `Draft:\n${draft}\n\nRationale:\n${rationale}\n\n` +
  `Answer "grounded" if the rationale names a specific citation, statistic, claim, or gap in THIS draft (e.g., "Smith 2020 says X, but the draft claims Y," "the second paragraph asserts a 73% figure with no source," "the empirical study paragraph earns the claim"). ` +
  `Answer "generic" if the rationale is boilerplate that could apply to any draft (e.g., "could use more sources," "citations would strengthen the argument").`;

const INTEGRITY_RATIONALE_GROUNDED_TEMPLATE = (
  draft: string,
  rationale: string,
): string =>
  `You judge whether an AI bullshit detector's one-sentence rationale for the Bullshit Resistance score genuinely engages with the SPECIFIC draft — naming a particular bullshit pattern — versus generic advice that could apply to any text.\n\n` +
  `Draft:\n${draft}\n\nRationale:\n${rationale}\n\n` +
  `Answer "grounded" if the rationale names a specific bullshit pattern in THIS draft (e.g., "the universal claim 'everyone knows' on the second paragraph has no support," "the '73% increase' in the third paragraph is suspicious specificity," "the paragraph relies on filler like 'things have changed'"). ` +
  `Answer "generic" if the rationale is boilerplate that could apply to any draft (e.g., "the draft has filler," "could be more specific").`;
const CHOICES = {
  grounded: { grounded: 1, generic: 0 },
  faithful: { faithful: 1, invented: 0 },
  plan: { present: 1, absent: 0 },
} as const;

function personaOrThrow(id: string): AgentPersona {
  const p = PERSONAS.find((x) => x.id === id);
  if (!p) {
    throw new Error(
      `Unknown persona id "${id}" — add it to src/utils/personas.ts`,
    );
  }
  return toAgentPersona(p);
}

function readDataset(): DatasetRow[] {
  const raw = readFileSync(DATASET_PATH, "utf8").trim();
  return raw
    .split(/\n+/)
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line) as DatasetRow;
      } catch (err) {
        throw new Error(`Bad JSONL line ${i + 1}: ${(err as Error).message}`);
      }
    });
}

async function callBifrost(
  system: string,
  user: string,
  model: string,
  temperature: number,
  signal: AbortSignal,
  maxOutputTokens: number | null = null,
): Promise<string> {
  if (!BIFROST_BASE_URL) {
    throw new Error("BIFROST_BASE_URL is required");
  }
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
  };
  if (maxOutputTokens !== null) body.max_tokens = maxOutputTokens;
  return callBifrostWithRetry(body, signal);
}

const RETRY_DELAYS_MS = [1_500, 4_000];
const MAX_ATTEMPTS = 3;

/**
 * One bare attempt of the Bifrost chat-completions call. Throws on network /
 * abort errors and on 5xx / Bifrost 504 timeout responses; 4xx and any other
 * non-OK status is propagated without retry.
 */
async function callBifrostOnce(
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(
    `${BIFROST_BASE_URL!.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      // Header-only auth: Bifrost passes its stored provider key through. A
      // bearer token would be misread as a virtual-key lookup → 401. This is
      // exactly why the Arize integration's auth_type must be proxy_with_headers.
      headers: {
        "content-type": "application/json",
        "x-bifrost-api-key": BIFROST_API_KEY ?? "",
      },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Bifrost ${res.status}: ${text.slice(0, 300)}`);
    // Attach status so the retry layer can decide without parsing the message.
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Bifrost response missing choices[0].message.content");
  }
  return content;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal.aborted) {
      clearTimeout(t);
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

/**
 * Retry wrapper for {@link callBifrostOnce}. Network/abort errors and HTTP
 * 5xx / Bifrost 504 (gateway timeout) responses are retried up to
 * {@link MAX_ATTEMPTS} total attempts with a short backoff; 4xx and all other
 * non-retryable errors propagate immediately. The per-attempt AbortSignal is
 * owned by the caller and is left untouched.
 */
async function callBifrostWithRetry(
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callBifrostOnce(body, signal);
    } catch (err) {
      const e = err as Error & { status?: number; name?: string };
      lastErr = e;
      const isAbort = e.name === "AbortError";
      const status = e.status;
      const retryableNetwork =
        e instanceof TypeError ||
        // node fetch surfaces transient failures as system errors
        e.name === "FetchError" ||
        // undici uses these
        e.name === "UndiciError";
      const retryableStatus =
        typeof status === "number" &&
        (status === 504 || status === 408 || status >= 500);
      const shouldRetry =
        attempt < MAX_ATTEMPTS - 1 &&
        !isAbort &&
        (retryableNetwork || retryableStatus);
      if (!shouldRetry) throw e;
      await sleep(RETRY_DELAYS_MS[attempt], signal);
    }
  }
  // Unreachable, but keep TS happy.
  throw lastErr ?? new Error("Bifrost call failed");
}

function parseScoreRationale(raw: string): {
  score: number | null;
  rationale: string | null;
} {
  const parsed = parseJudgeOutput(raw);
  return parsed ?? { score: null, rationale: null };
}

function clampIntInRange(score: number): boolean {
  return Number.isInteger(score) && score >= 1 && score <= 10;
}

async function judgeLabel(
  prompt: string,
  valid: Record<string, number>,
  signal: AbortSignal,
): Promise<LlmVerdict> {
  const labels = Object.keys(valid);
  const system =
    `You are a strict evaluator. Read the rubric, then respond with a JSON object ` +
    `exactly: {"label": "<one of: ${labels.join(", ")}>", "explanation": "<one sentence>"}. ` +
    `No other text.`;
  const raw = await callBifrost(system, prompt, JUDGE_MODEL, 0, signal);
  let label = "";
  let explanation = "";
  const txt = stripFences(raw);
  try {
    const obj = JSON.parse(extractFirstJsonObject(txt) ?? txt) as {
      label?: string;
      explanation?: string;
    };
    label = String(obj.label ?? "")
      .trim()
      .toLowerCase();
    explanation = String(obj.explanation ?? "").trim();
  } catch {
    const low = raw.toLowerCase();
    label = labels.find((l) => low.includes(l)) ?? "?";
    explanation = raw.trim().slice(0, 200);
  }
  if (!(label in valid)) {
    label = labels.find((l) => label.includes(l)) ?? "?";
  }
  return {
    label,
    score: label in valid ? valid[label] : null,
    explanation,
  };
}

function excerpt(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}

async function scoreRubricJudgeRow(row: RubricJudgeRow): Promise<JudgeScore> {
  const persona = personaOrThrow(row.persona);
  const req: AgentRequest = {
    persona,
    brief: null,
    draftText: row.draftText,
    instruction: "feedback",
  };
  const system = buildSystemPrompt(persona);
  const user = buildUserPrompt(req) + JUDGE_TASK_SUFFIX(persona.name);

  const raw = await callBifrost(
    system,
    user,
    JUDGE_MODEL,
    0.2,
    AbortSignal.timeout(90_000),
    220,
  );
  const parsed = parseScoreRationale(raw);
  const judgeOutput: JudgeOutput = {
    raw: excerpt(raw),
    score: parsed.score,
    rationale: parsed.rationale,
    score_in_range: parsed.score !== null && clampIntInRange(parsed.score),
  };

  let grounded: LlmVerdict;
  if (parsed.rationale) {
    grounded = await judgeLabel(
      RATIONALE_GROUNDED_TEMPLATE(row.draftText, parsed.rationale),
      CHOICES.grounded,
      AbortSignal.timeout(90_000),
    );
  } else {
    grounded = {
      label: "?",
      score: null,
      explanation: "no rationale parsed from judge output",
    };
  }

  return {
    case_id: row.case_id,
    task: "rubric-judge",
    persona: row.persona,
    draft_quality: row.draftQuality ?? null,
    output_excerpt: excerpt(raw),
    judge: judgeOutput,
    grounded,
  };
}

async function scoreRubricReviewRow(
  row: RubricReviewRow,
): Promise<ReviewScore> {
  const system = buildRubricReviewSystemPrompt();
  const user = buildRubricReviewPrompt({
    combined: row.combined,
    grade: row.grade,
    judgeMean: row.judgeMean,
    staticTotal: row.staticTotal,
    judges: row.judges,
    staticFeedback: row.staticFeedback,
    brief: null,
    draftText: row.draftText,
  });

  const raw = await callBifrost(
    system,
    user,
    JUDGE_MODEL,
    0.4,
    AbortSignal.timeout(120_000),
    1400,
  );
  const faithful = await judgeLabel(
    FAITHFUL_TO_GRADE_TEMPLATE(
      row.grade,
      row.combined,
      row.judgeMean,
      row.staticTotal,
      row.judges,
      row.staticFeedback,
      raw,
    ),
    CHOICES.faithful,
    AbortSignal.timeout(90_000),
  );
  const plan = await judgeLabel(
    REVISION_PLAN_TEMPLATE(raw),
    CHOICES.plan,
    AbortSignal.timeout(90_000),
  );

  return {
    case_id: row.case_id,
    task: "rubric-review",
    output_excerpt: excerpt(raw),
    faithful_to_grade: faithful,
    has_revision_plan: plan,
  };
}

async function scoreRubricEvidenceRow(
  row: RubricEvidenceRow,
): Promise<DedicatedJudgeScore> {
  const system = buildEvidenceJudgeSystemPrompt();
  const user = buildEvidenceJudgePrompt({
    goal: row.goal,
    audience: row.audience,
    draftText: row.draftText,
    staticNote:
      row.staticNote ??
      "Citation count: 0 (no static note supplied by dataset); judge the draft on its own merit.",
  });

  const raw = await callBifrost(
    system,
    user,
    JUDGE_MODEL,
    0.2,
    AbortSignal.timeout(90_000),
    220,
  );
  const parsed = parseScoreRationale(raw);
  const judgeOutput: JudgeOutput = {
    raw: excerpt(raw),
    score: parsed.score,
    rationale: parsed.rationale,
    score_in_range: parsed.score !== null && clampIntInRange(parsed.score),
  };

  let grounded: LlmVerdict;
  if (parsed.rationale) {
    grounded = await judgeLabel(
      EVIDENCE_RATIONALE_GROUNDED_TEMPLATE(row.draftText, parsed.rationale),
      CHOICES.grounded,
      AbortSignal.timeout(90_000),
    );
  } else {
    grounded = {
      label: "?",
      score: null,
      explanation: "no rationale parsed from evidence judge output",
    };
  }

  return {
    case_id: row.case_id,
    task: "rubric-evidence",
    persona: "evidence",
    draft_quality: row.draftQuality ?? null,
    output_excerpt: excerpt(raw),
    judge: judgeOutput,
    grounded,
  };
}

async function scoreRubricIntegrityRow(
  row: RubricIntegrityRow,
): Promise<DedicatedJudgeScore> {
  const system = buildIntegrityJudgeSystemPrompt();
  const user = buildIntegrityJudgePrompt({
    goal: row.goal,
    audience: row.audience,
    draftText: row.draftText,
    staticNote:
      row.staticNote ??
      "Regex signals unavailable for this row; judge the draft on its own merit.",
  });

  const raw = await callBifrost(
    system,
    user,
    JUDGE_MODEL,
    0.2,
    AbortSignal.timeout(90_000),
    220,
  );
  const parsed = parseScoreRationale(raw);
  const judgeOutput: JudgeOutput = {
    raw: excerpt(raw),
    score: parsed.score,
    rationale: parsed.rationale,
    score_in_range: parsed.score !== null && clampIntInRange(parsed.score),
  };

  let grounded: LlmVerdict;
  if (parsed.rationale) {
    grounded = await judgeLabel(
      INTEGRITY_RATIONALE_GROUNDED_TEMPLATE(row.draftText, parsed.rationale),
      CHOICES.grounded,
      AbortSignal.timeout(90_000),
    );
  } else {
    grounded = {
      label: "?",
      score: null,
      explanation: "no rationale parsed from integrity judge output",
    };
  }

  return {
    case_id: row.case_id,
    task: "rubric-integrity",
    persona: "integrity",
    draft_quality: row.draftQuality ?? null,
    output_excerpt: excerpt(raw),
    judge: judgeOutput,
    grounded,
  };
}

type QualityRow =
  | RubricJudgeRow
  | RubricEvidenceRow
  | RubricIntegrityRow;

interface PairAxis {
  /** Key under which the two slots are stored (persona id or "evidence" / "integrity"). */
  persona: string;
  /** Strong-quality label for this axis (e.g. "strong", "grounded", "honest"). */
  strong: string;
  /** Weak-quality label for this axis (e.g. "weak", "padded", "bullshit"). */
  weak: string;
}

const PAIR_AXES: Record<string, PairAxis> = {
  "rubric-judge": { persona: "_persona_", strong: "strong", weak: "weak" },
  "rubric-evidence": { persona: "evidence", strong: "grounded", weak: "padded" },
  "rubric-integrity": { persona: "integrity", strong: "honest", weak: "bullshit" },
};

function draftQuality(r: QualityRow): string | undefined {
  return r.draftQuality;
}

function axisPersona(r: QualityRow): string {
  if (r.task === "rubric-judge") return (r as RubricJudgeRow).persona;
  return PAIR_AXES[r.task].persona;
}

/** Axis-blind dedupe for quality pairs across the three judge tasks. */
function buildDiscriminationPairs(
  rows: QualityRow[],
): DiscriminationPair[] {
  const byQuality = new Map<
    string,
    { strong?: QualityRow; weak?: QualityRow; axis: PairAxis }
  >();
  for (const r of rows) {
    const axis = PAIR_AXES[r.task];
    if (!axis) continue;
    const q = draftQuality(r);
    if (!q) continue;
    const key = `${r.task}::${axisPersona(r)}`;
    const slot = byQuality.get(key) ?? { axis };
    if (q === axis.strong) slot.strong = r;
    if (q === axis.weak) slot.weak = r;
    byQuality.set(key, slot);
  }
  const pairs: DiscriminationPair[] = [];
  for (const [key, slot] of byQuality) {
    if (!slot.strong || !slot.weak) continue;
    pairs.push({
      persona: `${key} → ${slot.strong.task === "rubric-judge" ? axisPersona(slot.strong) : slot.axis.persona}`,
      strong_label: slot.axis.strong,
      weak_label: slot.axis.weak,
      strong_case_id: slot.strong.case_id,
      weak_case_id: slot.weak.case_id,
      strong_score: null,
      weak_score: null,
      passed: false,
    });
  }
  return pairs;
}

async function main(): Promise<void> {
  const dataset = readDataset();
  console.log(`[twyne:rubric] ${dataset.length} cases → judge ${JUDGE_MODEL}`);

  const scores: RubricScore[] = [];
  let failures = 0;
  const qualityRows: QualityRow[] = [];

  for (const row of dataset) {
    try {
      if (row.task === "rubric-judge") {
        qualityRows.push(row);
        const s = await scoreRubricJudgeRow(row);
        scores.push(s);
        console.log(
          `  ${row.case_id.padEnd(24)} (${row.persona.padEnd(8)}) score=${String(s.judge.score).padStart(3)} range=${String(s.judge.score_in_range).padEnd(5)} grounded=${s.grounded.label}`,
        );
      } else if (row.task === "rubric-review") {
        const s = await scoreRubricReviewRow(row);
        scores.push(s);
        console.log(
          `  ${row.case_id.padEnd(24)} faithful=${s.faithful_to_grade.label.padEnd(9)} plan=${s.has_revision_plan.label}`,
        );
      } else if (row.task === "rubric-evidence") {
        qualityRows.push(row);
        const s = await scoreRubricEvidenceRow(row);
        scores.push(s);
        console.log(
          `  ${row.case_id.padEnd(24)} (evidence)        score=${String(s.judge.score).padStart(3)} range=${String(s.judge.score_in_range).padEnd(5)} grounded=${s.grounded.label}`,
        );
      } else {
        qualityRows.push(row);
        const s = await scoreRubricIntegrityRow(row);
        scores.push(s);
        console.log(
          `  ${row.case_id.padEnd(24)} (integrity)       score=${String(s.judge.score).padStart(3)} range=${String(s.judge.score_in_range).padEnd(5)} grounded=${s.grounded.label}`,
        );
      }
    } catch (err) {
      failures += 1;
      const message = (err as Error).message;
      console.error(`  ✗ ${row.case_id}: ${message}`);
      // Mirror run-experiment.ts: record a placeholder so the artifact is
      // complete and downstream tooling can see which rows errored.
      if (row.task === "rubric-judge") {
        scores.push({
          case_id: row.case_id,
          task: "rubric-judge",
          persona: row.persona,
          draft_quality: row.draftQuality ?? null,
          output_excerpt: `[error] ${excerpt(message)}`,
          judge: {
            raw: `[error] ${excerpt(message)}`,
            score: null,
            rationale: null,
            score_in_range: false,
          },
          grounded: { label: "?", score: null, explanation: message },
        });
      } else if (row.task === "rubric-review") {
        scores.push({
          case_id: row.case_id,
          task: "rubric-review",
          output_excerpt: `[error] ${excerpt(message)}`,
          faithful_to_grade: { label: "?", score: null, explanation: message },
          has_revision_plan: { label: "?", score: null, explanation: message },
        });
      } else {
        scores.push({
          case_id: row.case_id,
          task: row.task,
          persona: row.task === "rubric-evidence" ? "evidence" : "integrity",
          draft_quality: row.draftQuality ?? null,
          output_excerpt: `[error] ${excerpt(message)}`,
          judge: {
            raw: `[error] ${excerpt(message)}`,
            score: null,
            rationale: null,
            score_in_range: false,
          },
          grounded: { label: "?", score: null, explanation: message },
        });
      }
    }
  }

  // Discrimination: strong-quality > weak-quality on every axis.
  const pairs = buildDiscriminationPairs(qualityRows);
  for (const pair of pairs) {
    const strong = scores.find(
      (s) =>
        (s.task === "rubric-judge" ||
          s.task === "rubric-evidence" ||
          s.task === "rubric-integrity") &&
        s.case_id === pair.strong_case_id,
    ) as JudgeScore | DedicatedJudgeScore | undefined;
    const weak = scores.find(
      (s) =>
        (s.task === "rubric-judge" ||
          s.task === "rubric-evidence" ||
          s.task === "rubric-integrity") &&
        s.case_id === pair.weak_case_id,
    ) as JudgeScore | DedicatedJudgeScore | undefined;
    const strongScore = strong ? strong.judge.score : null;
    const weakScore = weak ? weak.judge.score : null;
    if (strongScore != null && weakScore != null) {
      pair.strong_score = strongScore;
      pair.weak_score = weakScore;
      pair.passed = strongScore > weakScore;
    } else {
      // Ensure the pair is still surfaced in the JSON for inspection.
      pair.strong_score = strongScore;
      pair.weak_score = weakScore;
    }
  }

  writeFileSync(
    SCORES_PATH,
    JSON.stringify({ scores, discrimination_pairs: pairs }, null, 2),
  );

  // Summary.
  const judgeScores = scores.filter(
    (s): s is JudgeScore => s.task === "rubric-judge",
  );
  const reviewScores = scores.filter(
    (s): s is ReviewScore => s.task === "rubric-review",
  );
  const evidenceScores = scores.filter(
    (s): s is DedicatedJudgeScore => s.task === "rubric-evidence",
  );
  const integrityScores = scores.filter(
    (s): s is DedicatedJudgeScore => s.task === "rubric-integrity",
  );
  const inRange = judgeScores.filter((s) => s.judge.score_in_range).length;
  const grounded = judgeScores.filter((s) => s.grounded.score === 1).length;
  const faithful = reviewScores.filter(
    (s) => s.faithful_to_grade.score === 1,
  ).length;
  const planned = reviewScores.filter(
    (s) => s.has_revision_plan.score === 1,
  ).length;
  const evidenceInRange = evidenceScores.filter(
    (s) => s.judge.score_in_range,
  ).length;
  const evidenceGrounded = evidenceScores.filter(
    (s) => s.grounded.score === 1,
  ).length;
  const integrityInRange = integrityScores.filter(
    (s) => s.judge.score_in_range,
  ).length;
  const integrityGrounded = integrityScores.filter(
    (s) => s.grounded.score === 1,
  ).length;
  const pairsByTask = {
    "rubric-judge": pairs.filter((p) => p.persona.includes("rubric-judge::")),
    "rubric-evidence": pairs.filter(
      (p) => p.persona.includes("rubric-evidence::"),
    ),
    "rubric-integrity": pairs.filter(
      (p) => p.persona.includes("rubric-integrity::"),
    ),
  };
  const pairsPassed = pairs.filter((p) => p.passed).length;

  console.log(
    `[twyne:rubric] wrote ${scores.length} rows to evals/rubric-scores.json`,
  );
  console.log(
    `  rubric-judge:     score_in_range ${inRange}/${judgeScores.length}, ` +
      `rationale grounded ${grounded}/${judgeScores.length}`,
  );
  console.log(
    `  rubric-evidence:  score_in_range ${evidenceInRange}/${evidenceScores.length}, ` +
      `rationale grounded ${evidenceGrounded}/${evidenceScores.length}`,
  );
  console.log(
    `  rubric-integrity: score_in_range ${integrityInRange}/${integrityScores.length}, ` +
      `rationale grounded ${integrityGrounded}/${integrityScores.length}`,
  );
  console.log(
    `  rubric-review:    faithful-to-grade ${faithful}/${reviewScores.length}, ` +
      `has-revision-plan ${planned}/${reviewScores.length}`,
  );
  console.log(
    `  discrimination:   ${pairsPassed}/${pairs.length} strong>weak pairs` +
      ` (judge ${pairsByTask["rubric-judge"].filter((p) => p.passed).length}/${pairsByTask["rubric-judge"].length}, ` +
      `evidence ${pairsByTask["rubric-evidence"].filter((p) => p.passed).length}/${pairsByTask["rubric-evidence"].length}, ` +
      `integrity ${pairsByTask["rubric-integrity"].filter((p) => p.passed).length}/${pairsByTask["rubric-integrity"].length})`,
  );
  for (const p of pairs) {
    const mark = p.passed ? "PASS" : "FAIL";
    console.log(
      `    [${mark}] ${p.persona}: ${p.strong_label}=${p.strong_score} > ${p.weak_label}=${p.weak_score} ` +
        `(${p.strong_case_id} vs ${p.weak_case_id})`,
    );
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[twyne:rubric] fatal:", err);
  process.exit(1);
});
