import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

/* ── Creem payment webhook ──────────────────────────────────────────
 * Creem POSTs subscription lifecycle events here. We verify the
 * `creem-signature` header (HMAC-SHA256 over the raw body with
 * CREEM_WEBHOOK_SECRET) before recording entitlement. Unverified or
 * malformed requests are rejected without touching the database. */

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time compare on equal-length hex strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

http.route({
  path: "/creem/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CREEM_WEBHOOK_SECRET;
    if (!secret) return new Response("not configured", { status: 503 });

    const raw = await request.text();
    const provided = request.headers.get("creem-signature") ?? "";
    const expected = await hmacHex(secret, raw);
    if (!provided || !safeEqual(provided.toLowerCase(), expected)) {
      return new Response("invalid signature", { status: 401 });
    }

    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return new Response("bad json", { status: 400 });
    }

    // Creem nests the resource under `object`; metadata/request_id carries the
    // userId we set at checkout. Be defensive about shape across event types.
    const obj = event.object ?? event.data ?? event;
    const userId: string | undefined =
      obj?.metadata?.userId ??
      obj?.metadata?.referenceId ??
      obj?.request_id ??
      obj?.checkout?.request_id ??
      event?.request_id;
    if (!userId) return new Response("no user", { status: 202 });

    const sub = obj?.subscription ?? obj;
    const periodEndRaw =
      sub?.current_period_end ?? sub?.current_period_end_date;
    const currentPeriodEnd =
      typeof periodEndRaw === "number"
        ? periodEndRaw
        : periodEndRaw
          ? Date.parse(periodEndRaw) || undefined
          : undefined;

    await ctx.runMutation(internal.payments.upsertSubscription, {
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
      currentPeriodEnd,
    });

    return new Response("ok", { status: 200 });
  }),
});

export default http;
