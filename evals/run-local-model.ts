/**
 * Tool-calling + analysis eval for a small local model (e.g. LFM2.5-2.6B),
 * the candidate engine for signed-out / free mode.
 *
 * Every other script in `evals/` talks to the hosted Portkey gateway with a
 * bare system+user body and never passes `tools`. None of them can answer the
 * only question that matters for a 2.6B on-device model: *can it drive the
 * `quote_passage` tool?* That tool is what pins an editor's note to a real
 * passage; a model that cannot call it produces unanchored notes, which is a
 * different (worse) product, not a slightly weaker one.
 *
 * So this script runs the REAL production path rather than an approximation:
 * the prompts from `convex/agentPrompts`, the tool from `convex/agentTools`,
 * `generateText` with `stopWhen: stepCountIs(3)` exactly as
 * `src/utils/ai-client.ts` does. What it changes is only the endpoint.
 *
 * Two runs per case, so tool competence and analysis competence are separable:
 *   - `tools`   — the real path, with `quote_passage` offered.
 *   - `notools` — same prompts, no tool. The control. If analysis is fine here
 *                 and collapses in `tools`, the tool is the problem, not the
 *                 model's reading of the draft.
 *
 * Output is written to two places:
 *   - `evals/local-model-scores.json` — per-case tool metrics + the aggregate.
 *   - `evals/local-model-runs.json`   — `{case_id, output}[]`, the exact shape
 *     `evals/judge.ts` reads. Copy it over `evals/runs.json` and run
 *     `bun run eval:judge` to score analysis quality against the same
 *     faithfulness/helpfulness rubrics used for the hosted models, so the
 *     small model is compared on the incumbent's terms.
 *
 * Serving the model — anything OpenAI-compatible works. llama.cpp needs
 * `--jinja` or it will not emit tool calls at all:
 *   llama-server -hf LiquidAI/LFM2.5-2.6B-GGUF --jinja -c 8192
 *
 * Usage:
 *   LOCAL_MODEL_BASE_URL=http://localhost:8080/v1 bun run eval:local
 *
 * Env:
 *   LOCAL_MODEL_BASE_URL  default http://localhost:8080/v1
 *   LOCAL_MODEL_ID        default LFM2.5-2.6B
 *   LOCAL_MODEL_API_KEY   default "local" (llama.cpp ignores it)
 *   LOCAL_MODEL_TIMEOUT   ms, default 180000 — CPU decode is slow, be patient
 *
 * Read-only w.r.t. the repo otherwise: only writes the two files above.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, type ToolSet } from "ai";

import {
  buildSystemPrompt,
  buildUserPrompt,
  toAgentPersona,
  type AgentPersona,
  type AgentRequest,
} from "../convex/agentPrompts";
import { buildQuoteTools } from "../convex/agentTools";
import { PERSONAS } from "../src/utils/personas";
import {
  hasReasoningTags,
  stripReasoningTags,
} from "../src/utils/reasoning-tags";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(HERE, "dataset.jsonl");
const SCORES_PATH = resolve(HERE, "local-model-scores.json");
const RUNS_PATH = resolve(HERE, "local-model-runs.json");

const BASE_URL = (
  process.env.LOCAL_MODEL_BASE_URL ?? "http://localhost:8080/v1"
).replace(/\/$/, "");
const MODEL_ID = process.env.LOCAL_MODEL_ID ?? "LFM2.5-2.6B";
const API_KEY = process.env.LOCAL_MODEL_API_KEY ?? "local";
const TIMEOUT_MS = Number(process.env.LOCAL_MODEL_TIMEOUT ?? 180_000);

/** Matches `generateTrackedText` in src/utils/ai-client.ts. */
const TEMPERATURE = 0.4;
const MAX_OUTPUT_TOKENS = 1024;

interface DatasetRow {
  case_id: string;
  persona: string;
  instruction: string;
  draftText: string;
}

interface ToolCallRecord {
  /** Raw `query` the model passed. Non-string means it broke the schema. */
  query: unknown;
  /** Did `resolveDraftPassage` match it against the draft? */
  found: boolean;
}

interface CaseResult {
  case_id: string;
  persona: string;
  mode: "tools" | "notools";
  /** Empty when the call threw; `error` then carries why. */
  output: string;
  error?: string;
  /* ── tool metrics ──────────────────────────────────────────── */
  /** Did the model emit at least one well-formed `quote_passage` call? */
  toolCalled: boolean;
  toolCallCount: number;
  /** Every call passed a string `query`. False = schema violation. */
  toolArgsValid: boolean;
  /** At least one call resolved to a real passage. */
  toolResolved: boolean;
  /** The anchor the note would carry, per `getAnchor()`. */
  anchor?: string;
  /** The anchor appears verbatim in the draft. Should follow from resolution;
   *  a false here means the resolver, not the model, is at fault. */
  anchorVerbatim: boolean;
  /** Model wrote visible prose after the tool result, not just the call. */
  answeredAfterTool: boolean;
  /* ── production-compatibility metrics ──────────────────────── */
  /**
   * `hasReasoningTags` on the raw text. LFM2.5's chat template always opens a
   * `<think>` block, and `generateTrackedText` DISCARDS AND RE-RUNS any reply
   * where this is true — so on this model every call would silently cost two.
   * Counted rather than assumed, because it decides whether free mode needs a
   * per-provider "reasoning is expected here" flag before it can ship.
   */
  wouldRegenerate: boolean;
  /** `<think>` survived into the text a reader would see. Always a bug. */
  reasoningLeak: boolean;
  /* ── plumbing ──────────────────────────────────────────────── */
  steps: number;
  finishReason: string;
  latencyMs: number;
  outputChars: number;
}

