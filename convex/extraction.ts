/**
 * Clairic extractions, routed through Not Organic.
 *
 * The same shape as `systemOne.ts`: the browser never holds a provider key.
 * A signed-in writer with a linked Not Organic account is issued a short-lived
 * `extraction:run` token and the gateway calls Cloudflare, reserves credit,
 * and settles on input tokens.
 *
 * `CLOUDFLARE_AI_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` survive as a
 * local-development fallback only, for working on an extraction surface
 * without the gateway running. Not Organic wins whenever it is enabled.
 *
 * Failures are returned, not thrown: every caller has a deterministic answer
 * underneath (literal quote matching, the fixed flow thresholds), so a cold
 * gateway degrades the feature rather than breaking it.
 */

import { action, type ActionCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { userIsPro } from "./lib/entitlement";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import {
  issueNotOrganicAccessToken,
  notOrganicEnabled,
  notOrganicIssuer,
  providerJsonRequest,
} from "./lib/notorganic";

const EXTRACTION_PATH = "/v1/extraction";
const EXTRACTION_FEATURE = "extraction";
const EXTRACTION_CAPABILITY = "extraction:run";
const CLAIRIC = "@cf/cloudflare/clairic";

/** Matches the gateway's limits, so a refusal happens here with a useful error. */
const MAX_FIELDS = 64;
const MAX_STATE_CHARS = 96_000;

const linkedDidReference = makeFunctionReference<
  "query",
  { productSubject: string },
  { did: string; sessionVersion: number } | null
>("providerIdentity:getLinkedDidBySubject");

const fieldValidator = v.object({
  type: v.union(
    v.literal("text"),
    v.literal("number"),
    v.literal("date"),
    v.literal("time"),
    v.literal("datetime"),
    v.literal("duration"),
    v.literal("list"),
    v.literal("estimate"),
    v.literal("forecast"),
  ),
  instructions: v.optional(v.string()),
  unit: v.optional(v.string()),
  integer: v.optional(v.boolean()),
  decimals: v.optional(v.number()),
  items: v.optional(
    v.union(v.literal("text"), v.literal("number"), v.literal("date")),
  ),
  min: v.optional(v.union(v.number(), v.string())),
  max: v.optional(v.union(v.number(), v.string())),
  step: v.optional(v.union(v.number(), v.literal("month"), v.literal("year"))),
  scale: v.optional(v.union(v.literal("linear"), v.literal("log"))),
  null_threshold: v.optional(v.number()),
  horizon: v.optional(v.number()),
  interval: v.optional(
    v.union(
      v.literal("step"),
      v.literal("minute"),
      v.literal("hour"),
      v.literal("day"),
      v.literal("week"),
      v.literal("month"),
      v.literal("quarter"),
      v.literal("year"),
    ),
  ),
});

export type ExtractionTransport = "notorganic" | "direct" | "none";

function directCredentials(): { token: string; account: string } | null {
  const token = process.env.CLOUDFLARE_AI_API_TOKEN?.trim();
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  return token && account ? { token, account } : null;
}

function transport(): ExtractionTransport {
  if (notOrganicEnabled()) return "notorganic";
  if (directCredentials()) return "direct";
  return "none";
}

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
    transport: ExtractionTransport;
  }> => {
    const via = transport();
    return { available: via !== "none", transport: via };
  },
});

interface ExtractionBody {
  model: string;
  answers: Record<string, unknown>;
  truncated: boolean;
  usage?: { input_tokens: number; output_tokens: number; passes?: number };
}

type Outcome = { ok: true; body: ExtractionBody } | { ok: false; error: string };

/** Never surface upstream bodies: they can echo the request, i.e. the draft. */
function statusError(status: number): string {
  if (status === 429) return "rate limited";
  if (status === 529 || status === 503) return "overloaded";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "no credit";
  if (status === 404) return "unsupported";
  if (status === 400 || status === 422) return "malformed";
  return "provider";
}

