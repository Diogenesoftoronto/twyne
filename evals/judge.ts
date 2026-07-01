/**
 * LLM-as-judge scorer for Twyne's persona feedback experiments.
 *
 * Reads the generations produced by `evals/run-experiment.ts` (`evals/runs.json`)
 * and the matching `evals/dataset.jsonl`, then applies two rubrics through the
 * Bifrost gateway:
 *
 *   - faithfulness-to-draft : does the feedback engage THIS draft (grounded=1)
 *                             or is it generic boilerplate (generic=0)?
 *   - feedback-helpfulness  : is the feedback useful + on-persona (good=1) or
 *                             vague/off-topic (poor=0)?
 *
 * These mirror, verbatim, the two Arize template evaluators created under the
 * "kmannoel Space" (faithfulness-to-draft / feedback-helpfulness). The Arize
 * native judge task is blocked by the AI-integration's bearer injection (it
 * sends `Authorization: Bearer` to Bifrost → 401); this script runs the same
 * rubrics with header-only auth so the eval loop is reproducible in-repo and in
 * CI without that integration. Writes `evals/scores.json`.
 *
 * Usage:
 *   BIFROST_BASE_URL=https://... BIFROST_API_KEY=sk_bf_xxx \
 *     JUDGE_MODEL=neuralwatt/kimi-k2.6 bun run eval:judge
 *
 * Read-only w.r.t. the repo otherwise: only writes `evals/scores.json`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(HERE, "dataset.jsonl");
const RUNS_PATH = resolve(HERE, "runs.json");
const SCORES_PATH = resolve(HERE, "scores.json");

const BIFROST_BASE_URL = process.env.BIFROST_BASE_URL;
const BIFROST_API_KEY = process.env.BIFROST_API_KEY;
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "neuralwatt/kimi-k2.6";

interface DatasetRow {
  case_id: string;
  persona: string;
  instruction: string;
  draftText: string;
}
interface RunOutput {
  case_id: string;
  output: string;
}
interface Verdict {
  label: string;
  score: number | null;
  explanation: string;
}
interface CaseScore {
  case_id: string;
  persona: string;
  faithfulness: Verdict;
  helpfulness: Verdict;
}

const FAITHFULNESS_TEMPLATE = (draft: string, output: string): string =>
  `You judge whether an AI editor's feedback genuinely engages with the SPECIFIC ` +
  `draft it was given, versus generic writing advice that could apply to any text.\n\n` +
  `Draft:\n${draft}\n\nEditor feedback:\n${output}\n\n` +
  `Answer "grounded" if the feedback references specific content, claims, or wording ` +
  `from THIS draft. Answer "generic" if it is boilerplate advice that could apply to any text.`;

const HELPFULNESS_TEMPLATE = (
  persona: string,
  draft: string,
  output: string,
): string =>
  `You evaluate an AI editor persona's feedback for quality.\n\n` +
  `Persona role: ${persona}\nDraft:\n${draft}\n\nFeedback:\n${output}\n\n` +
  `Is the feedback helpful, specific, and consistent with the persona's role and the draft? ` +
  `Answer "good" if it is useful and on-task, "poor" if it is vague, off-topic, or unhelpful.`;

const CHOICES: Record<string, Record<string, number>> = {
  faithfulness: { grounded: 1, generic: 0 },
  helpfulness: { good: 1, poor: 0 },
};

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
      // Header-only auth: Bifrost passes its stored provider key through. A
      // bearer token would be misread as a virtual-key lookup → 401. This is
      // exactly why the Arize integration's auth_type must be proxy_with_headers.
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

function readDataset(): Map<string, DatasetRow> {
  const raw = readFileSync(DATASET_PATH, "utf8").trim();
  const map = new Map<string, DatasetRow>();
  for (const line of raw.split(/\n+/).filter(Boolean)) {
    const row = JSON.parse(line) as DatasetRow;
    map.set(row.case_id, row);
  }
  return map;
}

async function main(): Promise<void> {
  const dataset = readDataset();
  const runs = JSON.parse(readFileSync(RUNS_PATH, "utf8")) as RunOutput[];
  console.log(`[twyne:judge] ${runs.length} runs → judge ${JUDGE_MODEL}`);

  const scores: CaseScore[] = [];
  let failures = 0;
  for (const run of runs) {
    const row = dataset.get(run.case_id);
    if (!row) {
      console.error(`  ✗ ${run.case_id}: no dataset row`);
      failures += 1;
      continue;
    }
    if (run.output.startsWith("[error]")) {
      console.error(`  ✗ ${run.case_id}: generation errored, skipping judge`);
      failures += 1;
      continue;
    }
    try {
      const faithfulness = await judge(
        FAITHFULNESS_TEMPLATE(row.draftText, run.output),
        CHOICES.faithfulness,
        AbortSignal.timeout(90_000),
      );
      const helpfulness = await judge(
        HELPFULNESS_TEMPLATE(row.persona, row.draftText, run.output),
        CHOICES.helpfulness,
        AbortSignal.timeout(90_000),
      );
      scores.push({
        case_id: run.case_id,
        persona: row.persona,
        faithfulness,
        helpfulness,
      });
      console.log(
        `  ${run.case_id.padEnd(22)} faithful=${faithfulness.label.padEnd(9)}(${faithfulness.score})  helpful=${helpfulness.label.padEnd(5)}(${helpfulness.score})`,
      );
    } catch (err) {
      failures += 1;
      console.error(`  ✗ ${run.case_id}: ${(err as Error).message}`);
    }
  }

  writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 2));
  const fok = scores.filter((s) => s.faithfulness.score === 1).length;
  const hok = scores.filter((s) => s.helpfulness.score === 1).length;
  console.log(
    `[twyne:judge] wrote ${scores.length} scores to evals/scores.json` +
      ` (faithful grounded ${fok}/${scores.length}, helpful good ${hok}/${scores.length})`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[twyne:judge] fatal:", err);
  process.exit(1);
});
