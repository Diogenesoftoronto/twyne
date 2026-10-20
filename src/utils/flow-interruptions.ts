import { quantile } from "./flow-profile";
import { skipFragileKind } from "./flow-rhythm";
import type { FlowMode } from "./flow-state";

export const INTERRUPTION_KEY = "flow-interruption-costs";
const MAX_KINDS = 16;
const MAX_SAMPLES = 60;
const MAX_RECOVERY_SECONDS = 600;
export type InterruptionHistory = Record<string, number[]>;

export function normalizeInterruptions(value: unknown): InterruptionHistory {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_KINDS)
      .filter(([, values]) => Array.isArray(values))
      .map(([kind, values]) => [
        kind,
        (values as unknown[])
          .filter(
            (v): v is number =>
              typeof v === "number" &&
              Number.isFinite(v) &&
              v >= 0 &&
              v <= MAX_RECOVERY_SECONDS,
          )
          .slice(-MAX_SAMPLES),
      ]),
  );
}

/** Measured latency to steady keys, not a claim that the card caused it. */
export class FlowInterruptions {
  history: InterruptionHistory = {};
  private pending = new Map<string, number>();
  shown(kind: string, now: number): void {
    if (!this.pending.has(kind) && this.pending.size < MAX_KINDS)
      this.pending.set(kind, now);
  }
  steady(now: number, steadyMs = 0): boolean {
    let changed = false;
    for (const [kind, at] of this.pending) {
      if (now - at < steadyMs) continue;
      this.pending.delete(kind);
      const seconds = (now - at) / 1000;
      if (seconds >= 0 && seconds <= MAX_RECOVERY_SECONDS) {
        this.history = {
          ...this.history,
          [kind]: [...(this.history[kind] ?? []), seconds].slice(-MAX_SAMPLES),
        };
        changed = true;
      }
    }
    return changed;
  }
  interruptionCostSeconds(kind: string): number | null {
    const samples = this.history[kind] ?? [];
    return samples.length >= 5 ? quantile(samples, 0.5) : null;
  }
  skip(kind: string, mode: FlowMode, weight: number): boolean {
    return skipFragileKind(mode, weight, this.interruptionCostSeconds(kind));
  }
}
