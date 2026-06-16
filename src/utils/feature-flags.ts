/**
 * Product feature flags.
 *
 * PostHog is the source of truth for runtime rollout. The `PUBLIC_FEATURE_*`
 * env vars remain as local/offline fallbacks for environments where PostHog is
 * not configured, but app code should consume `useFeatureFlags()` from
 * `posthog-context.tsx` or `getRuntimeFeatures()` in non-component utilities.
 */

function flag(value: unknown): boolean {
  return value === "true" || value === "1";
}

export interface FeatureFlags {
  /** Show the Creem pricing page + its nav links. */
  pricing: boolean;
  /**
   * Surface the desktop-only native LiteRT local model (Gemma 4 E4B). This
   * only gates the UI; actual availability also requires the Electrobun shell
   * to advertise a bundled local server.
   */
  localAi: boolean;
}

export const POSTHOG_FEATURE_FLAG_KEYS = {
  pricing: "twyne-pricing",
  localAi: "twyne-local-ai",
} as const;

export const FALLBACK_FEATURES: FeatureFlags = {
  pricing: flag(import.meta.env.PUBLIC_FEATURE_PRICING),
  localAi: flag(import.meta.env.PUBLIC_FEATURE_LOCAL_AI),
};

let runtimeFeatures: FeatureFlags = FALLBACK_FEATURES;

export function setRuntimeFeatures(features: FeatureFlags): void {
  runtimeFeatures = features;
}

export function getRuntimeFeatures(): FeatureFlags {
  return runtimeFeatures;
}

export type FeatureName = keyof FeatureFlags;
