/**
 * Credit language shared by Scene Bench, its hosted actions, and Settings.
 *
 * Twyne does not cap how many pictures a writer makes. It warns: once,
 * plainly, that pictures spend credit quickly, and again whenever the wallet
 * is running low.
 */

/** Ceiling sent with each hosted picture; the gateway never charges more. */
export const SCENE_PICTURE_BUDGET_MICROS = 500_000;
/** Ceiling for the vision pass that compares a picture with its passage. */
export const SCENE_READING_BUDGET_MICROS = 50_000;
/** Below this the bench warns that credit is about to run out. */
export const LOW_CREDIT_MICROS = 1_000_000;

export const SCENE_CREDIT_WARNING =
  "Pictures cost far more than text. A few dozen can use up a month's included credit.";

export function formatCreditMicros(micros: number): string {
  const usd = Math.max(0, micros) / 1_000_000;
  return `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(0)}`;
}

/** The general low-balance warning, or null when there is room to spare. */
export function lowCreditWarning(availableMicros: number): string | null {
  if (availableMicros < SCENE_PICTURE_BUDGET_MICROS)
    return "Your credit has run out for this month. Add credit or use your own model to keep generating.";
  if (availableMicros < LOW_CREDIT_MICROS)
    return `Your credit is running low: ${formatCreditMicros(availableMicros)} left this month.`;
  return null;
}

/** What one picture plus its comparison can cost on Twyne's models. */
export function hostedSceneCostLabel(): string {
  return `Up to ${formatCreditMicros(
    SCENE_PICTURE_BUDGET_MICROS + SCENE_READING_BUDGET_MICROS,
  )} a picture from your credit`;
}

/**
 * Genie 4 interactive world pricing & guardrails.
 *
 * Genie 4 renders at 24fps (240 video tokens/frame + 48kHz stereo audio),
 * billed at ~$0.10/second ($6.00/minute). Every live session enforces a hard
 * duration cap and an idle auto-stop so closing a tab or stepping away never
 * leaves generation running.
 */
export const SCENE_WORLD_COST_PER_SECOND_MICROS = 100_000;
export const SCENE_WORLD_DEFAULT_MAX_SECONDS = 120;
export const SCENE_WORLD_MIN_MAX_SECONDS = 30;
export const SCENE_WORLD_MAX_MAX_SECONDS = 300;
export const SCENE_WORLD_DEFAULT_IDLE_SECONDS = 45;
export const SCENE_WORLD_MIN_IDLE_SECONDS = 15;
export const SCENE_WORLD_MAX_IDLE_SECONDS = 120;
export const SCENE_WORLD_MIN_CREDIT_MICROS = 1_000_000;

export const SCENE_WORLD_CREDIT_WARNING =
  "Interactive worlds stream live 24fps video and stereo audio at about $0.10/second (~$6/minute). Sessions stop automatically when idle or when you close the window.";

export function clampWorldMaxSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return SCENE_WORLD_DEFAULT_MAX_SECONDS;
  return Math.max(
    SCENE_WORLD_MIN_MAX_SECONDS,
    Math.min(SCENE_WORLD_MAX_MAX_SECONDS, Math.round(value)),
  );
}

export function clampWorldIdleSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return SCENE_WORLD_DEFAULT_IDLE_SECONDS;
  return Math.max(
    SCENE_WORLD_MIN_IDLE_SECONDS,
    Math.min(SCENE_WORLD_MAX_IDLE_SECONDS, Math.round(value)),
  );
}

export function estimateWorldSessionCostMicros(elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
  return Math.round(elapsedSeconds * SCENE_WORLD_COST_PER_SECOND_MICROS);
}

export function formatWorldDuration(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function hostedSceneWorldCostLabel(
  maxSeconds = SCENE_WORLD_DEFAULT_MAX_SECONDS,
): string {
  const capped = clampWorldMaxSeconds(maxSeconds);
  const ceiling = estimateWorldSessionCostMicros(capped);
  return `~$0.10/sec · auto-stops at ${formatWorldDuration(capped)} (up to ${formatCreditMicros(ceiling)})`;
}

export function worldLowCreditWarning(availableMicros: number): string | null {
  if (availableMicros < SCENE_WORLD_MIN_CREDIT_MICROS)
    return "You need at least $1.00 in available credit to enter a hosted Genie 4 world. Add credit, use your own Google Gemini key, or try the local preview.";
  if (availableMicros < SCENE_WORLD_MIN_CREDIT_MICROS * 3)
    return `Your credit is running low for live worlds: ${formatCreditMicros(availableMicros)} left this month.`;
  return null;
}
