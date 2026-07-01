/**
 * Offline eval harness for Twyne's persona feedback / rubric judges.
 *
 * Reads each line in `evals/dataset.jsonl`, builds the same system + user
 * prompts the production actions build via `convex/agentPrompts`, then
 * calls the Bifrost OpenAI-compatible `/chat/completions` endpoint that
 * `convex/agents.ts` already routes through. Writes the model outputs to
 * `evals/runs.json` in the shape `ax experiments create --file` accepts.
 *
 * Usage:
 *   BIFROST_BASE_URL=https://... BIFROST_API_KEY=sk_bf_xxx \
 *     BIFROST_DEFAULT_MODEL=neuralwatt/qwen3.5-397b-fast \
 *     bun run eval
 *
 * Read-only w.r.t. the repo otherwise: only writes `evals/runs.json`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSystemPrompt,
  buildUserPrompt,
  toAgentPersona,
  type AgentPersona,
  type AgentRequest,
} from "../convex/agentPrompts";
import { PERSONAS } from "../src/utils/personas";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(HERE, "dataset.jsonl");
const RUNS_PATH = resolve(HERE, "runs.json");

const BIFROST_BASE_URL = process.env.BIFROST_BASE_URL;
const BIFROST_API_KEY = process.env.BIFROST_API_KEY;
const BIFROST_DEFAULT_MODEL =
  process.env.BIFROST_DEFAULT_MODEL ?? "neuralwatt/qwen3.5-397b-fast";

interface DatasetRow {
  case_id: string;
  persona: string;
  instruction: string;
  draftText: string;
}

interface RunOutput {
  // Local stable key (the dataset's case_id). The Arize-assigned example_id is
  // resolved at upload time by joining on case_id (see evals/upload-experiment.ts).
  case_id: string;
  output: string;
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

async function callBifrost(
  system: string,
  user: string,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  if (!BIFROST_BASE_URL) {
    throw new Error("BIFROST_BASE_URL is required");
  }
  const res = await fetch(
    `${BIFROST_BASE_URL.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      // Bifrost authenticates via x-bifrost-api-key and uses its own stored
      // provider key. Do NOT send Authorization: Bearer — Bifrost treats a
      // bearer token as a "virtual key" lookup (→ 401 virtual_key_not_found).
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
        temperature: 0.4,
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

async function main(): Promise<void> {
  const dataset = readDataset();
  console.log(
    `[twyne:eval] ${dataset.length} examples → ${BIFROST_DEFAULT_MODEL}`,
  );
  const runs: RunOutput[] = [];
  let failures = 0;
  for (const row of dataset) {
    const persona = personaOrThrow(row.persona);
    const req: AgentRequest = {
      persona,
      brief: null,
      draftText: row.draftText,
      instruction: row.instruction as AgentRequest["instruction"],
    };
    const system = buildSystemPrompt(persona);
    const user = buildUserPrompt(req);
    try {
      const output = await callBifrost(
        system,
        user,
        BIFROST_DEFAULT_MODEL,
        AbortSignal.timeout(60_000),
      );
      runs.push({ case_id: row.case_id, output });
      console.log(`  ✓ ${row.case_id} (${output.length} chars)`);
    } catch (err) {
      failures += 1;
      const message = (err as Error).message;
      runs.push({
        case_id: row.case_id,
        output: `[error] ${message}`,
      });
      console.error(`  ✗ ${row.case_id}: ${message}`);
    }
  }
  writeFileSync(RUNS_PATH, JSON.stringify(runs, null, 2));
  console.log(
    `[twyne:eval] wrote ${runs.length} runs (${failures} failed) to evals/runs.json`,
  );
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[twyne:eval] fatal:", err);
  process.exit(1);
});
