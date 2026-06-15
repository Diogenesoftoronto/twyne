import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";

interface BlogPostData {
  slug: string;
  title: string;
  authorName: string | null;
  briefSummary: string | null;
  content: string;
  publishedAt: number;
  updatedAt: number;
}

interface BlogPostProps {
  post: BlogPostData | null;
  isLoading: boolean;
  missing: boolean;
  errored: string | null;
}

/**
 * The blog post reader. The content has been sanitized server-side
 * (published.ts:sanitizeHtml strips scripts, event handlers, and
 * javascript: URLs), so we render it with `dangerouslySetInnerHTML`
 * without further filtering.
 */
export const BlogPost = component$<BlogPostProps>(
  ({ post, isLoading, missing, errored }) => {
    return (
      <main class="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]">
        <header class="border-b border-[var(--color-paper-3)]">
          <div class="mx-auto max-w-2xl px-6 pt-10 pb-6">
            <p class="text-center">
              <Link
                href="/blog"
                class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                style="font-family: var(--font-typewriter);"
              >
                ← Field Notes
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
              Pulling the post from the wire…
            </p>
          )}

          {missing && !isLoading && (
            <div
              class="border border-dashed border-[var(--color-paper-3)] p-8 text-center"
              style="border-radius: 2px;"
            >
              <p
                class="text-base text-[var(--color-ink-light)]"
                style="font-family: var(--font-serif); font-style: italic;"
              >
                This post is not on the blog.
              </p>
              <p
                class="mt-2 text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter);"
              >
                It may be a private share, or it may have been
                unpublished.
              </p>
              <p class="mt-4">
                <Link
                  href="/blog"
                  class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-vermilion)] hover:underline"
                  style="font-family: var(--font-typewriter);"
                >
                  Back to the index
                </Link>
              </p>
            </div>
          )}

          {post && (
            <article>
              <p
                class="text-[10px] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter);"
              >
                {formatDate(post.publishedAt)}
                {post.authorName ? ` · ${post.authorName}` : ""}
              </p>
              <h1
                class="mt-2 text-4xl text-[var(--color-ink)]"
                style="font-family: var(--font-display); font-weight: 700; letter-spacing: -0.01em;"
              >
                {post.title}
              </h1>
              {post.briefSummary && (
                <p
                  class="mt-3 text-base text-[var(--color-ink-light)] italic leading-relaxed"
                  style="font-family: var(--font-serif);"
                >
                  {post.briefSummary}
                </p>
              )}
              <div
                class="mt-8 twyne-blog-prose text-[var(--color-ink)]"
                style="font-family: var(--font-serif);"
                dangerouslySetInnerHTML={post.content}
              />
            </article>
          )}
        </div>
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
