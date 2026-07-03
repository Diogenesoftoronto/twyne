/**
 * Offline eval harness for Twyne's AI conversational interview (dossier creation).
 *
 * Replays the REAL production interview system prompt (verbatim from
 * `convex/agents.ts:interviewSystemPrompt`) through the Bifrost gateway for
 * each conversation in `evals/interview.jsonl`, then applies five LLM-as-judge
 * rubrics:
 *
 *   - protocol-adherence    : did the model use DOSSIER: / SYNTHESIZE: tags correctly?
 *   - question-quality      : is the question short, one-at-a-time, and incisive?
 *   - focus-discipline      : did the model stay on-task vs. get distracted by tangents?
 *   - conclusion-timing     : did the model synthesize when it should (or NOT synthesize when it shouldn't)?
 *   - dossier-grounding     : is the tagged DOSSIER JSON grounded in the actual conversation?
 *
 * Mirrors the conventions of `evals/run-experiment.ts` and `evals/judge.ts`
 * (Node/TS via `tsx`, `node:fs`/`node:path` imports, header-only Bifrost auth,
 * case_id keys, main().catch() tail).
 *
 * The interview has no tools — it uses tagged-text parsing (DOSSIER: and
 * SYNTHESIZE: markers). "Tool usage" here means protocol adherence: the model
 * must emit the correct tag at the correct time with valid JSON.
 *
 * Usage:
 *   BIFROST_BASE_URL=https://... BIFROST_API_KEY=sk_bf_xxx \
 *     BIFROST_DEFAULT_MODEL=neuralwatt/qwen3.5-397b-fast \
 *     JUDGE_MODEL=neuralwatt/kimi-k2.6 bun run eval:interview
 *
 * Writes evals/interview-scores.json. Read-only w.r.t. the repo otherwise.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(HERE, "interview.jsonl");
const SCORES_PATH = resolve(HERE, "interview-scores.json");

const BIFROST_BASE_URL = process.env.BIFROST_BASE_URL;
const BIFROST_API_KEY = process.env.BIFROST_API_KEY;
const BIFROST_DEFAULT_MODEL =
  process.env.BIFROST_DEFAULT_MODEL ?? "neuralwatt/qwen3.5-397b-fast";
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "neuralwatt/kimi-k2.6";

// ---------------------------------------------------------------------------
// Types — mirror the production InterviewMessage and ProjectInterviewAnswers.
// ---------------------------------------------------------------------------

interface InterviewMessage {
  author: "writer" | "interviewer";
  text: string;
}

interface ProjectInterviewAnswers {
  workingTitle: string;
  format: string;
  audience: string;
  goal: string;
  tone: string;
  constraints: string;
  successSignal: string;
}

interface ProjectBrief {
  answers: ProjectInterviewAnswers;
}

type InterviewMode = "first-run" | "refine";

interface DatasetRow {
  case_id: string;
  mode: InterviewMode;
  currentBrief: ProjectBrief | null;
  messages: InterviewMessage[];
  expectedBehavior: "question" | "question_with_dossier" | "synthesize";
  expectedDossierFields: string[];
  groundTruthContext: string;
  distractionPresent: boolean;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Production system prompt — verbatim from convex/agents.ts:interviewSystemPrompt.
// If you change it here, also change it there.
// ---------------------------------------------------------------------------

function interviewSystemPrompt(
  mode: "first-run" | "refine",
  currentBrief: ProjectBrief | null,
): string {
  return [
    "You are a kind, incisive editorial interviewer helping a writer build a project dossier.",
    "Ask one question at a time. Keep it short. You are building a writer's room: identify the piece, reader, goal, tone, constraints, success signal, and what kind of advisors/editors the writer wants around it.",
    'After every ordinary question, append `DOSSIER:` followed by JSON { "brief": { workingTitle, format, audience, goal, tone, constraints, successSignal }, "confidence": { field: "high" | "medium" | "low" } }. Only include fields you can reasonably infer.',
    "When the dossier is complete enough for review, respond only with `SYNTHESIZE:` followed by the same JSON shape. Put requested advisors/editors into constraints or goal until the product has a dedicated advisor schema.",
    mode === "refine" && currentBrief
      ? `Existing dossier: ${JSON.stringify(currentBrief.answers)} — refine it, don't restart.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Tagged-JSON extraction — verbatim from src/utils/llm-parsing.ts.
// ---------------------------------------------------------------------------

interface TaggedJsonSegment {
  value: unknown;
  start: number;
  end: number;
}

function findJsonObjectEnd(text: string, open: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

function extractTaggedJson(
  text: string,
  tag: "DOSSIER" | "SYNTHESIZE",
): TaggedJsonSegment | null {
  const marker = new RegExp(`${tag}:`, "i").exec(text);
  if (!marker) return null;
  const open = text.indexOf("{", marker.index + marker[0].length);
  if (open < 0) return null;
  const end = findJsonObjectEnd(text, open);
  if (end === null) return null;
  try {
    return {
      value: JSON.parse(text.slice(open, end + 1)),
      start: marker.index,
      end: end + 1,
    };
  } catch {
    return null;
  }
}

function stripTaggedJson(
  text: string,
  segment: Pick<TaggedJsonSegment, "start" | "end">,
): string {
  return `${text.slice(0, segment.start)}${text.slice(segment.end)}`.trim();
}

// ---------------------------------------------------------------------------
// Reasoning-tag stripping — verbatim from src/utils/reasoning-tags.ts.
// ---------------------------------------------------------------------------

const REASONING_TAG_PATTERN = /<\/?\s*think(?:ing)?\b[^>]*\/?\s*>/gi;

function stripReasoningTags(text: string): string {
  let visible = "";
  let cursor = 0;
  let depth = 0;
  for (const match of text.matchAll(REASONING_TAG_PATTERN)) {
    const tag = match[0];
    const index = match.index ?? 0;
    if (depth === 0) {
      visible += text.slice(cursor, index);
    }
    const normalized = tag.toLowerCase().replace(/\s+/g, "");
    const isClosing = normalized.startsWith("</") || normalized.endsWith("/>");
    if (isClosing) {
      depth = Math.max(0, depth - 1);
    } else {
      depth += 1;
    }
    cursor = index + tag.length;
  }
  if (depth === 0) {
    visible += text.slice(cursor);
  }
  return visible
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Parsed output — mirrors the production InterviewTurnResult.
// ---------------------------------------------------------------------------

interface ParsedTurn {
  kind: "question" | "synthesize";
  text: string;
  dossierFields: string[];
  rawOutput: string;
  hasDossierTag: boolean;
  hasSynthesizeTag: boolean;
  dossierJsonValid: boolean;
}

const INTERVIEW_FIELDS = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
] as const;

function normalizeDossierFields(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  const briefSource =
    obj.brief && typeof obj.brief === "object"
      ? (obj.brief as Record<string, unknown>)
      : obj;
  const fields: string[] = [];
  for (const field of INTERVIEW_FIELDS) {
    const raw = briefSource[field];
    if (typeof raw === "string" && raw.trim()) {
      fields.push(field);
    }
  }
  return fields;
}

function parseInterviewOutput(text: string): ParsedTurn {
  const visible = stripReasoningTags(text);
  const synthSegment = extractTaggedJson(visible, "SYNTHESIZE");
  if (synthSegment) {
    return {
      kind: "synthesize",
      text: visible.slice(0, synthSegment.start).trim() || visible,
      dossierFields: normalizeDossierFields(synthSegment.value),
      rawOutput: visible,
      hasDossierTag: false,
      hasSynthesizeTag: true,
      dossierJsonValid: synthSegment.value !== null,
    };
  }

  const dossierSegment = extractTaggedJson(visible, "DOSSIER");
  const fields = dossierSegment ? normalizeDossierFields(dossierSegment.value) : [];
  const reply = dossierSegment
    ? stripTaggedJson(visible, dossierSegment)
    : visible;
  return {
    kind: "question",
    text: reply.trim() || "Tell me more.",
    dossierFields: fields,
    rawOutput: visible,
    hasDossierTag: dossierSegment !== null,
    hasSynthesizeTag: false,
    dossierJsonValid: dossierSegment ? dossierSegment.value !== null : true,
  };
}

// ---------------------------------------------------------------------------
// Bifrost caller — header-only auth (NEVER bearer; Bifrost 401s on it).
// ---------------------------------------------------------------------------

async function callBifrost(
  system: string,
  user: string,
  model: string,
  temperature: number,
  maxTokens: number,
  signal: AbortSignal,
): Promise<string> {
  if (!BIFROST_BASE_URL) {
    throw new Error("BIFROST_BASE_URL is required");
  }
  const res = await fetch(
    `${BIFROST_BASE_URL.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bifrost-api-key": BIFROST_API_KEY ?? "",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal,
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bifrost ${res.status}: ${body.slice(0, 400)}`);
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

// ---------------------------------------------------------------------------
// LLM-as-judge — same pattern as evals/judge.ts.
// ---------------------------------------------------------------------------

interface Verdict {
  label: string;
  score: number | null;
  explanation: string;
}

async function judge(
  prompt: string,
  valid: Record<string, number>,
  signal: AbortSignal,
): Promise<Verdict> {
  if (!BIFROST_BASE_URL) throw new Error("BIFROST_BASE_URL is required");
  const labels = Object.keys(valid);
  const system =
    `You are a strict evaluator. Read the rubric, then respond with a JSON object ` +
    `exactly: {"label": "<one of: ${labels.join(", ")}>", "explanation": "<one sentence>"}. ` +
    `No other text.`;
  const res = await fetch(
    `${BIFROST_BASE_URL.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bifrost-api-key": BIFROST_API_KEY ?? "",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature: 0,
      }),
      signal,
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bifrost ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content ?? "";
  let label = "";
  let explanation = "";
  let txt = raw.trim();
  if (txt.startsWith("```")) {
    txt = txt
      .replace(/^```[a-z]*\n?/, "")
      .replace(/```$/, "")
      .trim();
  }
  try {
    const obj = JSON.parse(txt) as { label?: string; explanation?: string };
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
  return { label, score: label in valid ? valid[label] : null, explanation };
}

// ---------------------------------------------------------------------------
// Rubric templates — one per evaluation dimension.
// ---------------------------------------------------------------------------

/**
 * PROTOCOL ADHERENCE: Did the model use the DOSSIER:/SYNTHESIZE: tagged-JSON
 * protocol correctly? This is the "tool usage" dimension — the interview's
 * "tools" are these text tags.
 */
