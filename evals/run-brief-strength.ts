/**
 * Live eval for brief strength.
 *
 * Sends the REAL batched questions from `src/utils/brief-strength.ts` to Jev
 * for every fixture in `evals/brief-strength-fixtures.ts`, one request per
 * fixture exactly as the brief form sends them on a typing pause, and scores
 * the readings against an editor's labels:
 *
 *   - per-field level accuracy (in band, and within one level of the band)
 *   - facet precision / recall, with "unmet" as the positive class, since an
 *     unmet facet is what the writer is told to fix
 *   - gamed-answer rejection (a keyword-stuffed answer must not pass Partial)
 *   - constraint-kind accuracy, and the binding/non-binding split the note
 *     gate actually acts on
 *   - whole-brief: sufficiency calibration, tension pair, first question,
 *     and the load-bearing verdict
 *   - questions, requests, tokens, latency and cost per brief
 *
 * It also scores two baselines on the same fixtures: the quick read (no
 * network) and the single 0–4 Score this design replaced.
 *
 * Usage:
 *   TYPESAFE_API_KEY=… bun run eval:brief
 *   bun run eval:brief -- --only audience-gamed-keywords --verbose
 *   bun run eval:brief -- --no-baseline --limit 10
 *
 * The key is read from the environment only; it is never printed or written.
 * `TYPESAFE_BASE_URL` points the runner at another System One server.
 *
 * Writes evals/brief-strength-scores.json.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { judgementQuestions } from "../convex/lib/judgementContract";
import type { ProjectInterviewAnswers } from "../src/types";
import { FIELD_PROMPTS, SUFFICIENCY_LEVELS } from "../src/utils/brief-coach";
import {
  BRIEF_FIELD_ORDER,
  EDGE_MET,
  FACET_MET,
  FIELD_FACETS,
  isBinding,
  splitConstraints,
  type BriefField,
  type StrengthLevel,
} from "../src/utils/brief-facets";
import {
  STRENGTH_KEYS,
  buildBriefStrengthQuestions,
  buildBriefStrengthState,
  quickFieldStrength,
  readBriefStrengths,
  standingFromViews,
  strangersFirstQuestion,
  strengthFor,
  type BriefStrengthReading,
  type StrengthView,
} from "../src/utils/brief-strength";
import {
  USD_PER_INPUT_TOKEN,
  isBimodal,
  isNoul,
  isScore,
  modalLevel,
  score as scoreQuestion,
  type SystemOneAnswer,
  type SystemOneQuestion,
} from "../src/utils/system-one";
import {
  BRIEF_FIXTURES,
  FIELD_FIXTURES,
  HOLDOUT_BRIEF_FIXTURES,
  HOLDOUT_FIELD_FIXTURES,
  type BriefFixture,
  type FieldFixture,
} from "./brief-strength-fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCORES_PATH = resolve(HERE, "brief-strength-scores.json");
const MODEL = process.env.TWYNE_BRIEF_EVAL_MODEL?.trim() || "jev-latest";

const EMPTY: ProjectInterviewAnswers = {
  workingTitle: "",
  format: "",
  audience: "",
  goal: "",
  tone: "",
  constraints: "",
  successSignal: "",
};

/* ── Options ───────────────────────────────────────────────────── */

interface Options {
  only?: string;
  limit?: number;
  baseline: boolean;
  verbose: boolean;
}

function parseOptions(args: readonly string[]): Options {
  const options: Options = { baseline: true, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--no-baseline") options.baseline = false;
    else if (flag === "--verbose") options.verbose = true;
    else if (flag === "--only") options.only = args[++i];
    else if (flag === "--limit") options.limit = Number(args[++i]);
    else if (flag !== "--")
      throw new Error(
        `Unknown option ${flag}. Options: --only <id> --limit <n> --no-baseline --verbose`,
      );
  }
  return options;
}

/* ── Transport ─────────────────────────────────────────────────── */

interface Ask {
  answers: Record<string, SystemOneAnswer>;
  questions: number;
  inputTokens: number;
  latencyMs: number;
}

