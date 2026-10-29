/**
 * Twyne's achievements on the Not Organic ledger. Earning is checked from
 * synced data on the server, a few minutes after the writer syncs, accepts an
 * edit, or publishes; nothing is awarded from a browser's say-so.
 */
import {
  makeFunctionReference,
  type FunctionReturnType,
  paginationOptsValidator,
} from "convex/server";
import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import {
  achievementValidator,
  awardNotOrganicAchievement,
  listNotOrganicAchievements,
  TWYNE_ACHIEVEMENTS,
  type TwyneAchievement,
} from "./lib/notorganicAchievements";

/** Background checks run at most this often per account. */
const CHECK_COOLDOWN_MS = 10 * 60 * 1000;
/** Opening Account re-checks at most this often. */
const VISIT_COOLDOWN_MS = 2 * 60 * 1000;
const TEN_THOUSAND_WORDS = 10_000;
const WELL_SOURCED_CITATIONS = 10;

const evaluateReference = makeFunctionReference<
  "action",
  { ownerId: string },
  null
>("achievements:evaluate");
const stateReference = makeFunctionReference<
  "query",
  { ownerId: string },
  {
    awarded: string[];
    link: { did: string; sessionVersion: number } | null;
  } | null
>("achievements:getState");
const accountFactsReference = makeFunctionReference<
  "query",
  { ownerId: string },
  { hasFolio: boolean; hasPublished: boolean }
>("achievements:accountFacts");
const contentFactsReference = makeFunctionReference<
  "query",
  {
    ownerId: string;
    paginationOpts: {
      numItems: number;
      cursor: string | null;
      maximumBytesRead?: number;
    };
  },
  {
    words: number;
    maxCitations: number;
    continueCursor: string;
    isDone: boolean;
  }
