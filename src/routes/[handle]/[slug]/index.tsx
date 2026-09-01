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

import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import {
  type DocumentHead,
  useLocation,
  Link,
  routeLoader$,
} from "@qwik.dev/router";
import { useConvexClient } from "../../../utils/convex-context";
import { api } from "../../../../convex/_generated/api";
import {
  articleDescription,
  loadPublishedPieceByHandleAndSlug,
  type PublishedPieceLoaderData,
} from "../../../utils/published-metadata";
import type { AppError } from "../../../types/application-errors";
import { ApplicationNotice } from "../../../components/ui/application-notice";
import {
  createAppError,
  normalizeApplicationError,
} from "../../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../../utils/application-diagnostics";

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

export const usePublishedPiece = routeLoader$(
  async ({ params, status }): Promise<PublishedPieceLoaderData> => {
    const handle = (params.handle ?? "").toLowerCase();
    const slug = params.slug ?? "";
    if (!handle || !slug) {
      status(404);
      return { piece: null, status: "loaded" };
    }
    const result = await loadPublishedPieceByHandleAndSlug(handle, slug);
    if (result.status === "loaded" && !result.piece) status(404);
    return result;
  },
);

export default component$(() => {
  const loc = useLocation();
  const clientSig = useConvexClient();
  const loadedPiece = usePublishedPiece();
  const piece = useSignal<PublishedPiece | null>(
    loadedPiece.value.piece as PublishedPiece | null,
  );
  const ownerHandle = useSignal<string | null>(
    loadedPiece.value.piece
      ? (loadedPiece.value.piece.ownerHandle ?? loc.params.handle ?? null)
      : null,
  );
  const missing = useSignal(
    loadedPiece.value.status === "loaded" && !loadedPiece.value.piece,
  );
  const isLoading = useSignal(loadedPiece.value.status === "unavailable");
  const errored = useSignal<AppError | null>(null);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    if (piece.value || missing.value) {
      return;
    }

    const handle = (loc.params.handle ?? "").toLowerCase();
    const slug = loc.params.slug;
    const client = clientSig.value;
    if (!client || !handle || !slug) {
      isLoading.value = false;
      errored.value = createAppError("NETWORK_UNAVAILABLE", {
        source: "convex",
        metadata: { operation: "load-public-piece" },
      });
      return;
    }
    try {
      const data = (await client.query(api.published.getByHandleAndSlug, {
        handle,
        slug,
      })) as PublishedPiece | null;
      if (!data) {
        missing.value = true;
        return;
      }
      piece.value = data;
      ownerHandle.value = data.ownerHandle ?? handle;
    } catch (err) {
      reportApplicationDiagnostic("twyne:public:load-piece", err, {
        operation: "load-public-piece",
      });
      errored.value = normalizeApplicationError(err, {
        source: "convex",
        metadata: { operation: "load-public-piece" },
      });
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
                href={`/${ownerHandle.value}/`}
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
        {errored.value && <ApplicationNotice error={errored.value} />}

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
                  href={`/${ownerHandle.value}/`}
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

export const head: DocumentHead = ({ params, resolveValue, url }) => {
  const { piece } = resolveValue(usePublishedPiece);
  const title = piece?.title ?? params.slug ?? "Read";
  const description = articleDescription(piece);
  const author = piece
    ? (piece.authorName ?? piece.ownerHandle ?? params.handle ?? null)
    : null;

  // Per-article social card (see routes/og/[handle]/[slug]). Absolute URL so
  // scrapers can resolve it; declaring these overrides RouterHead's defaults.
  const handle = (params.handle ?? "").toLowerCase();
  const ogImage = `${url.origin}/og/${handle}/${params.slug ?? ""}`;

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