const PROTOCOL_ADHERENCE_TEMPLATE = (
  transcript: string,
  output: string,
  expectedBehavior: string,
): string =>
  `You judge whether an AI editorial interviewer correctly used its text-protocol tags.\n\n` +
  `The interviewer was instructed to:\n` +
  `- After every ordinary question, append \`DOSSIER:\` followed by JSON { "brief": { workingTitle, format, audience, goal, tone, constraints, successSignal }, "confidence": { field: "high" | "medium" | "low" } }\n` +
  `- When the dossier is complete, respond ONLY with \`SYNTHESIZE:\` followed by the same JSON shape\n\n` +
  `Expected behavior for THIS turn: ${expectedBehavior}\n\n` +
  `Conversation so far:\n${transcript}\n\n` +
  `Interviewer output:\n${output}\n\n` +
  `Answer "compliant" if the output uses the correct tag(s) for the expected behavior — DOSSIER: with valid JSON for a question turn, or SYNTHESIZE: with valid JSON for a synthesis turn. ` +
  `Answer "noncompliant" if the tag is missing, wrong, contains invalid JSON, or uses the wrong tag for the situation (e.g. SYNTHESIZE when a question was expected, or no tag at all).`;

/**
 * QUESTION QUALITY: Is the question short, one-at-a-time, and incisive?
 * Only applies to question turns.
 */
