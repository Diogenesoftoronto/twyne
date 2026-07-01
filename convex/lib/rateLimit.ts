/**
 * Fixed-window rate limiting for Convex mutations and actions.
 *
 * Backed by the `rateBuckets` table: one row per (action, identifier).
 * The identifier is usually the user's Convex tokenIdentifier; for
 * unauthenticated paths (OTP request, public webhook) it can be an email
 * or IP-shaped string.
 *
 * Usage inside a mutation/action handler:
 *
 *   await consumeRateLimit(ctx, {
 *     action: "otp:send",
 *     identifier: email,
 *     limit: 5,
 *     windowMs: 60_000,
 *   });
 *
 * Throws `RateLimitError` when the limit is exceeded. Callers should catch
 * and return a 429-shaped message; the client surfaces the message verbatim.
 *
 * This is intentionally simple (no sliding window, no tiered limits) — the
 * goal is to stop abuse of expensive paths (OTP email, AI calls, hosted
 * voice), not to enforce precise quotas.
 *
 * Context handling: a MutationCtx has `db` directly; an ActionCtx only has
 * `runMutation`. We probe the shape and route through the internal mutation
 * from actions, inline through `ctx.db` from mutations.
 */

export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

interface ConsumeArgs {
  action: string;
  identifier: string;
  limit: number;
  windowMs: number;
}

/**
 * Consume one unit from the rate-limit bucket. Throws `RateLimitError`
 * when the limit is exceeded within the current window.
 *
 * Works from both mutations (uses `ctx.db` inline) and actions (routes
 * through the `rateLimit.consume` internal mutation). The throw is
 * re-raised across the internal-mutation hop via the thrown error's
 * message.
 */
export async function consumeRateLimit(
  ctx: RateLimitCtx,
  { action, identifier, limit, windowMs }: ConsumeArgs,
): Promise<void> {
  // Mutation context: write directly.
  if (typeof (ctx as MutationCtx).db?.query === "function") {
    await consumeInline((ctx as MutationCtx).db, {
      action,
      identifier,
      limit,
      windowMs,
    });
    return;
  }
  // Action context: route through the internal mutation.
  if (typeof (ctx as ActionCtx).runMutation === "function") {
    // `internal` is lazily resolved so the module also loads in non-action
    // contexts (where `_generated/api` may not be resolvable).
    const { internal } = await import("../_generated/api");
    const result = await (ctx as ActionCtx).runMutation(
      internal.rateLimit.consume,
      { action, identifier, limit, windowMs },
    );
    if (result && typeof result === "object" && "error" in result) {
      throw new RateLimitError(
        (result as { error: string }).error,
        (result as { retryAfterMs: number }).retryAfterMs,
      );
    }
    return;
  }
  // Unknown context — fail open (don't block the handler).
  console.warn("[twyne:rateLimit] unknown ctx shape, skipping rate limit");
}

interface BucketDb {
  query: (table: "rateBuckets") => {
    withIndex: (
      name: "by_action_identifier",
      builder: (q: any) => any,
    ) => { unique: () => Promise<any> };
  };
  insert: (table: "rateBuckets", doc: any) => Promise<any>;
  patch: (id: any, patch: any) => Promise<void>;
}

type MutationCtx = { db: BucketDb };
type ActionCtx = { runMutation: (ref: any, args: any) => Promise<any> };
type RateLimitCtx = Partial<MutationCtx> & Partial<ActionCtx>;

/** Inline implementation — shared by the mutation path and the internal mutation. */
export async function consumeInline(
  db: BucketDb,
  { action, identifier, limit, windowMs }: ConsumeArgs,
): Promise<void> {
  const now = Date.now();
  const existing = await db
    .query("rateBuckets")
    .withIndex("by_action_identifier", (q: any) =>
      q.eq("action", action).eq("identifier", identifier),
    )
    .unique();

  if (!existing) {
    await db.insert("rateBuckets", {
      action,
      identifier,
      count: 1,
      windowStart: now,
    });
    return;
  }

  if (now - existing.windowStart >= windowMs) {
    await db.patch(existing._id, {
      count: 1,
      windowStart: now,
    });
    return;
  }

  if (existing.count >= limit) {
    const retryAfterMs = windowMs - (now - existing.windowStart);
    throw new RateLimitError(
      `Too many requests. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
      retryAfterMs,
    );
  }

  await db.patch(existing._id, { count: existing.count + 1 });
}

/* ── Sensible defaults per protected action ──────────────────────── */

export const RATE_LIMITS = {
  /** OTP verification email: 5 per minute per email. */
  otpSend: { limit: 5, windowMs: 60_000 },
  /** Creem checkout creation: 10 per minute per user. */
  checkoutCreate: { limit: 10, windowMs: 60_000 },
  /** Hosted voice synthesis: 20 per minute per user. */
  voiceSynthesize: { limit: 20, windowMs: 60_000 },
  /** Room of editors feedback: 30 per minute per user. */
  agentFeedback: { limit: 30, windowMs: 60_000 },
  /** Suggested rewrite: 30 per minute per user. */
  agentRewrite: { limit: 30, windowMs: 60_000 },
  /** Research / apparatus, Pro tier: 15 per minute per user. */
  research: { limit: 15, windowMs: 60_000 },
  /** Research / apparatus, signed-in free tier: 5 per minute per user. */
  researchFree: { limit: 5, windowMs: 60_000 },
  /** Room convene (fans out to one LLM call per persona): 6 per minute. */
  agentRoom: { limit: 6, windowMs: 60_000 },
  /** Handle claim attempts: 5 per minute per user. */
  handleClaim: { limit: 5, windowMs: 60_000 },
  /** Avatar upload URL requests: 10 per minute per user. */
  avatarUpload: { limit: 10, windowMs: 60_000 },
} as const;
