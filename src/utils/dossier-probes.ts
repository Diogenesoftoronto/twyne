/**
 * Typed interview follow-ups.
 *
 * The seven brief fields are prose, which is right for "what is this piece" and
 * weak for "which of these three things is it". A probe is a small typed
 * question the interviewer generates from what it has already heard — a choice,
 * a multi-select, a fill-in-the-blanks sentence, a scale — and because the
 * answer comes back structured rather than as another paragraph, the judges can
 * act on it directly.
 *
 * Everything here is parsing and rendering. The model emits a probe as JSON,
 * which means it will sometimes emit something almost-right: a scale with no
 * bounds, a choice with one option, a blanks template with no blanks. This
 * module's job is to turn "almost right" into either something usable or
 * nothing at all, and never into a broken control the writer cannot answer.
 */

import type { DossierProbe, ProbeKind, ProjectInterviewAnswers } from "../types";

const PROBE_KINDS: ProbeKind[] = ["choice", "multi", "blanks", "scale"];

const BRIEF_FIELDS: Array<keyof ProjectInterviewAnswers> = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
];

/** The blank marker a template uses. Three or more underscores. */
export const BLANK_PATTERN = /_{3,}/g;

export function countBlanks(template: string): number {
  return (template.match(BLANK_PATTERN) ?? []).length;
}

/**
 * Turn whatever the model produced into a probe we can actually render, or
 * null. Strict on purpose: a malformed probe should vanish and let the
 * interview carry on in prose, never render as a control with no options or a
 * slider with no ends.
 */
export function normalizeProbe(value: unknown): DossierProbe | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const kind = PROBE_KINDS.find((k) => k === raw.kind);
  if (!kind) return null;

  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) return null;

  const relatesTo = BRIEF_FIELDS.find((f) => f === raw.relatesTo);
  const base: DossierProbe = {
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : `probe-${crypto.randomUUID()}`,
    kind,
    prompt,
    ...(relatesTo ? { relatesTo } : {}),
  };

  if (kind === "choice" || kind === "multi") {
    const options = Array.isArray(raw.options)
      ? Array.from(
          new Set(
            raw.options
              .filter((o): o is string => typeof o === "string")
              .map((o) => o.trim())
              .filter(Boolean),
          ),
        ).slice(0, 8)
      : [];
    // One option is not a choice; it is a statement with a button.
    if (options.length < 2) return null;
    return { ...base, options };
  }

  if (kind === "blanks") {
    const template =
      typeof raw.template === "string" ? raw.template.trim() : "";
    if (!template || countBlanks(template) === 0) return null;
    return { ...base, template };
  }

  // scale
  const min = typeof raw.min === "number" && Number.isFinite(raw.min)
    ? Math.round(raw.min)
    : 1;
  const max = typeof raw.max === "number" && Number.isFinite(raw.max)
    ? Math.round(raw.max)
    : 5;
  if (max <= min) return null;
  return {
    ...base,
    min,
    // A slider with fifty stops is a worse question than one with five.
    max: Math.min(max, min + 10),
    minLabel:
      typeof raw.minLabel === "string" ? raw.minLabel.trim() : undefined,
    maxLabel:
      typeof raw.maxLabel === "string" ? raw.maxLabel.trim() : undefined,
  };
}

export function normalizeProbes(value: unknown): DossierProbe[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).probes)
      ? ((value as Record<string, unknown>).probes as unknown[])
      : [];
  return list
    .map(normalizeProbe)
    .filter((p): p is DossierProbe => p !== null)
    .slice(0, 6);
}

export function isAnswered(probe: DossierProbe): boolean {
  const a = probe.answer;
  if (a === undefined || a === null) return false;
  if (Array.isArray(a)) return a.some((v) => v.trim() !== "");
  if (typeof a === "string") return a.trim() !== "";
  return Number.isFinite(a);
}

/**
 * Render a probe's answer as the sentence the writer effectively said. Used
 * both for the chat transcript (so the conversation reads naturally after a
 * tap) and for the prompt block the judges receive.
 */
export function probeAnswerText(probe: DossierProbe): string {
  const a = probe.answer;
  if (!isAnswered(probe)) return "";

  if (probe.kind === "blanks" && probe.template) {
    const parts = Array.isArray(a) ? a : [String(a)];
    let i = 0;
    return probe.template.replace(BLANK_PATTERN, () => {
      const filled = parts[i++]?.trim();
      return filled || "___";
    });
  }

  if (probe.kind === "scale") {
    const value = Number(a);
    const ends =
      probe.minLabel && probe.maxLabel
        ? ` (${probe.min}=${probe.minLabel}, ${probe.max}=${probe.maxLabel})`
        : "";
    return `${value} of ${probe.max}${ends}`;
  }

  if (Array.isArray(a)) return a.filter(Boolean).join(", ");
  return String(a);
}

/** One line per answered probe, for the prompt and the sidebar. */
export function probeSummaryLine(probe: DossierProbe): string {
  return `${probe.prompt} → ${probeAnswerText(probe)}`;
}

/**
 * Merge a newly-answered probe into a list, replacing any earlier answer to
 * the same question rather than accumulating duplicates.
 */
export function upsertProbe(
  probes: DossierProbe[],
  next: DossierProbe,
): DossierProbe[] {
  const index = probes.findIndex((p) => p.id === next.id);
  if (index < 0) return [...probes, next];
  const copy = [...probes];
  copy[index] = next;
  return copy;
}

/** The empty answer for a probe, shaped for its kind. */
export function blankAnswer(probe: DossierProbe): string | string[] | number {
  switch (probe.kind) {
    case "multi":
      return [];
    case "blanks":
      return new Array(countBlanks(probe.template ?? "")).fill("");
    case "scale":
      return Math.round(((probe.min ?? 1) + (probe.max ?? 5)) / 2);
    case "choice":
    default:
      return "";
  }
}
