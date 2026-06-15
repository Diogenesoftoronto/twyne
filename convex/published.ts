/**
 * Publish / unpublish / read-by-slug for the public reader route. The
 * slug is generated from the title with a short random suffix so
 * (a) it reads well, like standard.horse / leaflet.pub, and
 * (b) collisions are vanishingly unlikely.
 *
 * Reads are public (no auth) so anyone with a URL can view. Writes
 * require auth, and the server-side identity is the only authority on
 * who can publish. There is no `userId` argument — the Convex auth
 * guideline is non-negotiable on that point.
 */

import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

/* ── Slug generation ──────────────────────────────────────────── */

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function shortId(): string {
  // Avoid crypto-heavy lookups; a 5-char base36 suffix gives ~60M
  // combinations which is plenty for unique slugs.
  return Math.random().toString(36).slice(2, 7);
}

async function generateUniqueSlug(
  ctx: Pick<MutationCtx, "db">,
  title: string,
): Promise<string> {
  const base = slugify(title) || "piece";
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${shortId()}`;
    const existing = await ctx.db
      .query("published")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .first();
    if (!existing) return candidate;
  }
  // Final fallback: base + 8-char random suffix.
  return `${base}-${shortId()}${shortId()}`;
}

/* ── Sanitisation ─────────────────────────────────────────────── */

/**
 * Strip dangerous tags from the HTML we publish. The editor's output
 * is already well-formed; this is defence-in-depth against a user
 * pasting raw HTML from elsewhere.
 */
function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") {
    // SSR / Convex action: best-effort string-based strip. Convex
    // server runtime doesn't have DOMParser.
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
      .replace(/<object[\s\S]*?<\/object>/gi, "")
      .replace(/<embed\b[^>]*\/?>/gi, "")
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/javascript:/gi, "");
  }
  // Browser: use a DOMParser to drop nodes outright.
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed").forEach((el) =>
    el.remove(),
  );
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      if (
        attr.name === "href" &&
        /^\s*javascript:/i.test(attr.value ?? "")
      ) {
        el.removeAttribute("href");
      }
    }
  });
  return doc.body.innerHTML;
}

/* ── Public API ───────────────────────────────────────────────── */

export const publish = mutation({
  args: {
    folioId: v.string(),
    title: v.string(),
    authorName: v.optional(v.string()),
    briefSummary: v.optional(v.string()),
    content: v.string(),
    /**
     * "post" (default) for the writer's own share view at
     * /p/[slug]. "blog" only succeeds when the caller is in the
     * admin roster — non-admins asking for the blog kind fall
     * back to "post" with a flag in the response.
     */
    kind: v.optional(
      v.union(v.literal("post"), v.literal("blog")),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const ownerId = identity.tokenIdentifier;

    const now = Date.now();
    const cleanContent = sanitizeHtml(args.content);
    const cleanTitle = (args.title || "Untitled").trim().slice(0, 200);

    // Gate the blog kind on admin status. A non-admin who asks
    // for "blog" gets a "post" with `requestedBlog: true` in
    // the response so the client can show a "you're not an
    // admin" message. We never silently flip the kind — that
    // would mask a privilege confusion.
    let resolvedKind: "post" | "blog" = "post";
    let requestedBlog = false;
    if (args.kind === "blog") {
      requestedBlog = true;
      const isAdmin = await ctx.db
        .query("admins")
        .withIndex("by_userId", (q) => q.eq("userId", ownerId))
        .first();
      if (isAdmin) resolvedKind = "blog";
    }

    // If a published row already exists for this owner + folio, update
    // it in place and keep the same slug.
    const existingRows = await ctx.db
      .query("published")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .collect();
    const existing = existingRows.find((r) => r.folioId === args.folioId);

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: cleanTitle,
        authorName: args.authorName ?? existing.authorName,
        briefSummary: args.briefSummary ?? existing.briefSummary,
        content: cleanContent,
        // The kind can move on re-publish (admin decides what
        // a given folio is today).
        kind: resolvedKind,
        updatedAt: now,
      });
      return {
        slug: existing.slug,
        _id: existing._id,
        updated: true,
        kind: resolvedKind,
        requestedBlog,
      };
    }

    const slug = await generateUniqueSlug(ctx, cleanTitle);
    const id = await ctx.db.insert("published", {
      ownerId,
      slug,
      folioId: args.folioId,
      kind: resolvedKind,
      title: cleanTitle,
      authorName: args.authorName,
      briefSummary: args.briefSummary,
      content: cleanContent,
      publishedAt: now,
      updatedAt: now,
    });
    return {
      slug,
      _id: id,
      updated: false,
      kind: resolvedKind,
      requestedBlog,
    };
  },
});

export const unpublish = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const ownerId = identity.tokenIdentifier;
    const row = await ctx.db
      .query("published")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!row) return { ok: true, missing: true };
    if (row.ownerId !== ownerId) throw new Error("Not the owner");
    await ctx.db.delete(row._id);
    return { ok: true, missing: false };
  },
});

/** Public read — no auth required. */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const row = await ctx.db
      .query("published")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!row) return null;
    return {
      slug: row.slug,
      title: row.title,
      authorName: row.authorName ?? null,
      briefSummary: row.briefSummary ?? null,
      content: row.content,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
    };
  },
});

/** List the signed-in user's published pieces. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const ownerId = identity.tokenIdentifier;
    const rows = await ctx.db
      .query("published")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .collect();
    return rows
      .map((r) => ({
        slug: r.slug,
        folioId: r.folioId,
        title: r.title,
        publishedAt: r.publishedAt,
        updatedAt: r.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** Lightweight metadata — used by the share dialog to render a link card. */
export const getMetadataBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const row = await ctx.db
      .query("published")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!row) return null;
    return {
      title: row.title,
      authorName: row.authorName ?? null,
      publishedAt: row.publishedAt,
    };
  },
});