const QUESTION_QUALITY_TEMPLATE = (
  transcript: string,
  question: string,
): string =>
  `You judge whether an AI editorial interviewer's question is well-crafted.\n\n` +
  `The interviewer was instructed: "Ask one question at a time. Keep it short."\n\n` +
  `Conversation so far:\n${transcript}\n\n` +
  `Question asked:\n${question}\n\n` +
  `Answer "incisive" if the question is short (under 60 words), asks exactly ONE question, and advances the interview toward the missing dossier fields (working title, reader, goal, tone, constraints, success signal). ` +
  `Answer "bloated" if the question is too long, asks multiple questions at once, is generic/small-talk, or doesn't advance the interview.`;

/**
 * FOCUS DISCIPLINE: Did the model stay on-task vs. get distracted by tangents?
 * Tests whether the interviewer follows the writer down rabbit holes or refocuses.
 */
const FOCUS_DISCIPLINE_TEMPLATE = (
  transcript: string,
  output: string,
  distractionPresent: boolean,
): string =>
  `You judge whether an AI editorial interviewer maintains focus or gets distracted by writer tangents.\n\n` +
  `Conversation so far:\n${transcript}\n\n` +
  `Interviewer output:\n${output}\n\n` +
  (distractionPresent
    ? `NOTE: The writer's messages contain tangents or scattered thinking. ` +
      `Answer "focused" if the interviewer refocuses the writer toward the core dossier fields (working title, reader, goal, tone, constraints, success signal) rather than following the tangent. ` +
      `Answer "distracted" if the interviewer follows the tangent, asks about the tangential material, or fails to redirect.`
    : `Answer "focused" if the interviewer stays on track — asking about dossier-relevant fields. ` +
      `Answer "distracted" if the interviewer introduces unrelated topics or goes off on its own tangent.`);

