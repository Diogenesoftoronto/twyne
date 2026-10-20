/** Fire-and-forget pause estimates. All persisted state is rhythm only. */
import type { FlowProfile } from "./flow-profile";
import type { KeySample } from "./flow-state";
import {
  estimate,
  interval,
  type ExtractionRequest,
  type ExtractionResult,
} from "./extraction";
import {
  backOffExtraction,
  extractionWait,
  MAX_RHYTHM_CALLS_PER_SESSION,
  spendExtraction,
} from "./extraction-budget";
import {
  appendPrediction,
  resolvePause,
  resolveRun,
  trustClairic,
  type RhythmPrediction,
} from "./flow-predictions";
import {
  pauseDecision,
  predictedBreak,
  rhythmBaseline,
  rhythmCounts,
  validInterval,
  type RhythmEstimate,
} from "./flow-rhythm";

export const RHYTHM_BREAK_EVENT = "twyne:rhythm-break";
export const ESTIMATE_TIMEOUT_MS = 1_500;
export interface RhythmBreak {
  folioId: string;
  at: number;
  lastKeyAt: number;
  pause: RhythmEstimate["pause"];
  pauseSeconds: number;
}
interface PauseInput {
  now: number;
  lastKeyAt: number;
  runStartedAt: number;
  runSeconds: number;
  deleteRatio: number;
  exitPauseMs: number;
  samples: readonly KeySample[];
  profile: FlowProfile;
  ask?: (request: ExtractionRequest) => Promise<ExtractionResult>;
  current?: () => boolean;
}

export function rhythmRequest(
  input: PauseInput,
  baseline: RhythmEstimate,
): ExtractionRequest {
  const seconds = (values: number[]) =>
    values
      .slice(-24)
      .map((ms) => Math.round(ms / 1000))
      .join(",");
  return {
    state: [
      `run_seconds_csv=${seconds(input.profile.runs)}`,
      `pause_seconds_csv=${seconds(input.profile.pauses)}`,
      `current_run_seconds=${input.runSeconds}`,
      `focus_bout_seconds=${(input.lastKeyAt - input.runStartedAt) / 1000}`,
      `seconds_since_last_key=${(input.now - input.lastKeyAt) / 1000}`,
      `key_events_per_10_seconds_oldest_first=${rhythmCounts(input.samples, input.now).join(",")}`,
      `delete_ratio=${input.deleteRatio}`,
      `reference_exit_pause_seconds=${input.exitPauseMs / 1000}`,
      `local_hour=${new Date(input.now).getHours()}`,
      `empirical_remaining_seconds=${JSON.stringify(baseline)}`,
    ].join("\n"),
    fields: {
      focus_remaining: estimate(
        "Seconds from now to the last keystroke of this rhythmic focus bout. The reference bout ends when a pause reaches the writer's exit pause, regardless of UI decisions. Shorter gaps can resume. Cadence-run history is an empirical baseline, not cognitive focus evidence.",
        { min: 1, max: 3600, unit: "seconds", log: true, step: 1 },
      ),
      pause_length: estimate(
        "Remaining seconds from now until the next keystroke, conditional on the pause already observed. Compare the empirical remaining-pause interval.",
        { min: 1, max: 600, unit: "seconds", log: true, step: 1 },
      ),
    },
  };
}

export class FlowRhythmEstimator {
  log: RhythmPrediction[] = [];
  private pause: RhythmPrediction | null = null;
  private model: RhythmPrediction | null = null;
  private serial = 0;
  private calls = 0;
  private attemptedPauses = new Set<number>();
  private unavailable = false;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private current: (() => boolean) | undefined;
  constructor(private changed: () => void = () => {}) {}

