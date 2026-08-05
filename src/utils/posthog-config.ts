import type { PostHogConfig } from "posthog-js";

/**
 * Keep this aligned with the current PostHog recommended defaults. The
 * explicit history setting below is intentional: a future defaults change
 * must never silently turn Qwik City navigation back into load-only tracking.
 */
export const POSTHOG_DEFAULTS_VERSION = "2026-05-30";

interface PostHogInitOptions {
  host: string;
  capture: boolean;
  flagKeys: string[];
}

export function buildPostHogInitOptions({
  host,
  capture,
  flagKeys,
}: PostHogInitOptions): Partial<PostHogConfig> {
  return {
    api_host: host,
    defaults: POSTHOG_DEFAULTS_VERSION,
    autocapture: capture,
    capture_pageview: capture ? "history_change" : false,
    capture_pageleave: capture,
    disable_session_recording: !capture,
    opt_out_capturing_by_default: !capture,
    ...(capture ? { surveys: {} } : {}),
    flag_keys: flagKeys,
  };
}
