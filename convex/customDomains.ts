/**
 * Custom domains for writers' public pages.
 *
 * A writer adds `example.com` or `reports.example.com`; Twyne registers it
 * with the hosting provider (see lib/customDomainProvider.ts), shows the DNS
 * records to create, and checks until the certificate is issued:
 *
 *   pending_dns -> issuing_certificate -> active
 *
 * plus `failed` (gave up, or the provider refused) and `removed`. Hosting on a
 * custom domain costs nothing extra; `CUSTOM_DOMAIN_LIMIT` is a fair-use cap.
 *
 * Not self-serve yet. Railway gives a service about 20 custom domains, so
 * writers join a waitlist (`joinWaitlist`) and keep their twyne.love/<handle>
 * address meanwhile. The team connects a writer's domain from the waitlist
 * with `connectFromWaitlist` (run from the dashboard or `npx convex run`), and
 * only admins can call `add` directly. Once a provider built for many domains
 * replaces Railway, `add` can open to everyone.
 *
 * Every write derives the caller from `ctx.auth`; there is no user argument.
 * A domain belongs to the writer for now; `notorganicOrgId` is reserved for
 * organization ownership later.
 */

import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ownedHandles } from "./profiles";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import {
  customDomainDnsRecordValidator,
  providerDomainStateValidator,
  type ProviderDomainState,
} from "./lib/customDomainProvider";
import {
  CUSTOM_DOMAIN_LIMIT,
  normalizeCustomHostname,
} from "../src/utils/custom-domain-hostnames";
import { hostFromHeader } from "../scripts/custom-domain-routing.mjs";

/* ── Timing ───────────────────────────────────────────────────────── */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Railway retries certificates for 72 hours; there is no point waiting longer. */
export const GIVE_UP_AFTER_MS = 72 * HOUR;
/** Active domains are re-read now and then to notice a provider-side removal. */
const ACTIVE_RECHECK_MS = 6 * HOUR;
/** A scheduled sync holds the row this long, so the cron can't double it. */
const SYNC_LEASE_MS = 2 * MINUTE;
const NOT_CONFIGURED_RETRY_MS = 30 * MINUTE;

/** Quick checks while a writer is likely editing DNS, then slower ones. */
export function nextCheckDelay(checkCount: number): number {
  if (checkCount < 15) return MINUTE;
  if (checkCount < 45) return 5 * MINUTE;
  return 30 * MINUTE;
}

const ACTIVE_STATUSES = [
  "pending_dns",
  "issuing_certificate",
  "active",
  "failed",
] as const;

const statusValidator = v.union(
  v.literal("pending_dns"),
  v.literal("issuing_certificate"),
  v.literal("active"),
  v.literal("failed"),
  v.literal("removed"),
);

const publicDomainValidator = v.object({
  id: v.id("customDomains"),
  hostname: v.string(),
  kind: v.union(v.literal("apex"), v.literal("subdomain")),
  handle: v.string(),
  status: statusValidator,
  dnsRecords: v.array(customDomainDnsRecordValidator),
  registered: v.boolean(),
  lastCheckedAt: v.union(v.number(), v.null()),
  lastError: v.union(v.string(), v.null()),
  activatedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
});

function toPublic(row: Doc<"customDomains">) {
  return {
    id: row._id,
    hostname: row.hostname,
    kind: row.kind,
    handle: row.handle,
    status: row.status,
    dnsRecords: row.dnsRecords,
    registered: Boolean(row.providerDomainId),
    lastCheckedAt: row.lastCheckedAt ?? null,
    lastError: row.lastError ?? null,
    activatedAt: row.activatedAt ?? null,
    createdAt: row.createdAt,
  };
}

/* ── Helpers ──────────────────────────────────────────────────────── */

async function requireIdentity(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "NOT_SIGNED_IN", message: "Sign in first." });
  }
  return identity.tokenIdentifier;
}