function endpoint(): string {
  const base = process.env.TYPESAFE_BASE_URL?.trim();
  return base
    ? `${base.replace(/\/$/, "")}/v1/systemone`
    : "https://api.typesafe.ai/v1/systemone";
}

async function ask(
  state: Record<string, string>,
  questions: Record<string, SystemOneQuestion>,
): Promise<Ask> {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key) throw new Error("TYPESAFE_API_KEY is not set");
  const body = JSON.stringify({
    model: MODEL,
    state,
    // The same normaliser the Convex action runs, so the wire shape is the
    // production one.
    questions: judgementQuestions(questions),
  });
  for (let attempt = 0; ; attempt++) {
    const started = performance.now();
    const res = await fetch(endpoint(), {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body,
    });
    const latencyMs = Math.round(performance.now() - started);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
      continue;
    }
    // Never echo the body: it can repeat the request.
    if (!res.ok) throw new Error(`judgement endpoint returned ${res.status}`);
    const parsed = (await res.json()) as {
      answers: Record<string, SystemOneAnswer>;
      usage?: { input_tokens?: number };
    };
    return {
      answers: parsed.answers,
      questions: Object.keys(questions).length,
      inputTokens: parsed.usage?.input_tokens ?? 0,
      latencyMs,
    };
  }
}

async function pool<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await run(items[i]);
      }
    }),
  );
  return out;
}

/* ── Scoring helpers ───────────────────────────────────────────── */

type Band = [StrengthLevel, StrengthLevel];

const inBand = (level: number, [lo, hi]: Band) => level >= lo && level <= hi;
const nearBand = (level: number, [lo, hi]: Band) =>
  level >= lo - 1 && level <= hi + 1;

interface Tally {
  n: number;
  exact: number;
  near: number;
}
const tally = (): Tally => ({ n: 0, exact: 0, near: 0 });
function count(t: Tally, level: number, band: Band) {
  t.n++;
  if (inBand(level, band)) t.exact++;
  if (nearBand(level, band)) t.near++;
}
const pct = (num: number, den: number) =>
  den ? `${((100 * num) / den).toFixed(0)}%` : "n/a";
const rate = (num: number, den: number) =>
  den ? Number((num / den).toFixed(3)) : null;

/** The single Score this design replaced, for a like-for-like baseline. */
function legacyQuestion(field: BriefField): SystemOneQuestion {
  return scoreQuestion(
    `Rate ${FIELD_PROMPTS[field]}, judging the \`${field}\` entry in the context of the rest of the brief.`,
    SUFFICIENCY_LEVELS,
  );
}
function legacyLevel(answer: SystemOneAnswer | undefined): number | null {
  if (!isScore(answer)) return null;
  const split = isBimodal(answer) && answer.confidence < 0.35;
  return Math.round(split ? modalLevel(answer) : answer.score);
}

function viewFor(
  field: BriefField,
  answers: ProjectInterviewAnswers,
  reading: BriefStrengthReading,
): StrengthView {
  return strengthFor(
    field,
    answers[field],
    reading.fields[field],
    reading.lines,
  );
}

/* ── Field fixtures ────────────────────────────────────────────── */

interface FieldResult {
  id: string;
  field: BriefField;
  kind: FieldFixture["kind"];
  band: Band;
  jev: number | null;
  quick: number;
  legacy: number | null;
  /** The meter's 0–100 number, judged and first-look. */
  score: number | null;
  quickScore: number | null;
  /** The field's own graded scale, rounded to a level. */
  scale: number | null;
  facets: Record<string, { p: number; label?: boolean }>;
  lines?: Array<{ text: string; kind: string | null; want: string[] }>;
  split: boolean;
  standIn: string | null;
  questions: number;
  inputTokens: number;
  latencyMs: number;
}

