export interface HostedUsageSummary {
  billedMicrousd: number;
  settledRequests: number;
  unresolvedRequests: number;
  unverifiedCostRequests: number;
  unverifiedCostMicrousd: number;
  truncated: boolean;
}

const isMoney = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** The gateway's account feed includes other products and unsettled reservations. */
export function summarizeHostedUsage(
  payload: unknown,
  range: { from: number | null; to: number },
): HostedUsageSummary {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { data?: unknown }).data)
  )
    throw new Error("Hosted usage response is unavailable");
  const rows = (payload as { data: unknown[] }).data;
  const result: HostedUsageSummary = {
    billedMicrousd: 0,
    settledRequests: 0,
    unresolvedRequests: 0,
    unverifiedCostRequests: 0,
    unverifiedCostMicrousd: 0,
    // Both gateway backends cap this feed at 100; one does not paginate.
    truncated: rows.length >= 100,
  };
  const seen = new Set<string>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object")
      throw new Error("Invalid hosted usage row");
    const row = raw as Record<string, unknown>;
    if (row.product !== "twyne") continue;
    if (
      typeof row.requestId !== "string" ||
      !row.requestId ||
      !isMoney(row.createdAt)
    )
      throw new Error("Invalid hosted usage identity or date");
    if (seen.has(row.requestId)) continue;
    seen.add(row.requestId);
    if (
      row.createdAt >= range.to ||
      (range.from !== null && row.createdAt < range.from)
    )
      continue;
    if (row.state === "succeeded" && isMoney(row.billedMicros)) {
      const total = result.billedMicrousd + row.billedMicros;
      if (!Number.isSafeInteger(total))
        throw new Error("Hosted usage total exceeds safe range");
      result.billedMicrousd = total;
      result.settledRequests += 1;
      // The Convex gateway records conservative reconciliation as succeeded.
      // This is a wallet charge, but not evidence of the final provider cost.
      if (
        typeof row.reconciliationReason === "string" &&
        row.reconciliationReason
      ) {
        result.unverifiedCostRequests += 1;
        result.unverifiedCostMicrousd += row.billedMicros;
      }
    } else if (row.state !== "failed" && row.state !== "cancelled") {
      result.unresolvedRequests += 1;
    }
  }
  return result;
}
