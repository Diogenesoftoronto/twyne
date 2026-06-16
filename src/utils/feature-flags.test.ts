import { afterEach, describe, expect, test } from "bun:test";
import {
  FALLBACK_FEATURES,
  POSTHOG_FEATURE_FLAG_KEYS,
  getRuntimeFeatures,
  setRuntimeFeatures,
} from "./feature-flags";

afterEach(() => {
  setRuntimeFeatures(FALLBACK_FEATURES);
});

describe("feature flags", () => {
  test("uses stable PostHog flag keys", () => {
    expect(POSTHOG_FEATURE_FLAG_KEYS).toEqual({
      pricing: "twyne-pricing",
      localAi: "twyne-local-ai",
    });
  });

  test("stores runtime flags independently from fallback defaults", () => {
    setRuntimeFeatures({ pricing: true, localAi: false });

    expect(getRuntimeFeatures()).toEqual({
      pricing: true,
      localAi: false,
    });
  });
});