async function runField(
  fixture: FieldFixture,
  options: Options,
): Promise<FieldResult> {
  const answers = { ...EMPTY, [fixture.field]: fixture.text };
  const quickView = quickFieldStrength(fixture.field, fixture.text);
  const quick = quickView.level;
  const base: FieldResult = {
    id: fixture.id,
    field: fixture.field,
    kind: fixture.kind,
    band: fixture.band,
    jev: null,
    quick,
    legacy: null,
    score: null,
    quickScore: quickView.score ?? null,
    scale: null,
    facets: {},
    split: false,
    standIn: null,
    questions: 0,
    inputTokens: 0,
    latencyMs: 0,
  };
  // "None declared" never reaches Jev: there is nothing to judge.
  if (!fixture.text.trim() || fixture.none) return { ...base, jev: quick };

  const fields = [fixture.field];
  const questions = buildBriefStrengthQuestions(answers, fields);
  const state = buildBriefStrengthState(answers);
  const response = await ask(state, questions);
  const reading = readBriefStrengths(answers, fields, response.answers);
  const view = viewFor(fixture.field, answers, reading);

  const facets: FieldResult["facets"] = {};
  for (const def of FIELD_FACETS[fixture.field]) {
    const answer = response.answers[STRENGTH_KEYS.facet(fixture.field, def.id)];
    if (isNoul(answer))
      facets[def.id] = { p: answer.noul, label: fixture.facets?.[def.id] };
  }
  const lines =
    fixture.field === "constraints"
      ? splitConstraints(fixture.text).map((text, i) => ({
          text,
          kind: reading.lines[text]?.kind ?? null,
          want: fixture.lines?.[i] ?? [],
        }))
      : undefined;

  let legacy: number | null = null;
  if (options.baseline) {
    const old = await ask(state, { score: legacyQuestion(fixture.field) });
    legacy = legacyLevel(old.answers.score);
  }

  return {
    ...base,
    jev: view.source === "jev" ? view.level : null,
    legacy,
    score: view.source === "jev" ? (view.score ?? null) : null,
    scale: (() => {
      const scale = response.answers[STRENGTH_KEYS.scale(fixture.field)];
      return isScore(scale) ? Math.round(scale.score) : null;
    })(),
    facets,
    ...(lines ? { lines } : {}),
    split: !!view.split,
    standIn: view.standIn
      ? fixture.text.slice(view.standIn.start, view.standIn.end)
      : null,
    questions: response.questions,
    inputTokens: response.inputTokens,
    latencyMs: response.latencyMs,
  };
}

/* ── Brief fixtures ────────────────────────────────────────────── */

interface BriefResult {
  id: string;
  levels: Partial<Record<BriefField, number>>;
  quick: Partial<Record<BriefField, number>>;
  legacy: Partial<Record<BriefField, number | null>>;
  sufficiency: number | null;
  contradiction: number | null;
  tension: [BriefField, BriefField] | null;
  firstQuestion: BriefField | null;
  loadBearing: boolean;
  soft: string[];
  questions: number;
  requests: number;
  inputTokens: number;
  latencyMs: number;
}

async function runBrief(
  fixture: BriefFixture,
  options: Options,
): Promise<BriefResult> {
  const { answers } = fixture;
  const fields = BRIEF_FIELD_ORDER.filter((f) => answers[f].trim());
  const questions = buildBriefStrengthQuestions(answers, fields);
  const state = buildBriefStrengthState(answers);
  const response = await ask(state, questions);
  const reading = readBriefStrengths(answers, fields, response.answers);

  const views: Partial<Record<BriefField, StrengthView>> = {};
  const levels: BriefResult["levels"] = {};
  const quick: BriefResult["quick"] = {};
  for (const field of BRIEF_FIELD_ORDER) {
    views[field] = viewFor(field, answers, reading);
    if (!answers[field].trim()) continue;
    levels[field] = views[field]!.level;
    quick[field] = quickFieldStrength(field, answers[field]).level;
  }
  const standing = standingFromViews(views, reading);

  const legacy: BriefResult["legacy"] = {};
  if (options.baseline) {
    const old = await ask(
      state,
      Object.fromEntries(fields.map((f) => [`score_${f}`, legacyQuestion(f)])),
    );
    for (const f of fields) legacy[f] = legacyLevel(old.answers[`score_${f}`]);
  }

  return {
    id: fixture.id,
    levels,
    quick,
    legacy,
    sufficiency: reading.sufficiency,
    contradiction: reading.contradiction,
    tension: reading.tension ? [reading.tension.a, reading.tension.b] : null,
    firstQuestion:
      strangersFirstQuestion(answers, views, reading.firstQuestionOdds)?.field ??
      null,
    loadBearing: standing.loadBearing,
    soft: standing.soft,
    questions: response.questions,
    requests: 1,
    inputTokens: response.inputTokens,
    latencyMs: response.latencyMs,
  };
}

