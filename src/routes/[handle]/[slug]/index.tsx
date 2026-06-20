/**
 * The public reader for a writer's published piece. Canonical URL shape:
 *   /<handle>/<slug>
 *
 * No auth — anyone with the URL can read. The piece was sanitized
 * server-side at publish time (published.ts:sanitizeHtml strips scripts,
 * inline event handlers, and `javascript:` URLs), so we render with
 * `dangerouslySetInnerHTML` without further filtering.
 *
 * When the handle is missing/unknown or the slug doesn't match, the page
 * renders a quiet 404 — never revealing whether the handle exists, to avoid
 * user enumeration.
 */

import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { type DocumentHead, useLocation, Link } from "@builder.io/qwik-city";
import { useConvexClient } from "../../../utils/convex-context";
import { api } from "../../../../convex/_generated/api";

interface PublishedPiece {
  slug: string;
  ownerHandle: string | null;
  kind: "post" | "blog";
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
  const piece = useSignal<PublishedPiece | null>(null);
  const ownerHandle = useSignal<string | null>(null);
  const missing = useSignal(false);
  const isLoading = useSignal(true);
  const errored = useSignal<string | null>(null);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const handle = (loc.params.handle ?? "").toLowerCase();
    const slug = loc.params.slug;
    const client = clientSig.value;
    if (!client || !handle || !slug) {
      isLoading.value = false;
      errored.value = "Unable to load the piece.";
      return;
    }
    try {
      const data = (await client.query(
        api.published.getByHandleAndSlug,
        { handle, slug },
      )) as PublishedPiece | null;
      if (!data) {
        missing.value = true;
        return;
      }
      piece.value = data;
      ownerHandle.value = data.ownerHandle ?? handle;
    } catch (err) {
      errored.value =
        (err as Error).message ?? "Could not load the piece.";
    } finally {
      isLoading.value = false;
    }
  });

  return (
    <main class="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]">
      <header class="border-b border-[var(--color-paper-3)]">
        <div class="mx-auto max-w-2xl px-6 pt-10 pb-6">
          <p class="text-center">
            {ownerHandle.value && (
              <Link
                href={`/${ownerHandle.value}`}
                class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                style="font-family: var(--font-typewriter);"
              >
                ← @{ownerHandle.value}
              </Link>
            )}
          </p>
        </div>
      </header>

      <div class="mx-auto max-w-2xl px-6 py-10">
        {errored.value && (
          <p
            class="text-sm text-[var(--color-vermilion)] border border-dashed border-[var(--color-vermilion)] p-4"
            style="font-family: var(--font-serif); border-radius: 2px;"
          >
            {errored.value}
          </p>
        )}

        {isLoading.value && !errored.value && (
          <p
            class="text-sm text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter); letter-spacing: 0.16em; text-transform: uppercase;"
          >
            Pulling the piece from the wire…
          </p>
        )}

        {missing.value && !isLoading.value && (
          <div
            class="border border-dashed border-[var(--color-paper-3)] p-8 text-center"
            style="border-radius: 2px;"
          >
            <p
              class="text-base text-[var(--color-ink-light)]"
              style="font-family: var(--font-serif); font-style: italic;"
            >
              This piece isn't here.
            </p>
            <p
              class="mt-2 text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter);"
            >
              It may have been unpublished, or the handle may have changed.
            </p>
            <p class="mt-4">
              <Link
                href="/"
                class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-vermilion)] hover:underline"
                style="font-family: var(--font-typewriter);"
              >
                Back to Twyne
              </Link>
            </p>
          </div>
        )}

        {piece.value && (
          <article>
            <p
              class="text-[10px] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter);"
            >
              {formatDate(piece.value.publishedAt)}
              {piece.value.authorName
                ? ` · ${piece.value.authorName}`
                : ownerHandle.value
                  ? ` · @${ownerHandle.value}`
                  : ""}
            </p>
            <h1
              class="mt-2 text-4xl text-[var(--color-ink)]"
              style="font-family: var(--font-display); font-weight: 700; letter-spacing: -0.01em;"
            >
              {piece.value.title}
            </h1>
            {piece.value.briefSummary && (
              <p
                class="mt-3 text-base text-[var(--color-ink-light)] italic leading-relaxed"
                style="font-family: var(--font-serif);"
              >
                {piece.value.briefSummary}
              </p>
            )}
            <div
              class="mt-8 twyne-blog-prose text-[var(--color-ink)]"
              style="font-family: var(--font-serif);"
              dangerouslySetInnerHTML={piece.value.content}
            />
            {ownerHandle.value && (
              <p class="mt-12 pt-6 border-t border-dashed border-[var(--color-paper-3)]">
                <Link
                  href={`/${ownerHandle.value}`}
                  class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                  style="font-family: var(--font-typewriter);"
                >
                  More from @{ownerHandle.value} →
                </Link>
              </p>
            )}
          </article>
        )}
      </div>
    </main>
  );
});

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export const head: DocumentHead = ({ params }) => ({
  title: `Twyne · ${params.slug ?? "Read"}`,
  meta: [
    { name: "description", content: "A piece published on Twyne." },
    { property: "og:title", content: "Twyne · Read" },
  ],
});
