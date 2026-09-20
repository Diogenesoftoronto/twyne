/** New purchases only. Legacy Creem subscriptions keep their existing terms. */
export const TWYNE_PRO_PLAN = {
  id: "twyne_pro_v2",
  monthlyUsd: 29,
  monthlyCreditUsd: 10,
} as const;

export function hasCurrentTwynePlan(
  wallet: unknown,
  now = Date.now(),
): boolean {
  if (!wallet || typeof wallet !== "object" || !("subscriptions" in wallet))
    return false;
  const subscriptions = wallet.subscriptions;
  return (
    Array.isArray(subscriptions) &&
    subscriptions.some(
      (row) =>
        row &&
        row.product === "twyne" &&
        row.plan === TWYNE_PRO_PLAN.id &&
        row.status === "active" &&
        typeof row.currentPeriodEnd === "number" &&
        row.currentPeriodEnd > now,
    )
  );
}

/** Checkout availability is supplied by the authenticated wallet, not a URL. */
export function availableCreditPacks(wallet: unknown): string[] {
  if (!wallet || typeof wallet !== "object" || !("checkout" in wallet))
    return [];
  const checkout = wallet.checkout;
  if (
    !checkout ||
    typeof checkout !== "object" ||
    !("available" in checkout) ||
    checkout.available !== true ||
    !("packIds" in checkout) ||
    !Array.isArray(checkout.packIds)
  )
    return [];
  return checkout.packIds.filter(
    (id): id is string =>
      typeof id === "string" && /^twyne_credit_(10|25|50)$/.test(id),
  );
}
