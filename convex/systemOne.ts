/**
 * System One (Jev) judgements, routed through Not Organic.
 *
 * Jev is hosted and needs a credential, so it cannot be called from the
 * browser. The credential belongs to **Not Organic**, not to this deployment:
 * Not Organic is the account/control plane, so it owns provider keys, per
 * customer metering, and entitlement — exactly as it already does for chat,
 * embeddings, images, audio and Tavus. Twyne holds no TypeSafe key in
 * production; it presents a DPoP-bound product assertion and calls
 * `POST /v1/judgement`, the same shape `providerIdentity.ts` uses for
 * `/v1/wallet` and `/v1/billing/checkout`.
 *
 * That boundary is what makes the tier reusable: every other property gets
 * judgements from one place, one key rotates in one place, and spend is
 * attributable per account rather than per deployment.
 *
 * `TYPESAFE_API_KEY` survives as a **local-development fallback only**, for
 * working on a judgement surface without the gateway running. It is never the
 * production path; if Not Organic is enabled the direct key is ignored.
 *
 * The question/answer shapes live in `src/utils/system-one.ts`, which is
 * transport-free and shared with the client. Deliberately no `"use node"`:
 * `fetch()` and WebCrypto both work in the default Convex runtime, and the
 * lighter runtime starts faster for what is a ~380 ms call.
 */

import { action, type ActionCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  directJudgementKey,
  judgementQuestions,
  validJudgementResponse,
} from "./lib/judgementContract";
import { userIsPro } from "./lib/entitlement";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import {
  issueNotOrganicAccessToken,
  notOrganicEnabled,
  notOrganicIssuer,
  providerJsonRequest,
} from "./lib/notorganic";

/** Direct TypeSafe endpoint. Local development only — see the module header. */
const DIRECT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";

/**
 * The provider-side route. `judgement` is a logical model the gateway resolves
 * to a concrete Jev version, the same indirection as the `fast`/`balanced`
 * aliases — so a Jev upgrade is a gateway deploy, not a release in every
 * product that asks questions.
 */
const JUDGEMENT_PATH = "/v1/judgement";
const JUDGEMENT_FEATURE = "judgement";
const JUDGEMENT_CAPABILITY = "judgement:evaluate";

const linkedDidReference = makeFunctionReference<
  "query",
  { productSubject: string },
  { did: string; sessionVersion: number } | null
>("providerIdentity:getLinkedDidBySubject");

/**
 * Questions are validated structurally rather than by kind. `v.any()` on the
 * question body would let a malformed question through to a 422; this keeps
 * the failure on our side of the wire where the message is useful.
 */
const questionValidator = v.object({
  type: v.union(v.literal("noul"), v.literal("choice"), v.literal("score")),
  instructions: v.string(),
  criteria: v.optional(v.array(v.string())),
});

/** Guards against a runaway batch costing real money or blowing the context. */
const MAX_QUESTIONS = 64;
/** 32k of the 64k context budget is for state; ~4 chars/token, conservatively. */
const MAX_STATE_CHARS = 96_000;

function directApiKey(): string | null {
  return directJudgementKey(process.env);
}

export type JudgementTransport = "notorganic" | "direct" | "none";

/**
 * Not Organic wins whenever it is enabled, even if a direct key is also
 * present. A deployment that has both is a developer machine mid-migration,
 * and silently preferring the local key there would mean shipping a surface
 * that was never exercised against the real boundary.
 */
function transport(): JudgementTransport {
  if (notOrganicEnabled()) return "notorganic";
  if (directApiKey()) return "direct";
  return "none";
}

/** Whether the deployment can answer at all, so the client can hide the tier. */
export const isAvailable = action({
  args: {},
  returns: v.object({
    available: v.boolean(),
    transport: v.union(
      v.literal("notorganic"),
      v.literal("direct"),
      v.literal("none"),
    ),
  }),
  handler: async (): Promise<{
    available: boolean;
    transport: JudgementTransport;
  }> => {
    const via = transport();
    return { available: via !== "none", transport: via };
  },
});

export interface JudgementResponse {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Ask Not Organic. Failures are returned, not thrown: a judgement is the
 * second rung of a ladder whose lower rungs already produced an answer, so an
 * unlinked account or a cold gateway must degrade the feature rather than
 * break the caller.
 */
async function askNotOrganic(
  ctx: ActionCtx,
  body: Record<string, unknown>,
): Promise<
  { ok: true; body: JudgementResponse } | { ok: false; error: string }
> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return { ok: false, error: "signed out" };

  const link = await ctx.runQuery(linkedDidReference, {
    productSubject: identity.subject || identity.tokenIdentifier,
  });
  if (!link) return { ok: false, error: "account not linked" };

