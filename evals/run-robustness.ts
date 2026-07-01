/**
 * JUDGE-ROBUSTNESS meta-eval for Twyne.
 *
 * This does NOT test Twyne's outputs. It stress-tests the LLM-as-judge that
 * scores them (the "grounded vs generic" faithfulness-to-draft rubric from
 * `evals/judge.ts`). We probe for known failure modes of LLM-as-judge:
 *
 *   PROBE 1  reliability / non-randomness    (test-retest, N=5 temp 0)
 *   PROBE 2  position / ordering bias        (field-order + slot bias)
 *   PROBE 3  verbosity / length bias         (length decoupled from quality)
 *   PROBE 4  mutation (sensitivity+robustness)
 *   PROBE 5  amputation (does the judge use the DRAFT?)
 *   PROBE 6  confident-bullshit hard negative
 *   PROBE 7  cross-model agreement (optional)
 *
 * All probes share the same rubric wording as `evals/judge.ts`'s
 * FAITHFULNESS_TEMPLATE so verdicts are directly comparable to the real eval
 * pipeline. The harness reuses:
 *
 *   - Header-only Bifrost auth (NEVER a bearer; Bifrost 401s on it).
 *   - Retry-with-backoff caller that covers 5xx / 504 / 408 AND 429
 *     `concurrent_budget_exceeded` — this suite makes ~60 sequential calls
 *     and the gateway caps concurrency, so 429 backpressure is expected.
 *   - Defensive JSON parsing (strip ``` fences, extract first {...}).
 *
 * All calls are SEQUENTIAL — never fire concurrent requests. Bifrost caps
 * concurrent calls per virtual key.
 *
 * Usage:
 *   BIFROST_BASE_URL=https://... BIFROST_API_KEY=sk_bf_xxx \
 *     JUDGE_MODEL=neuralwatt/qwen3.5-397b-fast bun run eval:robustness
 *   # optional:
 *   JUDGE_MODEL_2=neuralwatt/kimi-k2.6 bun run eval:robustness
 *
 * Writes evals/robustness-scores.json. Process exits non-zero on hard failure
 * (network/parse after retries) OR on any FAIL of probes 1, 2, 3, 4, 5, or 6.
 * Probe 7 and borderline cases never set the exit code.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCORES_PATH = resolve(HERE, "robustness-scores.json");

const BIFROST_BASE_URL = process.env.BIFROST_BASE_URL;
const BIFROST_API_KEY = process.env.BIFROST_API_KEY;
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "neuralwatt/qwen3.5-397b-fast";
const JUDGE_MODEL_2 = process.env.JUDGE_MODEL_2 ?? "";

// ---------------------------------------------------------------------------
// Rubric — verbatim shape & wording of `FAITHFULNESS_TEMPLATE` in
// `evals/judge.ts`, with a slot for the (draft, feedback) presentation so we
// can reorder fields for the position-bias probes without changing the
// instruction itself.
// ---------------------------------------------------------------------------

const FAITHFULNESS_RUBRIC_V1 = (draft: string, feedback: string): string =>
  `You judge whether an AI editor's feedback genuinely engages with the SPECIFIC ` +
  `draft it was given, versus generic writing advice that could apply to any text.\n\n` +
  `Draft:\n${draft}\n\nEditor feedback:\n${feedback}\n\n` +
  `Answer "grounded" if the feedback references specific content, claims, or wording ` +
  `from THIS draft. Answer "generic" if it is boilerplate advice that could apply to any text.`;

/**
 * Same rubric wording, with FEEDBACK-then-DRAFT field order. Identical
 * instruction text, only the user-prompt ordering changes. Used by PROBE 2a
 * to detect order-sensitivity.
 */
const FAITHFULNESS_RUBRIC_V2 = (draft: string, feedback: string): string =>
  `You judge whether an AI editor's feedback genuinely engages with the SPECIFIC ` +
  `draft it was given, versus generic writing advice that could apply to any text.\n\n` +
  `Editor feedback:\n${feedback}\n\nDraft:\n${draft}\n\n` +
  `Answer "grounded" if the feedback references specific content, claims, or wording ` +
  `from THIS draft. Answer "generic" if it is boilerplate advice that could apply to any text.`;

/**
 * Pairwise rubric for PROBE 2b: which of two feedbacks engages the draft
 * more specifically? The instruction is identical between (A,B) and (B,A);
 * only the labelled slots swap.
 */
const PAIRWISE_RUBRIC = (
  draft: string,
  a: string,
  b: string,
  first: "A" | "B",
): string =>
  `You judge which of two AI editor feedbacks more specifically engages with the ` +
  `given draft.\n\n` +
  `Draft:\n${draft}\n\n` +
  `Feedback ${first === "A" ? "A" : "B"}:\n${first === "A" ? a : b}\n\n` +
  `Feedback ${first === "A" ? "B" : "A"}:\n${first === "A" ? b : a}\n\n` +
  `Answer "A" if feedback A more specifically engages THIS draft (cites its specifics). ` +
  `Answer "B" if feedback B more specifically engages it.`;

type GroundedLabel = "grounded" | "generic";
type PairwiseLabel = "A" | "B";
/** `GroundedLabel | "?"` — what comes back from the parser when the model
 *  fails to produce one of the valid labels. */
type GroundedVerdict = GroundedLabel | "?";
/** `PairwiseLabel | "?"` — same for pairwise. We carry both cases
 *  because the parser lowercases ("a"/"b") but the rubric instruction and
 *  internal display want "A"/"B". `asPairwise` normalises. */
type PairwiseVerdict = PairwiseLabel | "a" | "b" | "?";

function asGrounded(l: GroundedVerdict): GroundedLabel {
  return l === "grounded" || l === "generic" ? l : "generic";
}
function asPairwise(l: PairwiseVerdict): PairwiseLabel {
  return l === "A" || l === "a" ? "A" : "B";
}

// ---------------------------------------------------------------------------
// Fixed fixtures. Hand-authored so each expected label is genuinely
// unambiguous for CLEAR cases; borderline + confident-bullshit are
// intentionally hard. These are the "drafts" of the meta-eval.
// ---------------------------------------------------------------------------

/** A clearly-themed short essay about mid-century concrete brutalism in
 *  Brazilian universities, with named buildings, dates, and a specific claim
 *  about FAU-USP's adoption of the liço corrent. */
