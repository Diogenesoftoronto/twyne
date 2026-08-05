/** Authenticated data boundary for Twyne's CLI and local MCP server. */
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

const MAX_TOKEN_NAME_LENGTH = 80;
const MAX_FOLIO_NAME_LENGTH = 240;
const MAX_FOLIOS_PER_ACCOUNT = 500;
const MAX_SEARCH_RESULTS = 50;

const folioType = v.union(
  v.literal("draft"),
  v.literal("notes"),
  v.literal("outline"),
);
const folioInput = v.object({
  id: v.optional(v.string()),
  name: v.string(),
  type: v.optional(folioType),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  layout: v.optional(v.any()),
  header: v.optional(v.string()),
  footer: v.optional(v.string()),
});
const includeValue = v.union(
  v.literal("content"),
  v.literal("brief"),
  v.literal("feedback"),
  v.literal("rubric"),
  v.literal("suggestions"),
  v.literal("citations"),
);

async function requireIdentity(ctx: {
  auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  return identity.tokenIdentifier;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function createSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `twyne_pat_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export const createToken = mutation({
  args: { name: v.string() },
  returns: v.object({
    id: v.id("integrationTokens"),
    name: v.string(),
    prefix: v.string(),
    token: v.string(),
    createdAt: v.number(),
  }),
  handler: async (ctx, { name }) => {
    const userId = await requireIdentity(ctx);
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error("Token name is required");
    if (normalizedName.length > MAX_TOKEN_NAME_LENGTH) {
      throw new Error(
        `Token name must be ${MAX_TOKEN_NAME_LENGTH} characters or fewer`,
      );
    }
    const token = createSecret();
    const prefix = token.slice(0, 18);
    const createdAt = Date.now();
    const id = await ctx.db.insert("integrationTokens", {
      userId,
      tokenHash: await sha256(token),
      prefix,
      name: normalizedName,
      createdAt,
    });
    return { id, name: normalizedName, prefix, token, createdAt };
  },
});

export const listTokens = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("integrationTokens"),
      name: v.string(),
      prefix: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    const rows = await ctx.db
      .query("integrationTokens")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    return rows.map((row) => ({
      id: row._id,
      name: row.name,
      prefix: row.prefix,
      createdAt: row.createdAt,
    }));
  },
});

export const revokeToken = mutation({
  args: { id: v.id("integrationTokens") },
  returns: v.boolean(),
  handler: async (ctx, { id }) => {
    const userId = await requireIdentity(ctx);
    const token = await ctx.db.get("integrationTokens", id);
    if (!token || token.userId !== userId) return false;
    await ctx.db.delete("integrationTokens", id);
    return true;
  },
});

/** Called only after the HTTP route has hashed the presented bearer token. */
export const authenticate = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.union(v.null(), v.object({ userId: v.string() })),
  handler: async (ctx, { tokenHash }) => {
    const token = await ctx.db
      .query("integrationTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    return token ? { userId: token.userId } : null;
  },
});

export const listFolios = internalQuery({
  args: { userId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("folios")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    return Array.isArray(row?.folios) ? row.folios : [];
  },
});

export const getFolio = internalQuery({
  args: {
    userId: v.string(),
    folioId: v.string(),
    include: v.array(includeValue),
  },
  returns: v.any(),
  handler: async (ctx, { userId, folioId, include }) => {
    const foliosRow = await ctx.db
      .query("folios")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const folio = (foliosRow?.folios ?? []).find(
      (candidate: { id?: unknown }) => candidate?.id === folioId,
    );
    if (!folio) return null;

    const wanted = new Set(include);
    const bundle: Record<string, unknown> = { folio };
    if (wanted.has("content")) {
      const row = await ctx.db
        .query("folioContent")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", userId).eq("folioId", folioId),
        )
        .first();
      bundle.html = row?.html ?? "";
      bundle.contentUpdatedAt = row?.updatedAt ?? null;
    }
    if (wanted.has("brief")) {
      const row = await ctx.db
        .query("briefs")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", userId).eq("folioId", folioId),
        )
        .first();
      bundle.brief = row?.brief ?? null;
    }
    if (wanted.has("feedback")) {
      const [notes, replies] = await Promise.all([
        ctx.db
          .query("personaNotes")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", folioId),
          )
          .collect(),
        ctx.db
          .query("personaReplies")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", folioId),
          )
          .collect(),
      ]);
      bundle.feedback = {
        notes: notes.sort((a, b) => a.createdAt - b.createdAt),
        replies: replies.sort((a, b) => a.createdAt - b.createdAt),
      };
    }
    if (wanted.has("rubric")) {
      const row = await ctx.db
        .query("rubricResults")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", userId).eq("folioId", folioId),
        )
        .first();
      bundle.rubric = row?.result ?? null;
    }
    if (wanted.has("suggestions")) {
      bundle.suggestions = await ctx.db
        .query("suggestions")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", userId).eq("folioId", folioId),
        )
        .collect();
    }
    if (wanted.has("citations")) {
      const row = await ctx.db
        .query("bibliographies")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();
      bundle.citations = (row?.entries ?? []).filter(
        (entry: { folioId?: unknown }) =>
          !entry?.folioId || entry.folioId === folioId,
      );
    }
    return bundle;
  },
});

export const putFolio = internalMutation({
  args: {
    userId: v.string(),
    folio: folioInput,
    html: v.optional(v.string()),
    brief: v.optional(v.any()),
    expectedUpdatedAt: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const name = args.folio.name.trim();
    if (!name) throw new Error("Folio name is required");
    if (name.length > MAX_FOLIO_NAME_LENGTH) {
      throw new Error(
        `Folio name must be ${MAX_FOLIO_NAME_LENGTH} characters or fewer`,
      );
    }
    const foliosRow = await ctx.db
      .query("folios")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    const folios = Array.isArray(foliosRow?.folios)
      ? [...foliosRow.folios]
      : [];
    const id = args.folio.id?.trim() || crypto.randomUUID();
    const index = folios.findIndex(
      (candidate: { id?: unknown }) => candidate?.id === id,
    );
    const previous = index >= 0 ? folios[index] : null;
    if (
      args.expectedUpdatedAt !== undefined &&
      previous?.updatedAt !== args.expectedUpdatedAt
    ) {
      throw new Error(
        `Folio changed since it was read (expected ${args.expectedUpdatedAt}, found ${previous?.updatedAt ?? "missing"})`,
      );
    }
    if (index < 0 && folios.length >= MAX_FOLIOS_PER_ACCOUNT) {
      throw new Error(
        `An account can hold at most ${MAX_FOLIOS_PER_ACCOUNT} folios`,
      );
    }
    const now = Date.now();
    const next = {
      ...(previous ?? {}),
      id,
      name,
      type: args.folio.type ?? previous?.type ?? "draft",
      createdAt: previous?.createdAt ?? args.folio.createdAt ?? now,
      updatedAt: now,
      ...(args.folio.layout !== undefined ? { layout: args.folio.layout } : {}),
      ...(args.folio.header !== undefined ? { header: args.folio.header } : {}),
      ...(args.folio.footer !== undefined ? { footer: args.folio.footer } : {}),
    };
    if (index >= 0) folios[index] = next;
    else folios.push(next);

    if (foliosRow) {
      await ctx.db.patch(foliosRow._id, { folios, updatedAt: now });
    } else {
      await ctx.db.insert("folios", {
        userId: args.userId,
        folios,
        updatedAt: now,
      });
    }
    if (args.html !== undefined) {
      const row = await ctx.db
        .query("folioContent")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", args.userId).eq("folioId", id),
        )
        .first();
      if (row) await ctx.db.patch(row._id, { html: args.html, updatedAt: now });
      else {
        await ctx.db.insert("folioContent", {
          userId: args.userId,
          folioId: id,
          html: args.html,
          updatedAt: now,
        });
      }
    }
    if (args.brief !== undefined) {
      const row = await ctx.db
        .query("briefs")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", args.userId).eq("folioId", id),
        )
        .first();
      if (row)
        await ctx.db.patch(row._id, { brief: args.brief, updatedAt: now });
      else {
        await ctx.db.insert("briefs", {
          userId: args.userId,
          folioId: id,
          brief: args.brief,
          updatedAt: now,
        });
      }
    }
    return next;
  },
});

export const getFeedback = internalQuery({
  args: { userId: v.string(), folioId: v.string() },
  returns: v.any(),
  handler: async (ctx, { userId, folioId }) => {
    const [notes, replies, rubric, suggestions] = await Promise.all([
      ctx.db
        .query("personaNotes")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", userId).eq("folioId", folioId),
        )
        .collect(),
      ctx.db
        .query("personaReplies")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", userId).eq("folioId", folioId),
        )
        .collect(),
      ctx.db
        .query("rubricResults")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", userId).eq("folioId", folioId),
        )
        .first(),
      ctx.db
        .query("suggestions")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", userId).eq("folioId", folioId),
        )
        .collect(),
    ]);
    return {
      notes: notes.sort((a, b) => a.createdAt - b.createdAt),
      replies: replies.sort((a, b) => a.createdAt - b.createdAt),
      rubric: rubric?.result ?? null,
      suggestions: suggestions.sort((a, b) => a.createdAt - b.createdAt),
    };
  },
});

export const listCitations = internalQuery({
  args: {
    userId: v.string(),
    folioId: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, { userId, folioId, search }) => {
    const row = await ctx.db
      .query("bibliographies")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const needle = search?.trim().toLowerCase();
    return (row?.entries ?? []).filter((entry: Record<string, unknown>) => {
      if (folioId && entry.folioId && entry.folioId !== folioId) return false;
      if (!needle) return true;
      return [
        entry.title,
        entry.author,
        entry.url,
        entry.doi,
        entry.citationKey,
      ]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(needle));
    });
  },
});

export const putCitations = internalMutation({
  args: {
    userId: v.string(),
    folioId: v.string(),
    entries: v.array(v.any()),
  },
  returns: v.object({ saved: v.number() }),
  handler: async (ctx, { userId, folioId, entries }) => {
    if (entries.length > 100) {
      throw new Error("At most 100 citations may be saved at once");
    }
    const row = await ctx.db
      .query("bibliographies")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const merged = [...(row?.entries ?? [])];
    for (const raw of entries) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Each citation must be an object");
      }
      const entry = { ...raw, folioId } as Record<string, unknown>;
      if (typeof entry.title !== "string" || !entry.title.trim()) {
        throw new Error("Each citation needs a title");
      }
      if (typeof entry.id !== "string" || !entry.id.trim()) {
        entry.id = crypto.randomUUID();
      }
      if (typeof entry.accessedAt !== "number") entry.accessedAt = Date.now();
      const index = merged.findIndex(
        (candidate: { id?: unknown }) => candidate?.id === entry.id,
      );
      if (index >= 0) merged[index] = { ...merged[index], ...entry };
      else merged.push(entry);
    }
    const now = Date.now();
    if (row) await ctx.db.patch(row._id, { entries: merged, updatedAt: now });
    else {
      await ctx.db.insert("bibliographies", {
        userId,
        entries: merged,
        updatedAt: now,
      });
    }
    return { saved: entries.length };
  },
});

export const searchFolios = internalQuery({
  args: { userId: v.string(), search: v.string(), limit: v.number() },
  returns: v.array(v.any()),
  handler: async (ctx, { userId, search, limit }) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    const foliosRow = await ctx.db
      .query("folios")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const results: Array<Record<string, unknown>> = [];
    for (const folio of (foliosRow?.folios ?? []).slice(
      0,
      MAX_FOLIOS_PER_ACCOUNT,
    )) {
      const content = await ctx.db
        .query("folioContent")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", userId).eq("folioId", folio.id),
        )
        .first();
      const text = (content?.html ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const titleHit = String(folio.name ?? "")
        .toLowerCase()
        .includes(needle);
      const bodyIndex = text.toLowerCase().indexOf(needle);
      if (!titleHit && bodyIndex < 0) continue;
      const start = Math.max(0, bodyIndex - 80);
      results.push({
        folio,
        snippet: text.slice(start, start + needle.length + 240),
        score: titleHit ? 2 : 1,
      });
    }
    return results
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(limit))));
  },
});
