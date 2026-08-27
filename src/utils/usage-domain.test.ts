import { describe, expect, test } from "bun:test";
import {
  USAGE_LIMITS,
  USAGE_AI_FEATURES,
  assertEditorialActionEvidence,
  createUsageEventKey,
  createUsageRange,
  createWritingActivityKey,
  isUtcDay,
  isUsageAiFeature,
  isUsageEvent,
  isWritingActivityDetail,
  nextUtcDay,
  normalizeUsageAiFeature,
  parseEditorialActionEvidence,
  parseUsageEvent,
  timestampInRange,
  utcDayFromTimestamp,
  utcDayStart,
  type UsageEvent,
} from "./usage-domain";

const occurredAt = Date.parse("2026-08-26T12:00:00.000Z");

function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    eventKey: "usage:v1:event-1",
    occurredAt,
    day: "2026-08-26",
    source: "byok",
    authority: "client_reported",
    feature: "persona-feedback",
    provider: "openai",
    model: "gpt-5.5",
    traceId: "trace-1",
    attempt: 1,
    outcome: "completed",
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    costKind: "estimated",
    costMicrousd: 200,
    pricingVersion: "2026-08-26",
    pricing: {
      source: "official-provider-docs",
      version: "2026-08-26",
      currency: "USD",
      inputMicrousdPerMillion: 5_000_000,
      outputMicrousdPerMillion: 30_000_000,
    },
    ...overrides,
  };
}

