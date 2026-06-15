/**
 * The blog post reader. Public — anyone with a URL can read.
 * Mirrors `/p/[slug]` (the share view) but is scoped to admin
 * "blog" pieces. Non-admin pieces are still readable at
 * `/p/[slug]`; the blog reader 404s for non-blog kinds, so a
 * writer's personal share link never accidentally surfaces on
 * `/blog`.
 */

import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { type DocumentHead, useLocation, Link } from "@builder.io/qwik-city";
import { useConvexClient } from "../../../utils/convex-context";
import { api } from "../../../../convex/_generated/api";
import { BlogPost } from "../../../components/blog/blog-post";

interface BlogPostData {
  slug: string;
  title: string;
  authorName: string | null;
  briefSummary: string | null;
  content: string;
  publishedAt: number;
  updatedAt: number;
}

export default component$(() => {
  const loc = useLocation();
  const clientSig = useConvexClient();
  const post = useSignal<BlogPostData | null>(null);
  const missing = useSignal(false);
  const isLoading = useSignal(true);
  const errored = useSignal<string | null>(null);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const slug = loc.params.slug;
    const client = clientSig.value;
    if (!client || !slug) {
      isLoading.value = false;
      errored.value = "Unable to load post.";
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
      const listBlog = (api.published as unknown as {
        listBlog: unknown;
      }).listBlog;
      const all = (await (
        client.query as unknown as (
          ref: unknown,
          args: { limit?: number },
        ) => Promise<Array<{ slug: string }>>
      )(listBlog, { limit: 200 }));
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
      errored.value = (err as Error).message ?? "Could not load the post.";
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

export const head: DocumentHead = ({ params }) => ({
  title: `Twyne · ${params.slug ?? "Field Notes"}`,
  meta: [
    { name: "description", content: "A Twyne field note." },
    { property: "og:title", content: "Twyne · Field Notes" },
  ],
});

// `Link` is imported above because the post template includes
// a "back to the index" link; the import silences the unused
// linter when the post body is a future place for inline links.
void Link;
