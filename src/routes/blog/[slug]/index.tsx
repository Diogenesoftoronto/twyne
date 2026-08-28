/**
 * The blog post reader. Public — anyone with a URL can read.
 * Scoped to admin "blog" pieces. Non-admin pieces are readable at the
 * writer's own /<handle>/<slug> URL; the blog reader 404s for non-blog
 * kinds, so a writer's personal share link never accidentally surfaces
 * on /blog.
 */

import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import {
  type DocumentHead,
  useLocation,
  Link,
  routeLoader$,
} from "@builder.io/qwik-city";
import { useConvexClient } from "../../../utils/convex-context";
import { api } from "../../../../convex/_generated/api";
import { BlogPost } from "../../../components/blog/blog-post";
import {
  blogDescription,
  loadBlogPieceBySlug,
  type PublishedPieceLoaderData,
} from "../../../utils/published-metadata";
import {
  createAppError,
  normalizeApplicationError,
} from "../../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../../utils/application-diagnostics";

interface BlogPostData {
  slug: string;
  title: string;
  authorName: string | null;
  briefSummary: string | null;
  content: string;
  publishedAt: number;
  updatedAt: number;
}

export const useBlogPost = routeLoader$(
  async ({ params, status }): Promise<PublishedPieceLoaderData> => {
    const slug = params.slug ?? "";
    if (!slug) {
      status(404);
      return { piece: null, status: "loaded" };
    }
    const result = await loadBlogPieceBySlug(slug);
    if (result.status === "loaded" && !result.piece) status(404);
    return result;
  },
);

export default component$(() => {
  const loc = useLocation();
  const clientSig = useConvexClient();
  const loadedPost = useBlogPost();
  const post = useSignal<BlogPostData | null>(
    loadedPost.value.piece as BlogPostData | null,
  );
  const missing = useSignal(
    loadedPost.value.status === "loaded" && !loadedPost.value.piece,
  );
  const isLoading = useSignal(loadedPost.value.status === "unavailable");
  const errored = useSignal<string | null>(null);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    if (post.value || missing.value) {
      return;
    }

    const slug = loc.params.slug;
    const client = clientSig.value;
    if (!client || !slug) {
      isLoading.value = false;
      errored.value = createAppError("NETWORK_UNAVAILABLE", {
        source: "convex",
        metadata: { operation: "load-blog-post" },
      }).message;
      return;
    }
    try {
      // Reuse the existing `getBySlug` reader. The blog
      // reader is intentionally scoped to blog pieces: if
      // the slug points to a personal "post" we surface a
      // 404 rather than render the wrong context. The
      // `listBlog` lookup uses a type cast for the same
      // reason as the index page — see that file for the
      // full note.
      const listBlog = (
        api.published as unknown as {
          listBlog: unknown;
        }
      ).listBlog;
      const all = await (
        client.query as unknown as (
          ref: unknown,
          args: { limit?: number },
        ) => Promise<Array<{ slug: string }>>
      )(listBlog, { limit: 200 });
      const match = all.find((p) => p.slug === slug);
      if (!match) {
        missing.value = true;
        return;
      }
      const data = (await client.query(api.published.getBySlug, {
        slug,
      })) as BlogPostData | null;
      if (!data) {
        missing.value = true;
        return;
      }
      post.value = data;
    } catch (err) {
      reportApplicationDiagnostic("twyne:blog:load-post", err, {
        operation: "load-blog-post",
      });
      errored.value = normalizeApplicationError(err, {
        source: "convex",
        metadata: { operation: "load-blog-post" },
      }).message;
    } finally {
      isLoading.value = false;
    }
  });

  return (
    <BlogPost
      post={post.value}
      isLoading={isLoading.value}
      missing={missing.value}
      errored={errored.value}
    />
  );
});

export const head: DocumentHead = ({ params, resolveValue, url }) => {
  const { piece } = resolveValue(useBlogPost);
  const title = piece?.title ?? params.slug ?? "Field Notes";
  const description = blogDescription(piece);
  const author = piece?.authorName ?? piece?.ownerHandle ?? null;

  // Per-post social card (see routes/og/blog/[slug]). Absolute URL so
  // scrapers can resolve it; declaring these overrides RouterHead's defaults.
  const ogImage = `${url.origin}/og/blog/${params.slug ?? ""}`;

  return {
    title: `Twyne · ${title}`,
    meta: [
      { name: "description", content: description },
      { property: "og:type", content: "article" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:image", content: ogImage },
      { property: "og:image:alt", content: `${title} — Twyne` },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: ogImage },
      ...(author ? [{ name: "author", content: author }] : []),
    ],
  };
};

// `Link` is imported above because the post template includes
// a "back to the index" link; the import silences the unused
// linter when the post body is a future place for inline links.
void Link;