>("achievements:contentFacts");
const suggestionFactsReference = makeFunctionReference<
  "query",
  {
    ownerId: string;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  { accepted: boolean; cut: boolean; continueCursor: string; isDone: boolean }
>("achievements:suggestionFacts");
const recordReference = makeFunctionReference<
  "mutation",
  { ownerId: string; awarded: string[] },
  null
>("achievements:record");
const claimVisitReference = makeFunctionReference<
  "mutation",
  { ownerId: string; productSubject: string },
  boolean
>("achievements:claimVisitCheck");

/**
 * Schedule a check for the signed-in writer. Cheap enough to call from hot
 * sync mutations: one indexed read, and a write at most once per cooldown.
 */
export async function scheduleAchievementCheck(
  ctx: MutationCtx,
  options: { soon?: boolean } = {},
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return;
  const ownerId = identity.tokenIdentifier;
  const state = await ctx.db
    .query("achievementState")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .unique();
  const now = Date.now();
  const cooldown = options.soon ? 30_000 : CHECK_COOLDOWN_MS;
  if (state && state.scheduledAt > now - cooldown) return;
  if (state && state.awarded.length >= TWYNE_ACHIEVEMENTS.length) return;
  if (state)
    await ctx.db.patch("achievementState", state._id, { scheduledAt: now });
  else
    await ctx.db.insert("achievementState", {
      ownerId,
      productSubject: identity.subject || ownerId,
      awarded: [],
      scheduledAt: now,
    });
  // Let the edit that triggered this settle before reading it back.
  await ctx.scheduler.runAfter(
    options.soon ? 5_000 : 60_000,
    evaluateReference,
    {
      ownerId,
    },
  );
}

export const getState = internalQuery({
  args: { ownerId: v.string() },
  returns: v.union(
    v.object({
      awarded: v.array(v.string()),
      link: v.union(
        v.object({ did: v.string(), sessionVersion: v.number() }),
        v.null(),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, { ownerId }) => {
    const state = await ctx.db
      .query("achievementState")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .unique();
    if (!state) return null;
    const link = await ctx.db
      .query("providerIdentities")
      .withIndex("by_productSubject", (q) =>
        q.eq("productSubject", state.productSubject),
      )
      .unique();
    return {
      awarded: state.awarded,
      link:
        link?.verificationMethod === "notorganic_pkce"
          ? { did: link.did, sessionVersion: link.sessionVersion }
          : null,
    };
  },
});

export const accountFacts = internalQuery({
  args: { ownerId: v.string() },
  returns: v.object({ hasFolio: v.boolean(), hasPublished: v.boolean() }),
  handler: async (ctx, { ownerId }) => {
    const [folios, published] = await Promise.all([
      ctx.db
        .query("folios")
        .withIndex("by_userId", (q) => q.eq("userId", ownerId))
        .first(),
      ctx.db
        .query("published")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .first(),
    ]);
    return {
      hasFolio: (folios?.folios.length ?? 0) > 0,
      hasPublished: published !== null,
    };
  },
});

/** Words in a manuscript's synced HTML (or Typst source, for Typst folios). */
export function manuscriptWords(html: string, typstSource?: string): number {
  const text = html.trim()
    ? html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ")
    : (typstSource ?? "").replace(/[#=*_`$\\[\]{}()]/g, " ");
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Footnotes and endnotes in HTML, or footnotes and citations in Typst. */
export function manuscriptCitations(
  html: string,
  typstSource?: string,
): number {
  return html.trim()
    ? (html.match(/<sup\b[^>]*data-type="(?:endnote|footnote)"/g) ?? []).length
    : ((typstSource ?? "").match(/#(?:footnote|cite)\b/g) ?? []).length;
}

export const contentFacts = internalQuery({
  args: { ownerId: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    words: v.number(),
    maxCitations: v.number(),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { ownerId, paginationOpts }) => {
    const result = await ctx.db
      .query("folioContent")
      .withIndex("by_userId", (q) => q.eq("userId", ownerId))
      .paginate(paginationOpts);
    let words = 0;
    let maxCitations = 0;
    for (const row of result.page) {
      words += manuscriptWords(row.html, row.typstSource);
      maxCitations = Math.max(
        maxCitations,
        manuscriptCitations(row.html, row.typstSource),
      );
    }
    return {
      words,
      maxCitations,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const suggestionFacts = internalQuery({
  args: { ownerId: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    accepted: v.boolean(),
    cut: v.boolean(),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { ownerId, paginationOpts }) => {
    const result = await ctx.db
      .query("suggestions")
      .withIndex("by_userId", (q) => q.eq("userId", ownerId))
      .paginate(paginationOpts);
    const accepted = result.page.filter((row) => row.status === "accepted");
    return {
      accepted: accepted.length > 0,
      // An accepted persona edit that removes the passage outright.
      cut: accepted.some(
        (row) => row.original.trim() !== "" && row.replacement.trim() === "",
      ),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const record = internalMutation({
  args: { ownerId: v.string(), awarded: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { ownerId, awarded }) => {
    const state = await ctx.db
      .query("achievementState")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .unique();
    if (!state) return null;
    await ctx.db.patch("achievementState", state._id, {
      awarded: [...new Set([...state.awarded, ...awarded])],
      checkedAt: Date.now(),
    });
    return null;
  },
});

/** Which Twyne achievements the account's synced data shows it has earned. */
async function earnedAchievements(
  ctx: ActionCtx,
  ownerId: string,
  skip: ReadonlySet<string>,
): Promise<Set<TwyneAchievement>> {
  const earned = new Set<TwyneAchievement>();
  const facts = await ctx.runQuery(accountFactsReference, { ownerId });
  if (facts.hasFolio) earned.add("first-draft");
  if (facts.hasPublished) earned.add("out-the-door");

  if (!skip.has("ten-thousand-words") || !skip.has("well-sourced")) {
    let words = 0;
    let citations = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: FunctionReturnType<typeof contentFactsReference> =
        await ctx.runQuery(contentFactsReference, {
          ownerId,
          paginationOpts: {
            numItems: 50,
            cursor,
            maximumBytesRead: 4 * 1024 * 1024,
          },
        });
      words += page.words;
      citations = Math.max(citations, page.maxCitations);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    if (words > 0) earned.add("first-draft");
    if (words >= TEN_THOUSAND_WORDS) earned.add("ten-thousand-words");
    if (citations >= WELL_SOURCED_CITATIONS) earned.add("well-sourced");
  }

  if (!skip.has("notes-from-the-room") || !skip.has("kill-your-darlings")) {
    let cursor: string | null = null;
    for (;;) {
      const page: FunctionReturnType<typeof suggestionFactsReference> =
        await ctx.runQuery(suggestionFactsReference, {
          ownerId,
          paginationOpts: { numItems: 200, cursor },
        });
      if (page.accepted) earned.add("notes-from-the-room");
      if (page.cut) earned.add("kill-your-darlings");
      if (page.isDone || earned.has("kill-your-darlings")) break;
      cursor = page.continueCursor;
    }
  }
  return earned;
}

async function evaluateAndAward(ctx: ActionCtx, ownerId: string) {
  const state = await ctx.runQuery(stateReference, { ownerId });
  if (!state?.link) return;
  const already = new Set(state.awarded);
  if (TWYNE_ACHIEVEMENTS.every((key) => already.has(key))) return;
  const earned = await earnedAchievements(ctx, ownerId, already);
  const awarded: string[] = [];
  for (const key of earned) {
    if (already.has(key)) continue;
    try {
      await awardNotOrganicAchievement(state.link, key);
      awarded.push(key);
    } catch (error) {
      // Left unrecorded, so the next check retries it.
      console.warn(`[twyne:achievements] award ${key} failed`, error);
    }
  }
  await ctx.runMutation(recordReference, { ownerId, awarded });
}

export const evaluate = internalAction({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, { ownerId }) => {
    await evaluateAndAward(ctx, ownerId);
    return null;
  },
});

export const claimVisitCheck = internalMutation({
  args: { ownerId: v.string(), productSubject: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { ownerId, productSubject }) => {
    const state = await ctx.db
      .query("achievementState")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .unique();
    const now = Date.now();
    if (!state) {
      await ctx.db.insert("achievementState", {
        ownerId,
        productSubject,
        awarded: [],
        scheduledAt: now,
      });
      return true;
    }
    if (state.scheduledAt > now - VISIT_COOLDOWN_MS) return false;
    await ctx.db.patch("achievementState", state._id, { scheduledAt: now });
    return true;
  },
});

/**
 * The writer's achievements across every Not Organic app. Checks Twyne's own
 * first, so anything just earned is on the list the writer is looking at.
 */
export const listMine = action({
  args: {},
  returns: v.array(achievementValidator),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const ownerId = identity.tokenIdentifier;
    if (
      await ctx.runMutation(claimVisitReference, {
        ownerId,
        productSubject: identity.subject || ownerId,
      })
    )
      await evaluateAndAward(ctx, ownerId).catch((error) =>
        console.warn("[twyne:achievements] check failed", error),
      );
    const state = await ctx.runQuery(stateReference, { ownerId });
    if (!state?.link)
      throw new Error("Sign in with Not Organic to see achievements.");
    return await listNotOrganicAchievements(state.link);
  },
});