  begin(input: PauseInput): void {
    if (this.pause?.lastKeyAt === input.lastKeyAt) return;
    this.invalidate();
    const token = this.serial;
    this.current = input.current;
    const baseline = rhythmBaseline(
      input.profile,
      input.runSeconds,
      (input.now - input.lastKeyAt) / 1000,
    );
    this.pause = {
      id: `${input.runStartedAt}:${input.lastKeyAt}`,
      source: "baseline",
      at: input.now,
      lastKeyAt: input.lastKeyAt,
      runStartedAt: input.runStartedAt,
      runSeconds: input.runSeconds,
      pauseSeconds: (input.now - input.lastKeyAt) / 1000,
      estimate: baseline,
    };
    this.log = appendPrediction(this.log, this.pause);
    this.changed();
    if (
      !baseline.focus ||
      !baseline.pause ||
      !input.ask ||
      this.unavailable ||
      this.calls >= MAX_RHYTHM_CALLS_PER_SESSION ||
      this.attemptedPauses.has(input.lastKeyAt) ||
      extractionWait(input.now)
    )
      return;
    this.calls++;
    this.attemptedPauses.add(input.lastKeyAt);
    spendExtraction(input.now);
    const prediction = this.pause;
    let expired = false;
    this.timeout = setTimeout(() => {
      expired = true;
      backOffExtraction();
    }, ESTIMATE_TIMEOUT_MS);
    const fresh = () =>
      !expired &&
      token === this.serial &&
      this.pause === prediction &&
      Date.now() >= input.now &&
      Date.now() - input.now <= ESTIMATE_TIMEOUT_MS &&
      (input.current?.() ?? true);
    void Promise.resolve()
      .then(() => input.ask!(rhythmRequest(input, baseline)))
      .then((result) => {
        if (!result.ok || result.truncated) {
          if (
            fresh() &&
            (result.error === "unconfigured" || result.error === "signed out")
          )
            this.unavailable = true;
          backOffExtraction();
          return;
        }
        if (!fresh()) return;
        const focusAnswer = result.answers?.focus_remaining;
        const pauseAnswer = result.answers?.pause_length;
        const focus = interval(focusAnswer);
        const pause = interval(pauseAnswer);
        if (
          focusAnswer?.type !== "estimate" ||
          pauseAnswer?.type !== "estimate" ||
          typeof focusAnswer.value !== "number" ||
          typeof pauseAnswer.value !== "number" ||
          !Number.isFinite(focusAnswer.value) ||
          !Number.isFinite(pauseAnswer.value) ||
          (focusAnswer.p_null ?? 0) > 0.5 ||
          (pauseAnswer.p_null ?? 0) > 0.5 ||
          !validInterval(focus) ||
          !validInterval(pause) ||
          focus.p10 < 1 ||
          focus.p90 > 3600 ||
          pause.p10 < 1 ||
          pause.p90 > 600
        ) {
          backOffExtraction();
          return;
        }
        // Both sources forecast from the same instant, for a paired comparison.
        this.model = {
          ...prediction,
          source: "clairic",
          estimate: { focus, pause },
        };
        this.log = appendPrediction(this.log, this.model);
        this.changed();
      })
      .catch(() => {
        backOffExtraction();
      })
      .finally(() => {
        if (token === this.serial) clearTimeout(this.timeout);
      });
  }

  selected(): RhythmPrediction | null {
    return this.model && (this.current?.() ?? true) && trustClairic(this.log)
      ? this.model
      : this.pause;
  }
  decision(now: number, exitPauseMs: number) {
    const p = this.selected();
    return p
      ? pauseDecision(p.estimate, exitPauseMs, Math.max(0, (now - p.at) / 1000))
      : "timer";
  }
  breakPrediction(folioId: string): RhythmBreak | null {
    const p = this.selected();
    return p && predictedBreak(p.estimate.pause, p.pauseSeconds)
      ? {
          folioId,
          at: p.at,
          lastKeyAt: p.lastKeyAt,
          pause: p.estimate.pause,
          pauseSeconds: p.pauseSeconds,
        }
      : null;
  }
  finishRun(runStartedAt: number, lastKeyAt: number): void {
    this.log = resolveRun(this.log, runStartedAt, lastKeyAt);
    // A model response may still arrive for this pause; resolve it too.
    if (this.pause?.runStartedAt === runStartedAt)
      this.pause.actualFocus = Math.max(0, (lastKeyAt - this.pause.at) / 1000);
    this.changed();
  }
  key(lastKeyAt: number, now: number): void {
    this.log = resolvePause(this.log, lastKeyAt, now);
    this.invalidate();
    this.changed();
  }
  invalidate(): void {
    this.serial++;
    clearTimeout(this.timeout);
    this.pause = this.model = null;
    this.current = undefined;
  }
}
