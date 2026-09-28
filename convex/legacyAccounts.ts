/**
 * Retiring pre–Not Organic accounts (email OTP / passkey sign-ins).
 *
 * Operator-only: every function is internal and meant to be run with
 * `npx convex run`. Always run with `dryRun: true` first.
 *
 *   npx convex run legacyAccounts:sendDeprecationNotices '{"dryRun":true}'
 *   npx convex run legacyAccounts:retireLegacyAccounts '{"dryRun":true}'
 */
import { v } from "convex/values";
import { Resend } from "resend";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { scheduleAccountDeletion } from "./account";

const PAGE_SIZE = 100;
const PLACEHOLDER_EMAIL_SUFFIX = "@notorganic.invalid";

export const DEPRECATION_SUBJECT = "Twyne accounts are moving to Not Organic";

export const DEPRECATION_TEXT = `Hello,

You're getting this because you once created a Twyne account with your email address.

Those email and passkey accounts are now deprecated. Twyne sign-in has moved to Not Organic accounts: one account for your identity, your plan and your published writing.

What this means for you:

- Your old Twyne account and anything synced to it will be deleted shortly.
- Folios saved in your browser stay on that device, so export any you want to keep before clearing browser data.
- To keep writing, sign in at https://twyne.love/signin/ with "Continue with Not Organic". You can create a Not Organic account there if you don't have one.

Nothing was ever charged to these accounts, and there is nothing you need to cancel.

Questions? Reply to this email.

— Twyne`;

const legacyUser = v.object({ userId: v.string(), email: v.string() });

const adapter = (
  components.betterAuth as unknown as {
    adapter: { findMany: unknown };
  }
).adapter;

/** One page of Better Auth users that did not sign in through Not Organic. */
export const listLegacyUsers = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    users: v.array(legacyUser),
    cursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const page = (await ctx.runQuery(
      adapter.findMany as never,
      {
        model: "user",
        paginationOpts: { cursor, numItems: PAGE_SIZE },
      } as never,
    )) as {
      page: Array<{ _id: string; email?: string }>;
      continueCursor: string;
      isDone: boolean;
    };
    const users = page.page
      .filter(
        (user) =>
          typeof user.email === "string" &&
          !user.email.endsWith(PLACEHOLDER_EMAIL_SUFFIX),
      )
      .map((user) => ({ userId: user._id, email: user.email! }));
    return { users, cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const getNotice = internalQuery({
  args: { userId: v.string() },
  returns: v.union(
    v.object({
      notifiedAt: v.optional(v.number()),
      retiredAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("legacyAccountNotices")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return row
      ? { notifiedAt: row.notifiedAt, retiredAt: row.retiredAt }
      : null;
  },
});

export const markNotified = internalMutation({
  args: legacyUser.fields,
  returns: v.null(),
  handler: async (ctx, { userId, email }) => {
    const row = await ctx.db
      .query("legacyAccountNotices")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (row) await ctx.db.patch(row._id, { notifiedAt: Date.now() });
    else
      await ctx.db.insert("legacyAccountNotices", {
        userId,
        email,
        notifiedAt: Date.now(),
      });
    return null;
  },
});

/** Delete one legacy account: its synced data, sessions and user row. */
export const retireLegacyUser = internalMutation({
  args: legacyUser.fields,
  returns: v.null(),
  handler: async (ctx, { userId, email }) => {
    const issuer = process.env.CONVEX_SITE_URL;
    if (!issuer) throw new Error("CONVEX_SITE_URL is not set");
    await scheduleAccountDeletion(ctx, {
      // Matches the tokenIdentifier Convex derived from this user's JWT.
      ownerId: `${issuer}|${userId}`,
      productSubject: userId,
      email,
      userId,
    });
    const row = await ctx.db
      .query("legacyAccountNotices")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (row) await ctx.db.patch(row._id, { retiredAt: Date.now() });
    else
      await ctx.db.insert("legacyAccountNotices", {
        userId,
        email,
        retiredAt: Date.now(),
      });
    return null;
  },
});

async function collectLegacyUsers(ctx: {
  runQuery: <T>(ref: any, args: any) => Promise<T>;
}) {
  const users: Array<{ userId: string; email: string }> = [];
  let cursor: string | null = null;
  for (;;) {
    const page: {
      users: Array<{ userId: string; email: string }>;
      cursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.legacyAccounts.listLegacyUsers, {
      cursor,
    });
    users.push(...page.users);
    if (page.isDone) return users;
    cursor = page.cursor;
  }
}

/** Email every legacy account holder once. `dryRun` lists recipients only. */
export const sendDeprecationNotices = internalAction({
  args: { dryRun: v.boolean() },
  returns: v.object({
    recipients: v.array(v.string()),
    sent: v.number(),
    skipped: v.number(),
    failed: v.array(v.string()),
  }),
  handler: async (ctx, { dryRun }) => {
    const users = await collectLegacyUsers(ctx);
    const pending: typeof users = [];
    for (const user of users) {
      const notice = await ctx.runQuery(internal.legacyAccounts.getNotice, {
        userId: user.userId,
      });
      if (!notice?.notifiedAt) pending.push(user);
    }
    const recipients = pending.map((user) => user.email);
    if (dryRun) {
      return {
        recipients,
        sent: 0,
        skipped: users.length - pending.length,
        failed: [],
      };
    }
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set");
    const resend = new Resend(apiKey);
    const from = process.env.RESEND_FROM_EMAIL ?? "Twyne <support@twyne.love>";
    let sent = 0;
    const failed: string[] = [];
    for (const user of pending) {
      const { error } = await resend.emails.send({
        from,
        to: user.email,
        subject: DEPRECATION_SUBJECT,
        text: DEPRECATION_TEXT,
      });
      if (error) {
        failed.push(user.email);
        continue;
      }
      await ctx.runMutation(internal.legacyAccounts.markNotified, user);
      sent += 1;
    }
    return {
      recipients,
      sent,
      skipped: users.length - pending.length,
      failed,
    };
  },
});

/** Retire every legacy account. `dryRun` lists what would be deleted. */
export const retireLegacyAccounts = internalAction({
  args: { dryRun: v.boolean() },
  returns: v.object({ accounts: v.array(v.string()), retired: v.number() }),
  handler: async (ctx, { dryRun }) => {
    const users = await collectLegacyUsers(ctx);
    const accounts = users.map((user) => user.email);
    if (dryRun) return { accounts, retired: 0 };
    for (const user of users) {
      await ctx.runMutation(internal.legacyAccounts.retireLegacyUser, user);
    }
    return { accounts, retired: users.length };
  },
});