async function isAdmin(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<boolean> {
  const row = await ctx.db
    .query("admins")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return row !== null;
}

async function requireOwnedDomain(
  ctx: MutationCtx,
  ownerId: string,
  domainId: Id<"customDomains">,
): Promise<Doc<"customDomains">> {
  const row = await ctx.db.get("customDomains", domainId);
  // Same answer for "missing" and "someone else's" so ids can't be probed.
  if (!row || row.ownerId !== ownerId) {
    throw new ConvexError({
      code: "CUSTOM_DOMAIN_NOT_FOUND",
      message: "That domain isn't on your account.",
    });
  }
  return row;
}

async function liveDomainsFor(
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
): Promise<Doc<"customDomains">[]> {
  const rows: Doc<"customDomains">[] = [];
  for (const status of ACTIVE_STATUSES) {
    rows.push(
      ...(await ctx.db
        .query("customDomains")
        .withIndex("by_ownerId_and_status", (q) =>
          q.eq("ownerId", ownerId).eq("status", status),
        )
        .take(CUSTOM_DOMAIN_LIMIT + 1)),
    );
  }
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

/** Where the provider's answer puts the lifecycle. */
export function statusFromProvider(state: ProviderDomainState): {
  status: "pending_dns" | "issuing_certificate" | "active" | "failed";
  error: string | null;
} {
  if (state.certificate === "valid") return { status: "active", error: null };
  if (state.certificate === "failed" && !state.certificateRetryable) {
    return {
      status: "failed",
      error: state.certificateError ?? "The certificate couldn't be issued.",
    };
  }
  const dnsReady =
    state.records.length > 0 && state.records.every((record) => record.ready);
  return {
    status: dnsReady ? "issuing_certificate" : "pending_dns",
    error: state.certificate === "failed" ? state.certificateError : null,
  };
}

/* ── Writer API ───────────────────────────────────────────────────── */

/** The signed-in writer's domains (removed ones left out). */
export const listMine = query({
  args: {},
  returns: v.array(publicDomainValidator),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await liveDomainsFor(ctx, identity.tokenIdentifier);
    return rows.map(toPublic);
  },
});

/**
 * Claim `hostname` for `ownerId` and start registering it. Shared by the
 * admin-only `add` and by `connectFromWaitlist`; callers check who may do it.
 */
async function connectDomain(
  ctx: MutationCtx,
  ownerId: string,
  hostname: string,
  handle: string | undefined,
): Promise<{ id: Id<"customDomains">; hostname: string }> {
  const parsed = normalizeCustomHostname(hostname);
  if (!parsed.ok) {
    throw new ConvexError({ code: parsed.code, message: parsed.message });
  }

  const handles = await ownedHandles(ctx, ownerId);
  if (!handles.length) {
    throw new ConvexError({
      code: "CUSTOM_DOMAIN_NEEDS_HANDLE",
      message:
        "Claim your Twyne address first. A custom domain shows the page at that address.",
    });
  }
  const wanted = handle?.trim().toLowerCase();
  const handleRow = wanted
    ? handles.find((row) => row.handle === wanted)
    : handles[0];
  if (!handleRow) {
    throw new ConvexError({
      code: "CUSTOM_DOMAIN_HANDLE_NOT_OWNED",
      message: "That Twyne address isn't yours.",
    });
  }

  const existing = await ctx.db
    .query("customDomains")
    .withIndex("by_hostname", (q) => q.eq("hostname", parsed.hostname))
    .unique();
  if (existing && existing.ownerId === ownerId) {
    if (existing.status !== "removed") {
      return { id: existing._id, hostname: existing.hostname };
    }
  } else if (existing && existing.status !== "removed") {
    // A failed claim by someone else (never verified, or gave up) doesn't
    // hold the name: whoever controls the DNS can take it over.
    if (existing.status !== "failed") {
      throw new ConvexError({
        code: "CUSTOM_DOMAIN_TAKEN",
        message:
          "Another Twyne writer has added that domain. If it's yours, contact support.",
      });
    }
  }
  if (existing?.status === "removed" && existing.providerDomainId) {
    throw new ConvexError({
      code: "CUSTOM_DOMAIN_REMOVING",
      message: "That domain is still being removed. Try again in a minute.",
    });
  }

  const live = await liveDomainsFor(ctx, ownerId);
  if (live.length >= CUSTOM_DOMAIN_LIMIT) {
    throw new ConvexError({
      code: "CUSTOM_DOMAIN_LIMIT",
      message: `You can connect up to ${CUSTOM_DOMAIN_LIMIT} domains. Remove one to add another.`,
    });
  }

  const now = Date.now();
  const fields = {
    hostname: parsed.hostname,
    kind: parsed.kind,
    ownerId,
    handle: handleRow.handle,
    status: "pending_dns" as const,
    provider: "railway" as const,
    // A taken-over failed claim keeps its provider registration: it is
    // per hostname, and the sync adopts it.
    providerDomainId: existing?.providerDomainId,
    dnsRecords: [],
    pendingSince: now,
    checkCount: 0,
    nextCheckAt: now + SYNC_LEASE_MS,
    createdAt: now,
    updatedAt: now,
  };
  let id: Id<"customDomains">;
  if (existing) {
    await ctx.db.replace("customDomains", existing._id, fields);
    id = existing._id;
  } else {
    id = await ctx.db.insert("customDomains", fields);
  }
  await ctx.scheduler.runAfter(0, internal.customDomainsSync.sync, {
    domainId: id,
  });
  return { id, hostname: parsed.hostname };
}

/** Admins only for now; writers join the waitlist instead. */
export const add = mutation({
  args: { hostname: v.string(), handle: v.optional(v.string()) },
  returns: v.object({ id: v.id("customDomains"), hostname: v.string() }),
  handler: async (ctx, args) => {
    const ownerId = await requireIdentity(ctx);
    if (!(await isAdmin(ctx, ownerId))) {
      throw new ConvexError({
        code: "CUSTOM_DOMAIN_WAITLIST",
        message:
          "Custom domains aren't open yet. Join the waitlist and we'll set yours up when there's room.",
      });
    }
    await consumeRateLimit(ctx, {
      action: "customDomains:write",
      identifier: ownerId,
      ...RATE_LIMITS.customDomain,
    });
    return connectDomain(ctx, ownerId, args.hostname, args.handle);
  },
});

/** Ask for a check now, e.g. right after creating the DNS records. */
export const recheck = mutation({
  args: { domainId: v.id("customDomains") },
  returns: v.null(),
  handler: async (ctx, { domainId }) => {
    const ownerId = await requireIdentity(ctx);
    const row = await requireOwnedDomain(ctx, ownerId, domainId);
    if (row.status === "removed") {
      throw new ConvexError({
        code: "CUSTOM_DOMAIN_NOT_FOUND",
        message: "That domain isn't on your account.",
      });
    }
    await consumeRateLimit(ctx, {
      action: "customDomains:write",
      identifier: ownerId,
      ...RATE_LIMITS.customDomain,
    });
    const now = Date.now();
    await ctx.db.patch("customDomains", domainId, {
      // Checking a failed domain again starts a new wait for DNS.
      ...(row.status === "failed"
        ? { status: "pending_dns" as const, pendingSince: now, checkCount: 0 }
        : {}),
      nextCheckAt: now + SYNC_LEASE_MS,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.customDomainsSync.sync, {
      domainId,
    });
    return null;
  },
});

export const remove = mutation({
  args: { domainId: v.id("customDomains") },
  returns: v.null(),
  handler: async (ctx, { domainId }) => {
    const ownerId = await requireIdentity(ctx);
    const row = await requireOwnedDomain(ctx, ownerId, domainId);
    if (row.status === "removed") return null;
    const now = Date.now();
    await ctx.db.patch("customDomains", domainId, {
      status: "removed",
      removedAt: now,
      nextCheckAt: undefined,
      updatedAt: now,
    });
    if (row.providerDomainId) {
      await ctx.scheduler.runAfter(0, internal.customDomainsSync.unregister, {
        domainId,
        providerDomainId: row.providerDomainId,
        attempt: 0,
      });
    }
    return null;
  },
});

/* ── Waitlist ─────────────────────────────────────────────────────── */

const waitlistEntryValidator = v.object({
  hostname: v.union(v.string(), v.null()),
  status: v.union(v.literal("waiting"), v.literal("connected")),
  joinedAt: v.number(),
});

async function waitlistEntryFor(
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
): Promise<Doc<"customDomainWaitlist"> | null> {
  return ctx.db
    .query("customDomainWaitlist")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .unique();
}

/** The signed-in writer's place on the waitlist, if any. */
export const myWaitlist = query({
  args: {},
  returns: v.union(v.null(), waitlistEntryValidator),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await waitlistEntryFor(ctx, identity.tokenIdentifier);
    if (!row) return null;
    return {
      hostname: row.hostname ?? null,
      status: row.status,
      joinedAt: row.createdAt,
    };
  },
});

/**
 * Join, or update the domain on an existing entry. The domain is optional:
 * a writer may not have bought one yet. Joining again keeps the original
 * place in the queue.
 */
export const joinWaitlist = mutation({
  args: { hostname: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireIdentity(ctx);
    await consumeRateLimit(ctx, {
      action: "customDomains:write",
      identifier: ownerId,
      ...RATE_LIMITS.customDomain,
    });
    let hostname: string | undefined;
    if (args.hostname?.trim()) {
      const parsed = normalizeCustomHostname(args.hostname);
      if (!parsed.ok) {
        throw new ConvexError({ code: parsed.code, message: parsed.message });
      }
      hostname = parsed.hostname;
    }
    const handles = await ownedHandles(ctx, ownerId);
    const now = Date.now();
    const existing = await waitlistEntryFor(ctx, ownerId);
    if (existing) {
      await ctx.db.patch("customDomainWaitlist", existing._id, {
        hostname,
        handle: existing.handle ?? handles[0]?.handle,
        updatedAt: now,
      });
      return null;
    }
    await ctx.db.insert("customDomainWaitlist", {
      ownerId,
      hostname,
      handle: handles[0]?.handle,
      status: "waiting",
      createdAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const leaveWaitlist = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const ownerId = await requireIdentity(ctx);
    const existing = await waitlistEntryFor(ctx, ownerId);
    if (existing) await ctx.db.delete("customDomainWaitlist", existing._id);
    return null;
  },
});

/** For the team: who's waiting, oldest first. */
export const listWaitlist = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return ctx.db
      .query("customDomainWaitlist")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "waiting"))
      .take(Math.min(Math.max(limit ?? 50, 1), 200));
  },
});

