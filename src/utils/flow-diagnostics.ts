/**
 * A plain log of what the conductor decided and why — for developers tuning
 * the plumbing, and for writers who want to see what Twyne is reading.
 *
 * Only decisions and numbers: mode changes with their signals, Jev calls
 * with their questions, answers and latency, and which items surfaced or
 * waited. No manuscript text beyond the short previews Jev was handed.
 *
 * Kept in memory for the live view and mirrored to IndexedDB (throttled) so
 * the /house diagnostics tab can read the last session after a navigation.
 */
import { loadMetaFromIdb, saveMetaToIdb, toStorable } from "./idb";

export const FLOW_DIAGNOSTICS_EVENT = "twyne:flow-diagnostics";
const META_KEY = "flow-diagnostics";
const MAX_ENTRIES = 300;

export type DiagnosticKind =
  | "mode"
  | "jev"
  | "surface"
  | "item"
  | "focus"
  | "context"
  | "error";

export interface DiagnosticEntry {
  id: number;
  at: number;
  kind: DiagnosticKind;
  summary: string;
  detail?: Record<string, unknown>;
}

let entries: DiagnosticEntry[] = [];
let counter = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function logFlow(
  kind: DiagnosticKind,
  summary: string,
  detail?: Record<string, unknown>,
): void {
  const entry: DiagnosticEntry = {
    id: ++counter,
    at: Date.now(),
    kind,
    summary,
    ...(detail ? { detail } : {}),
  };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DiagnosticEntry>(FLOW_DIAGNOSTICS_EVENT, { detail: entry }),
  );
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveMetaToIdb(META_KEY, toStorable(entries));
  }, 2_000);
}

export function flowDiagnostics(): DiagnosticEntry[] {
  return entries;
}

/** The live log, or the last persisted one when this tab has none yet. */
export async function loadFlowDiagnostics(): Promise<DiagnosticEntry[]> {
  if (entries.length) return entries;
  const stored = await loadMetaFromIdb<DiagnosticEntry[]>(META_KEY);
  return Array.isArray(stored) ? stored : [];
}

export async function clearFlowDiagnostics(): Promise<void> {
  entries = [];
  await saveMetaToIdb(META_KEY, []);
}
