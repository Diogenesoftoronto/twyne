/** Only stable catalog identifiers cross the checkout boundary. */
export const TWYNE_CREDIT_PACKS = [
  { id: "twyne_credit_10", usd: 10 },
  { id: "twyne_credit_25", usd: 25 },
  { id: "twyne_credit_50", usd: 50 },
] as const;

export function providerCheckoutSelection(
  input: { planId?: string; packId?: string },
  env: { NOTORGANIC_TWYNE_PRO_V2_ENABLED?: string; NOTORGANIC_ENABLED?: string },
): { product_id: string } | { pack_id: string } {
  if (input.planId && !input.packId && input.planId === "twyne_pro_v2" && env.NOTORGANIC_TWYNE_PRO_V2_ENABLED === "true") {
    return { product_id: input.planId };
  }
  if (input.packId && !input.planId && TWYNE_CREDIT_PACKS.some((pack) => pack.id === input.packId) && env.NOTORGANIC_ENABLED === "true") {
    return { pack_id: input.packId };
  }
  throw new Error("This purchase is not available yet. No payment was taken.");
}
