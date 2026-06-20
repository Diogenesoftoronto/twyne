/**
 * Pro entitlement — the single source of truth for what "Pro" means.
 *
 * Everything that gates a hosted (key-consuming) feature on a paid tier reads
 * from here, so the rules can never drift between voice, the room, research,
 * and any future metered action:
 *
 *   1. The subscription status is `active` or `trialing`.
 *   2. The product id is in the server-side allowlist (env-configured), so a
 *      cheaper or unexpected product from a webhook can't grant Pro.
 *   3. When a period end is recorded, the period is still within a grace
 *      window — a stale "active" left by a canceled subscription can't keep
 *      granting Pro forever.
 *
 * The allowlist is authoritative on the server; the client's product id is
 * never trusted (see `createCheckout` in convex/payments.ts).
 */
import { internal } from "../_generated/api";

/** How long an `active`/`trialing` sub still counts as Pro past its period end. */
const PRO_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Creem product ids that grant the Pro tier. Sourced from the server env var
 * `CREEM_PRO_PRODUCT_IDS` (comma-separated). Falls back to the public product
 * id only so dev/test deployments keep working without an extra variable.
 */
export function proProductIds(): string[] {
  const raw =
    process.env.CREEM_PRO_PRODUCT_IDS ??
    process.env.PUBLIC_CREEM_PRODUCT_PRO ??
    "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SubscriptionRow {
  status?: string;
  productId?: string;
  currentPeriodEnd?: number | null;
}

/**
 * True when the subscription grants the Pro tier. Pure (no I/O) so it can be
 * unit-tested and reused on already-fetched rows.
 */
export function isProSubscription(row: SubscriptionRow | null | undefined): boolean {
  if (!row) return false;
  if (row.status !== "active" && row.status !== "trialing") return false;
  const allowlist = proProductIds();
  if (allowlist.length > 0 && !allowlist.includes(row.productId ?? "")) {
    return false;
  }
  const end = row.currentPeriodEnd;
  if (typeof end === "number" && Number.isFinite(end)) {
    if (end + PRO_GRACE_MS < Date.now()) return false;
  }
  return true;
}

/**
 * Look up the caller's subscription and report whether Pro is granted. Calls
 * the internal payments query, so it works from any action/mutation context
 * that can run queries.
 */
export async function userIsPro(
  ctx: { runQuery: <T>(ref: any, args: Record<string, unknown>) => Promise<T> },
  userId: string,
): Promise<boolean> {
  const row = await ctx.runQuery<SubscriptionRow | null>(
    internal.payments.getSubscriptionByUserId,
    { userId },
  );
  return isProSubscription(row);
}