const DRAFT_BRUTALISM =
  `Between 1958 and 1971, São Paulo's university campuses became laboratories ` +
  `for Brazilian brutalism: the FAU-USP complex (Vilanova Artigas, 1969) ` +
  `traded ornament for raw concrete and a continuous liço corrent that turned ` +
  `circulation into social space. The CECIERJ building in Rio followed a ` +
  `similar logic, but its pilotis were scaled down to fit a smaller lot, which ` +
  `broke the social-flow diagram that made Artigas's atrium legible. The ` +
  `author argues that these two buildings together refute the claim that ` +
  `brutalism is uniformly hostile to its users.`;

/** A short persuasive piece on why remote synchronous standups waste engineering
 *  time. Has a concrete named-org example (Plausible Analytics) and a specific
 *  claim about deep-work blocks. */
const DRAFT_STANDUPS =
  `Daily synchronous standups are net-negative for distributed engineering teams. ` +
  `Plausible Analytics dropped them in 2023 and reported that the average ` +
  `engineer gained 40 minutes of uninterrupted deep-work per day. The author's ` +
  `own team at a 12-person B2B SaaS saw async written standups surface blockers ` +
  `within 90 minutes, versus 24 hours under the synchronous version, because ` +
  `written status forced specificity. The piece argues the only signal a ` +
  `synchronous standup adds over async written status is social presence, and ` +
  `that signal is not worth the calendar tax.`;

/** A short food opinion column about why MSG-loaded instant ramen is not the
 *  same thing as a properly boiled tonkotsu broth. Specific brand and shop
 *  named. */
const DRAFT_RAMEN =
  `Calling instant ramen "tonkotsu" is a category error. The flavour packet in ` +
  `a Nissin Cup Noodle is built on hydrolyzed vegetable protein plus ~900mg of ` +
  `added MSG; genuine tonkotsu, like the 18-hour pork-bone broth at Ichiran ` +
  `Shibuya, gets its depth from collagen and emulsified fat, not free glutamate. ` +
  `The author concedes the umami overlap is real — both hit the same receptor — ` +
  `but argues that receptor overlap is not cuisine. The piece closes with a ` +
  `defence of long-simmered broths as cultural artefacts worth protecting.`;

/** A neutral un-themed passage of lorem-style writing used as the "unrelated"
 *  swap target in PROBE 5. */
const DRAFT_NEUTRAL =
  `The harbour at Halifax sits on a long, slow curve. Ferries leave the ` +
  `terminal at fifteen past every hour, and the crossing takes roughly an ` +
  `hour and a half in calm weather. On clear mornings you can see the ` +
  `lighthouse on McNab's Island before the pilot has finished her coffee. ` +
  `The author grew up nearby and returns every summer.`;

/** A hand-written grounded feedback for DRAFT_BRUTALISM — quotes specifics. */
const F_GROUNDED_BRUTALISM =
  `The strongest moment is the comparison between the FAU-USP liço corrent and the ` +
  `scaled-down CECIERJ pilotis — the author shows concretely how the social ` +
  `flow broke when Artigas's atrium dimension was compressed. I'd push on the ` +
  `claim that these two refute "uniform hostility": Artigas himself designed ` +
  `CEGIERJ's predecessor in 1962, so the comparison risks cherry-picking. Add ` +
  `one sentence naming the second Brazilian brutalist you'd counter-position, ` +
  `and the argument lands.`;

/** A hand-written grounded feedback for DRAFT_STANDUPS — quotes specifics. */
const F_GROUNDED_STANDUPS =
  `The Plausible Analytics datum (40 minutes of deep work regained per engineer ` +
  `per day) does most of the rhetorical work here, and the 12-person B2B SaaS ` +
  `comparison gives it texture — 90 minutes vs 24 hours to surface blockers is ` +
  `the cleanest illustration. Weak point: "social presence is not worth the ` +
  `calendar tax" is asserted, never argued. Either name what is lost without ` +
  `it (mentorship? onboarding?) or concede the trade-off.`;

/** A genuinely generic feedback that could apply to literally any draft. */
const F_GENERIC_A =
  `The piece would benefit from clearer structure, stronger topic sentences, and ` +
  `more specific evidence. Consider tightening the introduction, varying sentence ` +
  `length, and removing any redundant passages. A clear revision plan with ` +
  `measurable goals will help the reader follow the argument. Don't forget to ` +
  `proofread for typos and consistency before publishing.`;

/** A second generic, stylistically different, so probe 1 isn't measuring
 *  one specific template. */
const F_GENERIC_B =
  `Every essay gets stronger with a clear thesis up top, vivid concrete examples ` +
  `in the middle, and a memorable closing line. Try to show rather than tell, ` +
  `trust the reader, and cut any sentence whose only job is to gesture at the ` +
  `topic. Read it aloud once before you ship it.`;

/** Borderline grounded: cites the topic (remote work, async) but uses
 *  generic-feeling advice about specificity. A reasonable judge could go
 *  either way — that's the point. */
const F_BORDERLINE_GROUNDED =
  `The remote-work piece is timely and the move from anecdote to claim is well ` +
  `handled. Try to make the async-vs-sync comparison even more concrete — give ` +
  `the reader a single worked example they can picture. End with one sentence ` +
  `the reader will quote.`;

/** Borderline generic: looks specific ("three sentences", "the second
 *  paragraph") but is the kind of advice that fits most essays. */
const F_BORDERLINE_GENERIC =
  `The second paragraph is where the argument loses steam — three sentences in ` +
  `that block restate the introduction in different words. Cut them. The piece ` +
  `also has a pacing issue in the closing section; tighten the final paragraph.`;

/** Confident-bullshit hard negative: polished, specific-sounding, but the
 *  specifics are fabricated and about a DIFFERENT topic (cinema). */
const F_CONFIDENT_BULLSHIT =
  `The Kobayashi–Ozu axis you set up in the second act is exactly right — ` +
  `Kobayashi's 1962 "Harakiri" frame composition owes a clear debt to Ozu's ` +
  `tatami-low angle, and the way you read the long-take scene in ` +
  `"Black Rain" against Ozu's pillow shots is the most original move in the ` +
  `piece. One concern: the 1979 festival cut you reference doesn't exist in ` +
  `the BFI catalogue; verify before press.`;

/** A grounded feedback specifically engineered for DRAFT_BRUTALISM, used as
 *  the seed for PROBE 4 (mutation). */
