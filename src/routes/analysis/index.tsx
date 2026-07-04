import {
  component$,
  useStore,
  useStylesScoped$,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import type { RoomAnalysis } from "../../types";
import { loadRoomAnalysisFromIdb } from "../../utils/idb";
import { renderMarkdown } from "../../utils/markdown";
import {
  downloadBlob,
  exportRoomAnalysisMarkdown,
  safeFilename,
} from "../../utils/exchange";

interface AnalysisPageStore {
  result: RoomAnalysis | null;
  loaded: boolean;
}

export default component$(() => {
  const store = useStore<AnalysisPageStore>({ result: null, loaded: false });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const cached = await loadRoomAnalysisFromIdb();
    if (cached) store.result = cached;
    store.loaded = true;
  });

  const downloadAnalysis = $(() => {
    if (!store.result) return;
    const md = exportRoomAnalysisMarkdown(store.result);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const namePart = store.result.briefTitle
      ? `${store.result.briefTitle} full analysis`
      : "full-analysis";
    downloadBlob(blob, safeFilename(namePart, "md"));
  });

  useStylesScoped$(`
    .card {
      border: 1px solid var(--color-paper-3);
      background: var(--color-paper);
      border-radius: 4px;
    }
  `);

  return (
    <div
      class="min-h-screen bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <div class="max-w-5xl mx-auto px-6 py-8">
        <div class="flex items-center justify-between mb-6">
          <div>
            <p
              class="dept-label mb-1"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Twyne
            </p>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "1.75rem",
                color: "var(--color-ink)",
              }}
            >
              The Full Analysis
            </h1>
            <p class="text-sm text-[var(--color-ink-light)] mt-1">
              {store.result?.briefTitle ??
                "Every editor's memo, and the room's combined verdict."}
            </p>
          </div>
          <div class="flex items-center gap-3">
            {store.result && (
              <button onClick$={downloadAnalysis} class="btn-paper text-sm">
                ⇩ Download
              </button>
            )}
            <Link
              href="/editor"
              class="btn-paper text-sm"
              style={{ fontFamily: "var(--font-display)" }}
            >
              ← Back to desk
            </Link>
          </div>
        </div>

        {!store.loaded && (
          <p class="text-sm text-[var(--color-ink-muted)]">Loading…</p>
        )}

        {store.loaded && !store.result && (
          <div class="card p-8 text-center">
            <p
              class="text-4xl"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-cobalt)",
              }}
            >
              ❧
            </p>
            <p class="mt-3 text-sm text-[var(--color-ink-light)] max-w-md mx-auto">
              No analysis on file yet. Open the room in the right panel and
              run <em>Convene the room</em> to start.
            </p>
            <Link href="/editor" class="btn-press mt-4 inline-block text-sm">
              ← Back to desk
            </Link>
          </div>
        )}

        {store.result && (
          <div class="space-y-6">
            {store.result.synthesis && (
              <section class="card p-6">
                <div class="flex items-center justify-between">
                  <p class="dept-label">The Room's Verdict</p>
                  <p
                    class="text-[0.65rem] text-[var(--color-ink-muted)]"
                    style={{
                      fontFamily: "var(--font-typewriter)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {new Date(store.result.timestamp).toLocaleString()}
                  </p>
                </div>
                <div
                  class="comment-markdown mt-3 text-[15px] leading-7 text-[var(--color-ink)]"
                  style={{ fontFamily: "var(--font-serif)" }}
                  dangerouslySetInnerHTML={renderMarkdown(
                    store.result.synthesis,
                  )}
                />
              </section>
            )}

            {store.result.memos.length > 0 && (
              <section class="card p-6">
                <p class="dept-label">The Editors, One by One</p>
                <div class="mt-4 space-y-6">
                  {store.result.memos.map((memo) => (
                    <article
                      key={memo.personaId}
                      class="pl-4 border-b border-dashed border-[var(--color-paper-3)] pb-6 last:border-b-0 last:pb-0"
                      style={{ borderLeft: `3px solid ${memo.personaColor}` }}
                    >
                      <p
                        class="text-[11px] tracking-[0.15em] uppercase"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          color: memo.personaColor,
                        }}
                      >
                        {memo.personaName}
                      </p>
                      <div
                        class="comment-markdown mt-1.5 text-[15px] leading-7 text-[var(--color-ink)]"
                        style={{ fontFamily: "var(--font-serif)" }}
                        dangerouslySetInnerHTML={renderMarkdown(memo.text)}
                      />
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "The Full Analysis · Twyne",
  meta: [
    {
      name: "description",
      content:
        "The full cast analysis: every editor's memo and the room's combined verdict.",
    },
  ],
};