async function extractNotOrganic(
  ctx: ActionCtx,
  body: Record<string, unknown>,
): Promise<Outcome> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return { ok: false, error: "signed out" };
  const link = await ctx.runQuery(linkedDidReference, {
    productSubject: identity.subject || identity.tokenIdentifier,
  });
  if (!link) return { ok: false, error: "account not linked" };
  try {
    const token = await issueNotOrganicAccessToken({
      did: link.did,
      feature: EXTRACTION_FEATURE,
      capabilities: [EXTRACTION_CAPABILITY],
      sessionVersion: link.sessionVersion,
    });
    const result = await providerJsonRequest<ExtractionBody>(
      EXTRACTION_PATH,
      token,
      {
        method: "POST",
        signal: AbortSignal.timeout(40_000),
        body: JSON.stringify(body),
        // Fresh per attempt, as in systemOne: an edited draft is a new read.
        headers: { "idempotency-key": crypto.randomUUID() },
      },
      { issuer: notOrganicIssuer(), feature: EXTRACTION_FEATURE },
    );
    return { ok: true, body: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = /\((\d{3})\)/.exec(message)?.[1];
    return { ok: false, error: status ? statusError(Number(status)) : "provider" };
  }
}

/** Local-development path. Never reached when Not Organic is enabled. */
async function extractDirect(
  credentials: { token: string; account: string },
  body: Record<string, unknown>,
): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.account)}/ai/run/${CLAIRIC}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credentials.token}`,
        },
        body: JSON.stringify({ model: "clairic", ...body }),
      },
    );
  } catch {
    return { ok: false, error: "network" };
  }
  if (!res.ok) return { ok: false, error: statusError(res.status) };
  try {
    const json = (await res.json()) as Record<string, unknown>;
    const payload = (
      json.result && typeof json.result === "object" ? json.result : json
    ) as ExtractionBody;
    return { ok: true, body: { ...payload, model: `extraction-clairic/${payload.model}` } };
  } catch {
    return { ok: false, error: "provider" };
  }
}

function validBody(
  body: ExtractionBody,
  fields: Record<string, { type: string }>,
): boolean {
  if (!body || typeof body.model !== "string" || typeof body.answers !== "object" || !body.answers)
    return false;
  return Object.entries(fields).every(([name, field]) => {
    const answer = body.answers[name] as { type?: string } | undefined;
    return !!answer && answer.type === field.type && "value" in answer;
  });
}

export const extract = action({
  args: {
    state: v.optional(v.string()),
    fields: v.record(v.string(), fieldValidator),
    reference_date: v.optional(v.string()),
    options: v.optional(
      v.object({
        include_quantiles: v.optional(v.boolean()),
        return_state_text: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.object({
    ok: v.boolean(),
    model: v.optional(v.string()),
    answers: v.optional(v.record(v.string(), v.any())),
    truncated: v.optional(v.boolean()),
    usage: v.optional(
      v.object({
        input_tokens: v.number(),
        output_tokens: v.number(),
        passes: v.optional(v.number()),
      }),
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
    truncated?: boolean;
    usage?: { input_tokens: number; output_tokens: number; passes?: number };
    transport?: ExtractionTransport;
    error?: string;
  }> => {
    const via = transport();
    if (via === "none") return { ok: false, error: "unconfigured" };
    const names = Object.keys(args.fields);
    if (names.length === 0) return { ok: false, error: "no fields" };
    if (names.length > MAX_FIELDS)
      return { ok: false, error: `too many fields (${names.length})` };
    if (!args.state?.trim()) return { ok: false, error: "empty state" };
    if (args.state.length > MAX_STATE_CHARS)
      return { ok: false, error: "state too large" };

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "signed out" };
    const isPro = await userIsPro(ctx, identity.subject || identity.tokenIdentifier);
    await consumeRateLimit(ctx, {
      action: "extraction:extract",
      identifier: identity.tokenIdentifier,
      ...(isPro ? RATE_LIMITS.extraction : RATE_LIMITS.extractionFree),
    });

    const body = {
      state: args.state,
      fields: args.fields,
      ...(args.reference_date ? { reference_date: args.reference_date } : {}),
      ...(args.options ? { options: args.options } : {}),
    };
    const result =
      via === "notorganic"
        ? await extractNotOrganic(ctx, body)
        : await extractDirect(directCredentials()!, body);
    if (!result.ok) return { ok: false, transport: via, error: result.error };
    if (!validBody(result.body, args.fields))
      return { ok: false, transport: via, error: "provider" };
    const usage = result.body.usage;
    return {
      ok: true,
      transport: via,
      model: result.body.model,
      answers: result.body.answers,
      truncated: result.body.truncated === true,
      ...(usage &&
      typeof usage.input_tokens === "number" &&
      typeof usage.output_tokens === "number"
        ? {
            usage: {
              input_tokens: usage.input_tokens,
              output_tokens: usage.output_tokens,
              ...(typeof usage.passes === "number" ? { passes: usage.passes } : {}),
            },
          }
        : {}),
    };
  },
});
