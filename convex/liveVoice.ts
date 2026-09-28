"use node";

import { action, type ActionCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  createDpopProof,
  issueNotOrganicAccessToken,
  notOrganicIssuer,
  notOrganicOpenAiRoute,
  providerJsonRequest,
} from "./lib/notorganic";
import { consumeRateLimit } from "./lib/rateLimit";
import {
  LIVE_ACTION_BUDGET_MICROS,
  LIVE_ACTION_PROMPT,
  LIVE_SESSION_BUDGET_MICROS,
  liveVoiceAccess,
  parseLiveAction,
} from "../src/utils/live-voice-contract";

const linkRef = makeFunctionReference<
  "query",
  { productSubject: string },
  { did: string; sessionVersion: number } | null
>("providerIdentity:getLinkedDidBySubject");
async function account(ctx: ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Sign in to use Live voice.");
  const link = await ctx.runQuery(linkRef, {
    productSubject: identity.subject || identity.tokenIdentifier,
  });
  if (!link) throw new Error("Sign in with Not Organic to use Live voice.");
  return { ...link, identity };
}
async function walletAccess(ctx: ActionCtx) {
  const link = await account(ctx);
  const token = await issueNotOrganicAccessToken({
    ...link,
    feature: "voice-live",
    capabilities: ["wallet:read"],
  });
  const wallet = await providerJsonRequest<unknown>(
    "/v1/wallet",
    token,
    {},
    { issuer: notOrganicIssuer(), feature: "voice-live" },
  );
  return { link, ...liveVoiceAccess(wallet) };
}

export const access = action({
  args: {},
  returns: v.object({
    eligible: v.boolean(),
    welcome: v.boolean(),
    availableMicros: v.number(),
    sessionBudgetMicros: v.number(),
    consentGranted: v.boolean(),
  }),
  handler: async (ctx) => {
    const { link, ...access } = await walletAccess(ctx);
    const token = await issueNotOrganicAccessToken({
      ...link,
      feature: "voice-live",
      capabilities: ["realtime:connect"],
    });
    const consent = await providerJsonRequest<{ granted: boolean }>(
      "/v1/realtime/consent",
      token,
      {},
      { issuer: notOrganicIssuer(), feature: "voice-live" },
    );
    return {
      ...access,
      sessionBudgetMicros: LIVE_SESSION_BUDGET_MICROS,
      consentGranted: consent.granted === true,
    };
  },
});

export const connect = action({
  args: { consent: v.boolean() },
  returns: v.object({
    authorization: v.string(),
    dpop: v.string(),
    idempotencyKey: v.string(),
    maxCostMicrousd: v.number(),
  }),
  handler: async (ctx, args) => {
    const { link, eligible, availableMicros } = await walletAccess(ctx);
    if (!eligible)
      throw new Error(
        "Live voice is included with Pro and your available welcome credit.",
      );
    if (availableMicros < LIVE_SESSION_BUDGET_MICROS)
      throw new Error(
        "You need at least $0.50 in available credit to start Live voice.",
      );
    await consumeRateLimit(ctx, {
      action: "voice:live-connect",
      identifier: link.identity.tokenIdentifier,
      limit: 5,
      windowMs: 60_000,
    });
    const token = await issueNotOrganicAccessToken({
      ...link,
      feature: "voice-live",
      capabilities: ["realtime:connect"],
    });
    if (args.consent)
      await providerJsonRequest(
        "/v1/realtime/consent",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            purpose: "portkey-realtime-content-logging",
            policyVersion: "realtime-content-logging-v1",
            granted: true,
          }),
        },
        { issuer: notOrganicIssuer(), feature: "voice-live" },
      );
    const url = `${notOrganicIssuer()}/v1/live/sessions`;
    return {
      authorization: `DPoP ${token.accessToken}`,
      dpop: await createDpopProof(token, url, "GET"),
      idempotencyKey: crypto.randomUUID(),
      maxCostMicrousd: LIVE_SESSION_BUDGET_MICROS,
    };
  },
});

export const interpret = action({
  args: { context: v.string() },
  returns: v.object({
    kind: v.string(),
    text: v.string(),
    original: v.string(),
    target: v.string(),
  }),
  handler: async (ctx, { context }) => {
    if (context.length > 40_000) throw new Error("Voice context is too large.");
    const { link, eligible } = await walletAccess(ctx);
    if (!eligible)
      throw new Error("Live voice requires Pro or available welcome credit.");
    await consumeRateLimit(ctx, {
      action: "voice:live-action",
      identifier: link.identity.tokenIdentifier,
      limit: 20,
      windowMs: 60_000,
    });
    const token = await issueNotOrganicAccessToken({
      ...link,
      feature: "voice-live-action",
      capabilities: ["infer:fast"],
    });
    const route = notOrganicOpenAiRoute(
      token,
      "fast",
      "voice-live-action",
      notOrganicIssuer(),
    );
    const provider = createOpenAI({
      ...route,
      headers: {
        ...route.headers,
        "idempotency-key": crypto.randomUUID(),
        "x-notorganic-max-cost-microusd": String(LIVE_ACTION_BUDGET_MICROS),
      },
    });
    const result = await generateText({
      model: provider.chat(route.model),
      system: LIVE_ACTION_PROMPT,
      prompt: context,
      maxOutputTokens: 2500,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(30_000),
    });
    return parseLiveAction(result.text);
  },
});