const F_SEED_FOR_MUTATION =
  `The FAU-USP→CECIERJ comparison is the spine of the piece, and the ` +
  `specific point about the scaled-down pilotis breaking the social-flow ` +
  `diagram is exactly what makes the argument original. I'd push back on the ` +
  `claim that two buildings "refute" uniformity — at minimum you need a ` +
  `counter-example from Lina Bo Bardi or João Batista Vilanova Artigas's later ` +
  `work, otherwise it reads as cherry-picking.`;

/** Meaning-changing mutation: keep the surface, gut every draft-specific
 *  reference. Should flip to generic. */
const F_MUTATED_MEANING =
  `The architectural comparison is the spine of the piece, and the specific ` +
  `point about one building's reception of the other's ideas is exactly what ` +
  `makes the argument original. I'd push back on the claim that two examples ` +
  `"refute" uniformity — at minimum you need more examples from other ` +
  `architects of the era, otherwise it reads as cherry-picking.`;

/** Cosmetic mutation: paraphrase + reorder, keep every specific. Should
 *  remain grounded. */
const F_MUTATED_COSMETIC =
  `While the comparison between FAU-USP and CECIERJ carries the essay, it's ` +
  `the precise observation that the compressed pilotis undermined the social ` +
  `flow diagram that gives the argument its originality. However, asserting ` +
  `that just two buildings "refute" uniformity invites a cherry-picking ` +
  `objection — adding a counter-example from Lina Bo Bardi, or from Vilanova ` +
  `Artigas's later work, would close that gap.`;

/** Padding block — irrelevant filler about cooking. */
const PADDING_BLOCK =
  `\n\nA note on risotto: the rice should be arborio or carnaroli, never ` +
  `long-grain. Toast the grains in butter for two minutes before adding any ` +
  `liquid, and add stock one ladle at a time, stirring constantly. Wine goes ` +
  `in after the toast, before the first ladle. Finish off-heat with cold ` +
  `butter and Parmigiano-Reggiano — never Parmesan with a generic label. ` +
  `Rest the pan for sixty seconds before plating. A well-made risotto should ` +
  `flow slowly when you tap the plate, an Italian cooks' shorthand for ` +
  `"all'onda", meaning "like a wave". This is unrelated to the essay above; ` +
  `it is included here purely as filler to test whether the judge rewards ` +
  `length.`;

/** A verbose generic — long but boilerplate. */
const F_VERBOSE_GENERIC =
  `Great writing starts with a clear thesis, develops it through specific ` +
  `examples, and lands on a closing line the reader will remember. Before you ` +
  `revise, read the piece aloud once — your ear catches what your eye misses. ` +
  `Then tighten the introduction: every word in your opening paragraph should ` +
  `earn its place, and any sentence that only gestures at the topic should ` +
  `go. Vary your sentence length so the reader is never lulled into a ` +
  `predictable rhythm. Show, don't tell: replace abstract claims with ` +
  `concrete scenes, named sources, and verifiable facts. Cut filler. Trust ` +
  `the reader to do some of the work. A memorable closing line is the ` +
  `single highest-leverage edit you can make, because it is the sentence ` +
  `that will be quoted, tweeted, and remembered. Read it aloud once more ` +
  `before you ship it. Proofread for typos and consistency.`;

// ---------------------------------------------------------------------------
// Bifrost caller (header-only auth, retry on 5xx/504/408 + 429 + network).
// All calls are issued SEQUENTIALLY — Bifrost caps concurrency.
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MS = [1_500, 4_000, 8_000];
const MAX_ATTEMPTS = 4;

interface BifrostError extends Error {
  status?: number;
}

