/**
 * The galley slip: what one run of focused writing amounted to.
 *
 * The flow conductor opens a session when the page goes into flow and closes
 * it when flow ends, then announces the summary with `FLOW_SESSION_EVENT`.
 * The margin sets it as a small typed slip; the House keeps the recent ones.
 */

export const FLOW_SESSION_EVENT = "twyne:flow-session";

export type FlowSessionEnd =
  /** A long pause ended the run. */
  | "pause"
  /** The writer reached for the room (margin, masthead) or pressed Escape. */
  | "reached"
  /** The writer turned focus off by hand. */
  | "manual"
  /** No keys for a long while. */
  | "away"
  /** The editor closed or the folio changed mid-run. */
  | "closed";

export interface FlowSession {
  /** `${folioId}:${startedAt}` */
  id: string;
  folioId: string;
  /** When the page went into flow, ms since epoch. */
  startedAt: number;
  endedAt: number;
  /** Time spent in flow, ms. */
  flowMs: number;
  /** Net words set during the session (never negative). */
  words: number;
  /** Words a minute across the session. */
  wpm: number;
  /** Margin items that arrived, or were held back, while the page was quiet. */
  waited: number;
  /** Dossier amendments proposed during the session. */
  amendments: number;
  ended: FlowSessionEnd;
}

export interface SessionSummaryInput {
  folioId: string;
  startedAt: number;
  endedAt: number;
  startWords: number;
  endWords: number;
  waited: ReadonlySet<string>;
  amendments: ReadonlySet<string>;
  ended: FlowSessionEnd;
}

/** Net document growth, with a slip only for a minute in flow or 40 words. */
export function summarizeSession(
  input: SessionSummaryInput,
): FlowSession | null {
  const flowMs = Math.max(0, input.endedAt - input.startedAt);
  const words = Math.max(0, Math.round(input.endWords - input.startWords));
  if (flowMs < 60_000 && words < 40) return null;
  return {
    id: `${input.folioId}:${input.startedAt}`,
    folioId: input.folioId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    flowMs,
    words,
    wpm: flowMs > 0 ? Math.round((words * 60_000) / flowMs) : 0,
    waited: input.waited.size,
    amendments: input.amendments.size,
    ended: input.ended,
  };
}

/** Oldest first, distinct by id, without mutating the supplied history. */
export function appendSession(
  list: readonly FlowSession[],
  session: FlowSession,
  max = 30,
): FlowSession[] {
  const limit = Math.max(0, Math.floor(max));
  if (!limit) return [];
  const byId = new Map(list.map((entry) => [entry.id, entry]));
  byId.set(session.id, session);
  return [...byId.values()]
    .sort((a, b) => a.endedAt - b.endedAt || a.startedAt - b.startedAt)
    .slice(-limit)
    .map((entry) => ({ ...entry }));
}

/** Recent slips live on this device, under the existing IndexedDB meta store. */
export async function loadFlowSessions(): Promise<FlowSession[]> {
  const { loadMetaFromIdb } = await import("./idb");
  const stored = await loadMetaFromIdb<FlowSession[]>("flow-sessions");
  return Array.isArray(stored)
    ? stored.slice(-30).map((entry) => ({ ...entry }))
    : [];
}