/**
 * CONCLUSION TIMING: Did the model synthesize at the right time?
 * Cross-references the expected behavior (synthesize vs. question) with what
 * the model actually did.
 */
const CONCLUSION_TIMING_TEMPLATE = (
  transcript: string,
  output: string,
  expectedBehavior: string,
  actualBehavior: string,
): string =>
  `You judge whether an AI editorial interviewer concluded the interview at the right time.\n\n` +
  `The interviewer should synthesize (SYNTHESIZE:) ONLY when all seven dossier fields (working title, format, audience, goal, tone, constraints, success signal) have been reasonably covered. ` +
  `It must NOT synthesize too early (insufficient info) or too late (all fields covered but still asking questions).\n\n` +
  `Conversation so far:\n${transcript}\n\n` +
  `Expected behavior: ${expectedBehavior}\n` +
  `Actual behavior: ${actualBehavior}\n\n` +
  `Interviewer output:\n${output}\n\n` +
  `Answer "well-timed" if the model's decision to synthesize or continue matches the expected behavior. ` +
  `Answer "poorly-timed" if the model synthesized when it should have continued asking questions, or kept asking questions when it should have synthesized.`;

/**
 * DOSSIER GROUNDING: Is the tagged DOSSIER JSON grounded in the actual
 * conversation? Checks whether the fields the model claims are actually
 * derivable from the transcript.
 */
const DOSSIER_GROUNDING_TEMPLATE = (
  transcript: string,
  output: string,
  claimedFields: string[],
): string =>
  `You judge whether the AI interviewer's DOSSIER fields are grounded in the conversation.\n\n` +
  `Conversation so far:\n${transcript}\n\n` +
  `Interviewer output:\n${output}\n\n` +
  `Fields claimed in the DOSSIER tag: ${claimedFields.length > 0 ? claimedFields.join(", ") : "(none)"}\n\n` +
  `Answer "grounded" if every claimed field can be reasonably inferred from the writer's messages in the conversation. ` +
  `Answer "invented" if any claimed field is fabricated, hallucinated, or not supported by what the writer actually said.`;

// ---------------------------------------------------------------------------
// Scoring.
// ---------------------------------------------------------------------------

const CHOICES = {
  protocol: { compliant: 1, noncompliant: 0 },
  question: { incisive: 1, bloated: 0 },
  focus: { focused: 1, distracted: 0 },
  timing: { "well-timed": 1, "poorly-timed": 0 },
  grounding: { grounded: 1, invented: 0 },
} as const;