async function callBifrostOnce(
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(
    `${BIFROST_BASE_URL!.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
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
    const err: BifrostError = new Error(
      `Bifrost ${res.status}: ${text.slice(0, 300)}`,
    );
    err.status = res.status;
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
 * Retry wrapper. Retries on:
 *   - network errors (TypeError, FetchError, UndiciError)
 *   - HTTP 5xx, 504, 408, and 429 (concurrent_budget_exceeded from Bifrost)
 *
 * All other 4xx propagate immediately. The per-call AbortSignal is owned by
 * the caller and is left untouched across attempts.
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
      const e = err as BifrostError;
      lastErr = e;
      const isAbort = e.name === "AbortError";
      const status = e.status;
      const retryableNetwork =
        e instanceof TypeError ||
        e.name === "FetchError" ||
        e.name === "UndiciError";
      const retryableStatus =
        typeof status === "number" &&
        (status === 504 || status === 408 || status === 429 || status >= 500);
      const shouldRetry =
        attempt < MAX_ATTEMPTS - 1 &&
        !isAbort &&
        (retryableNetwork || retryableStatus);
      if (!shouldRetry) throw e;
      const delay =
        RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      await sleep(delay, signal);
    }
  }
  throw lastErr ?? new Error("Bifrost call failed");
}

async function callBifrost(
  system: string,
  user: string,
  model: string,
  temperature: number,
  signal: AbortSignal,
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
  return callBifrostWithRetry(body, signal);
}

// ---------------------------------------------------------------------------
// Defensive JSON parsing — mirrors evals/judge.ts and evals/run-rubric.ts.
// ---------------------------------------------------------------------------

function stripFences(text: string): string {
  return text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

interface LlmVerdict {
  label: string;
  score: number | null;
  explanation: string;
}

function parseVerdict(raw: string, validLabels: readonly string[]): LlmVerdict {
  let label = "";
  let explanation = "";
  const txt = stripFences(raw);
  try {
    const obj = JSON.parse(extractFirstJsonObject(txt) ?? txt) as {
      label?: unknown;
      explanation?: unknown;
    };
    label = String(obj.label ?? "")
      .trim()
      .toLowerCase();
    explanation = String(obj.explanation ?? "").trim();
  } catch {
    const low = raw.toLowerCase();
    label = validLabels.find((l) => low.includes(l)) ?? "?";
    explanation = raw.trim().slice(0, 200);
  }
  if (!validLabels.includes(label)) {
    label = validLabels.find((l) => label.includes(l)) ?? "?";
  }
  return {
    label,
    score:
      label === "grounded"
        ? 1
        : label === "generic"
          ? 0
          : label === "a"
            ? 1
            : label === "b"
              ? 0
              : null,
    explanation,
  };
}

const GROUNDED_SYSTEM = (valid: readonly string[]): string =>
  `You are a strict evaluator. Read the rubric, then respond with a JSON object ` +
  `exactly: {"label": "<one of: ${valid.join(", ")}>", "explanation": "<one sentence>"}. ` +
  `No other text.`;

async function judgeGrounded(
  prompt: string,
  signal: AbortSignal,
  model: string = JUDGE_MODEL,
  temperature: number = 0,
): Promise<LlmVerdict> {
  const raw = await callBifrost(
    GROUNDED_SYSTEM(["grounded", "generic"]),
    prompt,
    model,
    temperature,
    signal,
  );
  return parseVerdict(raw, ["grounded", "generic"]);
}

async function judgePairwise(
  draft: string,
  a: string,
  b: string,
  first: "A" | "B",
  signal: AbortSignal,
  model: string = JUDGE_MODEL,
): Promise<LlmVerdict> {
  const raw = await callBifrost(
    GROUNDED_SYSTEM(["a", "b"]),
    PAIRWISE_RUBRIC(draft, a, b, first),
    model,
    0,
    signal,
  );
  return parseVerdict(raw, ["a", "b"]);
}

// ---------------------------------------------------------------------------
// Probe infrastructure.
// ---------------------------------------------------------------------------

interface ProbeResult {
  passed: boolean;
  /** Whether this probe can ever fail the suite — false for report-only. */
  hard: boolean;
  /** Human-readable summary line for the final SUMMARY block. */
  summary: string;
}

const hardFailures: string[] = [];
const softFailures: string[] = [];

function recordFailure(probeName: string, hard: boolean, msg: string): void {
  if (hard) hardFailures.push(`${probeName}: ${msg}`);
  else softFailures.push(`${probeName}: ${msg}`);
}

function modalAgreement<T extends string>(
  xs: readonly T[],
): {
  modal: T;
  count: number;
  agreement: number;
} {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T = xs[0];
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return { modal: best, count: bestN, agreement: bestN / xs.length };
}

interface CaseSpec {
  case_id: string;
  draft: string;
  feedback: string;
  expected: GroundedLabel;
  /** Borderline cases are report-only — they still get scored, but a wrong
   *  verdict never fails the probe. */
  borderline?: boolean;
}

const RELIABILITY_CASES: readonly CaseSpec[] = [
  {
    case_id: "clear_grounded_brutalism",
    draft: DRAFT_BRUTALISM,
    feedback: F_GROUNDED_BRUTALISM,
    expected: "grounded",
  },
  {
    case_id: "clear_grounded_standups",
    draft: DRAFT_STANDUPS,
    feedback: F_GROUNDED_STANDUPS,
    expected: "grounded",
  },
  {
    case_id: "clear_generic_a",
    draft: DRAFT_BRUTALISM,
    feedback: F_GENERIC_A,
    expected: "generic",
  },
  {
    case_id: "clear_generic_b",
    draft: DRAFT_STANDUPS,
    feedback: F_GENERIC_B,
    expected: "generic",
  },
  {
    case_id: "borderline_grounded_remote",
    draft: DRAFT_STANDUPS,
    feedback: F_BORDERLINE_GROUNDED,
    expected: "grounded",
    borderline: true,
  },
  {
    case_id: "borderline_generic_paragraphs",
    draft: DRAFT_RAMEN,
    feedback: F_BORDERLINE_GENERIC,
    expected: "generic",
    borderline: true,
  },
];

interface ReliabilityRunResult {
  case_id: string;
  expected: GroundedLabel;
  borderline: boolean;
  verdicts: GroundedVerdict[];
  modal: GroundedVerdict;
  modal_count: number;
  agreement: number;
  flips: number;
}

async function probeReliability(): Promise<{
  result: ProbeResult;
  raw: ReliabilityRunResult[];
  temp07: ReliabilityRunResult[] | null;
}> {
  const N = 5;
  const raw: ReliabilityRunResult[] = [];
  console.log(
    `\n[PROBE 1] Reliability / non-randomness — N=${N} runs each at temp 0`,
  );
  for (const c of RELIABILITY_CASES) {
    const verdicts: GroundedVerdict[] = [];
    for (let i = 0; i < N; i += 1) {
      const v = await judgeGrounded(
        FAITHFULNESS_RUBRIC_V1(c.draft, c.feedback),
        AbortSignal.timeout(90_000),
      );
      const lbl =
        v.label === "grounded" || v.label === "generic" ? v.label : "?";
      verdicts.push(lbl);
    }
    const m = modalAgreement(verdicts);
    const flips = N - m.count;
    const row: ReliabilityRunResult = {
      case_id: c.case_id,
      expected: c.expected,
      borderline: c.borderline ?? false,
      verdicts,
      modal: m.modal,
      modal_count: m.count,
      agreement: m.agreement,
      flips,
    };
    raw.push(row);
    const tag = c.borderline ? "[BORDERLINE]" : "[CLEAR]";
    console.log(
      `  ${tag} ${c.case_id.padEnd(36)} expected=${c.expected.padEnd(9)} ` +
        `verdicts=${verdicts.join(",")} modal=${m.modal} (${m.count}/${N}, ` +
        `flips=${flips})`,
    );
  }

  // Optional temp-0.7 spread on borderline cases only (report-only).
  let temp07: ReliabilityRunResult[] | null = null;
  const borderlines = RELIABILITY_CASES.filter((c) => c.borderline);
  if (borderlines.length > 0) {
    temp07 = [];
    console.log(
      `\n[PROBE 1b] Borderline spread @ temperature 0.7 — report-only`,
    );
    for (const c of borderlines) {
      const verdicts: GroundedVerdict[] = [];
      for (let i = 0; i < N; i += 1) {
        const v = await judgeGrounded(
          FAITHFULNESS_RUBRIC_V1(c.draft, c.feedback),
          AbortSignal.timeout(90_000),
          JUDGE_MODEL,
          0.7,
        );
        const lbl =
          v.label === "grounded" || v.label === "generic" ? v.label : "?";
        verdicts.push(lbl);
      }
      const m = modalAgreement(verdicts);
      const flips = N - m.count;
      temp07.push({
        case_id: c.case_id,
        expected: c.expected,
        borderline: true,
        verdicts,
        modal: m.modal,
        modal_count: m.count,
        agreement: m.agreement,
        flips,
      });
      console.log(
        `  [BORDERLINE] ${c.case_id.padEnd(36)} expected=${c.expected.padEnd(9)} ` +
          `verdicts=${verdicts.join(",")} modal=${m.modal} (${m.count}/${N})`,
      );
    }
  }

  // Pass condition: every CLEAR case is 5/5 self-consistent AND its modal
  // label equals the expected label. Borderlines are report-only.
  const clears = raw.filter((r) => !r.borderline);
  const allClearSelfConsistent = clears.every((r) => r.modal_count === N);
  const allClearModalMatchesExpected = clears.every(
    (r) => r.modal === r.expected,
  );
  const passed = allClearSelfConsistent && allClearModalMatchesExpected;
  const overallFlipRate =
    raw.reduce((acc, r) => acc + r.flips, 0) / (raw.length * N);

  const summary =
    `self-consistent=${clears.filter((r) => r.modal_count === N).length}/${clears.length} clear, ` +
    `modal-matches-expected=${clears.filter((r) => r.modal === r.expected).length}/${clears.length} clear, ` +
    `flip-rate=${(overallFlipRate * 100).toFixed(1)}%`;
  return { result: { passed, hard: true, summary }, raw, temp07 };
}

// ---------------------------------------------------------------------------
// PROBE 2 — Position / ordering bias
// ---------------------------------------------------------------------------

interface PositionPair {
  case_id: string;
  draft: string;
  feedback: string;
  expected: GroundedLabel;
}

const POSITION_PAIRS: readonly PositionPair[] = [
  {
    case_id: "clear_grounded_brutalism",
    draft: DRAFT_BRUTALISM,
    feedback: F_GROUNDED_BRUTALISM,
    expected: "grounded",
  },
  {
    case_id: "clear_grounded_standups",
    draft: DRAFT_STANDUPS,
    feedback: F_GROUNDED_STANDUPS,
    expected: "grounded",
  },
  {
    case_id: "clear_generic_a",
    draft: DRAFT_BRUTALISM,
    feedback: F_GENERIC_A,
    expected: "generic",
  },
];

interface PairwiseTriple {
  case_id: string;
  draft: string;
  a_feedback: string;
  b_feedback: string;
  /** "A" is the grounded one. */
  expected_winner: "A" | "B";
}

const PAIRWISE_TRIPLES: readonly PairwiseTriple[] = [
  {
    case_id: "pw_brutalism_grounded_vs_generic",
    draft: DRAFT_BRUTALISM,
    a_feedback: F_GROUNDED_BRUTALISM,
    b_feedback: F_GENERIC_A,
    expected_winner: "A",
  },
  {
    case_id: "pw_standups_grounded_vs_generic",
    draft: DRAFT_STANDUPS,
    a_feedback: F_GROUNDED_STANDUPS,
    b_feedback: F_GENERIC_B,
    expected_winner: "A",
  },
  {
    case_id: "pw_ramen_grounded_vs_generic",
    draft: DRAFT_RAMEN,
    a_feedback: F_GROUNDED_BRUTALISM.replace(/FAU-USP|CECIERJ/gi, (m) =>
      m === "FAU-USP" ? "Ichiran" : "Nissin",
    ),
    b_feedback: F_GENERIC_A,
    expected_winner: "A",
  },
];

interface FieldOrderRow {
  case_id: string;
  expected: GroundedLabel;
  draft_then_feedback: GroundedLabel;
  feedback_then_draft: GroundedLabel;
  order_robust: boolean;
}

interface PairwiseRow {
  case_id: string;
  expected_winner: "A" | "B";
  ab_order: PairwiseLabel;
  ba_order: PairwiseLabel;
  picks_A_in_both_orderings: boolean;
  picks_same_slot_in_both_orderings: boolean;
}

async function probePosition(): Promise<{
  result: ProbeResult;
  fieldOrder: FieldOrderRow[];
  pairwise: PairwiseRow[];
}> {
  console.log(`\n[PROBE 2] Position / ordering bias`);
  // 2a — field order.
  const fieldOrder: FieldOrderRow[] = [];
  for (const p of POSITION_PAIRS) {
    const a = await judgeGrounded(
      FAITHFULNESS_RUBRIC_V1(p.draft, p.feedback),
      AbortSignal.timeout(90_000),
    );
    const b = await judgeGrounded(
      FAITHFULNESS_RUBRIC_V2(p.draft, p.feedback),
      AbortSignal.timeout(90_000),
    );
    const aLbl: GroundedVerdict =
      a.label === "grounded" || a.label === "generic" ? a.label : "?";
    const bLbl: GroundedVerdict =
      b.label === "grounded" || b.label === "generic" ? b.label : "?";
    const row: FieldOrderRow = {
      case_id: p.case_id,
      expected: p.expected,
      draft_then_feedback: asGrounded(aLbl),
      feedback_then_draft: asGrounded(bLbl),
      order_robust: aLbl === bLbl,
    };
    fieldOrder.push(row);
    const mark = row.order_robust ? "✓" : "✗";
    console.log(
      `  [2a] ${mark} ${p.case_id.padEnd(36)} D-F=${aLbl.padEnd(9)} F-D=${bLbl.padEnd(9)} expected=${p.expected}`,
    );
  }

  // 2b — pairwise slot bias.
  const pairwise: PairwiseRow[] = [];
  for (const t of PAIRWISE_TRIPLES) {
    const ab = await judgePairwise(
      t.draft,
      t.a_feedback,
      t.b_feedback,
      "A",
      AbortSignal.timeout(90_000),
    );
    const ba = await judgePairwise(
      t.draft,
      t.a_feedback,
      t.b_feedback,
      "B",
      AbortSignal.timeout(90_000),
    );
    const abLbl: PairwiseVerdict =
      ab.label === "a" || ab.label === "b" ? ab.label : "?";
    const baLbl: PairwiseVerdict =
      ba.label === "a" || ba.label === "b" ? ba.label : "?";
    const abSlot = abLbl === "a" ? "first" : "second";
    const baSlot = baLbl === "b" ? "first" : "second";
    const picksSameSlot = abSlot === baSlot;
    const picksAInBoth = abLbl === "a" && baLbl === "a";
    const row: PairwiseRow = {
      case_id: t.case_id,
      expected_winner: t.expected_winner,
      ab_order: asPairwise(abLbl),
      ba_order: asPairwise(baLbl),
      picks_A_in_both_orderings: picksAInBoth,
      picks_same_slot_in_both_orderings: picksSameSlot,
    };
    pairwise.push(row);
    const mark = picksAInBoth ? "✓" : "✗";
    console.log(
      `  [2b] ${mark} ${t.case_id.padEnd(36)} AB=${abLbl} BA=${baLbl} slot-constant=${picksSameSlot} expected=A`,
    );
  }

  const orderAllRobust = fieldOrder.every((r) => r.order_robust);
  const pairwiseAllConsistent = pairwise.every(
    (r) => r.picks_A_in_both_orderings,
  );
  const slotConsistencyRate =
    pairwise.filter((r) => r.picks_same_slot_in_both_orderings).length /
    pairwise.length;
  const contentConsistencyRate =
    pairwise.filter((r) => r.picks_A_in_both_orderings).length /
    pairwise.length;
  const passed = orderAllRobust && pairwiseAllConsistent;
  const summary =
    `field-order-robust=${fieldOrder.filter((r) => r.order_robust).length}/${fieldOrder.length}, ` +
    `pairwise-content-consistent=${pairwise.filter((r) => r.picks_A_in_both_orderings).length}/${pairwise.length}, ` +
    `slot-consistency=${(slotConsistencyRate * 100).toFixed(0)}%`;
  return { result: { passed, hard: true, summary }, fieldOrder, pairwise };
}

// ---------------------------------------------------------------------------
// PROBE 3 — Verbosity / content-amount bias
// ---------------------------------------------------------------------------

interface VerbosityRow {
  case_id: string;
  draft: string;
  feedback_chars: number;
  expected: GroundedLabel;
  verdict: GroundedLabel;
  length_driven_flip: boolean;
}

interface VerbosityInput {
  case_id: string;
  draft: string;
  feedback: string;
  feedback_chars: number;
  expected: GroundedLabel;
}

async function probeVerbosity(): Promise<{
  result: ProbeResult;
  raw: VerbosityRow[];
}> {
  console.log(`\n[PROBE 3] Verbosity / content-amount bias`);
  const cases: VerbosityInput[] = [
    {
      case_id: "concise_grounded",
      draft: DRAFT_BRUTALISM,
      feedback_chars: F_GROUNDED_BRUTALISM.length,
      expected: "grounded",
      feedback: F_GROUNDED_BRUTALISM,
    },
    {
      case_id: "verbose_generic",
      draft: DRAFT_BRUTALISM,
      feedback_chars: F_VERBOSE_GENERIC.length,
      expected: "generic",
      feedback: F_VERBOSE_GENERIC,
    },
    {
      case_id: "padded_grounded",
      draft: DRAFT_BRUTALISM,
      feedback_chars: F_GROUNDED_BRUTALISM.length + PADDING_BLOCK.length,
      expected: "grounded",
      feedback: F_GROUNDED_BRUTALISM + PADDING_BLOCK,
    },
  ];
  const raw: VerbosityRow[] = [];
  for (const c of cases) {
    const v = await judgeGrounded(
      FAITHFULNESS_RUBRIC_V1(c.draft, c.feedback),
      AbortSignal.timeout(90_000),
    );
    const lbl: GroundedVerdict =
      v.label === "grounded" || v.label === "generic" ? v.label : "?";
    const flipped = lbl !== c.expected;
    raw.push({
      case_id: c.case_id,
      draft: c.draft === DRAFT_BRUTALISM ? "DRAFT_BRUTALISM" : "other",
      feedback_chars: c.feedback_chars,
      expected: c.expected,
      verdict: asGrounded(lbl),
      length_driven_flip: flipped,
    });
    const mark = !flipped ? "✓" : "✗";
    console.log(
      `  ${mark} ${c.case_id.padEnd(22)} chars=${String(c.feedback_chars).padStart(5)} ` +
        `expected=${c.expected.padEnd(9)} verdict=${lbl}`,
    );
  }
  const passed = raw.every((r) => !r.length_driven_flip);
  const lengthDrivenFlips = raw.filter((r) => r.length_driven_flip).length;
  const summary =
    `length-respected=${raw.length - lengthDrivenFlips}/${raw.length}, ` +
    `length-driven-flips=${lengthDrivenFlips}`;
  return { result: { passed, hard: true, summary }, raw };
}

// ---------------------------------------------------------------------------
// PROBE 4 — Mutation
// ---------------------------------------------------------------------------

interface MutationRow {
  case_id: string;
  expected: GroundedLabel;
  verdict: GroundedLabel;
}

async function probeMutation(): Promise<{
  result: ProbeResult;
  raw: MutationRow[];
}> {
  console.log(`\n[PROBE 4] Mutation (sensitivity + robustness)`);
  const cases: Array<{
    case_id: string;
    feedback: string;
    expected: GroundedLabel;
  }> = [
    {
      case_id: "base_grounded",
      feedback: F_SEED_FOR_MUTATION,
      expected: "grounded",
    },
    {
      case_id: "meaning_changing_mutation",
      feedback: F_MUTATED_MEANING,
      expected: "generic",
    },
    {
      case_id: "cosmetic_mutation",
      feedback: F_MUTATED_COSMETIC,
      expected: "grounded",
    },
  ];
  const raw: MutationRow[] = [];
  for (const c of cases) {
    const v = await judgeGrounded(
      FAITHFULNESS_RUBRIC_V1(DRAFT_BRUTALISM, c.feedback),
      AbortSignal.timeout(90_000),
    );
    const lbl: GroundedVerdict =
      v.label === "grounded" || v.label === "generic" ? v.label : "?";
    raw.push({
      case_id: c.case_id,
      expected: c.expected,
      verdict: asGrounded(lbl),
    });
    const mark = lbl === c.expected ? "✓" : "✗";
    console.log(
      `  ${mark} ${c.case_id.padEnd(28)} expected=${c.expected.padEnd(9)} verdict=${lbl}`,
    );
  }
  const passed = raw.every((r) => r.verdict === r.expected);
  const summary = `correct=${raw.filter((r) => r.verdict === r.expected).length}/${raw.length}`;
  return { result: { passed, hard: true, summary }, raw };
}

// ---------------------------------------------------------------------------
// PROBE 5 — Amputation (most important)
// ---------------------------------------------------------------------------

interface AmputationRow {
  case_id: string;
  draft_kind: "original" | "unrelated" | "empty";
  expected: GroundedLabel;
  verdict: GroundedLabel;
  rubber_stamped: boolean;
}

async function probeAmputation(): Promise<{
  result: ProbeResult;
  raw: AmputationRow[];
}> {
  console.log(
    `\n[PROBE 5] Amputation — does the judge actually USE the draft?  *** most important probe ***`,
  );
  const cases: Array<{
    case_id: string;
    draft: string;
    draft_kind: "original" | "unrelated" | "empty";
    expected: GroundedLabel;
  }> = [
    {
      case_id: "grounded_with_correct_draft",
      draft: DRAFT_BRUTALISM,
      draft_kind: "original",
      expected: "grounded",
    },
    {
      case_id: "grounded_with_unrelated_draft",
      draft: DRAFT_NEUTRAL,
      draft_kind: "unrelated",
      expected: "generic",
    },
    {
      case_id: "grounded_with_empty_draft",
      draft: "",
      draft_kind: "empty",
      expected: "generic",
    },
  ];
  const raw: AmputationRow[] = [];
  for (const c of cases) {
    const v = await judgeGrounded(
      FAITHFULNESS_RUBRIC_V1(c.draft, F_GROUNDED_BRUTALISM),
      AbortSignal.timeout(90_000),
    );
    const lbl: GroundedVerdict =
      v.label === "grounded" || v.label === "generic" ? v.label : "?";
    const rubberStamped = c.draft_kind !== "original" && lbl === "grounded";
    raw.push({
      case_id: c.case_id,
      draft_kind: c.draft_kind,
      expected: c.expected,
      verdict: asGrounded(lbl),
      rubber_stamped: rubberStamped,
    });
    const mark = lbl === c.expected ? "✓" : "✗";
    const alarm = rubberStamped ? "  ⚠ JUDGE IGNORED DRAFT" : "";
    console.log(
      `  ${mark} ${c.case_id.padEnd(34)} draft=${c.draft_kind.padEnd(10)} ` +
        `expected=${c.expected.padEnd(9)} verdict=${lbl}${alarm}`,
    );
  }
  const passed = raw.every((r) => r.verdict === r.expected);
  const rubberStamps = raw.filter((r) => r.rubber_stamped).length;
  const summary =
    `draft-conditioned=${raw.length - rubberStamps}/${raw.length}, ` +
    `rubber-stamps=${rubberStamps}`;
  return { result: { passed, hard: true, summary }, raw };
}

// ---------------------------------------------------------------------------
// PROBE 6 — Confident-bullshit hard negative
// ---------------------------------------------------------------------------

async function probeBullshit(): Promise<{
  result: ProbeResult;
  raw: MutationRow[];
}> {
  console.log(`\n[PROBE 6] Confident-bullshit hard negative (report-only)`);
  const v = await judgeGrounded(
    FAITHFULNESS_RUBRIC_V1(DRAFT_RAMEN, F_CONFIDENT_BULLSHIT),
    AbortSignal.timeout(90_000),
  );
  const lbl: GroundedVerdict =
    v.label === "grounded" || v.label === "generic" ? v.label : "?";
  const passed = lbl === "generic";
  const raw: MutationRow[] = [
    {
      case_id: "confident_bullshit_about_cinema_on_ramen_draft",
      expected: "generic",
      verdict: asGrounded(lbl),
    },
  ];
  const mark = passed ? "✓" : "✗";
  console.log(
    `  ${mark} expected=generic verdict=${lbl}  (this is the "hardness" probe)`,
  );
  return {
    result: {
      passed,
      hard: true,
      summary: `not-fooled-by-bullshit=${passed ? "yes" : "NO"}`,
    },
    raw,
  };
}

// ---------------------------------------------------------------------------
// PROBE 7 — Cross-model agreement (optional)
// ---------------------------------------------------------------------------

interface CrossModelRow {
  case_id: string;
  expected: GroundedLabel;
  m1_verdict: GroundedLabel;
  m2_verdict: GroundedLabel;
  agree: boolean;
}

async function probeCrossModel(): Promise<{
  result: ProbeResult;
  raw: CrossModelRow[];
  skipped: boolean;
}> {
  console.log(
    `\n[PROBE 7] Cross-model agreement (JUDGE_MODEL vs JUDGE_MODEL_2)`,
  );
  if (!JUDGE_MODEL_2) {
    console.log("  -- skipped: JUDGE_MODEL_2 is not set");
    return {
      result: {
        passed: true,
        hard: false,
        summary: "skipped (JUDGE_MODEL_2 unset)",
      },
      raw: [],
      skipped: true,
    };
  }
  const clearCases = RELIABILITY_CASES.filter((c) => !c.borderline);
  const raw: CrossModelRow[] = [];
  for (const c of clearCases) {
    const a = await judgeGrounded(
      FAITHFULNESS_RUBRIC_V1(c.draft, c.feedback),
      AbortSignal.timeout(90_000),
      JUDGE_MODEL,
      0,
    );
    const b = await judgeGrounded(
      FAITHFULNESS_RUBRIC_V1(c.draft, c.feedback),
      AbortSignal.timeout(90_000),
      JUDGE_MODEL_2,
      0,
    );
    const aLbl: GroundedVerdict =
      a.label === "grounded" || a.label === "generic" ? a.label : "?";
    const bLbl: GroundedVerdict =
      b.label === "grounded" || b.label === "generic" ? b.label : "?";
    raw.push({
      case_id: c.case_id,
      expected: c.expected,
      m1_verdict: asGrounded(aLbl),
      m2_verdict: asGrounded(bLbl),
      agree: aLbl === bLbl,
    });
    const mark = raw[raw.length - 1].agree ? "✓" : "✗";
    console.log(
      `  ${mark} ${c.case_id.padEnd(36)} ${JUDGE_MODEL}=${aLbl}  ${JUDGE_MODEL_2}=${bLbl}`,
    );
  }
  const agreement = raw.filter((r) => r.agree).length / raw.length;
  const summary =
    `label-agreement=${(agreement * 100).toFixed(0)}% ` +
    `(${raw.filter((r) => r.agree).length}/${raw.length})`;
  // Report-only — never sets exit code.
  return {
    result: { passed: true, hard: false, summary },
    raw,
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// Orchestration + artifact write.
// ---------------------------------------------------------------------------

interface ProbeArtifact {
  passed: boolean;
  hard: boolean;
  summary: string;
}

interface RobustnessArtifact {
  model: string;
  model_2: string;
  probes: {
    p1_reliability: ProbeArtifact & {
      cases: ReliabilityRunResult[];
      temp07: ReliabilityRunResult[] | null;
    };
    p2_position: ProbeArtifact & {
      field_order: FieldOrderRow[];
      pairwise: PairwiseRow[];
    };
    p3_verbosity: ProbeArtifact & { cases: VerbosityRow[] };
    p4_mutation: ProbeArtifact & { cases: MutationRow[] };
    p5_amputation: ProbeArtifact & { cases: AmputationRow[] };
    p6_bullshit: ProbeArtifact & { cases: MutationRow[] };
    p7_cross_model: ProbeArtifact & {
      cases: CrossModelRow[];
      skipped: boolean;
    };
  };
  overall: {
    passed: boolean;
    hard_failures: string[];
    soft_failures: string[];
  };
}

async function main(): Promise<void> {
  if (!BIFROST_BASE_URL || !BIFROST_API_KEY) {
    console.error(
      "[twyne:robustness] BIFROST_BASE_URL and BIFROST_API_KEY are required",
    );
    process.exit(1);
  }

  console.log(
    `[twyne:robustness] judge=${JUDGE_MODEL}` +
      (JUDGE_MODEL_2 ? `, model_2=${JUDGE_MODEL_2}` : ", model_2=(unset)"),
  );

  let p1: Awaited<ReturnType<typeof probeReliability>>;
  let p2: Awaited<ReturnType<typeof probePosition>>;
  let p3: Awaited<ReturnType<typeof probeVerbosity>>;
  let p4: Awaited<ReturnType<typeof probeMutation>>;
  let p5: Awaited<ReturnType<typeof probeAmputation>>;
  let p6: Awaited<ReturnType<typeof probeBullshit>>;
  let p7: Awaited<ReturnType<typeof probeCrossModel>>;

  try {
    p1 = await probeReliability();
    p2 = await probePosition();
    p3 = await probeVerbosity();
    p4 = await probeMutation();
    p5 = await probeAmputation();
    p6 = await probeBullshit();
    p7 = await probeCrossModel();
  } catch (err) {
    // Anything that bubbles past the per-probe retry+parse layer is a hard
    // harness failure (network/parse after retries).
    console.error("[twyne:robustness] fatal:", err);
    process.exit(1);
  }

  const probes = [p1, p2, p3, p4, p5, p6, p7];
  for (const p of probes) {
    if (!p.result.passed && p.result.hard) {
      recordFailure(probeNameFor(p), true, p.result.summary);
    } else if (!p.result.passed) {
      recordFailure(probeNameFor(p), false, p.result.summary);
    }
  }

  const artifact: RobustnessArtifact = {
    model: JUDGE_MODEL,
    model_2: JUDGE_MODEL_2,
    probes: {
      p1_reliability: {
        passed: p1.result.passed,
        hard: p1.result.hard,
        summary: p1.result.summary,
        cases: p1.raw,
        temp07: p1.temp07,
      },
      p2_position: {
        passed: p2.result.passed,
        hard: p2.result.hard,
        summary: p2.result.summary,
        field_order: p2.fieldOrder,
        pairwise: p2.pairwise,
      },
      p3_verbosity: {
        passed: p3.result.passed,
        hard: p3.result.hard,
        summary: p3.result.summary,
        cases: p3.raw,
      },
      p4_mutation: {
        passed: p4.result.passed,
        hard: p4.result.hard,
        summary: p4.result.summary,
        cases: p4.raw,
      },
      p5_amputation: {
        passed: p5.result.passed,
        hard: p5.result.hard,
        summary: p5.result.summary,
        cases: p5.raw,
      },
      p6_bullshit: {
        passed: p6.result.passed,
        hard: p6.result.hard,
        summary: p6.result.summary,
        cases: p6.raw,
      },
      p7_cross_model: {
        passed: p7.result.passed,
        hard: p7.result.hard,
        summary: p7.result.summary,
        cases: p7.raw,
        skipped: p7.skipped,
      },
    },
    overall: {
      passed: hardFailures.length === 0 && softFailures.length === 0,
      hard_failures: hardFailures,
      soft_failures: softFailures,
    },
  };

  writeFileSync(SCORES_PATH, JSON.stringify(artifact, null, 2));

  // ----- Final SUMMARY block -----
  console.log("\n=========================================");
  console.log("  JUDGE-ROBUSTNESS SUMMARY");
  console.log("=========================================");
  const lines: Array<{ name: string; r: ProbeResult }> = [
    { name: "PROBE 1 reliability    ", r: p1.result },
    { name: "PROBE 2 position      ", r: p2.result },
    { name: "PROBE 3 verbosity     ", r: p3.result },
    { name: "PROBE 4 mutation      ", r: p4.result },
    { name: "PROBE 5 amputation    ", r: p5.result },
    { name: "PROBE 6 bullshit      ", r: p6.result },
    { name: "PROBE 7 cross-model   ", r: p7.result },
  ];
  for (const l of lines) {
    const tag = l.r.passed ? "PASS" : "FAIL";
    const suffix = l.r.hard ? "  " : "  (report-only)";
    console.log(`  [${tag}]${suffix}${l.name}  ${l.r.summary}`);
  }
  const overall = hardFailures.length === 0 ? "PASS" : "FAIL";
  console.log("-----------------------------------------");
  console.log(`  OVERALL: ${overall}`);
  if (hardFailures.length > 0) {
    for (const f of hardFailures) console.log(`    - ${f}`);
  }
  if (softFailures.length > 0) {
    console.log("  (soft / report-only failures — not counted)");
    for (const f of softFailures) console.log(`    - ${f}`);
  }
  console.log("=========================================");
  console.log(
    `[twyne:robustness] wrote artifact to evals/robustness-scores.json`,
  );

  if (hardFailures.length > 0) {
    process.exitCode = 1;
  }
}

function probeNameFor(p: {
  result: ProbeResult;
  raw?: unknown;
  fieldOrder?: unknown;
  pairwise?: unknown;
  temp07?: unknown;
}): string {
  if (Array.isArray(p.fieldOrder) && Array.isArray(p.pairwise))
    return "PROBE 2";
  if (p.temp07 !== undefined) return "PROBE 1";
  if (Array.isArray(p.raw) && p.raw.length > 0) {
    const first = (p.raw as Array<{ case_id?: string }>)[0];
    if (first?.case_id === "confident_bullshit_about_cinema_on_ramen_draft")
      return "PROBE 6";
    if (
      first?.case_id === "grounded_with_correct_draft" ||
      first?.case_id === "grounded_with_unrelated_draft"
    )
      return "PROBE 5";
    if (
      first?.case_id === "base_grounded" ||
      first?.case_id === "meaning_changing_mutation" ||
      first?.case_id === "cosmetic_mutation"
    )
      return "PROBE 4";
    if (
      first?.case_id === "concise_grounded" ||
      first?.case_id === "verbose_generic" ||
      first?.case_id === "padded_grounded"
    )
      return "PROBE 3";
    return "PROBE 1";
  }
  return "PROBE 7";
}

main().catch((err) => {
  console.error("[twyne:robustness] fatal:", err);
  process.exit(1);
});
