import { describe, expect, mock, test } from "bun:test";

const captured: Array<{
  event: string;
  properties: Record<string, unknown>;
}> = [];

const surveyMilestones: string[] = [];

mock.module("./posthog-context", () => ({
  capturePostHogEvent: async (
    event: string,
    properties: Record<string, unknown>,
  ) => {
    captured.push({ event, properties });
  },
  maybeDisplayProgressSurvey: async (milestone: string) => {
    surveyMilestones.push(milestone);
  },
}));

const {
  buildProductEventPayload,
  captureProductEvent,
  countDraftWords,
  crossedDraftMilestones,
  usageExportRowCountBucket,
  wordCountBucket,
} = await import("./product-analytics");

describe("product analytics contract", () => {
  test("adds the analytics version to every captured event", async () => {
    captured.length = 0;

    await captureProductEvent("landing_cta_clicked", {
      location: "hero",
      destination: "onboarding",
    });
    await captureProductEvent("draft_exported", { format: "pdf" });

    expect(captured).toEqual([
      {
        event: "landing_cta_clicked",
        properties: {
          analytics_version: 2,
          location: "hero",
          destination: "onboarding",
        },
      },
      {
        event: "draft_exported",
        properties: { analytics_version: 2, format: "pdf" },
      },
    ]);
  });

  test("offers the progress survey only after a milestone event", async () => {
    surveyMilestones.length = 0;

    await captureProductEvent("landing_cta_clicked", {
      location: "hero",
      destination: "onboarding",
    });
    await captureProductEvent("draft_exported", { format: "pdf" });

    expect(surveyMilestones).toEqual(["draft_exported"]);
  });

  test("drops properties outside the event allowlist", () => {
    const payload = buildProductEventPayload("folio_opened", {
      source: "editor",
      folio_type: "draft",
      folio_id: "private-folio-id",
      folio_name: "Unannounced manuscript",
      content: "private draft",
    } as never);

    expect(payload).toEqual({
      analytics_version: 2,
      source: "editor",
      folio_type: "draft",
    });
    expect(JSON.stringify(payload)).not.toContain("private");
    expect(JSON.stringify(payload)).not.toContain("Unannounced");
  });

  test("allows only stable error codes, never raw error messages", () => {
    expect(
      buildProductEventPayload("sign_in_failed", {
        method: "passkey",
        flow: "signin",
        error_code: "AUTHENTICATION_FAILED",
      }),
    ).toEqual({
      analytics_version: 2,
      method: "passkey",
      flow: "signin",
      error_code: "AUTHENTICATION_FAILED",
    });

    const bypassed = buildProductEventPayload("editorial_action_failed", {
      action: "persona_feedback",
      source: "editor",
      error_code: "The private draft failed at https://example.test",
    } as never);
    expect(bypassed.error_code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(bypassed)).not.toContain("private draft");
    expect(JSON.stringify(bypassed)).not.toContain("example.test");
  });

  test("keeps auth events content-free while recording method and flow", () => {
    expect(
      buildProductEventPayload("sign_in_completed", {
        provider: "convex",
        method: "email_otp",
        flow: "signup",
        email: "private@example.test",
      } as never),
    ).toEqual({
      analytics_version: 2,
      provider: "convex",
      method: "email_otp",
      flow: "signup",
    });
  });

  test("keeps Desk events aggregate and content-free", () => {
    expect(
      buildProductEventPayload("desk_viewed", {
        signed_in: true,
        range: "30d",
        folio_id: "private-folio-id",
        title: "Unannounced manuscript",
        provider: "private-provider",
        cost: 42,
      } as never),
    ).toEqual({
      analytics_version: 2,
      signed_in: true,
      range: "30d",
    });
    expect(
      buildProductEventPayload("usage_exported", {
        format: "csv",
        row_count_bucket: "10_99",
        event_keys: ["private-event"],
      } as never),
    ).toEqual({
      analytics_version: 2,
      format: "csv",
      row_count_bucket: "10_99",
    });
  });

  test("buckets export size without reporting an exact row count", () => {
    expect(
      [-1, 1, 9, 10, 99, 100, 999, 1000].map(usageExportRowCountBucket),
    ).toEqual([
      "empty",
      "1_9",
      "1_9",
      "10_99",
      "10_99",
      "100_999",
      "100_999",
      "1000_plus",
    ]);
  });
});

describe("draft analytics helpers", () => {
  test("counts words in editor HTML without treating markup as prose", () => {
    expect(
      countDraftWords(
        "<h1>Opening</h1><p>One <strong>careful</strong>&nbsp;sentence &amp; another.</p><script>secret words</script>",
      ),
    ).toBe(5);
    expect(countDraftWords("   <p></p>  ")).toBe(0);
  });

  test("uses stable word-count buckets at every boundary", () => {
    expect([
      wordCountBucket(0),
      wordCountBucket(1),
      wordCountBucket(99),
      wordCountBucket(100),
      wordCountBucket(499),
      wordCountBucket(500),
      wordCountBucket(999),
      wordCountBucket(1000),
      wordCountBucket(2499),
      wordCountBucket(2500),
    ]).toEqual([
      "empty",
      "1_99",
      "1_99",
      "100_499",
      "100_499",
      "500_999",
      "500_999",
      "1000_2499",
      "1000_2499",
      "2500_plus",
    ]);
  });

  test("returns each milestone crossed in an upward transition", () => {
    expect(crossedDraftMilestones(0, 1)).toEqual(["first_edit"]);
    expect(crossedDraftMilestones(1, 500)).toEqual(["100_words", "500_words"]);
    expect(crossedDraftMilestones(999, 2500)).toEqual([
      "1000_words",
      "2500_words",
    ]);
    expect(crossedDraftMilestones(2500, 100)).toEqual([]);
    expect(crossedDraftMilestones(500, 500)).toEqual([]);
  });
});