/**
 * For the team: connect a waiting writer's domain. The writer then sees the
 * DNS records on their account page, as if they'd added it themselves.
 */
export const connectFromWaitlist = internalMutation({
  args: {
    entryId: v.id("customDomainWaitlist"),
    hostname: v.optional(v.string()),
  },
  returns: v.object({ id: v.id("customDomains"), hostname: v.string() }),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get("customDomainWaitlist", args.entryId);
    if (!entry) {
      throw new ConvexError({
        code: "WAITLIST_ENTRY_NOT_FOUND",
        message: "That waitlist entry doesn't exist.",
      });
    }
    const hostname = args.hostname ?? entry.hostname;
    if (!hostname) {
      throw new ConvexError({
        code: "HOSTNAME_EMPTY",
        message: "This writer hasn't named a domain; pass one.",
      });
    }
    const result = await connectDomain(
      ctx,
      entry.ownerId,
      hostname,
      entry.handle,
    );
    await ctx.db.patch("customDomainWaitlist", entry._id, {
      status: "connected",
      hostname: result.hostname,
      updatedAt: Date.now(),
    });
    return result;
  },
});

/* ── Serving ──────────────────────────────────────────────────────── */

/**
 * Public: which handle an active custom domain serves. Used by the Node
 * server for every request on a non-Twyne host; returns nothing about
 * domains that aren't live.
 */
