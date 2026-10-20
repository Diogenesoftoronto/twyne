/**
 * The evidence an editor gathered for one note, reduced to what a margin card
 * can show: the other passages the note draws on, and the continuity facts
 * the editor read out of the draft.
 *
 * Generation returns every passage the research tools resolved and the raw
 * typed readings. Neither is stored as is: passages are deduplicated against
 * the card's own anchor and capped, and readings become plain facts — a value
 * or a closest reading, with the verbatim passages it came from. Probabilities
 * are not kept; the card never shows them.
 */
import type { PersonaExtractionReading } from "./persona-research";
import { extractQuotations } from "./quote-grounding";

export interface NoteFact {
  /** Field id the editor chose, e.g. `first_meeting_year`. */
  id: string;
  /** The id as words. */
  label: string;
  /** The reading, formatted for a line of type. */
  value: string;
  /** True when the draft only came close: a guess, not a stated fact. */
  near?: boolean;
  /** Verbatim passages the reading came from, in draft order. */
  passages: string[];
}

export interface NoteEvidence {
  /** Linked passages beyond the card's own anchor. */
  passages: string[];
  facts: NoteFact[];
}

/** One card, not a dossier: the anchor plus at most three more. */
export const MAX_EXTRA_PASSAGES = 3;
export const MAX_FACTS = 6;
const MAX_PASSAGE_CHARS = 600;

function fold(text: string): string {
  return text
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function clip(text: string): string {
  const t = text.trim();
  return t.length > MAX_PASSAGE_CHARS ? t.slice(0, MAX_PASSAGE_CHARS) : t;
}

/**
 * Passages other than the primary anchor, in the order research found them,
 * without repeats or passages contained in one already kept.
 */
export function normaliseNoteAnchors(
  primary: string | undefined,
  anchors: readonly unknown[] | undefined,
): string[] {
  const kept: string[] = [];
  const seen: string[] = primary?.trim() ? [fold(primary)] : [];
  for (const raw of anchors ?? []) {
    if (typeof raw !== "string") continue;
    const passage = clip(raw);
    const key = fold(passage);
    if (key.length < 8) continue;
    if (seen.some((s) => s.includes(key) || key.includes(s))) continue;
    seen.push(key);
    kept.push(passage);
    if (kept.length >= MAX_EXTRA_PASSAGES) break;
  }
  return kept;
}

/** `first_meeting_year` → "first meeting year". */
export function factLabel(id: string): string {
  return id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
}

function formatScalar(value: unknown, unit?: string): string | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const n = Number.isInteger(value)
      ? String(value)
      : String(Math.round(value * 100) / 100);
    return unit ? `${n} ${unit}` : n;
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const items = value
      .map((v) => formatScalar(v))
      .filter((v): v is string => !!v);
    return items.length ? items.join("; ") : null;
  }
  return null;
}

/** A value, or the 10–90 interval when the field is an estimate. */
function formatAnswer(
  answer: PersonaExtractionReading["answers"][string],
  unit: string | undefined,
  raw: unknown,
): string | null {
  const lo = formatScalar(answer.p10);
  const hi = formatScalar(answer.p90);
  if (
    (answer.type === "estimate" || answer.type === "forecast") &&
    lo &&
    hi &&
    lo !== hi
  ) {
    return unit ? `${lo}–${hi} ${unit}` : `${lo}–${hi}`;
  }
  return formatScalar(raw, unit);
}

/** Typed readings as card facts. Answers with neither value nor guess are dropped. */
export function factsFromReadings(
  readings: readonly PersonaExtractionReading[] | undefined,
): NoteFact[] {
  const out: NoteFact[] = [];
  const ids = new Set<string>();
  for (const reading of readings ?? []) {
    for (const [id, answer] of Object.entries(reading?.answers ?? {})) {
      if (!answer || ids.has(id)) continue;
      const unit = answer.unit ?? reading.fields?.[id]?.unit;
      const exact = answer.value != null;
      const value = formatAnswer(
        answer,
        unit,
        exact ? answer.value : answer.guess,
      );
      if (!value) continue;
      const passages = [answer.source, ...(answer.passages ?? [])]
        .map((p) => p?.passage)
        .filter((p): p is string => typeof p === "string" && !!p.trim())
        .map(clip)
        .filter((p, i, all) => all.indexOf(p) === i)
        .slice(0, 2);
      ids.add(id);
      out.push({
        id,
        label: factLabel(id),
        value: value.length > 160 ? value.slice(0, 159) + "…" : value,
        ...(exact ? {} : { near: true }),
        passages,
      });
      if (out.length >= MAX_FACTS) return out;
    }
  }
  return out;
}

/** Anything persisted or synced, back into a shape the card can trust. */
export function normaliseNoteFacts(input: unknown): NoteFact[] {
  if (!Array.isArray(input)) return [];
  const out: NoteFact[] = [];
  for (const f of input) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.value !== "string") continue;
    out.push({
      id: r.id,
      label: typeof r.label === "string" ? r.label : factLabel(r.id),
      value: r.value,
      ...(r.near === true ? { near: true } : {}),
      passages: Array.isArray(r.passages)
        ? r.passages
            .filter((p): p is string => typeof p === "string")
            .slice(0, 2)
        : [],
    });
    if (out.length >= MAX_FACTS) break;
  }
  return out;
}

/**
 * What the card shows beyond its anchor and body. A passage the note already
 * quotes is linked inline, so it is not listed again underneath.
 */
export function noteEvidence(note: {
  feedback: string;
  anchor?: string;
  anchors?: readonly unknown[];
  facts?: unknown;
}): NoteEvidence {
  const quoted = extractQuotations(note.feedback).map((q) => fold(q.quote));
  const passages = normaliseNoteAnchors(note.anchor, note.anchors).filter(
    (p) => {
      const key = fold(p);
      return !quoted.some(
        (q) => q.length >= 8 && (key.includes(q) || q.includes(key)),
      );
    },
  );
  // A fact the writer cannot check against the draft does not support the
  // note; only readings with a source passage are shown.
  const facts = normaliseNoteFacts(note.facts).filter(
    (f) => f.passages.length > 0,
  );
  return { passages, facts };
}

/** Fields to store on a note at the moment it is filed. */
export function evidenceFields(response: {
  anchor?: string;
  anchors?: readonly unknown[];
  extractions?: readonly PersonaExtractionReading[];
}): { anchors?: string[]; facts?: NoteFact[] } {
  const anchors = normaliseNoteAnchors(response.anchor, response.anchors);
  const facts = factsFromReadings(response.extractions);
  return {
    ...(anchors.length ? { anchors } : {}),
    ...(facts.length ? { facts } : {}),
  };
}