describe("usage domain validation", () => {
  test("keeps feature breakdown cardinality on the fixed launch vocabulary", () => {
    expect(USAGE_AI_FEATURES).toContain("dossier-check");
    expect(USAGE_AI_FEATURES).toContain("voice-narration");
    expect(isUsageAiFeature("rubric-review")).toBe(true);
    expect(isUsageAiFeature("attacker-controlled-feature")).toBe(false);
    expect(normalizeUsageAiFeature("future-feature")).toBe("other");
    expect(
      isUsageEvent({
        ...event(),
        feature: "attacker-controlled-feature",
      }),
    ).toBe(false);
  });

  test("accepts a content-free event and rejects unknown content fields", () => {
    expect(isUsageEvent(event())).toBe(true);
    const poisoned = { ...event(), prompt: "private draft" };
    const result = parseUsageEvent(poisoned);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues).toContainEqual({
        path: "event.prompt",
        message: "field is not allowed",
      });
  });

  test("rejects invalid numbers, mismatched days, and unknown-to-zero cost", () => {
    expect(isUsageEvent(event({ inputTokens: Number.NaN }))).toBe(false);
    expect(isUsageEvent(event({ inputTokens: -1 }))).toBe(false);
    expect(isUsageEvent(event({ day: "2026-08-25" }))).toBe(false);
    expect(
      isUsageEvent(
        event({
          costKind: "unknown",
          costMicrousd: 0,
          pricingVersion: undefined,
        }),
      ),
    ).toBe(false);
  });

  test("prevents client-reported rows from claiming financial authority", () => {
    expect(
      isUsageEvent(event({ costKind: "actual", pricingVersion: undefined })),
    ).toBe(false);
    expect(isUsageEvent(event({ creditMicrounits: 42 }))).toBe(false);
  });

  test("requires local events to remain non-billing records", () => {
    expect(
      isUsageEvent(
        event({
          source: "local",
          costKind: "local",
          costMicrousd: undefined,
          pricingVersion: undefined,
          pricing: undefined,
        }),
      ),
    ).toBe(true);
    expect(isUsageEvent(event({ source: "local" }))).toBe(false);
  });

  test("requires the exact rate snapshot behind an estimate", () => {
    expect(isUsageEvent(event({ pricing: undefined }))).toBe(false);
    expect(
      isUsageEvent(
        event({
          pricing: {
            source: "official-provider-docs",
            version: "different-version",
            currency: "USD",
            inputMicrousdPerMillion: 5_000_000,
            outputMicrousdPerMillion: 30_000_000,
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("stable attempt and activity keys", () => {
  test("prefers provider request ids and namespaces them by provider", () => {
    const first = createUsageEventKey({
      providerRequestId: "request:42",
      traceId: "ignored-a",
      attempt: 1,
      provider: "openai",
      model: "gpt-5.5",
    });
    const repeated = createUsageEventKey({
      providerRequestId: "request:42",
      traceId: "ignored-b",
      attempt: 2,
      provider: "openai",
      model: "gpt-5.5",
    });
    expect(first).toBe(repeated);
    expect(first).not.toBe(
      createUsageEventKey({
        providerRequestId: "request:42",
        traceId: "ignored-a",
        attempt: 1,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      }),
    );
  });

  test("distinguishes real retry attempts when no provider id exists", () => {
    const base = {
      traceId: "trace:with:colons",
      provider: "openai",
      model: "gpt-5.5",
    };
    expect(createUsageEventKey({ ...base, attempt: 1 })).not.toBe(
      createUsageEventKey({ ...base, attempt: 2 }),
    );
    expect(createUsageEventKey({ ...base, attempt: 1 })).toBe(
      createUsageEventKey({ ...base, attempt: 1 }),
    );
  });

  test("keeps maximum bounded parts inside the event-key write limit", () => {
    const key = createUsageEventKey({
      traceId: "t".repeat(USAGE_LIMITS.traceId),
      attempt: USAGE_LIMITS.attempt,
      provider: "p".repeat(USAGE_LIMITS.provider),
      model: "m".repeat(USAGE_LIMITS.model),
    });
    expect(key.length).toBeLessThanOrEqual(USAGE_LIMITS.eventKey);
  });

  test("creates collision-resistant day and opaque-folio keys", () => {
    expect(createWritingActivityKey("2026-08-26", "folio:1")).not.toBe(
      createWritingActivityKey("2026-08-26", "folio"),
    );
  });
});

describe("UTC range semantics", () => {
  test("validates real days and handles leap boundaries", () => {
    expect(isUtcDay("2024-02-29")).toBe(true);
    expect(isUtcDay("2026-02-29")).toBe(false);
    expect(nextUtcDay("2024-02-29")).toBe("2024-03-01");
    expect(utcDayFromTimestamp(occurredAt)).toBe("2026-08-26");
    expect(utcDayStart("2026-08-26")).toBe(
      Date.parse("2026-08-26T00:00:00.000Z"),
    );
  });

  test("uses inclusive from and exclusive through-today boundaries", () => {
    const range = createUsageRange("7d", occurredAt);
    expect(range).toEqual({
      preset: "7d",
      from: Date.parse("2026-08-20T00:00:00.000Z"),
      to: Date.parse("2026-08-27T00:00:00.000Z"),
    });
    expect(timestampInRange(range.from!, range)).toBe(true);
    expect(timestampInRange(range.to - 1, range)).toBe(true);
    expect(timestampInRange(range.to, range)).toBe(false);
    expect(createUsageRange("all", occurredAt).from).toBeNull();
    expect(createUsageRange("90d", 0).from).toBe(0);
  });
});

describe("writing activity detail", () => {
  test("accepts bounded content-free rows and rejects cross-day ranges", () => {
    const valid = {
      activityKey: createWritingActivityKey("2026-08-26", "folio-1"),
      day: "2026-08-26",
      folioId: "folio-1",
      count: 3,
      firstOccurredAt: Date.parse("2026-08-26T01:00:00.000Z"),
      lastOccurredAt: Date.parse("2026-08-26T23:00:00.000Z"),
    };
    expect(isWritingActivityDetail(valid)).toBe(true);
    expect(
      isWritingActivityDetail({
        ...valid,
        lastOccurredAt: Date.parse("2026-08-27T00:00:00.000Z"),
      }),
    ).toBe(false);
    expect(
      isWritingActivityDetail({ ...valid, activityKey: "wrong-key" }),
    ).toBe(false);
    expect(isWritingActivityDetail({ ...valid, title: "Secret title" })).toBe(
      false,
    );
  });
});

describe("editorial action evidence", () => {
  test("accepts bounded content-free pattern metadata", () => {
    const action = {
      actionId: "action-1",
      occurredAt,
      feature: "persona-rewrite",
      outcome: "completed",
      folioId: "folio-1",
      editorId: "editor-1",
      sessionId: "session-1",
      turnCount: 3,
      revision: true,
    } as const;
    expect(parseEditorialActionEvidence(action)).toEqual({
      ok: true,
      value: action,
    });
    expect(() => assertEditorialActionEvidence(action)).not.toThrow();
  });

  test("rejects content and invalid evidence counts", () => {
    expect(
      parseEditorialActionEvidence({
        actionId: "action-1",
        occurredAt,
        feature: "persona-rewrite",
        outcome: "completed",
        turnCount: 0,
        title: "private title",
      }).ok,
    ).toBe(false);
  });
});
