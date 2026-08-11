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
 *   • bibliographies — saved citation/source entries
 *
 * For each table, a `getX` (read latest) and `putX` (upsert) is exposed.
 * `pullAll` and `pushAll` are bulk convenience wrappers used on sign-in
 * and sign-up to hydrate or seed the server in one round-trip.
 */

import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { readCollection, writeCollection } from "./lib/collections";

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
  args: { folioId: v.optional(v.string()) },
  handler: async (ctx, { folioId }) => {
    const userId = await requireIdentity(ctx);
    if (folioId) {
      return await ctx.db
        .query("briefs")
        .withIndex("by_userId_folioId", (q) =>
          q.eq("userId", userId).eq("folioId", folioId),
        )
        .first();
    }
    return await ctx.db
      .query("briefs")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
  },
});

export const putBrief = mutation({
  args: { folioId: v.string(), brief: v.any() },
  handler: async (ctx, { folioId, brief }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("briefs")
      .withIndex("by_userId_folioId", (q) =>
        q.eq("userId", userId).eq("folioId", folioId),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { brief, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("briefs", {
      userId,
      folioId,
      brief,
      updatedAt: now,
    });
  },
});

/* ── Folios (list of pieces) ─────────────────────────────────────── */

export const getFolios = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    // Shape preserved from when this was one document, so callers that read
    // `.folios` off the result keep working.
    const { items, updatedAt } = await readCollection(
      ctx,
      "folioEntries",
      userId,
    );
    return { userId, folios: items, updatedAt };
  },
});

export const putFolios = mutation({
  args: { folios: v.array(v.any()) },
  handler: async (ctx, { folios }) => {
    const userId = await requireIdentity(ctx);
    return await writeCollection(ctx, "folioEntries", userId, folios);
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
    const { items, updatedAt } = await readCollection(
      ctx,
      "personaEntries",
      userId,
    );
    return { userId, personas: items, updatedAt };
  },
});

export const putCustomPersonas = mutation({
  args: { personas: v.array(v.any()) },
  handler: async (ctx, { personas }) => {
    const userId = await requireIdentity(ctx);
    return await writeCollection(ctx, "personaEntries", userId, personas);
  },
});

/* ── Persona notes & replies ─────────────────────────────────────── */

