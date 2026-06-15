/**
 * The blog index. A reverse-chronological stream of admin-authored
 * posts (`kind: "blog"` in the `published` table). The feed is
 * public — no auth — and fetched on the client (the project
 * has no Convex SSR bridge yet). Once a server-side client is
 * wired up, this can be promoted to `routeLoader$` for SEO.
 *
 * Layout: editorial masthead on top, then a single column of
 * post cards. Each card is a link to `/blog/[slug]`. The page
 * is intentionally quiet: no sidebar, no related posts, no
 * share buttons. The blog is a place to read, not a place to
 * engage.
 */

import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { type DocumentHead } from "@builder.io/qwik-city";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import { BlogIndex } from "../../components/blog/blog-index";
import type { PublicBlogPost } from "../../components/blog/blog-types";

export default component$(() => {
  const clientSig = useConvexClient();
  const posts = useSignal<PublicBlogPost[]>([]);
  const isLoading = useSignal(true);
  const errored = useSignal<string | null>(null);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ cleanup }) => {
    const client = clientSig.value;
    if (!client) {
      // Convex client isn't ready yet — bail and let the
      // masthead render an empty state. The retry on sign-in
      // is handled by the ConvexProvider re-mounting the
      // client and the page already being hydrated.
      isLoading.value = false;
      errored.value = "Sign in to load the blog feed.";
      return;
    }
    try {
      // The `listBlog` query is registered in `convex/published.ts`
      // but the generated `api.d.ts` predates it. A type cast
      // keeps the wire shape correct without forcing a
      // Convex regeneration — the next `npx convex dev` will
      // pick the function up and the cast becomes redundant.
      const data = (await (
        client.query as unknown as (
          ref: unknown,
          args: { limit?: number },
        ) => Promise<PublicBlogPost[]>
      )((api.published as unknown as { listBlog: unknown }).listBlog, {
        limit: 50,
      }));
      posts.value = data;
    } catch (err) {
      errored.value = (err as Error).message ?? "Could not load the blog.";
    } finally {
      isLoading.value = false;
    }
    cleanup(() => {
      // Nothing to tear down; the signal holders are
      // component-scoped.
    });
  });

  return (
    <BlogIndex
      posts={posts.value}
      isLoading={isLoading.value}
      errored={errored.value}
    />
  );
});

export const head: DocumentHead = {
  title: "Twyne · Field Notes",
  meta: [
    {
      name: "description",
      content:
        "Updates, experiments, and editorial notes from the Twyne desk — the writer's room where the room of editors is in residence.",
    },
    { property: "og:title", content: "Twyne · Field Notes" },
    {
      property: "og:description",
      content:
        "Updates, experiments, and editorial notes from the Twyne desk.",
    },
  ],
};
