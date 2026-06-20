import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import { parseCreemEvent } from "./lib/creem";
import { reportError } from "./lib/errors";

/* ── Shared-Lix auth helpers ───────────────────────────────────────
 * The /lsp/* routes are hit by the Lix SDK's sync process, which uses raw
 * fetch. We can't rely on Convex's automatic ctx.auth identity here; instead
 * we verify the better-auth session cookie (or the cross-domain
 * Better-Auth-Cookie header) and only let accepted collaborators read or
 * write a shared document. */

/** Verify the caller's better-auth session and return their user id. */
async function getAuthenticatedUserId(
  ctx: any,
  request: Request,
): Promise<string | null> {
  try {
    const auth = createAuth(ctx);
    // The cross-domain client sends the session via the Better-Auth-Cookie
    // header; better-auth's session middleware reads the Cookie header. Fold
    // the former into the latter so verification works regardless of whether
    // the request flows through the registered auth handler.
    const headers = new Headers(request.headers);
    const crossDomainCookie = headers.get("better-auth-cookie");
    if (crossDomainCookie && !headers.get("cookie")) {
      headers.set("cookie", crossDomainCookie);
    }
    const session = await (auth as any).api.getSession({
      headers,
      query: { disableCookieCache: true },
    });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Extract the lix_id from the JSON body of get/pull/push requests. */
function getLixIdFromBody(path: string, body: ArrayBuffer): string | null {
  if (path === "/lsp/new-v1") return null;
  if (body.byteLength === 0) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(body));
    return typeof json?.lix_id === "string" ? json.lix_id : null;
  } catch {
    return null;
  }
}

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

/* ── Creem payment webhook ──────────────────────────────────────────
 * Creem POSTs subscription lifecycle events here. We verify the
 * `creem-signature` header (HMAC-SHA256 over the raw body with
 * CREEM_WEBHOOK_SECRET) before recording entitlement. Unverified or
 * malformed requests are rejected without touching the database.
 *
 * After verification, the event is parsed through an accepted-type
 * allowlist (`parseCreemEvent`) and applied idempotently
 * (`applyCreemEvent`): duplicate event ids and out-of-order/stale events
 * are ignored, and only Pro-allowlisted products can ever grant Pro. */

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

    const parsed = parseCreemEvent(event);
    if (!parsed) return new Response("ignored", { status: 202 });

    try {
      await ctx.runMutation(internal.payments.applyCreemEvent, {
        ...parsed.update,
        eventId: parsed.eventId ?? undefined,
        eventCreatedAt: parsed.eventCreatedAt ?? undefined,
        eventType: parsed.eventType,
      });
      return new Response("ok", { status: 200 });
    } catch (err) {
      // A failed webhook is the worst silent failure: a real subscriber
      // could lose Pro without anyone noticing. Report it and surface a
      // 500 so Creem retries (and we have a chance to fix forward).
      reportError({
        feature: "creem.webhook",
        error: err,
        context: {
          eventType: parsed.eventType,
          eventId: parsed.eventId ?? undefined,
          userId: parsed.update.userId,
        },
      });
      return new Response("internal error", { status: 500 });
    }
  }),
});

http.route({
  path: "/e2e/otp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.E2E_OTP_SECRET;
    if (!secret) return new Response("not found", { status: 404 });
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("unauthorized", { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      email?: string;
      otp?: string;
    } | null;
    if (!body?.email || !body.otp) {
      return new Response("email and otp required", { status: 400 });
    }
    await ctx.runMutation(internal.testing.storeOtp, {
      email: body.email,
      otp: body.otp,
    });
    return new Response("ok");
  }),
});

http.route({
  path: "/e2e/otp",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.E2E_OTP_SECRET;
    if (!secret) return new Response("not found", { status: 404 });
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("unauthorized", { status: 401 });
    }
    const email = new URL(request.url).searchParams.get("email");
    if (!email) return new Response("email required", { status: 400 });
    const result = await ctx.runQuery(internal.testing.getOtp, { email });
    if (!result) return new Response("not found", { status: 404 });
    return Response.json(result);
  }),
});

/* ── Lix server protocol relay ──────────────────────────────────────
 * The LSP routes. Each is a thin httpAction that authenticates the caller's
 * better-auth session, extracts the lix_id from the request body, and
 * forwards the raw body to `lixRelay.handleLspRequest` (a `"use node"` action
 * that runs the Lix SDK). The action re-checks the caller's collaborator role
 * on the document before letting the Lix SDK read or mutate the blob, then
 * persists the updated blob and returns the serialized response.
 *
 * `new-v1` is not exposed here — shared documents are created through the
 * authenticated `shareFolio` action so collaboration metadata is always set
 * up alongside the blob. */

const LSP_ROUTES = [
  "/lsp/new-v1",
  "/lsp/get-v1",
  "/lsp/push-v1",
  "/lsp/pull-v1",
];

for (const path of LSP_ROUTES) {
  http.route({
    path,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      // Shared documents are never created via the LSP new-v1 route; sharing
      // is done through the authenticated shareFolio action. Block this path
      // so we don't create orphaned blobs without collaboration metadata.
      if (path === "/lsp/new-v1") {
        return new Response("not found", { status: 404 });
      }

      const body = await request.arrayBuffer().catch(() => new ArrayBuffer(0));
      const lixId = getLixIdFromBody(path, body);
      if (!lixId) {
        return new Response("missing lix_id", { status: 400 });
      }

      const userId = await getAuthenticatedUserId(ctx, request);
      if (!userId) {
        return new Response("unauthorized", { status: 401 });
      }

      try {
        const result = await ctx.runAction(internal.lixRelay.handleLspRequest, {
          path,
          method: "POST",
          body,
          lixId,
          userId,
        });
        return new Response(result.body ? new Blob([result.body]) : null, {
          status: result.status,
          headers: result.headers,
        });
      } catch (err) {
        // A relay failure drops a multiplayer change-set silently; report
        // so we have a signal before a collaborator notices data loss.
        reportError({
          feature: "lixRelay.lsp",
          error: err,
          context: { path, lixId },
        });
        return new Response("relay error", { status: 502 });
      }
    }),
  });
}

export default http;