export const resolveHost = query({
  args: { hostname: v.string() },
  returns: v.union(v.null(), v.object({ handle: v.string() })),
  handler: async (ctx, args) => {
    const hostname = hostFromHeader(args.hostname);
    if (!hostname || hostname.length > 253) return null;
    const row = await ctx.db
      .query("customDomains")
      .withIndex("by_hostname", (q) => q.eq("hostname", hostname))
      .unique();
    if (!row || row.status !== "active") return null;
    const handle = await ctx.db
      .query("handles")
      .withIndex("by_handle", (q) => q.eq("handle", row.handle))
      .unique();
    if (!handle || handle.userId !== row.ownerId) return null;
    return { handle: row.handle };
  },
});

/* ── Provider sync (internal) ─────────────────────────────────────── */

export const getForSync = internalQuery({
  args: { domainId: v.id("customDomains") },
  returns: v.union(
    v.null(),
    v.object({
      hostname: v.string(),
      status: statusValidator,
      providerDomainId: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { domainId }) => {
    const row = await ctx.db.get("customDomains", domainId);
    if (!row) return null;
    return {
      hostname: row.hostname,
      status: row.status,
      providerDomainId: row.providerDomainId ?? null,
    };
  },
});

export const recordProviderState = internalMutation({
  args: {
    domainId: v.id("customDomains"),
    state: providerDomainStateValidator,
  },
  returns: v.null(),
  handler: async (ctx, { domainId, state }) => {
    const row = await ctx.db.get("customDomains", domainId);
    if (!row) return null;
    const now = Date.now();
    if (row.status === "removed") {
      // Removed while the registration was in flight: don't leak it.
      if (!row.providerDomainId) {
        await ctx.db.patch("customDomains", domainId, {
          providerDomainId: state.id,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(0, internal.customDomainsSync.unregister, {
          domainId,
          providerDomainId: state.id,
          attempt: 0,
        });
      }
      return null;
    }

    let { status, error } = statusFromProvider(state);
    const checkCount = row.checkCount + 1;
    let nextCheckAt: number | undefined;
    if (status === "active") {
      nextCheckAt = now + ACTIVE_RECHECK_MS;
    } else if (status === "failed") {
      nextCheckAt = undefined;
    } else if (now - row.pendingSince > GIVE_UP_AFTER_MS) {
      error =
        status === "issuing_certificate"
          ? "The certificate wasn't issued within 3 days. Press Check again to retry."
          : "The DNS records weren't found within 3 days. Check them, then press Check again.";
      status = "failed";
      nextCheckAt = undefined;
    } else {
      nextCheckAt = now + nextCheckDelay(checkCount);
    }

    await ctx.db.patch("customDomains", domainId, {
      status,
      providerDomainId: state.id,
      kind: state.apex === null ? row.kind : state.apex ? "apex" : "subdomain",
      dnsRecords: state.records,
      checkCount,
      lastCheckedAt: now,
      nextCheckAt,
      lastError: error ?? undefined,
      activatedAt:
        status === "active" ? (row.activatedAt ?? now) : row.activatedAt,
      updatedAt: now,
    });
    return null;
  },
});

export const recordProviderError = internalMutation({
  args: {
    domainId: v.id("customDomains"),
    message: v.string(),
    reason: v.union(
      v.literal("not_configured"),
      v.literal("not_found"),
      v.literal("retryable"),
      v.literal("rejected"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { domainId, message, reason }) => {
    const row = await ctx.db.get("customDomains", domainId);
    if (!row || row.status === "removed") return null;
    const now = Date.now();
    const checkCount = row.checkCount + 1;
    const base = { checkCount, lastCheckedAt: now, updatedAt: now };

    if (reason === "not_found") {
      // The provider lost it; checking again registers it afresh.
      await ctx.db.patch("customDomains", domainId, {
        ...base,
        status: "failed",
        providerDomainId: undefined,
        nextCheckAt: undefined,
        lastError:
          "The host no longer has this domain. Press Check again to set it up again.",
      });
      return null;
    }
    if (reason === "rejected" && !row.providerDomainId) {
      await ctx.db.patch("customDomains", domainId, {
        ...base,
        status: "failed",
        nextCheckAt: undefined,
        lastError: message,
      });
      return null;
    }
    const expired =
      row.status !== "active" && now - row.pendingSince > GIVE_UP_AFTER_MS;
    await ctx.db.patch("customDomains", domainId, {
      ...base,
      ...(expired ? { status: "failed" as const } : {}),
      nextCheckAt: expired
        ? undefined
        : now +
          (reason === "not_configured"
            ? NOT_CONFIGURED_RETRY_MS
            : row.status === "active"
              ? ACTIVE_RECHECK_MS
              : nextCheckDelay(checkCount)),
      lastError: message,
    });
    return null;
  },
});

export const clearProviderDomain = internalMutation({
  args: { domainId: v.id("customDomains"), providerDomainId: v.string() },
  returns: v.null(),
  handler: async (ctx, { domainId, providerDomainId }) => {
    const row = await ctx.db.get("customDomains", domainId);
    if (
      row &&
      row.status === "removed" &&
      row.providerDomainId === providerDomainId
    ) {
      await ctx.db.patch("customDomains", domainId, {
        providerDomainId: undefined,
        dnsRecords: [],
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Cron: schedule a sync for every domain whose next check is due. */
export const scheduleDueChecks = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let scheduled = 0;
    for (const status of [
      "pending_dns",
      "issuing_certificate",
      "active",
    ] as const) {
      const due = await ctx.db
        .query("customDomains")
        .withIndex("by_status_and_nextCheckAt", (q) =>
          q.eq("status", status).gte("nextCheckAt", 0).lte("nextCheckAt", now),
        )
        .take(25);
      for (const row of due) {
        await ctx.db.patch("customDomains", row._id, {
          nextCheckAt: now + SYNC_LEASE_MS,
        });
        await ctx.scheduler.runAfter(0, internal.customDomainsSync.sync, {
          domainId: row._id,
        });
        scheduled++;
      }
    }
    return scheduled;
  },
});
