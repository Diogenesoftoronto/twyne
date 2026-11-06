import { describe, expect, test } from "bun:test";
import type { AppError } from "../../types/application-errors";
import {
  copyStatusMessage,
  describeSpeechError,
  HOSTED_NARRATION_FAILURE,
} from "./speech-error-model";

const base: AppError = {
  code: "PROVIDER_ERROR",
  message: "The selected provider could not complete the request.",
  referenceId: "err_1",
  source: "provider",
  recovery: { action: "retry", canRetry: true },
};

describe("describeSpeechError", () => {
  test("keeps the full message and offers retry only when retryable", () => {
    const v = describeSpeechError(base);
    expect(v.message).toBe(base.message);
    expect(v.retry).toBe(true);
    expect(v.suggestVoiceChange).toBe(false);
    expect(v.recovery).toBeUndefined();
    const none = describeSpeechError({
      ...base,
      recovery: { action: "none", canRetry: false },
    });
    expect(none.retry).toBe(false);
  });

  test("routes sign-in and settings recoveries", () => {
    expect(
      describeSpeechError({
        ...base,
        code: "AUTHENTICATION_REQUIRED",
        recovery: { action: "sign-in", canRetry: false },
      }).recovery?.href,
    ).toBe("/editor?auth=1");
    expect(
      describeSpeechError({
        ...base,
        code: "CONFIGURATION_ERROR",
        recovery: { action: "check-configuration", canRetry: false },
      }).recovery?.href,
    ).toBe("/settings/");
  });

  test("rounds retry-after up and handles a missing error", () => {
    expect(
      describeSpeechError({
        ...base,
        recovery: { action: "retry-later", canRetry: true, retryAfterMs: 1200 },
      }).retryAfterSeconds,
    ).toBe(2);
    expect(describeSpeechError(null).message).toBe("Narration failed.");
  });

  test("explains download-required without implying an outage", () => {
    const v = describeSpeechError({
      ...base,
      code: "CONFIGURATION_ERROR",
      recovery: { action: "download-required", canRetry: false },
    });
    expect(v.title).toBe("Browser voice not downloaded");
    expect(v.message).toContain("Nothing is downloaded automatically");
    expect(v.recovery?.href).toBe("/settings/");
    expect(v.suggestVoiceChange).toBe(false);
  });

  test("permission denied does not invent a cause", () => {
    const v = describeSpeechError({
      ...base,
      code: "PERMISSION_DENIED",
      recovery: { action: "none", canRetry: false },
    });
    expect(v.title).toBe("Read aloud is unavailable");
    expect(v.title.toLowerCase()).not.toContain("plan");
  });

  test("download-required suppresses retry even if canRetry is set", () => {
    const v = describeSpeechError({
      ...base,
      code: "CONFIGURATION_ERROR",
      recovery: { action: "download-required", canRetry: true },
    });
    expect(v.retry).toBe(false);
    expect(v.primaryRecovery).toBe(true);
    expect(describeSpeechError(base).primaryRecovery).toBe(false);
  });

  test("copy status messages are visible text for failure and success", () => {
    expect(copyStatusMessage("idle")).toBe("");
    expect(copyStatusMessage("copied")).toContain("copied");
    expect(copyStatusMessage("failed")).toContain("Select the reference");
  });

  test("hosted convex provider failures use reviewed copy, not raw detail", () => {
    const raw =
      'HTTP 500 {"error":"upstream","api_key":"sk-secret-123","trace":"at gateway.ts:42"}';
    const v = describeSpeechError({
      ...base,
      source: "convex",
      message: raw,
      referenceId: "err_hosted",
    });
    expect(v.message).toBe(HOSTED_NARRATION_FAILURE);
    expect(JSON.stringify(v)).not.toContain("sk-secret-123");
    expect(v.retry).toBe(true);
    expect(v.recovery).toBeUndefined();
  });

  test("other providers' classified messages are unchanged", () => {
    const v = describeSpeechError({ ...base, source: "provider" });
    expect(v.message).toBe(base.message);
  });
});
