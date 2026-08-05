import { describe, expect, test } from "bun:test";
import {
  POSTHOG_DEFAULTS_VERSION,
  buildPostHogInitOptions,
} from "./posthog-config";

describe("PostHog browser configuration", () => {
  test("captures Qwik City history navigation when analytics are enabled", () => {
    const options = buildPostHogInitOptions({
      host: "https://us.i.posthog.com",
      capture: true,
      flagKeys: ["twyne-pricing"],
    });

    expect(POSTHOG_DEFAULTS_VERSION).toBe("2026-05-30");
    expect(options.capture_pageview).toBe("history_change");
    expect(options.autocapture).toBe(true);
    expect(options.capture_pageleave).toBe(true);
  });

  test("disables every capture surface while preserving feature flag access", () => {
    const options = buildPostHogInitOptions({
      host: "https://us.i.posthog.com",
      capture: false,
      flagKeys: ["twyne-local-ai"],
    });

    expect(options.capture_pageview).toBe(false);
    expect(options.capture_pageleave).toBe(false);
    expect(options.autocapture).toBe(false);
    expect(options.disable_session_recording).toBe(true);
    expect(options.opt_out_capturing_by_default).toBe(true);
    expect(options.flag_keys).toEqual(["twyne-local-ai"]);
  });
});
