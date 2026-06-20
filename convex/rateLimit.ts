/**
 * Internal mutation backing the rate limiter. Defined in a top-level Convex
 * file (not under `lib/`) so the Convex scanner picks it up and generates an
 * `internal.rateLimit.consume` reference. The logic lives in
 * `convex/lib/rateLimit.ts` so it can be shared with the inline mutation path.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { consumeInline, RateLimitError } from "./lib/rateLimit";

export const consume = internalMutation({
  args: {
    action: v.string(),
    identifier: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      await consumeInline(ctx.db as any, args);
      return { ok: true as const };
    } catch (err) {
      if (err instanceof RateLimitError) {
        return {
          ok: false as const,
          error: err.message,
          retryAfterMs: err.retryAfterMs,
        };
      }
      // Unknown error — rethrow so the action sees it.
      throw err;
    }
  },
});
