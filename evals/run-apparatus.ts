/**
 * Offline source-RELEVANCE eval for Twyne's Apparatus (`convex/research.ts`).
 *
 * Reads `evals/apparatus.jsonl`: each row carries a research query, a brief
 * "audience · goal" context, and a set of candidate sources — each pre-labelled
 * `relevant: true|false` as ground truth. For every candidate, we ask the LLM
 * judge (temperature 0, header-only Bifrost auth) whether THAT source is
 * relevant to the writer's research need. We compare the predicted label to
 * the ground-truth label and report per-row + overall accuracy plus
 * precision/recall on the "relevant" class.
 *
 * This tests the apparatus's core promise (surfacing on-target sources)
 * deterministically and offline, without needing TinyFish, Convex, or a
 * browser. The query/context are baked into the dataset; we never call
 * searchSources — that's by design (the search itself is a provider call;
 * the evaluable quality is the relevance judgement downstream of it).
 *
 * Usage:
 *   BIFROST_BASE_URL=https://... BIFROST_API_KEY=sk_bf_xxx \
 *     JUDGE_MODEL=neuralwatt/kimi-k2.6 bun run eval:apparatus
 *
 * Writes evals/apparatus-scores.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Source } from "../convex/research";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(HERE, "apparatus.jsonl");
const SCORES_PATH = resolve(HERE, "apparatus-scores.json");

const BIFROST_BASE_URL = process.env.BIFROST_BASE_URL;
const BIFROST_API_KEY = process.env.BIFROST_API_KEY;
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "neuralwatt/kimi-k2.6";

interface CandidateSource extends Source {
  /** Ground-truth label. */
  relevant: boolean;
}

interface DatasetRow {
  case_id: string;
  query: string;
  context: string;
  candidateSources: CandidateSource[];
}

interface LlmVerdict {
  label: string;
  score: number | null;
  explanation: string;
}

interface SourceScore {
  case_id: string;
  query: string;
  url: string;
  title: string;
  ground_truth: "relevant" | "irrelevant";
  predicted: "relevant" | "irrelevant" | "?";
  correct: boolean;
  explanation: string;
}

interface RowSummary {
  case_id: string;
  accuracy: number;
  precision_relevant: number | null;
  recall_relevant: number | null;
  n: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

interface OverallSummary {
  accuracy: number;
  precision_relevant: number | null;
  recall_relevant: number | null;
  n: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  parse_failures: number;
}

const RELEVANCE_TEMPLATE = (
  query: string,
  context: string,
  candidate: CandidateSource,
): string =>
  `You judge whether a single research source is relevant to a writer's research need.\n\n` +
  `Query: ${query}\n` +
  `Context (audience · goal): ${context}\n\n` +
  `Candidate source:\n` +
  `- title: ${candidate.title}\n` +
  `- url: ${candidate.url}\n` +
  `- publisher: ${candidate.publisher ?? "(unknown)"}\n` +
  `- date: ${candidate.date ?? "(unknown)"}\n` +
  `- snippet: ${candidate.snippet}\n\n` +
  `Answer "relevant" if this source would plausibly help a writer covering THIS query ` +
  `for THIS audience/goal — i.e. it speaks to the same subject, evidence, or argument. ` +
  `Answer "irrelevant" if it is off-topic (different subject, wrong audience, unrelated domain).`;

const CHOICES: Record<string, number> = {
  relevant: 1,
  irrelevant: 0,
};

/** Header-only Bifrost call. Mirrors evals/judge.ts: a bearer token would 401. */
async function callBifrost(
  system: string,
  user: string,
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
        model: JUDGE_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
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
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Bifrost response missing choices[0].message.content");
  }
  return content;
}

/** Defensive JSON parse — same shape as evals/judge.ts's judge(). */
function parseRelevanceVerdict(raw: string): LlmVerdict {
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
    label = ["relevant", "irrelevant"].find((l) => low.includes(l)) ?? "?";
    explanation = raw.trim().slice(0, 200);
  }
  if (!(label in CHOICES)) {
    label = ["relevant", "irrelevant"].find((l) => label.includes(l)) ?? "?";
  }
  return {
    label,
    score: label in CHOICES ? CHOICES[label] : null,
    explanation,
  };
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

function summarizeCounts(scores: SourceScore[]): {
  n: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  correct: number;
} {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let correct = 0;
  for (const s of scores) {
    if (s.correct) correct += 1;
    if (s.predicted === "relevant" && s.ground_truth === "relevant") tp += 1;
    if (s.predicted === "relevant" && s.ground_truth === "irrelevant") fp += 1;
    if (s.predicted !== "relevant" && s.ground_truth === "relevant") fn += 1;
    if (s.predicted !== "relevant" && s.ground_truth === "irrelevant") tn += 1;
  }
  return { n: scores.length, tp, fp, fn, tn, correct };
}

