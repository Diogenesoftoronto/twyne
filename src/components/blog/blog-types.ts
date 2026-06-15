/**
 * Shape of a blog feed entry as it crosses the wire from
 * Convex into the Qwik component. The `published` table also
 * stores `content` and `ownerId`; the feed entry strips those
 * so the index page only pulls what the card needs to render.
 */
export interface PublicBlogPost {
  slug: string;
  title: string;
  authorName: string | null;
  briefSummary: string | null;
  publishedAt: number;
  updatedAt: number;
}
