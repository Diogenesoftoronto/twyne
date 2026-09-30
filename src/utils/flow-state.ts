/**
 * Reading flow from the rhythm of the keys.
 *
 * Nothing here looks at the words — only at when they arrive and how many are
 * taken back. Five readings:
 *
 *   away      no keys for minutes; nothing should change around the page
 *   working   ordinary writing: pauses, rereads, small cuts
 *   settling  a steady run has begun; the chrome starts to dim
 *   flow      the run has held; the room goes quiet and the page stands alone
 *   stuck     a long pause after cutting and circling — help may land now
 *
 * The readings are sticky on purpose. Entering flow takes a sustained run;
 * leaving it takes a real pause (or the writer reaching for the room), never
 * a single deletion or a glance away. A rewrite inside flow is still flow.
 *
 * Thresholds are not constants: `thresholdsFor` in `flow-profile.ts` derives
 * them from how this writer actually pauses. Pure — `now` is passed in.
 */

export type FlowMode = "away" | "working" | "settling" | "flow" | "stuck";

export interface KeySample {
  at: number;
  inserted: number;
  deleted: number;
}

export interface FlowThresholds {
  /** Longest gap between keys that still counts as one run. */
  gapMs: number;
  /** Run length before the chrome starts to dim. */
  settleMs: number;
  /** Run length before the page goes quiet. */
  flowMs: number;
  /** A pause this long, after churn, reads as stuck. */
  stuckPauseMs: number;
  /** A pause this long ends flow. */
  exitPauseMs: number;
  /** No keys for this long reads as away. */
  awayMs: number;
  /** Share of characters taken back that still counts as steady. */
  maxDeleteRatio: number;
  /** Share of the run's seconds that carried a key. */
  minActiveRatio: number;
}

export const DEFAULT_THRESHOLDS: FlowThresholds = {
  gapMs: 4_000,
  settleMs: 30_000,
  flowMs: 90_000,
  stuckPauseMs: 18_000,
  exitPauseMs: 25_000,
  awayMs: 180_000,
  maxDeleteRatio: 0.3,
  minActiveRatio: 0.45,
};

export interface FlowContext {
  /** 0..1 from `readStruggle` for the paragraph under the cursor. */
  struggle?: number;
  /** The writer has held the pointer over the room (margins, masthead). */
  reaching?: boolean;
}

export interface FlowReading {
  mode: FlowMode;
  /** Length of the current (or last) run, ms. */
  runMs: number;
  /** Time since the last key, ms. */
  pauseMs: number;
  activeRatio: number;
  deleteRatio: number;
  /** Words a minute across the run, at five characters a word. */
  wpm: number;
  /** Deletions over the last minute of writing, as a share of all edits. */
  recentChurn: number;
  reason: string;
}

/** Keep only what `readFlow` can use; call on every sample. */
export function trimSamples(
  samples: KeySample[],
  now: number,
  keepMs = 10 * 60_000,
): KeySample[] {
  const cutoff = now - keepMs;
  let start = 0;
  while (start < samples.length && samples[start].at < cutoff) start++;
  return start ? samples.slice(start) : samples;
}

export function readFlow(
  samples: readonly KeySample[],
  now: number,
  previous: FlowMode,
  t: FlowThresholds = DEFAULT_THRESHOLDS,
  context: FlowContext = {},
): FlowReading {
  const last = samples[samples.length - 1];
  if (!last)
    return reading("working", 0, Infinity, 0, 0, 0, 0, "No writing yet.");
  const pauseMs = Math.max(0, now - last.at);

  // The current run: walk back while the gaps stay short.
  let first = samples.length - 1;
  while (first > 0 && samples[first].at - samples[first - 1].at <= t.gapMs)
    first--;
  const run = samples.slice(first);
  const runMs = last.at - run[0].at;
  let inserted = 0;
  let deleted = 0;
  const seconds = new Set<number>();
  for (const s of run) {
    inserted += s.inserted;
    deleted += s.deleted;
    seconds.add(Math.floor(s.at / 1000));
  }
  const deleteRatio = deleted / Math.max(1, inserted + deleted);
  const activeRatio =
    runMs < 1000 ? 1 : Math.min(1, seconds.size / Math.ceil(runMs / 1000));
  const wpm = runMs > 0 ? (inserted / 5) * (60_000 / runMs) : 0;

  let recentIn = 0;
  let recentOut = 0;
  for (
    let i = samples.length - 1;
    i >= 0 && last.at - samples[i].at <= 60_000;
    i--
  ) {
    recentIn += samples[i].inserted;
    recentOut += samples[i].deleted;
  }
  const recentChurn = recentOut / Math.max(1, recentIn + recentOut);
  const steady =
    deleteRatio <= t.maxDeleteRatio && activeRatio >= t.minActiveRatio;
  const at = (mode: FlowMode, reason: string) =>
    reading(
      mode,
      runMs,
      pauseMs,
      activeRatio,
      deleteRatio,
      wpm,
      recentChurn,
      reason,
    );

  if (pauseMs >= t.awayMs) return at("away", "No keys for a while.");

  if (context.reaching) return at("working", "Reached for the room.");

  if (previous === "flow") {
    if (pauseMs >= t.exitPauseMs)
      return at("working", "A long pause ended the run.");
    return at("flow", "Still in the run.");
  }

  const circling = recentChurn >= 0.4 || (context.struggle ?? 0) >= 0.5;
  if (pauseMs >= t.stuckPauseMs && circling)
    return at("stuck", "A long pause after cutting and circling.");
  if (previous === "stuck" && pauseMs >= t.gapMs)
    return at("stuck", "Still paused.");

  if (pauseMs <= t.gapMs && steady) {
    if (runMs >= t.flowMs) return at("flow", "A steady run held.");
    if (runMs >= t.settleMs) return at("settling", "A steady run is building.");
  }
  if (previous === "settling" && pauseMs <= t.gapMs && runMs >= t.settleMs)
    return at("settling", "The run continues.");
  return at("working", steady ? "Writing." : "Revising.");
}

function reading(
  mode: FlowMode,
  runMs: number,
  pauseMs: number,
  activeRatio: number,
  deleteRatio: number,
  wpm: number,
  recentChurn: number,
  reason: string,
): FlowReading {
  return {
    mode,
    runMs,
    pauseMs,
    activeRatio,
    deleteRatio,
    wpm,
    recentChurn,
    reason,
  };
}

/** The quiet modes: nothing new may appear around the page. */
export function isQuiet(mode: FlowMode): boolean {
  return mode === "flow" || mode === "settling";
}
