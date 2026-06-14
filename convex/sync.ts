/**
 * Per-user sync functions. Every mutation and query is auth-gated to
 * the calling user — the server-side identity is the source of truth,
 * never an argument. This is the contract the Convex AI guidelines
 * require: "NEVER accept a userId or any user identifier as a function
 * argument for authorization purposes."
 *
 * The functions cover everything the browser used to keep in IndexedDB:
 *   • briefs         — project dossier
 *   • folios         — list of pieces
 *   • folioContent   — per-folio manuscript HTML
 *   • customPersonas — user-edited editorial board
 *   • personaNotes   — the room's marginalia
 *   • personaReplies — threaded reply chains on each note
 *   • rubricResults  — latest galley-proof result
 *
 * For each table, a `getX` (read latest) and `putX` (upsert) is exposed.
 * `pullAll` and `pushAll` are bulk convenience wrappers used on sign-in
 * and sign-up to hydrate or seed the server in one round-trip.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/* ── Identity helpers ───────────────────────────────────────────── */

async function requireIdentity(ctx: {
  auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> };
}): Promise<string> {
  const id = await ctx.auth.getUserIdentity();
  if (!id) throw new Error("Not signed in");
  return id.tokenIdentifier;
}

/* ── Briefs ──────────────────────────────────────────────────────── */

export const getBrief = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    return await ctx.db
      .query("briefs")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
  },
});

export const putBrief = mutation({
  args: { brief: v.any() },
  handler: async (ctx, { brief }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("briefs")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { brief, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("briefs", { userId, brief, updatedAt: now });
  },
});

/* ── Folios (list of pieces) ─────────────────────────────────────── */

export const getFolios = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    return await ctx.db
      .query("folios")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
  },
});