function rowSummary(case_id: string, scores: SourceScore[]): RowSummary {
  const c = summarizeCounts(scores);
  const precision = c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : null;
  const recall = c.tp + c.fn > 0 ? c.tp / (c.tp + c.fn) : null;
  return {
    case_id,
    accuracy: c.n > 0 ? c.correct / c.n : 0,
    precision_relevant: precision,
    recall_relevant: recall,
    n: c.n,
    tp: c.tp,
    fp: c.fp,
    fn: c.fn,
    tn: c.tn,
  };
}

function fmtPct(x: number | null): string {
  return x === null ? "  n/a" : `${(x * 100).toFixed(1).padStart(5)}%`;
}

async function main(): Promise<void> {
  const dataset = readDataset();
  console.log(
    `[twyne:apparatus] ${dataset.length} cases → judge ${JUDGE_MODEL}`,
  );

  const allScores: SourceScore[] = [];
  const rowSummaries: RowSummary[] = [];
  let failures = 0;

  for (const row of dataset) {
    const rowScores: SourceScore[] = [];
    for (const cand of row.candidateSources) {
      const prompt = RELEVANCE_TEMPLATE(row.query, row.context, cand);
      const system =
        `You are a strict evaluator. Read the rubric, then respond with a JSON object ` +
        `exactly: {"label": "<one of: relevant, irrelevant>", "explanation": "<one sentence>"}. ` +
        `No other text.`;
      try {
        const raw = await callBifrost(
          system,
          prompt,
          AbortSignal.timeout(90_000),
        );
        const verdict = parseRelevanceVerdict(raw);
        const predicted = verdict.label;
        const groundTruth: "relevant" | "irrelevant" = cand.relevant
          ? "relevant"
          : "irrelevant";
        const correct = predicted === groundTruth;
        const score: SourceScore = {
          case_id: row.case_id,
          query: row.query,
          url: cand.url,
          title: cand.title,
          ground_truth: groundTruth,
          predicted:
            predicted === "relevant" || predicted === "irrelevant"
              ? predicted
              : "?",
          correct,
          explanation: verdict.explanation,
        };
        rowScores.push(score);
        allScores.push(score);
        const tick = correct ? "✓" : "✗";
        console.log(
          `  ${tick} ${row.case_id.padEnd(24)} ` +
            `gt=${groundTruth.padEnd(11)} pred=${predicted.padEnd(11)} ` +
            `${cand.url}`,
        );
      } catch (err) {
        failures += 1;
        console.error(
          `  ! ${row.case_id} ${cand.url}: ${(err as Error).message}`,
        );
        const score: SourceScore = {
          case_id: row.case_id,
          query: row.query,
          url: cand.url,
          title: cand.title,
          ground_truth: cand.relevant ? "relevant" : "irrelevant",
          predicted: "?",
          correct: false,
          explanation: `[error] ${(err as Error).message}`,
        };
        rowScores.push(score);
        allScores.push(score);
      }
    }
    rowSummaries.push(rowSummary(row.case_id, rowScores));
  }

  const overall = summarizeCounts(allScores);
  const parseFailures = allScores.filter((s) => s.predicted === "?").length;
  const overallSummary: OverallSummary = {
    accuracy: overall.n > 0 ? overall.correct / overall.n : 0,
    precision_relevant:
      overall.tp + overall.fp > 0
        ? overall.tp / (overall.tp + overall.fp)
        : null,
    recall_relevant:
      overall.tp + overall.fn > 0
        ? overall.tp / (overall.tp + overall.fn)
        : null,
    n: overall.n,
    tp: overall.tp,
    fp: overall.fp,
    fn: overall.fn,
    tn: overall.tn,
    parse_failures: parseFailures,
  };

  writeFileSync(
    SCORES_PATH,
    JSON.stringify(
      { summary: overallSummary, rows: rowSummaries, sources: allScores },
      null,
      2,
    ),
  );

  console.log("");
  console.log("[twyne:apparatus] per-row:");
  for (const r of rowSummaries) {
    console.log(
      `  ${r.case_id.padEnd(28)} ` +
        `acc=${fmtPct(r.accuracy)}  ` +
        `P=${fmtPct(r.precision_relevant)}  ` +
        `R=${fmtPct(r.recall_relevant)}  ` +
        `tp=${r.tp} fp=${r.fp} fn=${r.fn} tn=${r.tn}`,
    );
  }
  console.log("");
  console.log(
    `[twyne:apparatus] overall: n=${overallSummary.n}  ` +
      `acc=${fmtPct(overallSummary.accuracy)}  ` +
      `P=${fmtPct(overallSummary.precision_relevant)}  ` +
      `R=${fmtPct(overallSummary.recall_relevant)}  ` +
      `(tp=${overallSummary.tp} fp=${overallSummary.fp} ` +
      `fn=${overallSummary.fn} tn=${overallSummary.tn}, ` +
      `parse_failures=${parseFailures})`,
  );
  console.log(
    `[twyne:apparatus] wrote ${allScores.length} scores to evals/apparatus-scores.json`,
  );
  // Hard failures (network / unparseable JSON from the judge) — NOT low accuracy.
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[twyne:apparatus] fatal:", err);
  process.exit(1);
});
