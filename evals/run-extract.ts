/**
 * TARGET-EXTRACTION eval for Twyne's Apparatus.
 *
 * `run-apparatus.ts` scores the step *after* search: given a query and a
 * candidate source, is the source relevant? This scores the step *before* it —
 * the one the writer actually feels. Given a draft, does the extract pass flag
 * the passages that must be checked, and leave alone the ones that must not?
 *
 * Two things make this eval worth trusting:
 *
 *   1. **It runs the shipped prompt.** The system and user bodies come from
 *      `src/utils/research-targets.ts`, which renders the same `prompts/*.md`
 *      files the app ships, and the reply is parsed by the same
 *      `parseResearchTargets`. An edit to the markdown moves this score. A
 *      hand-copied template in the harness would not.
 *   2. **Scoring is deterministic — no judge.** Each case names the passages
 *      that must be flagged and the passages that must not, each identified by
 *      needles that have to appear in a target's anchor or query. There is no
 *      second model to be biased, so a regression is a regression.
 *
 * Reads `evals/extract.jsonl`; writes `evals/extract-scores.json`.
 *
 * Metrics:
 *   recall        — required passages that got a target  (misses = under-flagging)
 *   false_flag    — forbidden passages that got a target  (noise the writer sees)
 *   kind_accuracy — of matched targets, how many carried the expected kind
 *   mode          — dossierResearchMode() vs the expected mode (no API call)
 *
 * Env: PORTKEY_API_KEY (see evals/llm-client.ts). The mode check runs without it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chatCompletion, DEFAULT_MODEL } from "./llm-client";
import {
  DEFAULT_TARGETS_PER_PASS,
  buildDossierResearchInstructions,
  buildResearchExtractSystemPrompt,
  buildResearchExtractUserPrompt,
  dossierResearchMode,
  parseResearchTargets,
} from "../src/utils/research-targets";
import type {
  ProjectBrief,
  ProjectInterviewAnswers,
  ResearchTarget,
  ResearchTargetKind,
} from "../src/types";

const DATASET_PATH = resolve(import.meta.dirname, "extract.jsonl");
const SCORES_PATH = resolve(import.meta.dirname, "extract-scores.json");

interface Expectation {
  label: string;
  /** All of these must appear in a target's anchor+query for it to count. */
  needles: string[];
  kind?: ResearchTargetKind;
}

interface DatasetRow {
  case_id: string;
  mode: "fiction" | "nonfiction" | "general";
  answers: ProjectInterviewAnswers;
  draftText: string;
  existingSources: string[];
  mustFlag: Expectation[];
  mustNotFlag: Expectation[];
}

interface ExpectationResult {
  label: string;
  needles: string[];
  matched: boolean;
  matched_anchor: string | null;
  expected_kind: ResearchTargetKind | null;
  actual_kind: ResearchTargetKind | null;
  kind_ok: boolean | null;
}

interface RowScore {
  case_id: string;
  expected_mode: string;
  actual_mode: string;
  mode_ok: boolean;
  targets_returned: number;
  parse_ok: boolean;
  recall: number | null;
  hits: number;
  misses: number;
  false_flags: number;
  required: ExpectationResult[];
  forbidden: ExpectationResult[];
  targets: Array<{ kind: string; anchor: string; query: string }>;
  error?: string;
}

function briefFrom(answers: ProjectInterviewAnswers): ProjectBrief {
  return { answers, probes: [], attachments: [], completedAt: 1, updatedAt: 1 };
}

/** A target's searchable surface: what the model anchored on and what it asked. */
function haystack(target: ResearchTarget): string {
  return `${target.anchor} ${target.query}`.toLowerCase();
}

function findMatch(
  targets: ResearchTarget[],
  expectation: Expectation,
): ResearchTarget | null {
  const needles = expectation.needles.map((n) => n.toLowerCase());
  return (
    targets.find((t) => {
      const hay = haystack(t);
      return needles.every((n) => hay.includes(n));
    }) ?? null
  );
}

