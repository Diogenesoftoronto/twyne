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
