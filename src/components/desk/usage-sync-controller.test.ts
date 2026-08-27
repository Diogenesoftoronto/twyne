import { describe, expect, mock, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import type { UsageEvent } from "../../utils/usage-domain";
import { createConvexUsageUploader } from "./usage-sync-controller";

function event(eventKey: string): UsageEvent {
  return {
    eventKey,
    occurredAt: 1_787_683_200_000,
    day: "2026-08-26",
    source: "byok",
    authority: "client_reported",
    feature: "persona-feedback",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    traceId: `trace:${eventKey}`,
    attempt: 1,
    outcome: "completed",
    costKind: "unknown",
  };
}

describe("usage sync controller adapter", () => {
  test("acknowledges every offered key only after the atomic mutation resolves", async () => {
    const mutation = mock(async (...args: unknown[]) => {
      void args;
      return { accepted: 1, duplicates: 1 };
    });
    const uploader = createConvexUsageUploader({
      mutation,
    } as unknown as Pick<ConvexClient, "mutation">);
    const events = [event("new"), event("duplicate")];

    await expect(
      uploader.upload({ accountId: "ignored-client-owner", events }),
    ).resolves.toEqual({ acknowledgedEventKeys: ["new", "duplicate"] });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0]?.[1]).toEqual({ events });
  });

  test("does not acknowledge rows when the server rejects the batch", async () => {
    const mutation = mock(async (...args: unknown[]) => {
      void args;
      throw new Error("rejected");
    });
    const uploader = createConvexUsageUploader({
      mutation,
    } as unknown as Pick<ConvexClient, "mutation">);

    await expect(
      uploader.upload({ accountId: "opaque-owner", events: [event("one")] }),
    ).rejects.toThrow("rejected");
  });
});