interface Aggregate {
  model: string;
  baseUrl: string;
  ranAt: string;
  cases: number;
  tools: {
    /** The headline number: fraction of cases that produced a usable anchor. */
    anchoredRate: number;
    toolCalledRate: number;
    toolArgsValidRate: number;
    toolResolvedRate: number;
    answeredAfterToolRate: number;
    errorRate: number;
    meanLatencyMs: number;
  };
  notools: {
    answeredRate: number;
    errorRate: number;
    meanLatencyMs: number;
  };
  /** Fraction of all calls that production would have thrown away and re-run. */
  wouldRegenerateRate: number;
  reasoningLeakRate: number;
}

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

/**
 * Wrap the real `quote_passage` so every call is recorded, leaving its schema
 * and description untouched — those are half of what is under test here, and a
 * reimplementation would be testing the wrong prompt.
 */
function instrumentQuoteTool(draftText: string): {
  tools: ToolSet;
  getAnchor: () => string | undefined;
  calls: ToolCallRecord[];
} {
  const { tools, getAnchor } = buildQuoteTools(draftText);
  const base = tools.quote_passage;
  const calls: ToolCallRecord[] = [];
  const execute = base.execute;
  if (!execute) throw new Error("quote_passage lost its execute closure");

  const instrumented: ToolSet = {
    quote_passage: {
      ...base,
      execute: async (input: unknown, options: unknown) => {
        const out = (await (
          execute as (i: unknown, o: unknown) => Promise<unknown>
        )(input, options)) as { found?: boolean };
        calls.push({
          query: (input as { query?: unknown })?.query,
          found: Boolean(out.found),
        });
        return out;
      },
    } as ToolSet[string],
  };
  return { tools: instrumented, getAnchor, calls };
}

async function runCase(
  row: DatasetRow,
  mode: "tools" | "notools",
): Promise<CaseResult> {
  const persona = personaOrThrow(row.persona);
  const req: AgentRequest = {
    persona,
    brief: null,
    draftText: row.draftText,
    instruction: row.instruction as AgentRequest["instruction"],
  };
  const system = buildSystemPrompt(persona);
  const prompt = buildUserPrompt(req);

  const openai = createOpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
  const model = openai.chat(MODEL_ID);

  const withTools = mode === "tools";
  const probe = withTools ? instrumentQuoteTool(row.draftText) : null;

  const base: CaseResult = {
    case_id: row.case_id,
    persona: row.persona,
    mode,
    output: "",
    toolCalled: false,
    toolCallCount: 0,
    toolArgsValid: false,
    toolResolved: false,
    anchorVerbatim: false,
    answeredAfterTool: false,
    wouldRegenerate: false,
    reasoningLeak: false,
    steps: 0,
    finishReason: "unknown",
    latencyMs: 0,
    outputChars: 0,
  };

  const started = Date.now();
  try {
    const result = await generateText({
      model,
      system,
      prompt,
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      ...(probe ? { tools: probe.tools, stopWhen: stepCountIs(3) } : {}),
    });

    const raw = result.text;
    const visible = stripReasoningTags(raw).trim();
    const calls = probe?.calls ?? [];
    const anchor = probe?.getAnchor();

    return {
      ...base,
      output: visible,
      toolCalled: calls.length > 0,
      toolCallCount: calls.length,
      toolArgsValid:
        calls.length > 0 &&
        calls.every(
          (c) => typeof c.query === "string" && c.query.trim() !== "",
        ),
      toolResolved: calls.some((c) => c.found),
      anchor,
      anchorVerbatim: Boolean(anchor && row.draftText.includes(anchor)),
      answeredAfterTool: calls.length > 0 && visible.length > 0,
      wouldRegenerate: hasReasoningTags(raw),
      // `stripReasoningTags` removed the block; a leak means the model wrote a
      // tag shape the stripper does not recognise.
      reasoningLeak: hasReasoningTags(visible),
      steps: result.steps.length,
      finishReason: String(result.finishReason),
      latencyMs: Date.now() - started,
      outputChars: visible.length,
    };
  } catch (err) {
    return {
      ...base,
      error: (err as Error).message,
      latencyMs: Date.now() - started,
    };
  }
}

