/**
 * Dynamic OpenGraph card endpoint: GET /og/blog/<slug>
 *
 * Returns a 1200×630 PNG rendered per blog piece (see utils/og-image),
 * so a shared blog link unfurls with an image that actually reflects that
 * post rather than the one generic site card. The blog route's `head`
 * points og:image / twitter:image here.
 *
 * Runs server-side only (imports the native rasterizer). Cached aggressively —
 * the card only changes when the piece's title/summary/author change.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RequestHandler } from "@qwik.dev/router";
import {
  blogDescription,
  loadBlogPieceBySlug,
} from "../../../../utils/published-metadata";
import { renderArticleOgPng } from "../../../../utils/og-image";

export const onGet: RequestHandler = async ({
  params,
  send,
  cacheControl,
}) => {
  cacheControl({
    public: true,
    maxAge: 60 * 60, // 1h at the client/CDN edge
    sMaxAge: 60 * 60 * 24, // 1d shared
    staleWhileRevalidate: 60 * 60 * 24 * 7,
  });

  const slug = params.slug ?? "";

  let png: Buffer | null = null;
  try {
    const { piece } = await loadBlogPieceBySlug(slug);
    if (piece) {
      const author =
        piece.authorName ?? (piece.ownerHandle ? `@${piece.ownerHandle}` : null);
      png = renderArticleOgPng({
        title: piece.title,
        summary: blogDescription(piece),
        author,
        kind: "blog",
      });
    }
  } catch {
    // fall through to the static default below
  }

  // Unknown piece (or a transient failure): serve the site's generic card so
  // the link still unfurls with something rather than a broken image.
  if (!png) {
    try {
      png = readFileSync(join(process.cwd(), "public", "og-image.png"));
    } catch {
      send(404, "Not found");
      return;
    }
  }

  send(
    new Response(png, {
      headers: { "Content-Type": "image/png" },
    }),
  );
};
