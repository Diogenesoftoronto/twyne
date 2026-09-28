/**
 * One request budget for every System One caller that runs on a typing pause.
 *
 * Quick review and the in-flow tools both fire on pauses in the same editor.
 * Separate limits would let the pair spend twice the rate either was sized
 * for; one shared window keeps them honest with each other.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const BACKOFF_MS = 30_000;

const calls: number[] = [];
let backoffUntil = 0;

/** Milliseconds to wait before a call is allowed; 0 means go now. */
export function systemOneWait(now = Date.now()): number {
  while (calls.length && calls[0] <= now - WINDOW_MS) calls.shift();
  return Math.max(
    backoffUntil - now,
    calls.length >= MAX_PER_WINDOW ? calls[0] + WINDOW_MS - now : 0,
    0,
  );
}

/** Record a call that is about to be made. */
export function spendSystemOne(now = Date.now()): void {
  calls.push(now);
}

/** A failed call quiets every pause-driven caller for a while. */
export function backOffSystemOne(now = Date.now()): void {
  backoffUntil = now + BACKOFF_MS;
}

export function __resetSystemOneBudgetForTests(): void {
  calls.length = 0;
  backoffUntil = 0;
}
