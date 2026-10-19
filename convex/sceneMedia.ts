"use node";

/**
 * Scene Bench pictures on Twyne's hosted models.
 *
 * Every call spends the writer's Not Organic credit, so the bench only calls
 * these after the writer has switched generation on in Settings and pressed
 * Generate. There is no monthly picture cap: the wallet balance is the limit,
 * and the gateway refuses a request the balance cannot cover. Each request
 * carries its own cost ceiling so one picture can never spend more than the
 * price the bench showed.
 */

import { action, type ActionCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { generateImage, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  issueNotOrganicAccessToken,
  notOrganicIssuer,
  notOrganicOpenAiRoute,
  providerJsonRequest,
  type NotOrganicModelAlias,
} from "./lib/notorganic";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import { liveVoiceAccess } from "../src/utils/live-voice-contract";
import {
  SCENE_PICTURE_BUDGET_MICROS,
  SCENE_READING_BUDGET_MICROS,
} from "../src/utils/scene-media-credit";
import { SCENE_READING_SYSTEM } from "../src/utils/scene-bench";
import { createAiTraceId } from "../src/utils/ai-deterministic-evals";
import {
  utcDayFromTimestamp,
  type UsageEvent,
} from "../src/utils/usage-domain";

const linkRef = makeFunctionReference<
  "query",
  { productSubject: string },
  { did: string; sessionVersion: number } | null
>("providerIdentity:getLinkedDidBySubject");

const recordTrustedUsage = makeFunctionReference<
  "mutation",
  { ownerId: string; event: UsageEvent },
  { inserted: boolean }
>("usage:recordTrustedEvent");

/** Image endpoints reject long prompts; the bench trims the excerpt first. */
const MAX_PICTURE_PROMPT_CHARS = 6_000;
const MAX_READING_PROMPT_CHARS = 16_000;
/** A generated picture is a few MB at most; base64 adds a third. */
const MAX_READING_IMAGE_BASE64 = 8 * 1024 * 1024;

async function account(ctx: ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Sign in to generate scene pictures.");
  const link = await ctx.runQuery(linkRef, {
    productSubject: identity.subject || identity.tokenIdentifier,
  });
  if (!link)
    throw new Error("Link your Not Organic account to use hosted pictures.");
  return { ...link, identity };
}

/** Pro and welcome credit both spend from the same wallet balance. */
async function walletCredit(
  link: { did: string; sessionVersion: number },
  feature: string,
) {
  const token = await issueNotOrganicAccessToken({
    ...link,
    feature,
    capabilities: ["wallet:read"],
  });
  const wallet = await providerJsonRequest<unknown>(
    "/v1/wallet",
    token,
    {},
    { issuer: notOrganicIssuer(), feature },
  );
  return liveVoiceAccess(wallet);
}

async function hostedRoute(
  link: { did: string; sessionVersion: number },
  alias: NotOrganicModelAlias,
  feature: string,
  maxCostMicrousd: number,
) {
  const token = await issueNotOrganicAccessToken({
    ...link,
    feature,
    capabilities: [`infer:${alias}`],
  });
  const route = notOrganicOpenAiRoute(
    token,
    alias,
    feature,
    notOrganicIssuer(),
    fetch,
    { maxCostMicrousd },
  );
  return {
    route,
    provider: createOpenAI({
      baseURL: route.baseURL,
      apiKey: route.apiKey,
      headers: route.headers,
      fetch: route.fetch,
    }),
  };
}

/** The wallet is authoritative for price; this keeps the attempt in My Desk. */
async function recordAttempt(
  ctx: ActionCtx,
  ownerId: string,
  feature: "scene-image" | "scene-reading",
  model: string,
  outcome: "completed" | "failed",
  usage: { inputTokens?: number; outputTokens?: number } = {},
) {
  const occurredAt = Date.now();
  const traceId = createAiTraceId(feature);
  try {
    await ctx.runMutation(recordTrustedUsage, {
      ownerId,
      event: {
        eventKey: `${traceId}:1:notorganic:${model}`,
        occurredAt,
        day: utcDayFromTimestamp(occurredAt),
        source: "hosted",
        authority: "server",
        feature,
        provider: "notorganic",
        model,
        editorialActionId: traceId,
        traceId,
        attempt: 1,
        outcome,
        ...Object.fromEntries(
          Object.entries(usage).filter(
            ([, value]) =>
              Number.isSafeInteger(value) && (value as number) >= 0,
          ),
        ),
        costKind: "unknown",
      },
    });
  } catch {
    // Usage history must never fail the picture the writer already paid for.
  }
}

/** Balance and price for the bench to show before the writer opts in. */
export const access = action({
  args: {},
  returns: v.object({
    eligible: v.boolean(),
    availableMicros: v.number(),
  }),
  handler: async (ctx) => {
    const link = await account(ctx);
    const { eligible, availableMicros } = await walletCredit(
      link,
      "scene-image",
    );
    return { eligible, availableMicros };
  },
});

export const picture = action({
  args: { prompt: v.string() },
  returns: v.object({
    base64: v.string(),
    mediaType: v.string(),
    model: v.string(),
  }),
  handler: async (ctx, args) => {
    const prompt = args.prompt.trim();
    if (!prompt) throw new Error("Select a scene before generating a picture.");
    if (prompt.length > MAX_PICTURE_PROMPT_CHARS)
      throw new Error("That passage is too long to picture. Select less text.");
    const link = await account(ctx);
    await consumeRateLimit(ctx, {
      action: "scene:picture",
      identifier: link.identity.tokenIdentifier,
      ...RATE_LIMITS.scenePicture,
    });
    const { eligible, availableMicros } = await walletCredit(
      link,
      "scene-image",
    );
    if (!eligible)
      throw new Error(
        "Hosted pictures need Pro or welcome credit. You can use your own image model in Settings instead.",
      );
    if (availableMicros < SCENE_PICTURE_BUDGET_MICROS)
      throw new Error(
        "Your credit has run out for this month. Add credit, or use your own image model in Settings.",
      );
    const { route, provider } = await hostedRoute(
      link,
      "image",
      "scene-image",
      SCENE_PICTURE_BUDGET_MICROS,
    );
    try {
      const { image } = await generateImage({
        model: provider.image(route.model),
        prompt,
        n: 1,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(120_000),
      });
      await recordAttempt(
        ctx,
        link.identity.tokenIdentifier,
        "scene-image",
        route.model,
        "completed",
      );
      return {
        base64: image.base64,
        mediaType: image.mediaType || "image/png",
        model: route.model,
      };
    } catch (error) {
      await recordAttempt(
        ctx,
        link.identity.tokenIdentifier,
        "scene-image",
        route.model,
        "failed",
      );
      throw error;
    }
  },
});

/** Shows the picture to a vision model and returns its raw JSON answer. */
export const reading = action({
  args: {
    prompt: v.string(),
    imageBase64: v.string(),
    mediaType: v.string(),
  },
  returns: v.object({ text: v.string() }),
  handler: async (ctx, args) => {
    if (args.prompt.length > MAX_READING_PROMPT_CHARS)
      throw new Error("That passage is too long to compare.");
    if (!args.imageBase64 || args.imageBase64.length > MAX_READING_IMAGE_BASE64)
      throw new Error("That picture cannot be compared.");
    if (!/^image\/(png|jpeg|webp|gif)$/.test(args.mediaType))
      throw new Error("Unsupported picture type.");
    const link = await account(ctx);
    await consumeRateLimit(ctx, {
      action: "scene:reading",
      identifier: link.identity.tokenIdentifier,
      ...RATE_LIMITS.scenePicture,
    });
    const { route, provider } = await hostedRoute(
      link,
      "vision",
      "scene-reading",
      SCENE_READING_BUDGET_MICROS,
    );
    try {
      const result = await generateText({
        model: provider.chat(route.model),
        system: SCENE_READING_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: args.prompt },
              {
                type: "image",
                image: args.imageBase64,
                mediaType: args.mediaType,
              },
            ],
          },
        ],
        temperature: 0.2,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(60_000),
      });
      await recordAttempt(
        ctx,
        link.identity.tokenIdentifier,
        "scene-reading",
        route.model,
        "completed",
        {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
      );
      return { text: result.text };
    } catch (error) {
      await recordAttempt(
        ctx,
        link.identity.tokenIdentifier,
        "scene-reading",
        route.model,
        "failed",
      );
      throw error;
    }
  },
});