  try {
    const token = await issueNotOrganicAccessToken({
      did: link.did,
      feature: JUDGEMENT_FEATURE,
      capabilities: [JUDGEMENT_CAPABILITY],
      sessionVersion: link.sessionVersion,
    });
    const result = await providerJsonRequest<JudgementResponse>(
      JUDGEMENT_PATH,
      token,
      {
        method: "POST",
        signal: AbortSignal.timeout(40_000),
        body: JSON.stringify(body),
        // The gateway reserves credit before calling upstream, so it needs a
        // key to settle against. A fresh one per attempt is deliberate: each
        // ask is a new judgement the writer asked for, and deduplicating on
        // content would silently return a stale grade for an edited draft.
        headers: { "idempotency-key": crypto.randomUUID() },
      },
      { issuer: notOrganicIssuer(), feature: JUDGEMENT_FEATURE },
    );
    return { ok: true, body: result };
  } catch (error) {
    // `providerJsonRequest` puts the upstream status in its message. Map the
    // ones a caller can act on and swallow the rest — the detail can echo the
    // request, which here is the writer's own draft.
    const message = error instanceof Error ? error.message : "";
    if (message.includes("(429)")) return { ok: false, error: "rate limited" };
    if (message.includes("(529)")) return { ok: false, error: "overloaded" };
    if (message.includes("(401)") || message.includes("(403)")) {
      return { ok: false, error: "unauthorized" };
    }
    if (message.includes("(402)")) return { ok: false, error: "no credit" };
    if (message.includes("(404)")) {
      // The gateway has not shipped `/v1/judgement` yet.
      return { ok: false, error: "unsupported" };
    }
    if (message.includes("(422)")) return { ok: false, error: "malformed" };
    return { ok: false, error: "provider" };
  }
}

/** Local-development path. Never reached when Not Organic is enabled. */
async function askDirect(
  key: string,
  body: Record<string, unknown>,
): Promise<
  { ok: true; body: JudgementResponse } | { ok: false; error: string }
> {
  let res: Response;
  try {
    res = await fetch(DIRECT_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  if (!res.ok) {
    // 429 and 529 are both "try again shortly"; the caller decides whether a
    // background pass is worth retrying at all. Never surface the body, which
    // can echo the request.
    const kind =
      res.status === 429
        ? "rate limited"
        : res.status === 529
          ? "overloaded"
          : res.status === 401
            ? "unauthorized"
            : res.status === 422
              ? "malformed"
              : `http ${res.status}`;
    return { ok: false, error: kind };
  }
  try {
    return { ok: true, body: (await res.json()) as JudgementResponse };
  } catch {
    return { ok: false, error: "provider" };
  }
}

export const ask = action({
  args: {
    state: v.record(v.string(), v.string()),
    questions: v.record(v.string(), questionValidator),
    model: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    model: v.optional(v.string()),
    answers: v.optional(v.record(v.string(), v.any())),
    usage: v.optional(
      v.object({ input_tokens: v.number(), output_tokens: v.number() }),
    ),
    transport: v.optional(
      v.union(v.literal("notorganic"), v.literal("direct"), v.literal("none")),
    ),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    model?: string;
    answers?: Record<string, unknown>;
    usage?: { input_tokens: number; output_tokens: number };
    transport?: JudgementTransport;
    error?: string;
  }> => {
    const via = transport();
    // Not an error: Jev is a tier of a ladder, and every surface above it has
    // a working Tier 0/1 answer already. Degrade silently, never throw.
    if (via === "none") return { ok: false, error: "unconfigured" };

    const ids = Object.keys(args.questions);
    if (ids.length === 0) return { ok: false, error: "no questions" };
    if (ids.length > MAX_QUESTIONS) {
      return { ok: false, error: `too many questions (${ids.length})` };
    }

    const stateChars = Object.values(args.state).reduce(
      (n, s) => n + s.length,
      0,
    );
    if (stateChars > MAX_STATE_CHARS) {
      return { ok: false, error: "state too large" };
    }

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "signed out" };
    let questions;
    try {
      questions = judgementQuestions(args.questions);
    } catch {
      return { ok: false, error: "malformed" };
    }
    if (identity) {
      const isPro = await userIsPro(ctx, identity.tokenIdentifier);
      await consumeRateLimit(ctx, {
        action: "systemOne:ask",
        identifier: identity.tokenIdentifier,
        ...(isPro ? RATE_LIMITS.systemOne : RATE_LIMITS.systemOneFree),
      });
    }

    // The gateway resolves `judgement` to a concrete Jev version, so the model
    // is only named explicitly on the direct developer path.
    const payload = {
      model: args.model ?? DEFAULT_MODEL,
      state: args.state,
      questions,
    };

    const result =
      via === "notorganic"
        ? await askNotOrganic(ctx, {
            state: args.state,
            questions,
            ...(args.model ? { model: args.model } : {}),
          })
        : await askDirect(directApiKey()!, payload);

    if (!result.ok) return { ok: false, transport: via, error: result.error };
    if (!validJudgementResponse(result.body, args.questions))
      return { ok: false, transport: via, error: "provider" };
    return {
      ok: true,
      transport: via,
      model: result.body.model,
      answers: result.body.answers,
      usage: result.body.usage,
    };
  },
});
