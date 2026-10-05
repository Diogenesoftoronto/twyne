import { describe, expect, test } from "bun:test";
import {
  POSTHOG_DEFAULTS_VERSION,
  buildPostHogInitOptions,
  shouldLoadPostHog,
} from "./posthog-config";

describe("PostHog browser configuration", () => {
  test.each([
    [
      "desktop Firefox",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
    ],
    [
      "Android Firefox",
      "Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0",
    ],
    [
      "iOS Firefox",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15",
    ],
  ])("skips the SDK in %s", (_browser, userAgent) => {
    expect(shouldLoadPostHog(userAgent)).toBe(false);
  });

  test.each([
    [
      "Chrome",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    ],
    [
      "Edge",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
    ],
    [
      "Safari",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
    ],
    ["server rendering", ""],
  ])("preserves SDK access for %s", (_browser, userAgent) => {
    expect(shouldLoadPostHog(userAgent)).toBe(true);
  });

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
