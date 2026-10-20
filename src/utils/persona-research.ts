import type {
  ExtractionField,
  ExtractionRequest,
  ExtractionResult,
  ExtractionAnswer,
} from "./extraction";
import type { PassageRange } from "./passage-window";
import type { JudgementRequest, JudgementResult } from "./judgement-client";
import {
  judgementQuestions,
  type JudgementQuestion,
} from "../../convex/lib/judgementContract";

export interface PersonaResearch {
  extract?: (request: ExtractionRequest) => Promise<ExtractionResult>;
  judge?: (request: JudgementRequest) => Promise<JudgementResult>;
  /** Shared across private drafting retries; reserve synchronously before awaiting. */
  reserve: () => boolean;
}

export interface PersonaExtractionAnswer extends ExtractionAnswer {
  /** Coordinates and verbatim text in the original draft, including a near miss. */
  source: PassageRange | null;
  passages: PassageRange[];
}

export interface PersonaExtractionReading {
  fields: Record<string, ExtractionField>;
  answers: Record<string, PersonaExtractionAnswer>;
  partial: boolean;
}

export function personaResearchBudget(max = 4): () => boolean {
  let calls = 0;
  return () => calls++ < max;
}

const TYPES = new Set([
  "text",
  "number",
  "date",
  "time",
  "datetime",
  "duration",
  "list",
  "estimate",
  "forecast",
]);
const INTERVALS = new Set([
  "step",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "quarter",
  "year",
]);
const UNITS = new Set([
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
  "years",
]);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

export function validatePersonaFields(
  input: unknown,
): Record<string, ExtractionField> {
  if (
    !record(input) ||
    !Object.keys(input).length ||
    Object.keys(input).length > 12
  )
    throw new Error("Use 1–12 fields.");
  const fields: Record<string, ExtractionField> = {};
  for (const [name, raw] of Object.entries(input)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ||
      !record(raw) ||
      !TYPES.has(String(raw.type))
    )
      throw new Error("Invalid field name or type.");
    const f: ExtractionField = { type: raw.type as ExtractionField["type"] };
    if (typeof raw.instructions === "string")
      f.instructions = raw.instructions.slice(0, 1200);
    if (typeof raw.unit === "string") f.unit = raw.unit.slice(0, 64);
    if (f.type === "duration" && (!f.unit || !UNITS.has(f.unit)))
      throw new Error("Duration needs a unit from seconds through years.");
    if (typeof raw.integer === "boolean") f.integer = raw.integer;
    for (const key of ["decimals", "null_threshold", "horizon"] as const) {
      const value = raw[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error("Invalid field range.");
      f[key] =
        key === "null_threshold"
          ? clamp(value, 0, 1)
          : Math.floor(
              clamp(
                value,
                key === "horizon" ? 1 : 0,
                key === "horizon" ? 24 : 6,
              ),
            );
    }
    for (const key of ["min", "max"] as const) {
      const value = raw[key];
      if (typeof value === "number" && Number.isFinite(value))
        f[key] = clamp(value, -1e9, 1e9);
      else if (
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]+)?$/.test(value) &&
        Number.isFinite(Date.parse(value))
      )
        f[key] = value;
      else if (value !== undefined) throw new Error("Invalid field range.");
    }
    if (
      f.min !== undefined &&
      f.max !== undefined &&
      (typeof f.min !== typeof f.max || f.min > f.max)
    )
      throw new Error("Field range must be ordered.");
    if (f.type === "list") {
      if (!["text", "number", "date"].includes(String(raw.items)))
        throw new Error("List needs text, number or date items.");
      f.items = raw.items as ExtractionField["items"];
    }
    if (raw.step !== undefined) {
      if (raw.step === "month" || raw.step === "year") f.step = raw.step;
      else if (
        typeof raw.step === "number" &&
        Number.isFinite(raw.step) &&
        raw.step > 0
      )
        f.step = clamp(raw.step, 0.000001, 1e9);
      else throw new Error("Invalid step.");
    }
    if (raw.scale !== undefined) {
      if (raw.scale !== "linear" && raw.scale !== "log")
        throw new Error("Invalid scale.");
      f.scale = raw.scale;
    }
    if (f.type === "estimate" || f.type === "forecast") {
      if (
        f.min === undefined ||
        f.max === undefined ||
        typeof f.min !== typeof f.max ||
        f.min >= f.max
      )
        throw new Error("Estimate and forecast need an ordered range.");
      if (f.scale === "log" && (typeof f.min !== "number" || f.min <= 0))
        throw new Error("Log ranges must be positive.");
    }
    if (f.type === "forecast") {
      if (!f.horizon || !INTERVALS.has(String(raw.interval)))
        throw new Error("Forecast needs horizon and interval.");
      f.interval = raw.interval as ExtractionField["interval"];
    }
    fields[name] = f;
  }
  return fields;
}

export function validatePersonaQuestions(
  input: unknown,
): Record<string, JudgementQuestion> {
  if (!record(input) || Object.keys(input).length > 8)
    throw new Error("Use 1–8 questions.");
  for (const [id, q] of Object.entries(input)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(id) ||
      !record(q) ||
      !["noul", "choice", "score"].includes(String(q.type)) ||
      typeof q.instructions !== "string" ||
      q.instructions.length > 1200
    )
      throw new Error("Invalid question.");
    if (
      q.criteria !== undefined &&
      (!Array.isArray(q.criteria) ||
        q.criteria.length > 12 ||
        q.criteria.some((s) => typeof s !== "string" || s.length > 300))
    )
      throw new Error("Use at most 12 short criteria.");
  }
  const questions = input as unknown as Record<string, JudgementQuestion>;
  judgementQuestions(questions);
  return questions;
}
