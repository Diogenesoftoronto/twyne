import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ClairicAsk } from "../judges";
import type { Score } from "../scoring";

export const VALUE_METRIC = "clairic_value_support_v2";
export const VALUE_VERSION = "research-value-support-v2";
export type ValueCheck = { property: string } & (
  | { type: "date"; expected: string; precision: "year" | "month" | "day" }
  | {
      type: "number";
      expected: number;
      unit: string;
      absoluteTolerance: number;
    }
  | { type: "text"; expected: string }
);
interface Entry {
  fact: string;
  check: ValueCheck | null;
  reason?: string;
}
const manifestText = readFileSync(
  new URL("../cases/research-value-checks.v2.json", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(manifestText) as {
  version: string;
  cases: Record<string, Entry>;
};
export const VALUE_MANIFEST_SHA256 = createHash("sha256")
  .update(manifestText)
  .digest("hex");
export const VALUE_EVALUATOR = `${VALUE_VERSION}:${VALUE_MANIFEST_SHA256}`;

function validDate(value: string): boolean {
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return false;
  const full =
    value.length === 4
      ? `${value}-01-01`
      : value.length === 7
        ? `${value}-01`
        : value;
  const date = new Date(`${full}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === full
  );
}

/** Every corpus claim is explicitly eligible or excluded, bound to its exact gold fact. */
export function validateValueManifest(
  claims: Array<{ case_id: string; fact: string }>,
  data = manifest,
): void {
  if (data.version !== VALUE_VERSION)
    throw new Error("Unsupported research value evaluator version");
  const ids = new Set(claims.map((c) => c.case_id));
  if (
    ids.size !== claims.length ||
    Object.keys(data.cases).some((id) => !ids.has(id))
  )
    throw new Error("Research value manifest has duplicate or stale case IDs");
  for (const claim of claims) {
    const entry = data.cases[claim.case_id];
    if (!entry || entry.fact !== claim.fact)
      throw new Error(`Review research value gold for ${claim.case_id}`);
    const check = entry.check;
    if (check === null) {
      if (!entry.reason?.trim())
        throw new Error(`Missing exclusion reason: ${claim.case_id}`);
      continue;
    }
    const valid =
      check &&
      typeof check.property === "string" &&
      check.property.trim() &&
      (check.type === "date"
        ? typeof check.expected === "string" &&
          validDate(check.expected) &&
          check.expected.length ===
            { year: 4, month: 7, day: 10 }[check.precision]
        : check.type === "number"
          ? Number.isFinite(check.expected) &&
            typeof check.unit === "string" &&
            check.unit.trim() &&
            Number.isFinite(check.absoluteTolerance) &&
            check.absoluteTolerance >= 0
          : check.type === "text" &&
            typeof check.expected === "string" &&
            check.expected.trim());
    if (!valid)
      throw new Error(`Invalid research value check: ${claim.case_id}`);
  }
}

export function valueEntry(claim: { case_id: string; fact: string }): Entry {
  const entry = manifest.cases[claim.case_id];
  if (!entry || entry.fact !== claim.fact)
    throw new Error(`Review research value gold for ${claim.case_id}`);
  return entry;
}

interface Answer {
  value?: unknown;
  confidence?: number;
  p_null?: number;
  span?: number[];
  unit?: string;
}
function answer(raw: unknown): Answer | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Answer;
  if (
    !("value" in a) ||
    typeof a.p_null !== "number" ||
    !Number.isFinite(a.p_null) ||
    a.p_null < 0 ||
    a.p_null > 1
  )
    return null;
  if (
    a.value !== null &&
    (typeof a.confidence !== "number" ||
      !Number.isFinite(a.confidence) ||
      a.confidence < 0 ||
      a.confidence > 1)
  )
    return null;
  return a;
}
const confident = (a: Answer) =>
  a.value !== null && a.confidence! >= 0.3 && a.p_null! <= 0.3;
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const MONTHS =
  "january february march april may june july august september october november december".split(
    " ",
  );
const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  eighteen: 18,
  "forty-two": 42,
  "fifty-five": 55,
};

/** Conservative lexical grounding, not a semantic fact checker. Unsupported notation abstains. */
function grounded(
  value: string | number,
  quote: string,
  check: ValueCheck,
): boolean {
  if (check.type === "text")
    return quote.toLowerCase().includes(String(value).toLowerCase());
  if (check.type === "date") {
    const text = quote.toLowerCase();
    const [year, month, day] = String(value).split("-");
    if (!new RegExp(`\\b${year}\\b`).test(text)) return false;
    if (check.precision === "year") return true;
    if (
      text.includes(String(value).slice(0, check.precision === "day" ? 10 : 7))
    )
      return true;
    const name = MONTHS[Number(month) - 1];
    if (!name) return false;
    const m = `(?:${name}|${name.slice(0, 3)}\\.?)`;
    const d =
      check.precision === "day"
        ? `0?${Number(day)}(?:st|nd|rd|th)?`
        : "\\d{1,2}(?:st|nd|rd|th)?";
    // Keep the date components adjacent; do not assemble a date from two events.
    return (
      new RegExp(
        `\\b(?:${d}\\s+${m}[,\\s]+${year}|${m}\\s+${d}[,\\s]+${year})\\b`,
      ).test(text) ||
      (check.precision === "month" &&
        new RegExp(`\\b${m}[,\\s]+${year}\\b`).test(text))
    );
  }
  const text = quote
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/−/g, "-")
    .replace(/minus\s+(?=\d)/g, "-");
  const values = [
    ...text.matchAll(
      /(?<![\w.])-?\d+(?:\.\d+)?(?:\s*(hundred|thousand|million|billion))?(?!\w|\.\d)/g,
    ),
  ].map(
    (m) =>
      Number(m[0].replace(/\s*(hundred|thousand|million|billion)$/, "")) *
      ({ hundred: 100, thousand: 1000, million: 1e6, billion: 1e9 }[m[1]] ?? 1),
  );
  for (const [word, n] of Object.entries(WORD_NUMBERS))
    if (
      new RegExp(
        `(?<![\\w-])(?<!twenty )(?<!thirty )(?<!forty )(?<!fifty )(?<!sixty )(?<!seventy )(?<!eighty )(?<!ninety )${word}(?![\\w-]|\\s+(?:hundred|thousand|million|billion))`,
      ).test(text)
    )
      values.push(n);
  return values.some(
    (n) => Math.abs(n - Number(value)) <= Math.max(1e-9, Math.abs(n) * 1e-12),
  );
}

function typed(value: unknown, check: ValueCheck): value is string | number {
  return check.type === "number"
    ? typeof value === "number" && Number.isFinite(value)
    : typeof value === "string" &&
        (check.type === "text"
          ? !!value.trim()
          : validDate(value) && value.length >= check.expected.length);
}
function agrees(value: string | number, check: ValueCheck): boolean {
  return check.type === "number"
    ? Math.abs(Number(value) - check.expected) <= check.absoluteTolerance
    : check.type === "date"
      ? String(value).slice(0, check.expected.length) === check.expected
      : norm(String(value)) === norm(check.expected);
}

interface Source {
  title: string;
  url: string;
  snippet?: string;
}
interface Reading {
  rank: number;
  url: string;
  stateSha256: string;
  truncated: boolean;
  status: string;
  value?: unknown;
  confidence?: number;
  pNull?: number;
  evidence?: string;
  evidenceSpan?: number[];
  evidenceConfidence?: number;
  evidencePNull?: number;
  error?: string;
}

/** Top-five source support at declared precision/units; never re-extract the answer key. */
export async function clairicValueSupport(
  extract: ClairicAsk,
  claim: { case_id: string; fact: string },
  sources: Source[],
): Promise<Score> {
  const entry = valueEntry(claim);
  const check = entry.check;
  if (!check)
    return {
      score: null,
      label: "n/a",
      explanation: `${VALUE_EVALUATOR}: ${entry.reason}`,
    };
  const readings: Reading[] = [];
  const finish = (score: number | null, label: string): Score => ({
    score,
    label,
    explanation: JSON.stringify({
      evaluator: VALUE_EVALUATOR,
      check,
      scope: "top-five returned source snippets",
      readings,
      caveat:
        "Extraction agreement with declared gold; supporting text is not proof of semantic entailment or application factual accuracy.",
    }),
    items: Object.fromEntries(
      readings
        .filter(
          (r) =>
            r.status === "agrees" ||
            r.status === "differs" ||
            r.status === "not stated",
        )
        .map((r) => [`source${r.rank}`, r.status === "agrees" ? 1 : 0]),
    ),
  });
  if (!sources.length) return finish(0, "no sources");
  for (const [index, source] of sources.slice(0, 5).entries()) {
    const full = `${source.title}\n${source.snippet ?? ""}`;
    const state = full.slice(0, 12_000);
    const reading: Reading = {
      rank: index + 1,
      url: source.url,
      stateSha256: createHash("sha256").update(state).digest("hex"),
      truncated: full.length > state.length,
      status: "uncertain",
    };
    readings.push(reading);
    // Serial requests respect the caller's rate limit and keep source provenance separate.
    try {
      const result = await extract({
        state,
        fields: {
          value: {
            type: check.type,
            instructions: `${check.property}. ${check.type === "number" ? `Report in ${check.unit}. ` : ""}Null if this exact property is not stated. Do not substitute a nearby event or quantity.`,
            ...(check.type === "number" ? { unit: check.unit } : {}),
          },
          evidence: {
            type: "text",
            instructions: `The exact shortest passage stating ${check.property}, including the value and its event/property context. Null if absent. Copy the source; do not paraphrase.`,
          },
        },
      });
      if (!result.ok) throw new Error(result.error ?? "no extraction result");
      const value = answer(result.answers?.value);
      const evidence = answer(result.answers?.evidence);
      if (!value || !evidence)
        throw new Error("missing or malformed value/evidence answer");
      reading.value = value.value;
      reading.confidence = value.confidence;
      reading.pNull = value.p_null;
      reading.evidenceConfidence = evidence.confidence;
      reading.evidencePNull = evidence.p_null;
      if (typeof evidence.value === "string") reading.evidence = evidence.value;
      if (Array.isArray(evidence.span)) reading.evidenceSpan = evidence.span;
      if (value.value === null) {
        reading.status =
          value.p_null! >= 0.7 && !reading.truncated
            ? "not stated"
            : "uncertain";
        continue;
      }
      if (!typed(value.value, check))
        throw new Error("value does not match the declared type/precision");
      if (!confident(value) || !confident(evidence)) continue;
      const quote = evidence.value;
      const span = evidence.span;
      if (
        typeof quote !== "string" ||
        !quote.trim() ||
        !Array.isArray(span) ||
        span.length !== 2 ||
        !span.every(Number.isInteger) ||
        span[0] < 0 ||
        span[1] > state.length ||
        span[1] <= span[0] ||
        state.slice(span[0], span[1]) !== quote ||
        !grounded(value.value, quote, check) ||
        (check.type === "number" &&
          value.unit !== undefined &&
          value.unit !== check.unit)
      ) {
        reading.status = "ungrounded";
        continue;
      }
      reading.status = agrees(value.value, check) ? "agrees" : "differs";
    } catch (error) {
      reading.status = "clairic-error";
      reading.error = error instanceof Error ? error.message : String(error);
      return finish(null, "clairic-error");
    }
  }
  if (readings.some((r) => r.status === "agrees"))
    return finish(1, "supported");
  if (
    readings.some((r) => r.status === "uncertain" || r.status === "ungrounded")
  )
    return finish(null, "uncertain");
  return finish(
    0,
    readings.some((r) => r.status === "differs") ? "differs" : "not stated",
  );
}
