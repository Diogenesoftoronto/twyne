/** Purchase interest is collected by Not Organic, alongside the shared account. */
export type PurchaseWalletStatus = "idle" | "loading" | "ready" | "error";

export function creditPurchaseAction(
  authLoading: boolean,
  signedIn: boolean,
  walletStatus: PurchaseWalletStatus,
  packAvailable: boolean,
): "loading" | "unavailable" | "checkout" | "waitlist" {
  if (
    authLoading ||
    (signedIn && (walletStatus === "idle" || walletStatus === "loading"))
  )
    return "loading";
  if (signedIn && walletStatus === "error") return "unavailable";
  return signedIn && packAvailable ? "checkout" : "waitlist";
}

export function purchaseWaitlistUrl(
  intent: "setup" | "subscription" | "credits",
  offerId = "",
) {
  const query = new URLSearchParams({ product: "twyne", intent });
  if (offerId) query.set("offerId", offerId);
  return `https://id.notorganic.info/waitlist?${query}`;
}
