/** Shared pause-driven Clairic rate limit, parallel to the Jev budget. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 4;
const BACKOFF_MS = 30_000;
export const MAX_RHYTHM_CALLS_PER_SESSION = 12;
const calls: number[] = [];
let backoffUntil = 0;
let sessionCalls = 0;

export function extractionWait(now = Date.now()): number {
  while (calls.length && calls[0] <= now - WINDOW_MS) calls.shift();
  if (sessionCalls >= MAX_RHYTHM_CALLS_PER_SESSION) return Infinity;
  return Math.max(
    backoffUntil - now,
    calls.length >= MAX_PER_WINDOW ? calls[0] + WINDOW_MS - now : 0,
    0,
  );
}
export function spendExtraction(now = Date.now()): void {
  calls.push(now);
  sessionCalls++;
}
export function backOffExtraction(now = Date.now()): void {
  backoffUntil = now + BACKOFF_MS;
}
/** Back-off only, without the rhythm per-session cap, for other Clairic callers. */
export function extractionBackedOff(now = Date.now()): boolean {
  return backoffUntil > now;
}
export function __resetExtractionBudgetForTests(): void {
  calls.length = 0;
  backoffUntil = 0;
  sessionCalls = 0;
}