interface CaseScore {
  case_id: string;
  tags: string[];
  expectedBehavior: string;
  actualBehavior: string;
  protocol: Verdict;
  question: Verdict | null;
  focus: Verdict;
  timing: Verdict;
  grounding: Verdict;
  dossierFieldsClaimed: string[];
  expectedDossierFields: string[];
  outputExcerpt: string;
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

function buildTranscript(messages: InterviewMessage[]): string {
  return messages
    .map((m) => `${m.author === "writer" ? "Writer" : "You"}: ${m.text}`)
    .join("\n");
}

async function main(): Promise<void> {
  const dataset = readDataset();
  console.log(
    `[twyne:interview] ${dataset.length} cases → model ${BIFROST_DEFAULT_MODEL}, judge ${JUDGE_MODEL}`,
  );

  const scores: CaseScore[] = [];
  let failures = 0;

  for (const row of dataset) {
    const system = interviewSystemPrompt(row.mode, row.currentBrief);
    const transcript = buildTranscript(row.messages);
    try {
      const raw = await callBifrost(
        system,
        transcript,
        BIFROST_DEFAULT_MODEL,
        0.6,
        420,
        AbortSignal.timeout(60_000),
      );
      const parsed = parseInterviewOutput(raw);
      const actualBehavior = parsed.kind === "synthesize" ? "synthesize" : "question";

      // Protocol adherence
      const protocol = await judge(
        PROTOCOL_ADHERENCE_TEMPLATE(transcript, parsed.rawOutput, row.expectedBehavior),
        CHOICES.protocol,
        AbortSignal.timeout(90_000),
      );

      // Question quality (only for question turns)
      let questionVerdict: Verdict | null = null;
      if (parsed.kind === "question") {
        questionVerdict = await judge(
          QUESTION_QUALITY_TEMPLATE(transcript, parsed.text),
          CHOICES.question,
          AbortSignal.timeout(90_000),
        );
      }

      // Focus discipline
      const focus = await judge(
        FOCUS_DISCIPLINE_TEMPLATE(transcript, parsed.rawOutput, row.distractionPresent),
        CHOICES.focus,
        AbortSignal.timeout(90_000),
      );

      // Conclusion timing
      const timing = await judge(
        CONCLUSION_TIMING_TEMPLATE(
          transcript,
          parsed.rawOutput,
          row.expectedBehavior,
          actualBehavior,
        ),
        CHOICES.timing,
        AbortSignal.timeout(90_000),
      );

      // Dossier grounding
      const grounding = await judge(
        DOSSIER_GROUNDING_TEMPLATE(transcript, parsed.rawOutput, parsed.dossierFields),
        CHOICES.grounding,
        AbortSignal.timeout(90_000),
      );

      scores.push({
        case_id: row.case_id,
        tags: row.tags,
        expectedBehavior: row.expectedBehavior,
        actualBehavior,
        protocol,
        question: questionVerdict,
        focus,
        timing,
        grounding,
        dossierFieldsClaimed: parsed.dossierFields,
        expectedDossierFields: row.expectedDossierFields,
        outputExcerpt: parsed.rawOutput.slice(0, 300),
      });

      const p = protocol.score === 1 ? "✓" : "✗";
      const q = questionVerdict
        ? questionVerdict.score === 1
          ? "✓"
          : "✗"
        : "—";
      const f = focus.score === 1 ? "✓" : "✗";
      const t = timing.score === 1 ? "✓" : "✗";
      const g = grounding.score === 1 ? "✓" : "✗";
      console.log(
        `  ${p}${q}${f}${t}${g} ${row.case_id.padEnd(28)} ` +
          `act=${actualBehavior.padEnd(10)} exp=${row.expectedBehavior.padEnd(20)} ` +
          `fields=[${parsed.dossierFields.join(",")}]`,
      );
    } catch (err) {
      failures += 1;
      const message = (err as Error).message;
      scores.push({
        case_id: row.case_id,
        tags: row.tags,
        expectedBehavior: row.expectedBehavior,
        actualBehavior: "[error]",
        protocol: { label: "?", score: null, explanation: `[error] ${message}` },
        question: null,
        focus: { label: "?", score: null, explanation: `[error] ${message}` },
        timing: { label: "?", score: null, explanation: `[error] ${message}` },
        grounding: { label: "?", score: null, explanation: `[error] ${message}` },
        dossierFieldsClaimed: [],
        expectedDossierFields: row.expectedDossierFields,
        outputExcerpt: `[error] ${message}`,
      });
      console.error(`  ✗✗✗✗✗ ${row.case_id}: ${message}`);
    }
  }

  writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 2));

  // Summary
  const protocolOk = scores.filter((s) => s.protocol.score === 1).length;
  const questionScores = scores.filter((s) => s.question !== null);
  const questionOk = questionScores.filter((s) => s.question!.score === 1).length;
  const focusOk = scores.filter((s) => s.focus.score === 1).length;
  const timingOk = scores.filter((s) => s.timing.score === 1).length;
  const groundingOk = scores.filter((s) => s.grounding.score === 1).length;
  const n = scores.length;

  console.log("");
  console.log(`[twyne:interview] summary (${n} cases):`);
  console.log(`  protocol-adherence   ${protocolOk}/${n}  (${Math.round((protocolOk / n) * 100)}%)`);
  console.log(`  question-quality     ${questionOk}/${questionScores.length}  (${questionScores.length > 0 ? Math.round((questionOk / questionScores.length) * 100) : 0}%)`);
  console.log(`  focus-discipline     ${focusOk}/${n}  (${Math.round((focusOk / n) * 100)}%)`);
  console.log(`  conclusion-timing    ${timingOk}/${n}  (${Math.round((timingOk / n) * 100)}%)`);
  console.log(`  dossier-grounding    ${groundingOk}/${n}  (${Math.round((groundingOk / n) * 100)}%)`);
  console.log(`[twyne:interview] wrote ${scores.length} scores to evals/interview-scores.json`);

  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[twyne:interview] fatal:", err);
  process.exit(1);
});
