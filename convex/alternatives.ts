"use node";

/**
 * Alternatives on Twyne's hosted model, for writers without their own key.
 *
 * The browser sends the locked span, a window of paragraph context and the
 * wordings already on screen; this asks the model once (with the shared
 * second-chance retry), holds every line to the span's length window and
 * returns the options that pass. The prompt and the parsing are the same
 * ones the bring-your-own-key path uses (`src/utils/alternatives.ts`).
 */
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { generateWithSecondChance, pickProvider } from "./agents";
import { flushArize } from "./arizeTracing";
import { applicationError } from "./lib/applicationErrors";
import { callerFromIdentity } from "./lib/authIdentity";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import {
  alternativesPrompt,
  checkAlternativeSpan,
  CONTEXT_CHARS,
  MAX_ALTERNATIVE_CHARS,
  MAX_DIRECTION_CHARS,
  MODEL_LENSES_FOR,
  parseAlternatives,
  type AlternativeLens,
  type AlternativeOption,
} from "../src/utils/alternatives";

const scaleValidator = v.union(
  v.literal("word"),
  v.literal("phrase"),
  v.literal("sentence"),
  v.literal("passage"),
);

const lensValidator = v.union(
  v.literal("synonym"),
  v.literal("antonym"),
  v.literal("slot"),
  v.literal("rephrase"),
  v.literal("plainer"),
  v.literal("sharper"),
  v.literal("formal"),
  v.literal("looser"),
  v.literal("opposite"),
  v.literal("steered"),
);

const optionValidator = v.object({
  id: v.string(),
  text: v.string(),
  lens: lensValidator,
  source: v.union(v.literal("lexicon"), v.literal("model")),
  words: v.number(),
  direction: v.optional(v.string()),
});

export const suggest = action({
  args: {
    text: v.string(),
    before: v.string(),
    after: v.string(),
    scale: scaleValidator,
    lenses: v.array(lensValidator),
    count: v.number(),
    exclude: v.array(v.string()),
    /** A direction in the writer's words; asks for steered options only. */
    direction: v.optional(v.string()),
  },
  returns: v.object({ options: v.array(optionValidator) }),
  handler: async (ctx, args): Promise<{ options: AlternativeOption[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw applicationError("authentication_required");
    const caller = callerFromIdentity(identity);

    // Bound everything a caller controls before any work is done: the
    // prompt grows with each of these.
    if (
      !Number.isFinite(args.count) ||
      args.lenses.length > 16 ||
      args.exclude.length > 200 ||
      args.before.length > 4000 ||
      args.after.length > 4000 ||
      (args.direction?.length ?? 0) > 1000
    )
      throw applicationError("validation_failed", {
        message: "That request was larger than Alternatives accepts.",
      });
    const checked = checkAlternativeSpan(args.text);
    if (!checked.ok || args.text.length > MAX_ALTERNATIVE_CHARS)
      throw applicationError("validation_failed", {
        message: checked.ok ? "Select up to a paragraph." : checked.message,
      });
    const direction = args.direction?.trim().slice(0, MAX_DIRECTION_CHARS);
    const allowed = new Set<AlternativeLens>(
      direction ? ["steered"] : MODEL_LENSES_FOR[args.scale],
    );
    const lenses = direction
      ? (["steered"] as AlternativeLens[])
      : [...new Set(args.lenses)].filter((lens) => allowed.has(lens));
    const request = {
      text: args.text,
      before: args.before.slice(-CONTEXT_CHARS * 2),
      after: args.after.slice(0, CONTEXT_CHARS * 2),
      scale: args.scale,
      lenses,
      count: Math.max(1, Math.min(16, Math.round(args.count))),
      exclude: args.exclude.slice(0, 40).map((s) => s.slice(0, 1800)),
      direction,
    };

    await consumeRateLimit(ctx, {
      action: "alternatives",
      identifier: caller.tokenIdentifier,
      ...RATE_LIMITS.alternatives,
    });
    const provider = await pickProvider(ctx, caller, "alternatives", "fast");
    if (!provider)
      throw applicationError("provider_unavailable", {
        recovery: "open_settings",
      });
    const { system, prompt } = alternativesPrompt(request);
    try {
      const result = await generateWithSecondChance(
        {
          ctx,
          caller,
          provider,
          feature: "alternatives",
          usageFeature: "alternatives",
          system,
          prompt,
          temperature: 0.8,
          functionId: "alternatives",
          metadata: { scale: args.scale },
        },
        (visible) => {
          const options = parseAlternatives(visible, request).map((option) =>
            direction ? { ...option, direction } : option,
          );
          return options.length ? options : null;
        },
      );
      if (!result) throw applicationError("malformed_response");
      return { options: result.value };
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw applicationError("provider_unavailable", { recovery: "retry" });
    } finally {
      await flushArize();
    }
  },
});
