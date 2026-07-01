import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export interface PublishedPieceMetadata {
  slug: string;
  ownerHandle?: string | null;
  kind?: "post" | "blog";
  title: string;
  authorName: string | null;
  briefSummary: string | null;
  content: string;
  publishedAt: number;
  updatedAt: number;
}

export interface PublishedPieceLoaderData {
  piece: PublishedPieceMetadata | null;
  status: "loaded" | "unavailable";
}

const DEFAULT_ARTICLE_DESCRIPTION = "A piece published on Twyne.";
const DEFAULT_BLOG_DESCRIPTION = "A Twyne field note.";

function getConvexUrl(): string | undefined {
  return (
    (import.meta.env.PUBLIC_CONVEX_URL as string | undefined) ??
    (import.meta.env.VITE_CONVEX_URL as string | undefined) ??
    process.env.PUBLIC_CONVEX_URL ??
    process.env.VITE_CONVEX_URL
  );
}

function publishedClient(): ConvexHttpClient | null {
  const convexUrl = getConvexUrl();
  return convexUrl ? new ConvexHttpClient(convexUrl) : null;
}

export async function loadPublishedPieceByHandleAndSlug(
  handle: string,
  slug: string,
): Promise<PublishedPieceLoaderData> {
  const client = publishedClient();
  if (!client) return { piece: null, status: "unavailable" };

  try {
    const piece = await client.query(api.published.getByHandleAndSlug, {
      handle: handle.toLowerCase(),
      slug,
    });
    return { piece, status: "loaded" };
  } catch {
    return { piece: null, status: "unavailable" };
  }
}

export async function loadBlogPieceBySlug(
  slug: string,
): Promise<PublishedPieceLoaderData> {
  const client = publishedClient();
  if (!client) return { piece: null, status: "unavailable" };

  try {
    const listBlog = (api.published as unknown as {
      listBlog: unknown;
    }).listBlog;
    const all = (await (
      client.query as unknown as (
        ref: unknown,
        args: { limit?: number },
      ) => Promise<Array<{ slug: string }>>
    )(listBlog, { limit: 200 }));
    if (!all.some((piece) => piece.slug === slug)) {
      return { piece: null, status: "loaded" };
    }

    const piece = await client.query(api.published.getBySlug, { slug });
    return { piece, status: "loaded" };
  } catch {
    return { piece: null, status: "unavailable" };
  }
}

export function articleDescription(
  piece: Pick<PublishedPieceMetadata, "briefSummary" | "content"> | null,
  fallback = DEFAULT_ARTICLE_DESCRIPTION,
): string {
  const source =
    piece?.briefSummary?.trim() ||
    htmlToText(piece?.content ?? "").trim() ||
    fallback;
  return truncateMeta(source);
}

export function blogDescription(
  piece: Pick<PublishedPieceMetadata, "briefSummary" | "content"> | null,
): string {
  return articleDescription(piece, DEFAULT_BLOG_DESCRIPTION);
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

function truncateMeta(input: string): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177).replace(/\s+\S*$/, "")}...`;
}
