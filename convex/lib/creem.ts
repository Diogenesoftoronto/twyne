const CREEM_PRODUCTION_API = "https://api.creem.io/v1";
const CREEM_TEST_API = "https://test-api.creem.io/v1";

export interface CreemSubscriptionUpdate {
  userId: string;
  email?: string;
  productId: string;
  status: string;
  creemCustomerId?: string;
  creemSubscriptionId?: string;
  currentPeriodEnd?: number;
}

/**
 * Creem event types we act on. Anything else is acknowledged (202) and
 * ignored so an unexpected payload shape can't reshape a subscription. The
 * list is intentionally narrow: a new event type must be added here before it
 * can change entitlement.
 */
export const ACCEPTED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "checkout.session.completed",
  "checkout.completed",
  "subscription.active",
  "subscription.trialing",
  "subscription.updated",
  "subscription.renewed",
  "subscription.past_due",
  "subscription.on_grace_period",
  "subscription.paused",
  "subscription.canceled",
  "subscription.expired",
  "subscription.deleted",
]);

export interface ParsedCreemEvent {
  eventType: string;
  /** Creem event id, used for idempotent processing. null when absent. */
  eventId: string | null;
  /** When Creem says the event happened (ms). null when absent. */
  eventCreatedAt: number | null;
  update: CreemSubscriptionUpdate;
}

export function creemApiBase(apiKey: string, override?: string): string {
  if (override?.trim()) return override.replace(/\/+$/, "");
  return apiKey.startsWith("creem_test_")
    ? CREEM_TEST_API
    : CREEM_PRODUCTION_API;
}

/**
 * Parse a verified Creem webhook into a typed event, enforcing the accepted
 * allowlist and correlation id. Returns null for events we neither recognize
 * nor can attribute to a user. This is the only parser the webhook handler
 * should use.
 */
export function parseCreemEvent(event: unknown): ParsedCreemEvent | null {
  if (!event || typeof event !== "object") return null;
  const payload = event as Record<string, any>;
  const eventType =
    payload.eventType ?? payload.type ?? payload.event ?? "";
  if (!eventType || !ACCEPTED_EVENT_TYPES.has(eventType)) return null;

  const update = parseCreemSubscriptionUpdate(event);
  if (!update) return null;

  const eventId =
    payload.id ?? payload.event_id ?? payload.eventId ?? null;
  const tsRaw =
    payload.created_at ??
    payload.createdAt ??
    payload.timestamp ??
    payload.created ??
    null;
  const parsedTs =
    typeof tsRaw === "number"
      ? tsRaw
      : typeof tsRaw === "string"
        ? Date.parse(tsRaw)
        : Number.NaN;

  return {
    eventType,
    eventId: typeof eventId === "string" ? eventId : null,
    eventCreatedAt: Number.isFinite(parsedTs) ? parsedTs : null,
    update,
  };
}

/**
 * Normalize a Creem webhook payload into the fields we persist. Kept as a
 * separate, dependency-free function so it can be unit-tested directly
 * (see tests/creem.test.ts). `parseCreemEvent` wraps this with the
 * event-type allowlist and idempotency metadata.
 */
export function parseCreemSubscriptionUpdate(
  event: unknown,
): CreemSubscriptionUpdate | null {
  if (!event || typeof event !== "object") return null;

  const payload = event as Record<string, any>;
  const obj = payload.object ?? payload.data ?? payload;
  const userId =
    obj?.metadata?.userId ??
    obj?.metadata?.referenceId ??
    obj?.request_id ??
    obj?.checkout?.request_id ??
    payload.request_id;
  if (typeof userId !== "string" || !userId) return null;

  const sub = obj?.subscription ?? obj;
  const periodEndRaw =
    sub?.current_period_end ?? sub?.current_period_end_date;
  const parsedPeriodEnd =
    typeof periodEndRaw === "number"
      ? periodEndRaw
      : typeof periodEndRaw === "string"
        ? Date.parse(periodEndRaw)
        : Number.NaN;

  return {
    userId,
    email: obj?.customer?.email ?? obj?.metadata?.email ?? undefined,
    productId:
      obj?.product?.id ??
      obj?.product_id ??
      obj?.order?.product ??
      sub?.product?.id ??
      sub?.product ??
      "unknown",
    status: sub?.status ?? obj?.status ?? "active",
    creemCustomerId: obj?.customer?.id ?? sub?.customer ?? undefined,
    creemSubscriptionId: sub?.id ?? undefined,
    currentPeriodEnd: Number.isFinite(parsedPeriodEnd)
      ? parsedPeriodEnd
      : undefined,
  };
}
