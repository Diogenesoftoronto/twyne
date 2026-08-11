import {
  component$,
  useStore,
  useStylesScoped$,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import type { Persona, RoomAnalysis } from "../../types";
import {
  loadActiveFolioIdFromIdb,
  loadPersonasFromIdb,
  loadRoomAnalysisFromIdb,
} from "../../utils/idb";
import { renderMarkdown } from "../../utils/markdown";
import {
  downloadBlob,
  exportRoomAnalysisMarkdown,
  safeFilename,
} from "../../utils/exchange";
import { ANALYSIS_READING_ID, speakQueue } from "../../utils/speech";
import { SpeakButton } from "../../components/ui/speak-button";
import { SpeechTransport } from "../../components/ui/speech-transport";
import { useConvexClient } from "../../utils/convex-context";
import { useAuth } from "../../utils/auth-context";

interface AnalysisPageStore {
  result: RoomAnalysis | null;
  loaded: boolean;
  /**
   * The cast, for their voices only. A memo records who wrote it but not how
   * they sound, so the analysis on its own would be read in one flat default
   * voice — which defeats the point of a room of editors.
   */
  personas: Persona[];
}

export default component$(() => {
  const store = useStore<AnalysisPageStore>({
    result: null,
    loaded: false,
    personas: [],
  });
  const clientSig = useConvexClient();
  const auth = useAuth();

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const folioId = await loadActiveFolioIdFromIdb();
    const cached = await loadRoomAnalysisFromIdb(folioId);
    if (cached) store.result = cached;
    // Voices are a nicety: a failure to read the cast must not keep the
    // analysis itself off the page.
    store.personas = await loadPersonasFromIdb().catch(() => []);
    store.loaded = true;
  });

  /**
   * Read the whole room aloud, each editor in their own voice, the verdict
   * last. The per-memo buttons below stay in step, since every passage keeps
   * the id its own button watches.
   */
  const readRoomAloud = $(async () => {
    const analysis = store.result;
    if (!analysis) return;

    const items = analysis.memos.map((memo) => {
      const persona = store.personas.find((p) => p.id === memo.personaId);
      return {
        id: `analysis-memo-${memo.personaId}`,
        text: memo.text,
        voice: persona?.speechVoice,
        voices: persona?.speechVoices,
        instructions: persona?.voice,
        label: memo.personaName,
        client: clientSig.value ?? null,
        signedIn: Boolean(auth.value.user),
      };
    });

    // The verdict is what the room settled on, so it reads last.
    if (analysis.synthesis) {
      items.push({
        id: "analysis-synthesis",
        text: analysis.synthesis,
        voice: undefined,
        voices: undefined,
        instructions: undefined,
        label: "The Room's Verdict",
        client: clientSig.value ?? null,
        signedIn: Boolean(auth.value.user),
      });
    }

    await speakQueue(items, { ownerId: ANALYSIS_READING_ID });
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
              <SpeechTransport
                id={ANALYSIS_READING_ID}
                onPlay$={readRoomAloud}
                playLabel="Read the whole room aloud, each editor in turn"
              />
            )}
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
              run <em>Full analysis</em> to start.
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
                  <div class="flex items-center gap-2">
                    <SpeakButton
                      compact
                      id="analysis-synthesis"
                      text={store.result.synthesis}
                      label="the room"
                    />
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
                      id={`analysis-memo-${memo.personaId}`}
                      class="pl-4 border-b border-dashed border-[var(--color-paper-3)] pb-6 last:border-b-0 last:pb-0"
                      style={{ borderLeft: `3px solid ${memo.personaColor}` }}
                    >
                      <div class="flex items-center justify-between gap-2">
                        <p
                          class="text-[11px] tracking-[0.15em] uppercase"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            color: memo.personaColor,
                          }}
                        >
                          {memo.personaName}
                        </p>
                        <SpeakButton
                          compact
                          id={`analysis-memo-${memo.personaId}`}
                          text={memo.text}
                          voice={
                            store.personas.find((p) => p.id === memo.personaId)
                              ?.speechVoice
                          }
                          voices={
                            store.personas.find((p) => p.id === memo.personaId)
                              ?.speechVoices
                          }
                          instructions={
                            store.personas.find((p) => p.id === memo.personaId)
                              ?.voice
                          }
                          label={memo.personaName}
                        />
                      </div>
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
