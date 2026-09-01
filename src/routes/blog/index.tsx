/**
 * The blog index. A reverse-chronological stream of admin-authored
 * posts (`kind: "blog"` in the `published` table). The feed is
 * public — no auth — and fetched by a route loader so post links are present
 * in the initial HTML. The client retries only when that server read is
 * temporarily unavailable.
 *
 * Layout: editorial masthead on top, then a single column of
 * post cards. Each card is a link to `/blog/[slug]`. The page
 * is intentionally quiet: no sidebar, no related posts, no
 * share buttons. The blog is a place to read, not a place to
 * engage.
 */

import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import { type DocumentHead, routeLoader$ } from "@qwik.dev/router";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import { BlogIndex } from "../../components/blog/blog-index";
import type { PublicBlogPost } from "../../components/blog/blog-types";
import {
  createAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import {
  loadPublicBlogPosts,
  type PublicBlogIndexLoaderData,
} from "../../utils/published-metadata";

export const useBlogPosts = routeLoader$(
  async (): Promise<PublicBlogIndexLoaderData> => loadPublicBlogPosts(),
);

export default component$(() => {
  const loadedPosts = useBlogPosts();
  const clientSig = useConvexClient();
  const posts = useSignal<PublicBlogPost[]>(loadedPosts.value.posts);
  const isLoading = useSignal(loadedPosts.value.status === "unavailable");
  const errored = useSignal<string | null>(null);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ cleanup }) => {
    if (loadedPosts.value.status === "loaded") return;

    const client = clientSig.value;
    if (!client) {
      // Convex client isn't ready yet — bail and let the
      // masthead render an empty state. The retry on sign-in
      // is handled by the ConvexProvider re-mounting the
      // client and the page already being hydrated.
      isLoading.value = false;
      errored.value = createAppError("NETWORK_UNAVAILABLE", {
        source: "convex",
        metadata: { operation: "load-blog-index" },
      }).message;
      return;
    }
    try {
      const data = (await client.query(api.published.listBlog, {
        limit: 50,
      })) as PublicBlogPost[];
      posts.value = data;
    } catch (err) {
      reportApplicationDiagnostic("twyne:blog:load-index", err, {
        operation: "load-blog-index",
      });
      errored.value = normalizeApplicationError(err, {
        source: "convex",
        metadata: { operation: "load-blog-index" },
      }).message;
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
      content: "Updates, experiments, and editorial notes from the Twyne desk.",
    },
  ],
};