/* ── Report ────────────────────────────────────────────────────── */

function samePair(
  got: [BriefField, BriefField] | null,
  want: Array<[BriefField, BriefField]>,
): boolean {
  return (
    !!got &&
    want.some(([a, b]) => (got[0] === a && got[1] === b) || (got[0] === b && got[1] === a))
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

/** Score one fixture set and print its report. */
async function evaluate(
  name: string,
  allFields: FieldFixture[],
  allBriefs: BriefFixture[],
  options: Options,
): Promise<Record<string, unknown>> {
  let fieldFixtures = allFields;
  let briefFixtures = allBriefs;
  if (options.only) {
    fieldFixtures = fieldFixtures.filter((f) => f.id.includes(options.only!));
    briefFixtures = briefFixtures.filter((f) => f.id.includes(options.only!));
  }
  if (options.limit) {
    fieldFixtures = fieldFixtures.slice(0, options.limit);
    briefFixtures = briefFixtures.slice(0, options.limit);
  }

  console.log(
    `\n━━ ${name} · ${fieldFixtures.length} answers, ${briefFixtures.length} briefs ━━`,
  );
  const fieldResults = await pool(fieldFixtures, 4, (f) =>
    runField(f, options),
  );
  const briefResults = await pool(briefFixtures, 3, (f) =>
    runBrief(f, options),
  );

  /* Levels: field fixtures plus every labelled field inside a brief. */
  const level = { jev: tally(), quick: tally(), legacy: tally() };
  const byField: Record<string, { jev: Tally; quick: Tally; legacy: Tally }> =
    {};
  const byKind: Record<string, { jev: Tally; quick: Tally; legacy: Tally }> = {};
  const bucket = (
    map: typeof byField,
    key: string,
  ): (typeof byField)[string] =>
    (map[key] ??= { jev: tally(), quick: tally(), legacy: tally() });
  const misses: string[] = [];
  const add = (
    where: string,
    field: BriefField,
    kind: string,
    band: Band,
    jev: number | null,
    quick: number,
    legacy: number | null | undefined,
  ) => {
    for (const t of [level, bucket(byField, field), bucket(byKind, kind)]) {
      if (jev !== null) count(t.jev, jev, band);
      count(t.quick, quick, band);
      if (legacy !== null && legacy !== undefined)
        count(t.legacy, legacy, band);
    }
    if (jev !== null && !inBand(jev, band))
      misses.push(
        `${where} [${field}] expected ${band.join("–")}, judged ${jev} (first look ${quick}${legacy != null ? `, old score ${legacy}` : ""})`,
      );
  };
  for (const r of fieldResults)
    add(r.id, r.field, r.kind, r.band, r.jev, r.quick, r.legacy);
  briefResults.forEach((r, i) => {
    const fixture = briefFixtures[i];
    for (const [field, band] of Object.entries(fixture.bands) as Array<
      [BriefField, Band]
    >)
      add(
        r.id,
        field,
        "in-brief",
        band,
        r.levels[field] ?? null,
        r.quick[field] ?? 0,
        r.legacy[field],
      );
  });

  /* Facets: "unmet" is the positive class. */
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const facetMisses: string[] = [];
  for (const r of fieldResults)
    for (const [id, { p, label }] of Object.entries(r.facets)) {
      if (label === undefined) continue;
      const role = FIELD_FACETS[r.field].find((d) => d.id === id)?.role;
      const met = p >= (role === "edge" ? EDGE_MET : FACET_MET);
      if (!label && !met) tp++;
      else if (label && !met) fp++;
      else if (!label && met) fn++;
      else tn++;
      if (label !== met)
        facetMisses.push(
          `${r.id} · ${id}: labelled ${label ? "met" : "unmet"}, p=${p.toFixed(2)}`,
        );
    }

  /* Gamed answers: anything above Partial is a failure. */
  const gamed = fieldResults.filter((r) => r.kind === "gamed");
  const rejected = (pick: (r: FieldResult) => number | null) =>
    gamed.filter((r) => (pick(r) ?? 9) <= 2).length;
  const terse = fieldResults.filter((r) => r.kind === "terse-sharp");
  const kept = (pick: (r: FieldResult) => number | null) =>
    terse.filter((r) => (pick(r) ?? 0) >= 2).length;

  /* Constraint kinds. */
  let lineN = 0;
  let lineExact = 0;
  let lineBinding = 0;
  const lineMisses: string[] = [];
  for (const r of fieldResults)
    for (const line of r.lines ?? []) {
      if (!line.want.length || !line.kind) continue;
      lineN++;
      const kind = line.kind as Parameters<typeof isBinding>[0];
      if (line.want.includes(kind)) lineExact++;
      else lineMisses.push(`${r.id} · “${line.text}”: ${kind}, wanted ${line.want.join("|")}`);
      if (
        isBinding(kind) ===
        isBinding(line.want[0] as Parameters<typeof isBinding>[0])
      )
        lineBinding++;
    }

  /* Whole brief. */
  const suff = briefResults.map((r, i) => ({
    id: r.id,
    p: r.sufficiency,
    want: briefFixtures[i].sufficient,
  }));
  const scored = suff.filter((s) => s.p !== null && s.want !== null) as Array<{
    id: string;
    p: number;
    want: boolean;
  }>;
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  const brier = mean(scored.map((s) => (s.p - (s.want ? 1 : 0)) ** 2));
  const suffAt = (t: number) =>
    scored.filter((s) => s.p >= t === s.want).length;
  const tensionCases = briefResults.map((r, i) => ({
    r,
    want: briefFixtures[i].tension,
  }));
  const tense = tensionCases.filter((c) => c.want);
  const calm = tensionCases.filter((c) => !c.want);
  const firstq = briefResults
    .map((r, i) => ({ r, want: briefFixtures[i].firstQuestion }))
    .filter((c) => c.want);
  const bearing = briefResults.filter(
    (r, i) => r.loadBearing === briefFixtures[i].loadBearing,
  ).length;

  const tokens = briefResults.map((r) => r.inputTokens);
  const cost = mean(tokens) * USD_PER_INPUT_TOKEN;

  const line = (label: string, t: Tally) =>
    `${label.padEnd(26)} in band ${pct(t.exact, t.n).padStart(4)}   within one ${pct(t.near, t.n).padStart(4)}   (n=${t.n})`;
  console.log("\nLevel accuracy");
  console.log(line("  judged (checklist)", level.jev));
  console.log(line("  first look (local)", level.quick));
  if (options.baseline) console.log(line("  old single score", level.legacy));
  console.log("\n  by field (judged)");
  for (const field of BRIEF_FIELD_ORDER)
    if (byField[field]) console.log(line(`    ${field}`, byField[field].jev));
  console.log("\n  by kind (judged / first look" + (options.baseline ? " / old score)" : ")"));
  for (const [kind, t] of Object.entries(byKind))
    console.log(
      `    ${kind.padEnd(12)} ${pct(t.jev.exact, t.jev.n).padStart(4)} / ${pct(t.quick.exact, t.quick.n).padStart(4)}${options.baseline ? ` / ${pct(t.legacy.exact, t.legacy.n).padStart(4)}` : ""}   (n=${t.jev.n})`,
    );

  /* The number on the meter: does it rise with the editor's level? */
  const byBand = (pick: (r: FieldResult) => number | null) =>
    [1, 2, 3, 4].map((lvl) => {
      const scores = fieldResults
        .filter((r) => r.band[0] === lvl && r.band[1] === lvl)
        .map(pick)
        .filter((n): n is number => n !== null);
      return scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;
    });
  const scaleTally = tally();
  for (const r of fieldResults)
    if (r.scale !== null) count(scaleTally, r.scale, r.band);
  console.log("\nThe meter's number (mean, by the editor's level: Vague / Partial / Specific / Sharp)");
  console.log(`  judged      ${byBand((r) => r.score).join(" / ")}`);
  console.log(`  first look  ${byBand((r) => r.quickScore).join(" / ")}`);
  console.log(line("  graded scale alone", scaleTally));

  console.log("\nFacets (unmet is the positive class)");
  console.log(
    `  precision ${pct(tp, tp + fp)}   recall ${pct(tp, tp + fn)}   accuracy ${pct(tp + tn, tp + tn + fp + fn)}   (n=${tp + tn + fp + fn})`,
  );

  console.log("\nGamed answers held at Partial or below");
  console.log(
    `  judged ${rejected((r) => r.jev)}/${gamed.length}   first look ${rejected((r) => r.quick)}/${gamed.length}${options.baseline ? `   old score ${rejected((r) => r.legacy)}/${gamed.length}` : ""}`,
  );
  console.log("Sharp terse answers kept at Partial or above");
  console.log(
    `  judged ${kept((r) => r.jev)}/${terse.length}   first look ${kept((r) => r.quick)}/${terse.length}${options.baseline ? `   old score ${kept((r) => r.legacy)}/${terse.length}` : ""}`,
  );

  console.log("\nConstraint lines");
  console.log(
    `  kind ${pct(lineExact, lineN)}   binding vs not ${pct(lineBinding, lineN)}   (n=${lineN})`,
  );

  console.log("\nWhole brief");
  console.log(
    `  sufficiency: mean ${mean(scored.filter((s) => s.want).map((s) => s.p)).toFixed(2)} when a stranger could write it, ${mean(scored.filter((s) => !s.want).map((s) => s.p)).toFixed(2)} when not; Brier ${brier.toFixed(3)}; correct at 0.6 ${suffAt(0.6)}/${scored.length}, at 0.7 ${suffAt(0.7)}/${scored.length}`,
  );
  console.log(
    `  tension: pair named ${tense.filter((c) => samePair(c.r.tension, c.want!)).length}/${tense.length}; false alarms ${calm.filter((c) => c.r.tension).length}/${calm.length}`,
  );
  console.log(
    `  first question on an expected field ${firstq.filter((c) => c.r.firstQuestion && c.want!.includes(c.r.firstQuestion)).length}/${firstq.length}; asked of a brief that needed none ${briefResults.filter((r, i) => r.firstQuestion && briefFixtures[i].firstQuestion === undefined).length}/${briefResults.filter((_, i) => briefFixtures[i].firstQuestion === undefined).length}`,
  );
  console.log(`  load-bearing verdict ${bearing}/${briefResults.length}`);

  console.log("\nCost per brief");
  console.log(
    `  requests 1   questions median ${median(briefResults.map((r) => r.questions))} (max ${Math.max(0, ...briefResults.map((r) => r.questions))})   input tokens median ${median(tokens)}   latency median ${median(briefResults.map((r) => r.latencyMs))} ms   ≈ $${cost.toFixed(6)}`,
  );
  console.log(
    `  single answer: questions median ${median(fieldResults.filter((r) => r.questions).map((r) => r.questions))}, latency median ${median(fieldResults.filter((r) => r.latencyMs).map((r) => r.latencyMs))} ms`,
  );

  if (options.verbose || misses.length) {
    console.log(`\nLevel misses (${misses.length})`);
    for (const m of misses) console.log(`  ${m}`);
  }
  if (options.verbose) {
    console.log(`\nFacet misses (${facetMisses.length})`);
    for (const m of facetMisses) console.log(`  ${m}`);
    console.log(`\nConstraint misses (${lineMisses.length})`);
    for (const m of lineMisses) console.log(`  ${m}`);
    console.log("\nBriefs");
    for (const r of briefResults)
      console.log(
        `  ${r.id}: suff ${r.sufficiency?.toFixed(2)} contra ${r.contradiction?.toFixed(2)} tension ${r.tension?.join("×") ?? "-"} firstq ${r.firstQuestion ?? "-"} bearing ${r.loadBearing} ${r.soft.join("; ")}`,
      );
    console.log("\nSplits and stand-ins");
    for (const r of fieldResults)
      if (r.split || r.standIn)
        console.log(
          `  ${r.id} (band ${r.band.join("–")}): ${r.split ? "split " : ""}${r.standIn ? `stand-in “${r.standIn}”` : ""}`,
        );
  }

  return {
    fixtures: { answers: fieldFixtures.length, briefs: briefFixtures.length },
    level: {
      judged: { inBand: rate(level.jev.exact, level.jev.n), withinOne: rate(level.jev.near, level.jev.n), n: level.jev.n },
      firstLook: { inBand: rate(level.quick.exact, level.quick.n), withinOne: rate(level.quick.near, level.quick.n), n: level.quick.n },
      ...(options.baseline
        ? { oldScore: { inBand: rate(level.legacy.exact, level.legacy.n), withinOne: rate(level.legacy.near, level.legacy.n), n: level.legacy.n } }
        : {}),
    },
    meter: {
      judgedMeanByLevel: byBand((r) => r.score),
      firstLookMeanByLevel: byBand((r) => r.quickScore),
      scaleAlone: {
        inBand: rate(scaleTally.exact, scaleTally.n),
        withinOne: rate(scaleTally.near, scaleTally.n),
        n: scaleTally.n,
      },
    },
    facets: {
      precision: rate(tp, tp + fp),
      recall: rate(tp, tp + fn),
      accuracy: rate(tp + tn, tp + tn + fp + fn),
      n: tp + tn + fp + fn,
    },
    gamed: {
      n: gamed.length,
      judgedRejected: rejected((r) => r.jev),
      firstLookRejected: rejected((r) => r.quick),
      ...(options.baseline ? { oldScoreRejected: rejected((r) => r.legacy) } : {}),
    },
    terseSharp: {
      n: terse.length,
      judgedKept: kept((r) => r.jev),
      firstLookKept: kept((r) => r.quick),
    },
    constraints: {
      kind: rate(lineExact, lineN),
      binding: rate(lineBinding, lineN),
      n: lineN,
    },
    whole: {
      sufficiency: scored,
      brier: Number(brier.toFixed(4)),
      tensionNamed: `${tense.filter((c) => samePair(c.r.tension, c.want!)).length}/${tense.length}`,
      tensionFalseAlarms: `${calm.filter((c) => c.r.tension).length}/${calm.length}`,
      loadBearing: `${bearing}/${briefResults.length}`,
    },
    perBrief: {
      requests: 1,
      questionsMedian: median(briefResults.map((r) => r.questions)),
      inputTokensMedian: median(tokens),
      latencyMsMedian: median(briefResults.map((r) => r.latencyMs)),
      usd: Number(cost.toFixed(7)),
    },
    misses,
    answers: fieldResults,
    briefs: briefResults,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!process.env.TYPESAFE_API_KEY?.trim()) {
    console.error(
      "TYPESAFE_API_KEY is not set. Load it into the environment for this run only; nothing was called.",
    );
    process.exitCode = 2;
    return;
  }
  console.log(`Brief strength · ${MODEL}`);
  let tuned: Record<string, unknown>;
  let heldOut: Record<string, unknown>;
  try {
    tuned = await evaluate(
      "Tuning set (wording was adjusted against these)",
      FIELD_FIXTURES,
      BRIEF_FIXTURES,
      options,
    );
    heldOut = await evaluate(
      "Held-out set (never used to adjust wording)",
      HOLDOUT_FIELD_FIXTURES,
      HOLDOUT_BRIEF_FIXTURES,
      options,
    );
  } catch (error) {
    console.error(
      `The judgement endpoint failed: ${(error as Error).message}. No scores were written.`,
    );
    process.exitCode = 1;
    return;
  }
  if (!options.only && !options.limit) {
    writeFileSync(
      SCORES_PATH,
      `${JSON.stringify({ model: MODEL, at: new Date().toISOString(), tuned, heldOut }, null, 2)}\n`,
    );
    console.log(`\nWrote ${SCORES_PATH}`);
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