export const putFolios = mutation({
  args: { folios: v.array(v.any()) },
  handler: async (ctx, { folios }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("folios")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { folios, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("folios", {
      userId,
      folios,
      updatedAt: now,
    });
  },
});

/* ── Folio content (per-piece HTML) ──────────────────────────────── */

export const getFolioContent = query({
  args: { folioId: v.string() },
  handler: async (ctx, { folioId }) => {
    const userId = await requireIdentity(ctx);
    return await ctx.db
      .query("folioContent")
      .withIndex("by_userId_folioId", (q) =>
        q.eq("userId", userId).eq("folioId", folioId),
      )
      .first();
  },
});

export const listFolioContent = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    return await ctx.db
      .query("folioContent")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const putFolioContent = mutation({
  args: { folioId: v.string(), html: v.string() },
  handler: async (ctx, { folioId, html }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("folioContent")
      .withIndex("by_userId_folioId", (q) =>
        q.eq("userId", userId).eq("folioId", folioId),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { html, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("folioContent", {
      userId,
      folioId,
      html,
      updatedAt: now,
    });
  },
});

export const removeFolioContent = mutation({
  args: { folioId: v.string() },
  handler: async (ctx, { folioId }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("folioContent")
      .withIndex("by_userId_folioId", (q) =>
        q.eq("userId", userId).eq("folioId", folioId),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/* ── Custom personas ─────────────────────────────────────────────── */

export const getCustomPersonas = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    return await ctx.db
      .query("customPersonas")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
  },
});

export const putCustomPersonas = mutation({
  args: { personas: v.array(v.any()) },
  handler: async (ctx, { personas }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("customPersonas")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { personas, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("customPersonas", {
      userId,
      personas,
      updatedAt: now,
    });
  },
});

/* ── Persona notes & replies ─────────────────────────────────────── */

export const listPersonaNotes = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    const rows = await ctx.db
      .query("personaNotes")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const putPersonaNote = mutation({
  args: {
    noteId: v.string(),
    personaId: v.string(),
    personaName: v.string(),
    personaColor: v.string(),
    type: v.union(
      v.literal("encouragement"),
      v.literal("suggestion"),
      v.literal("critique"),
      v.literal("perspective"),
    ),
    feedback: v.string(),
    anchor: v.optional(v.string()),
    briefTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("personaNotes")
      .withIndex("by_userId_noteId", (q) =>
        q.eq("userId", userId).eq("noteId", args.noteId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        feedback: args.feedback,
        type: args.type,
        anchor: args.anchor,
      });
      return existing._id;
    }
    return await ctx.db.insert("personaNotes", {
      userId,
      noteId: args.noteId,
      personaId: args.personaId,
      personaName: args.personaName,
      personaColor: args.personaColor,
      type: args.type,
      feedback: args.feedback,
      anchor: args.anchor,
      briefTitle: args.briefTitle,
      createdAt: Date.now(),
    });
  },
});

export const removePersonaNote = mutation({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("personaNotes")
      .withIndex("by_userId_noteId", (q) =>
        q.eq("userId", userId).eq("noteId", noteId),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      // Cascade: delete replies attached to the note.
      const replies = await ctx.db
        .query("personaReplies")
        .withIndex("by_userId_noteId", (q) =>
          q.eq("userId", userId).eq("noteId", noteId),
        )
        .collect();
      for (const r of replies) {
        await ctx.db.delete(r._id);
      }
    }
  },
});

export const listPersonaReplies = query({
  args: { noteId: v.optional(v.string()) },
  handler: async (ctx, { noteId }) => {
    const userId = await requireIdentity(ctx);
    if (noteId) {
      const rows = await ctx.db
        .query("personaReplies")
        .withIndex("by_userId_noteId", (q) =>
          q.eq("userId", userId).eq("noteId", noteId),
        )
        .collect();
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    }
    return await ctx.db
      .query("personaReplies")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const addPersonaReply = mutation({
  args: {
    noteId: v.string(),
    replyId: v.string(),
    author: v.string(),
    authorKind: v.union(v.literal("user"), v.literal("persona")),
    personaId: v.optional(v.string()),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx);
    return await ctx.db.insert("personaReplies", {
      userId,
      noteId: args.noteId,
      replyId: args.replyId,
      author: args.author,
      authorKind: args.authorKind,
      personaId: args.personaId,
      text: args.text,
      createdAt: Date.now(),
    });
  },
});

export const removePersonaReply = mutation({
  args: { replyId: v.string() },
  handler: async (ctx, { replyId }) => {
    const userId = await requireIdentity(ctx);
    const rows = await ctx.db
      .query("personaReplies")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const target = rows.find((r) => r.replyId === replyId);
    if (target) {
      await ctx.db.delete(target._id);
    }
  },
});

/* ── Rubric results ──────────────────────────────────────────────── */

export const getRubricResult = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    return await ctx.db
      .query("rubricResults")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
  },
});

export const putRubricResult = mutation({
  args: { result: v.any() },
  handler: async (ctx, { result }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("rubricResults")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { result, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("rubricResults", {
      userId,
      result,
      updatedAt: now,
    });
  },
});

/* ── Suggestions (editorial change proposals) ────────────────────── */

export const listSuggestions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    const rows = await ctx.db
      .query("suggestions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const putSuggestion = mutation({
  args: {
    suggestionId: v.string(),
    versionId: v.string(),
    personaId: v.string(),
    personaName: v.string(),
    color: v.string(),
    blockId: v.string(),
    original: v.string(),
    replacement: v.string(),
    rationale: v.string(),
    kind: v.union(v.literal("sentence"), v.literal("paragraph")),
    status: v.union(
      v.literal("open"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("suggestions")
      .withIndex("by_userId_suggestionId", (q) =>
        q.eq("userId", userId).eq("suggestionId", args.suggestionId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { status: args.status, replacement: args.replacement });
      return existing._id;
    }
    return await ctx.db.insert("suggestions", {
      userId,
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const updateSuggestionStatus = mutation({
  args: {
    suggestionId: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, { suggestionId, status }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("suggestions")
      .withIndex("by_userId_suggestionId", (q) =>
        q.eq("userId", userId).eq("suggestionId", suggestionId),
      )
      .first();
    if (existing) await ctx.db.patch(existing._id, { status });
  },
});

export const removeSuggestion = mutation({
  args: { suggestionId: v.string() },
  handler: async (ctx, { suggestionId }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("suggestions")
      .withIndex("by_userId_suggestionId", (q) =>
        q.eq("userId", userId).eq("suggestionId", suggestionId),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/* ── Room settings (tunable assistance) ──────────────────────────── */

export const getRoomSettings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    return await ctx.db
      .query("roomSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
  },
});

export const putRoomSettings = mutation({
  args: { settings: v.any() },
  handler: async (ctx, { settings }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("roomSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { settings, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("roomSettings", { userId, settings, updatedAt: now });
  },
});

/* ── Bulk push / pull ────────────────────────────────────────────── */

/**
 * Push the full local-state payload from the browser to the server.
 * Used on sign-up (when the user has local data and no remote data) and
 * after every subsequent local change (debounced).
 */
export const pushAll = mutation({
  args: {
    brief: v.optional(v.any()),
    folios: v.optional(v.array(v.any())),
    folioContent: v.optional(
      v.array(v.object({ folioId: v.string(), html: v.string() })),
    ),
    customPersonas: v.optional(v.array(v.any())),
    personaNotes: v.optional(
      v.array(
        v.object({
          noteId: v.string(),
          personaId: v.string(),
          personaName: v.string(),
          personaColor: v.string(),
          type: v.string(),
          feedback: v.string(),
          anchor: v.optional(v.string()),
          briefTitle: v.optional(v.string()),
          createdAt: v.number(),
        }),
      ),
    ),
    personaReplies: v.optional(
      v.array(
        v.object({
          replyId: v.string(),
          noteId: v.string(),
          author: v.string(),
          authorKind: v.string(),
          personaId: v.optional(v.string()),
          text: v.string(),
          createdAt: v.number(),
        }),
      ),
    ),
    rubricResult: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx);
    const now = Date.now();

    if (args.brief !== undefined) {
      const existing = await ctx.db
        .query("briefs")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          brief: args.brief,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("briefs", {
          userId,
          brief: args.brief,
          updatedAt: now,
        });
      }
    }

    if (args.folios !== undefined) {
      const existing = await ctx.db
        .query("folios")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          folios: args.folios,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("folios", {
          userId,
          folios: args.folios,
          updatedAt: now,
        });
      }
    }

    if (args.folioContent) {
      for (const fc of args.folioContent) {
        const existing = await ctx.db
          .query("folioContent")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", fc.folioId),
          )
          .first();
        if (existing) {
          await ctx.db.patch(existing._id, {
            html: fc.html,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("folioContent", {
            userId,
            folioId: fc.folioId,
            html: fc.html,
            updatedAt: now,
          });
        }
      }
    }

    if (args.customPersonas !== undefined) {
      const existing = await ctx.db
        .query("customPersonas")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          personas: args.customPersonas,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("customPersonas", {
          userId,
          personas: args.customPersonas,
          updatedAt: now,
        });
      }
    }

    if (args.personaNotes) {
      for (const n of args.personaNotes) {
        const existing = await ctx.db
          .query("personaNotes")
          .withIndex("by_userId_noteId", (q) =>
            q.eq("userId", userId).eq("noteId", n.noteId),
          )
          .first();
        if (existing) {
          await ctx.db.patch(existing._id, {
            feedback: n.feedback,
            type: n.type as
              | "encouragement"
              | "suggestion"
              | "critique"
              | "perspective",
            anchor: n.anchor,
            personaName: n.personaName,
            personaColor: n.personaColor,
            personaId: n.personaId,
            briefTitle: n.briefTitle,
          });
        } else {
          await ctx.db.insert("personaNotes", {
            userId,
            noteId: n.noteId,
            personaId: n.personaId,
            personaName: n.personaName,
            personaColor: n.personaColor,
            type: n.type as
              | "encouragement"
              | "suggestion"
              | "critique"
              | "perspective",
            feedback: n.feedback,
            anchor: n.anchor,
            briefTitle: n.briefTitle,
            createdAt: n.createdAt,
          });
        }
      }
    }

    if (args.personaReplies) {
      for (const r of args.personaReplies) {
        const existing = await ctx.db
          .query("personaReplies")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect();
        const dup = existing.find((row) => row.replyId === r.replyId);
        if (!dup) {
          await ctx.db.insert("personaReplies", {
            userId,
            replyId: r.replyId,
            noteId: r.noteId,
            author: r.author,
            authorKind: r.authorKind as "user" | "persona",
            personaId: r.personaId,
            text: r.text,
            createdAt: r.createdAt,
          });
        }
      }
    }

    if (args.rubricResult !== undefined) {
      const existing = await ctx.db
        .query("rubricResults")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          result: args.rubricResult,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("rubricResults", {
          userId,
          result: args.rubricResult,
          updatedAt: now,
        });
      }
    }

    return { ok: true, syncedAt: now };
  },
});

/**
 * Pull the full user state in a single round-trip. The browser calls
 * this on sign-in to hydrate; it then merges the result with whatever
 * was already in IndexedDB (newer-wins by `updatedAt`).
 */
export const pullAll = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);

    const [brief, folios, folioContent, customPersonas, personaNotes, personaReplies, rubricResult] =
      await Promise.all([
        ctx.db
          .query("briefs")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .first(),
        ctx.db
          .query("folios")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .first(),
        ctx.db
          .query("folioContent")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect(),
        ctx.db
          .query("customPersonas")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .first(),
        ctx.db
          .query("personaNotes")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect(),
        ctx.db
          .query("personaReplies")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect(),
        ctx.db
          .query("rubricResults")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .first(),
      ]);

    return {
      brief: brief?.brief ?? null,
      briefUpdatedAt: brief?.updatedAt ?? 0,
      folios: folios?.folios ?? [],
      foliosUpdatedAt: folios?.updatedAt ?? 0,
      folioContent: folioContent.map((fc) => ({
        folioId: fc.folioId,
        html: fc.html,
        updatedAt: fc.updatedAt,
      })),
      customPersonas: customPersonas?.personas ?? null,
      customPersonasUpdatedAt: customPersonas?.updatedAt ?? 0,
      personaNotes: personaNotes.map((n) => ({
        noteId: n.noteId,
        personaId: n.personaId,
        personaName: n.personaName,
        personaColor: n.personaColor,
        type: n.type,
        feedback: n.feedback,
        anchor: n.anchor,
        briefTitle: n.briefTitle,
        createdAt: n.createdAt,
      })),
      personaReplies: personaReplies.map((r) => ({
        replyId: r.replyId,
        noteId: r.noteId,
        author: r.author,
        authorKind: r.authorKind,
        personaId: r.personaId,
        text: r.text,
        createdAt: r.createdAt,
      })),
      rubricResult: rubricResult?.result ?? null,
      rubricResultUpdatedAt: rubricResult?.updatedAt ?? 0,
    };
  },
});