function evaluate(
  targets: ResearchTarget[],
  expectation: Expectation,
): ExpectationResult {
  const hit = findMatch(targets, expectation);
  const expectedKind = expectation.kind ?? null;
  const actualKind = hit?.kind ?? null;
  return {
    label: expectation.label,
    needles: expectation.needles,
    matched: hit !== null,
    matched_anchor: hit?.anchor ?? null,
    expected_kind: expectedKind,
    actual_kind: actualKind,
    kind_ok: hit && expectedKind ? actualKind === expectedKind : null,
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

function fmtPct(x: number | null): string {
  return x === null ? "  n/a" : `${(x * 100).toFixed(1).padStart(5)}%`;
}

async function main(): Promise<void> {
  const dataset = readDataset();
  const modeOnly = !process.env.PORTKEY_API_KEY;

  if (modeOnly) {
    // The Dossier→mode decision is pure and worth checking on its own; it is
    // what puts the extract pass into fiction or nonfiction discipline.
    console.log("[twyne:extract] no PORTKEY_API_KEY — mode checks only\n");
    let bad = 0;
    for (const row of dataset) {
      const actual = dossierResearchMode(briefFrom(row.answers));
      const ok = actual === row.mode;
      if (!ok) bad += 1;
      console.log(
        `  ${ok ? "✓" : "✗"} ${row.case_id.padEnd(28)} expected=${row.mode.padEnd(10)} actual=${actual}`,
      );
    }
    console.log(
      `\n[twyne:extract] mode: ${dataset.length - bad}/${dataset.length} correct`,
    );
    process.exit(bad === 0 ? 0 : 1);
  }

  console.log(`[twyne:extract] ${dataset.length} cases → ${DEFAULT_MODEL}`);

  const system = buildResearchExtractSystemPrompt();
  const rows: RowScore[] = [];

  for (const row of dataset) {
    const brief = briefFrom(row.answers);
    const actualMode = dossierResearchMode(brief);
    const user = buildResearchExtractUserPrompt({
      draftText: row.draftText,
      existingSources: row.existingSources,
      maxTargets: DEFAULT_TARGETS_PER_PASS,
      instructions: buildDossierResearchInstructions(brief),
    });

    let targets: ResearchTarget[] = [];
    let parseOk = false;
    let error: string | undefined;
    try {
      const raw = await chatCompletion({
        system,
        user,
        model: DEFAULT_MODEL,
        temperature: 0,
        signal: AbortSignal.timeout(120_000),
      });
      // The shipped parser, so fence/reasoning-tag noise is under test too.
      targets = parseResearchTargets(raw);
      parseOk = targets.length > 0;
    } catch (err) {
      error = (err as Error).message;
      console.error(`  ! ${row.case_id}: ${error}`);
    }

    const required = row.mustFlag.map((e) => evaluate(targets, e));
    const forbidden = row.mustNotFlag.map((e) => evaluate(targets, e));
    const hits = required.filter((r) => r.matched).length;
    const falseFlags = forbidden.filter((r) => r.matched).length;

    const score: RowScore = {
      case_id: row.case_id,
      expected_mode: row.mode,
      actual_mode: actualMode,
      mode_ok: actualMode === row.mode,
      targets_returned: targets.length,
      parse_ok: parseOk,
      recall: required.length > 0 ? hits / required.length : null,
      hits,
      misses: required.length - hits,
      false_flags: falseFlags,
      required,
      forbidden,
      targets: targets.map((t) => ({
        kind: t.kind,
        anchor: t.anchor,
        query: t.query,
      })),
      error,
    };
    rows.push(score);

    console.log(
      `  ${score.misses === 0 && falseFlags === 0 ? "✓" : "✗"} ${row.case_id.padEnd(28)} ` +
        `recall=${fmtPct(score.recall)}  false_flags=${falseFlags}  ` +
        `targets=${targets.length}  mode=${actualMode}`,
    );
    for (const miss of required.filter((r) => !r.matched)) {
      console.log(`      missed: ${miss.label}`);
    }
    for (const noise of forbidden.filter((r) => r.matched)) {
      console.log(
        `      false flag: ${noise.label} → "${noise.matched_anchor}"`,
      );
    }
  }

  const totalRequired = rows.reduce((n, r) => n + r.required.length, 0);
  const totalHits = rows.reduce((n, r) => n + r.hits, 0);
  const totalForbidden = rows.reduce((n, r) => n + r.forbidden.length, 0);
  const totalFalseFlags = rows.reduce((n, r) => n + r.false_flags, 0);
  const kindChecked = rows.flatMap((r) =>
    r.required.filter((e) => e.kind_ok !== null),
  );
  const kindOk = kindChecked.filter((e) => e.kind_ok).length;

  const summary = {
    n_cases: rows.length,
    recall: totalRequired > 0 ? totalHits / totalRequired : null,
    required_total: totalRequired,
    required_hit: totalHits,
    false_flag_rate:
      totalForbidden > 0 ? totalFalseFlags / totalForbidden : null,
    forbidden_total: totalForbidden,
    false_flags: totalFalseFlags,
    kind_accuracy: kindChecked.length > 0 ? kindOk / kindChecked.length : null,
    mode_correct: rows.filter((r) => r.mode_ok).length,
    parse_failures: rows.filter((r) => !r.parse_ok).length,
    model: DEFAULT_MODEL,
  };

  writeFileSync(SCORES_PATH, JSON.stringify({ summary, rows }, null, 2));

  console.log("");
  console.log(
    `[twyne:extract] overall: recall=${fmtPct(summary.recall)} ` +
      `(${totalHits}/${totalRequired})  ` +
      `false_flags=${totalFalseFlags}/${totalForbidden}  ` +
      `kind_acc=${fmtPct(summary.kind_accuracy)}  ` +
      `mode=${summary.mode_correct}/${rows.length}  ` +
      `parse_fail=${summary.parse_failures}`,
  );
  console.log(`[twyne:extract] wrote ${SCORES_PATH}`);

  // Under-flagging is the failure this eval exists to catch.
  process.exit(totalHits === totalRequired && totalFalseFlags === 0 ? 0 : 1);
}

void main();
