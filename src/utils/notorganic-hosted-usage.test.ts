import { describe, expect, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { getNotOrganicHostedUsage } from "./notorganic-provider";
import { createUsageRange } from "./usage-domain";

// Convex rejects extra object fields. Exercise the actual Desk input rather
// than a hand-written from/to object that hides the client-only preset.
describe("hosted usage transport", () => {
  for (const preset of ["7d", "30d", "90d", "all"] as const) {
    test(`sends only the validated billing boundaries for ${preset}`, async () => {
      const range = createUsageRange(preset, Date.UTC(2026, 10, 10));
      const summary = {
        billedMicrousd: 42,
        settledRequests: 1,
        unresolvedRequests: 0,
        unverifiedCostRequests: 0,
        unverifiedCostMicrousd: 0,
        truncated: false,
      };
      const client = {
        action: async (
          reference: Parameters<typeof getFunctionName>[0],
          args: unknown,
        ) => {
          expect(getFunctionName(reference)).toBe(
            "providerIdentity:getHostedUsage",
          );
          expect(args).toEqual({ from: range.from, to: range.to });
          expect(Object.keys(args as object).sort()).toEqual(["from", "to"]);
          return summary;
        },
      } as unknown as ConvexClient;
      expect(await getNotOrganicHostedUsage(client, range)).toBe(summary);
      expect(range.preset).toBe(preset);
    });
  }
});
