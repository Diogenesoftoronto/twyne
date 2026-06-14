import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";

/**
 * The Library — a future home for the writer's saved folios, drafts,
 * research notes, and chapter outlines. Currently a placeholder;
 * the data model lives in IndexedDB and the full UI is the next
 * pass.
 */
export default component$(() => {
  return (
    <div
      class="min-h-screen flex flex-col items-center justify-center px-6 py-16 bg-[var(--color-surface)] text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <div class="max-w-xl w-full text-center space-y-6">
        <p
          class="text-xs tracking-[0.32em] uppercase text-[var(--color-ink-muted)]"
          style={{ fontFamily: "var(--font-typewriter)" }}
        >
          Twyne
        </p>
        <h1
          class="text-4xl md:text-5xl leading-[1.05] tracking-tight"
          style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
        >
          The Library
        </h1>
        <p class="text-base text-[var(--color-ink-light)] leading-relaxed">
          Your folios, research notes, and chapter outlines will live here.
          The data model is in place (IndexedDB) — the full shelf view ships
          in the next pass.
        </p>
        <Link
          href="/editor/"
          class="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-surface-3)] px-5 py-2 text-sm text-[var(--color-ink-light)] hover:bg-[var(--color-surface-2)] transition-colors"
          style={{ fontFamily: "var(--font-typewriter)" }}
        >
          <span aria-hidden="true">←</span> Back to desk
        </Link>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Library · Twyne",
  meta: [
    {
      name: "description",
      content: "Twyne's library — folios, research, outlines.",
    },
  ],
};