export const listPersonaNotes = query({
  args: { folioId: v.optional(v.string()) },
  handler: async (ctx, { folioId }) => {
    const userId = await requireIdentity(ctx);
    const rows = folioId
      ? await ctx.db
          .query("personaNotes")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", folioId),
          )
          .collect()
      : await ctx.db
          .query("personaNotes")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const putPersonaNote = mutation({
  args: {
    folioId: v.string(),
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
    traceId: v.optional(v.string()),
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
        folioId: args.folioId,
        feedback: args.feedback,
        traceId: args.traceId,
        type: args.type,
        anchor: args.anchor,
      });
      return existing._id;
    }
    return await ctx.db.insert("personaNotes", {
      userId,
      folioId: args.folioId,
      noteId: args.noteId,
      personaId: args.personaId,
      personaName: args.personaName,
      personaColor: args.personaColor,
      type: args.type,
      feedback: args.feedback,
      traceId: args.traceId,
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
  args: {
    folioId: v.optional(v.string()),
    noteId: v.optional(v.string()),
  },
  handler: async (ctx, { folioId, noteId }) => {
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
    return folioId
      ? await ctx.db
          .query("personaReplies")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", folioId),
          )
          .collect()
      : await ctx.db
          .query("personaReplies")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect();
  },
});

export const addPersonaReply = mutation({
  args: {
    folioId: v.string(),
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
      folioId: args.folioId,
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
  args: { folioId: v.optional(v.string()) },
  handler: async (ctx, { folioId }) => {
    const userId = await requireIdentity(ctx);
    return folioId
      ? await ctx.db
          .query("rubricResults")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", folioId),
          )
          .first()
      : await ctx.db
          .query("rubricResults")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .first();
  },
});

export const putRubricResult = mutation({
  args: { folioId: v.string(), result: v.any() },
  handler: async (ctx, { folioId, result }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("rubricResults")
      .withIndex("by_userId_folioId", (q) =>
        q.eq("userId", userId).eq("folioId", folioId),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { folioId, result, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("rubricResults", {
      userId,
      folioId,
      result,
      updatedAt: now,
    });
  },
});

/* ── Suggestions (editorial change proposals) ────────────────────── */

export const listSuggestions = query({
  args: { folioId: v.optional(v.string()) },
  handler: async (ctx, { folioId }) => {
    const userId = await requireIdentity(ctx);
    const rows = folioId
      ? await ctx.db
          .query("suggestions")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", folioId),
          )
          .collect()
      : await ctx.db
          .query("suggestions")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .collect();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const putSuggestion = mutation({
  args: {
    folioId: v.string(),
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
      await ctx.db.patch(existing._id, {
        folioId: args.folioId,
        status: args.status,
        replacement: args.replacement,
      });
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
    folioId: v.string(),
    suggestionId: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, { folioId, suggestionId, status }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("suggestions")
      .withIndex("by_userId_suggestionId", (q) =>
        q.eq("userId", userId).eq("suggestionId", suggestionId),
      )
      .first();
    if (existing) await ctx.db.patch(existing._id, { folioId, status });
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
    return await ctx.db.insert("roomSettings", {
      userId,
      settings,
      updatedAt: now,
    });
  },
});

/* ── Appearance (theme) ──────────────────────────────────────────── */

export const getAppearance = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    return await ctx.db
      .query("appearance")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
  },
});

export const putAppearance = mutation({
  args: {
    preset: v.string(),
    custom: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, { preset, custom }) => {
    const userId = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("appearance")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { preset, custom, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("appearance", {
      userId,
      preset,
      custom,
      updatedAt: now,
    });
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
    expectedRevision: v.optional(v.number()),
    briefs: v.optional(
      v.array(v.object({ folioId: v.string(), brief: v.any() })),
    ),
    folios: v.optional(v.array(v.any())),
    folioContent: v.optional(
      v.array(v.object({ folioId: v.string(), html: v.string() })),
    ),
    customPersonas: v.optional(v.array(v.any())),
    personaNotes: v.optional(
      v.array(
        v.object({
          folioId: v.string(),
          noteId: v.string(),
          personaId: v.string(),
          personaName: v.string(),
          personaColor: v.string(),
          type: v.string(),
          feedback: v.string(),
          traceId: v.optional(v.string()),
          anchor: v.optional(v.string()),
          briefTitle: v.optional(v.string()),
          createdAt: v.number(),
        }),
      ),
    ),
    personaReplies: v.optional(
      v.array(
        v.object({
          folioId: v.string(),
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
    rubricResults: v.optional(
      v.array(v.object({ folioId: v.string(), result: v.any() })),
    ),
    bibliography: v.optional(v.array(v.any())),
    removedBriefFolioIds: v.optional(v.array(v.string())),
    removedFolioContentIds: v.optional(v.array(v.string())),
    removedPersonaNoteIds: v.optional(v.array(v.string())),
    removedPersonaReplyIds: v.optional(v.array(v.string())),
    removedRubricFolioIds: v.optional(v.array(v.string())),
  },
  returns: v.object({
    ok: v.literal(true),
    syncedAt: v.number(),
    revision: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx);
    const now = Date.now();
    const syncHead = await ctx.db
      .query("syncHeads")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    const currentRevision = syncHead?.revision ?? 0;
    if (
      args.expectedRevision !== undefined &&
      args.expectedRevision !== currentRevision
    ) {
      throw new ConvexError({
        code: "SYNC_CONFLICT",
        message: "This workspace changed on another device.",
        expectedRevision: args.expectedRevision,
        currentRevision,
      });
    }

    if (args.briefs) {
      for (const dossier of args.briefs) {
        const existing = await ctx.db
          .query("briefs")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", dossier.folioId),
          )
          .first();
        if (existing) {
          await ctx.db.patch(existing._id, {
            brief: dossier.brief,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("briefs", {
            userId,
            folioId: dossier.folioId,
            brief: dossier.brief,
            updatedAt: now,
          });
        }
      }
    }

    if (args.removedBriefFolioIds) {
      for (const folioId of args.removedBriefFolioIds) {
        const existing = await ctx.db
          .query("briefs")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", folioId),
          )
          .first();
        if (existing) await ctx.db.delete(existing._id);
      }
    }

    // The three array sections are always sent whole when they are sent at
    // all, so each is authoritative: an item absent from the array has been
    // deleted, and `writeCollection` removes its row. The row-upserted
    // sections cannot claim the same, which is why the writer sends the
    // `removed*` lists — a folio that no longer appears in the whole-folio
    // array also leaves the server for its content, brief, notes and rubric
    // result via those lists.
    if (args.folios !== undefined) {
      await writeCollection(ctx, "folioEntries", userId, args.folios);
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

    if (args.removedFolioContentIds) {
      for (const folioId of args.removedFolioContentIds) {
        const existing = await ctx.db
          .query("folioContent")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", folioId),
          )
          .first();
        if (existing) await ctx.db.delete(existing._id);
      }
    }

    if (args.customPersonas !== undefined) {
      await writeCollection(ctx, "personaEntries", userId, args.customPersonas);
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
            folioId: n.folioId,
            feedback: n.feedback,
            traceId: n.traceId,
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
            folioId: n.folioId,
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
            traceId: n.traceId,
            anchor: n.anchor,
            briefTitle: n.briefTitle,
            createdAt: n.createdAt,
          });
        }
      }
    }

    if (args.removedPersonaNoteIds) {
      // One read for the whole batch, mirroring the reply upsert below —
      // per-note queries inside the loop would be quadratic in a long history.
      const existing = await ctx.db
        .query("personaNotes")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect();
      const wanted = new Set(args.removedPersonaNoteIds);
      for (const row of existing) {
        if (wanted.has(row.noteId)) await ctx.db.delete(row._id);
      }
    }

    if (args.personaReplies) {
      // One read for the whole batch. Collecting inside the loop made a sync
      // quadratic in the number of replies a writer had ever received, and
      // past a few hundred it stopped being slow and started exceeding the
      // transaction's read limit — taking the draft up with it.
      const existing = await ctx.db
        .query("personaReplies")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect();
      const known = new Set(existing.map((row) => row.replyId));
      for (const r of args.personaReplies) {
        if (!known.has(r.replyId)) {
          // Guard the rest of the batch too: a payload may carry the same
          // reply twice.
          known.add(r.replyId);
          await ctx.db.insert("personaReplies", {
            userId,
            folioId: r.folioId,
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

    if (args.removedPersonaReplyIds) {
      // Batch read, same shape as the upsert above.
      const existing = await ctx.db
        .query("personaReplies")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect();
      const wanted = new Set(args.removedPersonaReplyIds);
      for (const row of existing) {
        if (wanted.has(row.replyId)) await ctx.db.delete(row._id);
      }
    }

    if (args.rubricResults !== undefined) {
      for (const rubric of args.rubricResults) {
        const existing = await ctx.db
          .query("rubricResults")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", rubric.folioId),
          )
          .first();
        if (existing) {
          await ctx.db.patch(existing._id, {
            folioId: rubric.folioId,
            result: rubric.result,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("rubricResults", {
            userId,
            folioId: rubric.folioId,
            result: rubric.result,
            updatedAt: now,
          });
        }
      }
    }

    if (args.removedRubricFolioIds) {
      for (const folioId of args.removedRubricFolioIds) {
        const existing = await ctx.db
          .query("rubricResults")
          .withIndex("by_userId_folioId", (q) =>
            q.eq("userId", userId).eq("folioId", folioId),
          )
          .first();
        if (existing) await ctx.db.delete(existing._id);
      }
    }

    if (args.bibliography !== undefined) {
      await writeCollection(
        ctx,
        "bibliographyEntries",
        userId,
        args.bibliography,
      );
    }

    const revision = currentRevision + 1;
    if (syncHead) {
      await ctx.db.patch(syncHead._id, { revision, updatedAt: now });
    } else {
      await ctx.db.insert("syncHeads", { userId, revision, updatedAt: now });
    }
    return { ok: true as const, syncedAt: now, revision };
  },
});

/**
 * Pull the full user state in a single round-trip. The browser calls
 * this on sign-in to hydrate; it then merges the result with whatever
 * was already in IndexedDB (newer-wins by `updatedAt`).
 */
export const pullAll = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);

    const [
      briefs,
      folios,
      folioContent,
      customPersonas,
      personaNotes,
      personaReplies,
      rubricResults,
      bibliography,
      syncHead,
    ] = await Promise.all([
      ctx.db
        .query("briefs")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect(),
      readCollection(ctx, "folioEntries", userId),
      ctx.db
        .query("folioContent")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect(),
      readCollection(ctx, "personaEntries", userId),
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
        .collect(),
      readCollection(ctx, "bibliographyEntries", userId),
      ctx.db
        .query("syncHeads")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique(),
    ]);

    return {
      syncRevision: syncHead?.revision ?? 0,
      briefs: briefs
        .filter((row) => row.folioId)
        .map((row) => ({
          folioId: row.folioId!,
          brief: row.brief,
          updatedAt: row.updatedAt,
        })),
      legacyBrief:
        briefs.find((row) => row.folioId === undefined)?.brief ?? null,
      legacyBriefUpdatedAt:
        briefs.find((row) => row.folioId === undefined)?.updatedAt ?? 0,
      folios: folios.items,
      foliosUpdatedAt: folios.updatedAt,
      folioContent: folioContent.map((fc) => ({
        folioId: fc.folioId,
        html: fc.html,
        updatedAt: fc.updatedAt,
      })),
      // Null still means "this user has no persona record at all", which is
      // what the browser's merge distinguishes from an empty board.
      customPersonas:
        customPersonas.updatedAt === 0 ? null : customPersonas.items,
      customPersonasUpdatedAt: customPersonas.updatedAt,
      personaNotes: personaNotes.map((n) => ({
        folioId: n.folioId,
        noteId: n.noteId,
        personaId: n.personaId,
        personaName: n.personaName,
        personaColor: n.personaColor,
        type: n.type,
        feedback: n.feedback,
        traceId: n.traceId,
        anchor: n.anchor,
        briefTitle: n.briefTitle,
        createdAt: n.createdAt,
      })),
      personaReplies: personaReplies.map((r) => ({
        folioId: r.folioId,
        replyId: r.replyId,
        noteId: r.noteId,
        author: r.author,
        authorKind: r.authorKind,
        personaId: r.personaId,
        text: r.text,
        createdAt: r.createdAt,
      })),
      rubricResults: rubricResults.map((rubric) => ({
        folioId: rubric.folioId,
        result: rubric.result,
        updatedAt: rubric.updatedAt,
      })),
      bibliography: bibliography.items,
      bibliographyUpdatedAt: bibliography.updatedAt,
    };
  },
});
