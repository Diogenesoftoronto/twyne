/**
 * The writer's rubric configuration and its trend line.
 *
 * Twyne ships a fixed spine of criteria so that a 68 in March and a 68 in June
 * mean the same thing. What the writer owns is the weighting, whether a spine
 * criterion is shown at all, and any criteria of their own — "does this stay
 * in second person", "does every section end on a concrete image" — which the
 * room judges alongside the built-ins.
 *
 * Both live in the existing `meta` IndexedDB store, so nothing here needs a
 * schema change or a migration.
 */

import {
  SPINE_CRITERIA,
  type RubricCriterionSpec,
  type RubricHistoryEntry,
} from "../types";
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";

const CRITERIA_KEY = "rubric-criteria";
const HISTORY_KEY = "rubric-history";

/** How many passes we keep. Enough for a long project's trend line. */
const MAX_HISTORY = 50;

/** Guard rails on a custom criterion's weight. */
export const MIN_WEIGHT = 0.25;
export const MAX_WEIGHT = 3;

export function defaultCriteriaSpecs(): RubricCriterionSpec[] {
  return SPINE_CRITERIA.map((c) => ({
    ...c,
    source: "spine" as const,
    enabled: true,
    weight: 1,
  }));
}

export function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 1;
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, weight));
}

/**
 * Merge stored specs with the shipped spine.
 *
 * Written as a merge rather than a straight read because the spine is code and
 * the stored list is data: shipping a new built-in criterion must add it for
 * existing writers, and retiring one must drop it from their list, without
 * touching the weights and custom criteria they have set. A plain load would
 * freeze every writer's rubric at whatever version they first opened.
 */
export function reconcileSpecs(
  stored: RubricCriterionSpec[] | null,
): RubricCriterionSpec[] {
  if (!stored || stored.length === 0) return defaultCriteriaSpecs();

  const byId = new Map(stored.map((s) => [s.id, s]));

  const spine: RubricCriterionSpec[] = SPINE_CRITERIA.map((c) => {
    const saved = byId.get(c.id);
    return {
      ...c,
      source: "spine" as const,
      // Label and description always come from code, so wording improvements
      // reach writers who configured their rubric months ago.
      enabled: saved?.enabled ?? true,
      weight: clampWeight(saved?.weight ?? 1),
    };
  });

  const custom = stored
    .filter((s) => s.source === "custom" && s.label.trim())
    .map((s) => ({
      ...s,
      source: "custom" as const,
      weight: clampWeight(s.weight),
    }));

  return [...spine, ...custom];
}

export async function loadCriteriaSpecs(): Promise<RubricCriterionSpec[]> {
  const stored = await loadMetaFromIdb<RubricCriterionSpec[]>(CRITERIA_KEY);
  return reconcileSpecs(Array.isArray(stored) ? stored : null);
}

export async function saveCriteriaSpecs(
  specs: RubricCriterionSpec[],
): Promise<void> {
  await saveMetaToIdb(CRITERIA_KEY, specs);
}

/** The custom criteria that are switched on — the ones needing an LLM judge. */
export function activeCustomCriteria(
  specs: RubricCriterionSpec[],
): RubricCriterionSpec[] {
  return specs.filter((s) => s.source === "custom" && s.enabled);
}

export function newCustomCriterion(
  label: string,
  description: string,
): RubricCriterionSpec {
  return {
    id: `custom-${crypto.randomUUID()}`,
    label: label.trim(),
    description: description.trim(),
    source: "custom",
    enabled: true,
    weight: 1,
  };
}

/**
 * The writer's own weighted score, 0-100.
 *
 * Kept separate from the editorial grade rather than folded into it, for two
 * reasons. The grade is a fixed instrument — judges, harshest judge, gated
 * static features — and its meaning depends on not changing when a writer
 * moves a slider. And one built-in criterion ("Reader Engagement") is derived
 * *from* the combined grade, so feeding the criteria back into it would be
 * circular. So this is a second, plainly-labelled number: "by your weights".
 *
 * Returns null when the writer has not customised anything, since an
 * identical second score would be noise.
 */
export function weightedCriteriaScore(
  specs: RubricCriterionSpec[],
  scores: Record<string, number>,
): number | null {
  const customised =
    specs.some((s) => s.source === "custom" && s.enabled) ||
    specs.some((s) => s.source === "spine" && (!s.enabled || s.weight !== 1));
  if (!customised) return null;

  // "engagement" is derived from the combined grade; including it here would
  // make this score partly a function of the very thing it stands apart from.
  const scored = specs.filter(
    (s) => s.enabled && s.id !== "engagement" && s.id in scores,
  );
  if (scored.length === 0) return null;

  const totalWeight = scored.reduce((sum, s) => sum + clampWeight(s.weight), 0);
  if (totalWeight <= 0) return null;
  const mean =
    scored.reduce((sum, s) => sum + scores[s.id] * clampWeight(s.weight), 0) /
    totalWeight;
  return Math.round(mean * 10);
}

/* ── The trend line ─────────────────────────────────────────────── */

export async function loadRubricHistory(): Promise<RubricHistoryEntry[]> {
  const stored = await loadMetaFromIdb<RubricHistoryEntry[]>(HISTORY_KEY);
  return Array.isArray(stored) ? stored : [];
}

export async function appendRubricHistory(
  entry: RubricHistoryEntry,
): Promise<RubricHistoryEntry[]> {
  const existing = await loadRubricHistory();
  const next = [...existing, entry].slice(-MAX_HISTORY);
  await saveMetaToIdb(HISTORY_KEY, next);
  return next;
}

/**
 * Points for a sparkline, normalised to a 0-1 range over the values present.
 *
 * Deliberately scaled to the observed range rather than to 0-100: a writer
 * working in the 55-70 band wants to see the shape of their movement, and a
 * fixed axis flattens that into a straight line. Returns an empty array for
 * fewer than two points, since a single dot is not a trend.
 */
export function sparklinePoints(
  history: RubricHistoryEntry[],
): Array<{ x: number; y: number; entry: RubricHistoryEntry }> {
  if (history.length < 2) return [];
  const scores = history.map((h) => h.overall);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min || 1;
  return history.map((entry, i) => ({
    x: i / (history.length - 1),
    y: (entry.overall - min) / span,
    entry,
  }));
}

/** Change since the previous pass, or null when there is nothing to compare. */
export function scoreDelta(history: RubricHistoryEntry[]): number | null {
  if (history.length < 2) return null;
  return (
    history[history.length - 1].overall - history[history.length - 2].overall
  );
}