function rate(rows: CaseResult[], pick: (r: CaseResult) => boolean): number {
  if (rows.length === 0) return 0;
  return Number((rows.filter(pick).length / rows.length).toFixed(3));
}

function meanLatency(rows: CaseResult[]): number {
  if (rows.length === 0) return 0;
  return Math.round(
    rows.reduce((sum, r) => sum + r.latencyMs, 0) / rows.length,
  );
}

async function main(): Promise<void> {
  const dataset = readDataset();
  console.log(
    `[twyne:eval:local] ${dataset.length} cases × 2 modes → ${MODEL_ID} @ ${BASE_URL}`,
  );

  const results: CaseResult[] = [];
  for (const row of dataset) {
    for (const mode of ["tools", "notools"] as const) {
      const r = await runCase(row, mode);
      results.push(r);
      if (r.error) {
        console.error(`  ✗ ${row.case_id} [${mode}]: ${r.error}`);
        continue;
      }
      const tail =
        mode === "tools"
          ? `tool=${r.toolCalled ? `${r.toolCallCount}×` : "none"} ` +
            `resolved=${r.toolResolved ? "yes" : "no"} ` +
            `steps=${r.steps}`
          : `chars=${r.outputChars}`;
      console.log(
        `  ✓ ${row.case_id.padEnd(22)} [${mode.padEnd(7)}] ` +
          `${tail} think=${r.wouldRegenerate ? "yes" : "no"} ` +
          `${r.latencyMs}ms`,
      );
    }
  }

  const toolRows = results.filter((r) => r.mode === "tools");
  const noToolRows = results.filter((r) => r.mode === "notools");

  const aggregate: Aggregate = {
    model: MODEL_ID,
    baseUrl: BASE_URL,
    ranAt: new Date().toISOString(),
    cases: dataset.length,
    tools: {
      anchoredRate: rate(toolRows, (r) => r.anchorVerbatim),
      toolCalledRate: rate(toolRows, (r) => r.toolCalled),
      toolArgsValidRate: rate(toolRows, (r) => r.toolArgsValid),
      toolResolvedRate: rate(toolRows, (r) => r.toolResolved),
      answeredAfterToolRate: rate(toolRows, (r) => r.answeredAfterTool),
      errorRate: rate(toolRows, (r) => Boolean(r.error)),
      meanLatencyMs: meanLatency(toolRows),
    },
    notools: {
      answeredRate: rate(noToolRows, (r) => r.outputChars > 0),
      errorRate: rate(noToolRows, (r) => Boolean(r.error)),
      meanLatencyMs: meanLatency(noToolRows),
    },
    wouldRegenerateRate: rate(results, (r) => r.wouldRegenerate),
    reasoningLeakRate: rate(results, (r) => r.reasoningLeak),
  };

  writeFileSync(SCORES_PATH, JSON.stringify({ aggregate, results }, null, 2));
  // judge.ts reads `{case_id, output}[]`. Emit the tool-mode runs, since that
  // is the path free mode would actually ship.
  writeFileSync(
    RUNS_PATH,
    JSON.stringify(
      toolRows.map((r) => ({
        case_id: r.case_id,
        output: r.error ? `[error] ${r.error}` : r.output,
      })),
      null,
      2,
    ),
  );

  console.log("\n[twyne:eval:local] tool calling");
  console.log(`  anchored (headline)  ${aggregate.tools.anchoredRate}`);
  console.log(`  tool called          ${aggregate.tools.toolCalledRate}`);
  console.log(`  args well-formed     ${aggregate.tools.toolArgsValidRate}`);
  console.log(`  query resolved       ${aggregate.tools.toolResolvedRate}`);
  console.log(
    `  answered after tool  ${aggregate.tools.answeredAfterToolRate}`,
  );
  console.log("[twyne:eval:local] production compatibility");
  console.log(`  would regenerate     ${aggregate.wouldRegenerateRate}`);
  console.log(`  reasoning leak       ${aggregate.reasoningLeakRate}`);
  console.log(
    `[twyne:eval:local] latency  tools=${aggregate.tools.meanLatencyMs}ms  ` +
      `notools=${aggregate.notools.meanLatencyMs}ms`,
  );

  if (aggregate.tools.toolCalledRate === 0 && aggregate.tools.errorRate === 0) {
    console.warn(
      "\n[twyne:eval:local] NOTE: zero tool calls but no errors. Before " +
        "concluding the model cannot call tools, check the server is applying " +
        "the LFM2.5 chat template (llama.cpp needs --jinja) — without it the " +
        "model's <|tool_call_start|> output is never parsed into tool_calls.",
    );
  }
  console.log(
    `\n[twyne:eval:local] wrote evals/local-model-scores.json and ` +
      `evals/local-model-runs.json\n` +
      `  For analysis quality: cp evals/local-model-runs.json evals/runs.json ` +
      `&& bun run eval:judge`,
  );
}

main().catch((err) => {
  console.error("[twyne:eval:local] fatal:", err);
  process.exit(1);
});
