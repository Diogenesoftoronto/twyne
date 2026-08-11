import { afterEach, describe, expect, test } from "bun:test";
import {
  FALLBACK_FEATURES,
  POSTHOG_FEATURE_FLAG_KEYS,
  flag,
  getRuntimeFeatures,
  setRuntimeFeatures,
} from "./feature-flags";

afterEach(() => {
  setRuntimeFeatures(FALLBACK_FEATURES);
});

describe("flag", () => {
  test("maps on/off spellings to booleans", () => {
    expect(flag("true")).toBe(true);
    expect(flag("1")).toBe(true);
    expect(flag("false")).toBe(false);
    expect(flag("0")).toBe(false);
    expect(flag("yes")).toBe(false);
    expect(flag("TRUE")).toBe(false);
  });

  test("rejects empty and non-string values", () => {
    expect(flag("")).toBe(false);
    expect(flag(undefined)).toBe(false);
    expect(flag(null)).toBe(false);
    expect(flag(true)).toBe(false);
    expect(flag(1)).toBe(false);
  });
});

describe("feature flags", () => {
  test("uses stable PostHog flag keys", () => {
    expect(POSTHOG_FEATURE_FLAG_KEYS).toEqual({
      pricing: "twyne-pricing",
      localAi: "twyne-local-ai",
    });
  });

  test("fallback features are booleans", () => {
    expect(typeof FALLBACK_FEATURES.pricing).toBe("boolean");
    expect(typeof FALLBACK_FEATURES.localAi).toBe("boolean");
  });

  test("stores runtime flags independently from fallback defaults", () => {
    setRuntimeFeatures({ pricing: true, localAi: false });

    expect(getRuntimeFeatures()).toEqual({
      pricing: true,
      localAi: false,
    });
  });
});
