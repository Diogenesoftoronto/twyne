import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import type { PublicBlogPost } from "./blog-types";

interface BlogIndexProps {
  posts: PublicBlogPost[];
  isLoading: boolean;
  errored: string | null;
}

/**
 * The blog index. A single column of post cards, each linking
 * to `/blog/[slug]`. Quiet by design — no comments, no share
 * buttons, no related posts. The cards carry the post's
 * title, a brief summary, the author byline, and a date.
 */
export const BlogIndex = component$<BlogIndexProps>(
  ({ posts, isLoading, errored }) => {
    return (
      <main class="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]">
        <header class="border-b-2 border-double border-[var(--color-paper-3)]">
          <div class="mx-auto max-w-2xl px-6 pt-10 pb-8 text-center">
            <p
              class="dept-label"
              style="font-family: var(--font-typewriter); letter-spacing: 0.2em; text-transform: uppercase;"
            >
              Twyne
            </p>
            <h1
              class="mt-2 text-4xl text-[var(--color-ink)]"
              style="font-family: var(--font-display); font-weight: 700; letter-spacing: -0.01em;"
            >
              Field Notes
            </h1>
            <p
              class="mt-3 text-sm text-[var(--color-ink-muted)]"
              style="font-family: var(--font-serif);"
            >
              Updates, experiments, and editorial notes from the
              writer's room.
            </p>
            <p class="mt-4">
              <Link
                href="/"
                class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                style="font-family: var(--font-typewriter);"
              >
                ← Back to the room
              </Link>
            </p>
          </div>
        </header>

        <div class="mx-auto max-w-2xl px-6 py-10">
          {errored && (
            <p
              class="text-sm text-[var(--color-vermilion)] border border-dashed border-[var(--color-vermilion)] p-4"
              style="font-family: var(--font-serif); border-radius: 2px;"
            >
              {errored}
            </p>
          )}

          {isLoading && !errored && (
            <p
              class="text-sm text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter); letter-spacing: 0.16em; text-transform: uppercase;"
            >
              Pulling the latest from the wire…
            </p>
          )}

          {!isLoading && !errored && posts.length === 0 && (
            <div
              class="border border-dashed border-[var(--color-paper-3)] p-8 text-center"
              style="border-radius: 2px;"
            >
              <p
                class="text-base text-[var(--color-ink-light)]"
                style="font-family: var(--font-serif); font-style: italic;"
              >
                No posts yet. The desk is quiet.
              </p>
              <p
                class="mt-2 text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter);"
              >
                Check back soon.
              </p>
            </div>
          )}

          {posts.length > 0 && (
            <ol class="space-y-10">
              {posts.map((post) => (
                <li key={post.slug}>
                  <Link
                    href={`/blog/${post.slug}`}
                    class="block group focus-ring"
                  >
                    <p
                      class="text-[10px] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      {formatDate(post.publishedAt)}
                      {post.authorName ? ` · ${post.authorName}` : ""}
                    </p>
                    <h2
                      class="mt-1 text-2xl text-[var(--color-ink)] group-hover:text-[var(--color-vermilion)]"
                      style="font-family: var(--font-display); font-weight: 600; letter-spacing: -0.005em;"
                    >
                      {post.title}
                    </h2>
                    {post.briefSummary && (
                      <p
                        class="mt-2 text-base text-[var(--color-ink-light)] leading-relaxed"
                        style="font-family: var(--font-serif);"
                      >
                        {post.briefSummary}
                      </p>
                    )}
                    <p
                      class="mt-3 text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] group-hover:text-[var(--color-vermilion)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      Read the post →
                    </p>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer class="mx-auto max-w-2xl px-6 pb-12 pt-6 text-center border-t border-[var(--color-paper-3)]">
          <p
            class="text-[10px] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter);"
          >
            Twyne · The writer's room
          </p>
        </footer>
      </main>
    );
  },
);

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
