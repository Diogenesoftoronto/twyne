import {
  component$,
  useStore,
  useStylesScoped$,
  useVisibleTask$,
  $,
} from "@qwik.dev/core";
import { Link, type DocumentHead } from "@qwik.dev/router";
import type { Persona, RoomAnalysis } from "../../types";
import {
  loadActiveFolioIdFromIdb,
  loadAiSettingsFromIdb,
  loadFolioContentFromIdb,
  loadPersonasFromIdb,
  loadRoomAnalysisFromIdb,
  loadWriterSettingsFromIdb,
  saveRoomAnalysisToIdb,
} from "../../utils/idb";
import {
  htmlToPlainText,
  loadProjectBriefForFolio,
} from "../../utils/anti-tabula-rasa";
import {
  hasConfiguredAiProvider,
  normalizeAiSettings,
} from "../../utils/ai-client";
import {
  isAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import { PERSONAS as DEFAULT_PERSONAS } from "../../utils/personas";
import { runRoomAnalysis } from "../../utils/room-analysis";
import { MIN_EDITOR_WORDS } from "../../utils/draft-thresholds";
import type { AppError, AppErrorSource } from "../../types/application-errors";
import { ApplicationNotice } from "../../components/ui/application-notice";
import { EditorialLoader } from "../../components/ui/editorial-loader";
import { renderMarkdown } from "../../utils/markdown";
import {
  downloadBlob,
  exportRoomAnalysisMarkdown,
  safeFilename,
} from "../../utils/exchange";
import { ANALYSIS_READING_ID, speakQueue } from "../../utils/speech";
import { SpeakButton } from "../../components/ui/speak-button";
import { PersonaMasthead } from "../../components/personas/persona-portrait";
import { SpeechTransport } from "../../components/ui/speech-transport";
import { useConvexClient } from "../../utils/convex-context";
import { useAuth } from "../../utils/auth-context";

interface AnalysisPageStore {
  result: RoomAnalysis | null;
  loaded: boolean;
  folioId: string | null;
  isAnalyzing: boolean;
  isSynthesizing: boolean;
  error: AppError | null;
  /**
   * The current cast, used to run analysis and read each memo in its editor's voice.
   */
  personas: Persona[];
}

export default component$(() => {
  const store = useStore<AnalysisPageStore>({
    result: null,
    loaded: false,
    folioId: null,
    isAnalyzing: false,
    isSynthesizing: false,
    error: null,
    personas: [],
  });
  const clientSig = useConvexClient();
  const auth = useAuth();

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    try {
      store.folioId = await loadActiveFolioIdFromIdb();
      if (store.folioId) {
        store.result = await loadRoomAnalysisFromIdb(store.folioId);
      }
      const custom = await loadPersonasFromIdb();
      store.personas = custom.length > 0 ? custom : DEFAULT_PERSONAS;
    } catch (err) {
      store.error = normalizeApplicationError(err, { source: "application" });
    } finally {
      store.loaded = true;
    }
  });

  const analyze = $(async () => {
    if (!store.loaded || !store.folioId || store.isAnalyzing) return;
    // Keep the page tied to the folio whose saved analysis it displays.
    const folioId = store.folioId;
    store.isAnalyzing = true;
    store.isSynthesizing = false;
    store.error = null;
    let source: AppErrorSource = "application";
    try {
      const [html, brief, custom, writer, aiRaw] = await Promise.all([
        loadFolioContentFromIdb(folioId),
        loadProjectBriefForFolio(folioId),
        loadPersonasFromIdb(),
        loadWriterSettingsFromIdb(),
        loadAiSettingsFromIdb(),
      ]);
      const settings = normalizeAiSettings(aiRaw);
      source = hasConfiguredAiProvider(settings) ? "provider" : "convex";
      store.personas = custom.length > 0 ? custom : DEFAULT_PERSONAS;
      const result = await runRoomAnalysis({
        activeFolioId: folioId,
        draftText: htmlToPlainText(html ?? ""),
        brief,
        personas: store.personas,
        writerProfile: writer.profile,
        settings,
        client: clientSig.value ?? null,
        onSynthesis: () => {
          store.isSynthesizing = true;
        },
      });
      await saveRoomAnalysisToIdb(result, folioId);
      store.result = result;
    } catch (err) {
      const metadata = { feature: "personas", operation: "full-analysis" };
      reportApplicationDiagnostic("twyne:analysis:run", err, metadata);
      store.error = isAppError(err)
        ? err
        : normalizeApplicationError(err, { source, metadata });
    } finally {
      store.isAnalyzing = false;
      store.isSynthesizing = false;
    }
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
        <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
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
          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick$={analyze}
              disabled={!store.loaded || !store.folioId || store.isAnalyzing}
              class="btn-press text-sm"
            >
              {store.isAnalyzing
                ? "Writing analysis…"
                : store.result
                  ? "Run full analysis again"
                  : "Run full analysis"}
            </button>
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

        {store.error && (
          <div class="mb-6">
            <ApplicationNotice
              error={store.error}
              busy={store.isAnalyzing}
              onRetry$={
                store.error.code === "VALIDATION_FAILED" ? undefined : analyze
              }
              showReference={store.error.code !== "VALIDATION_FAILED"}
              recoveryLabel={
                store.error.code === "CONFIGURATION_ERROR"
                  ? "Choose a provider"
                  : store.error.code === "VALIDATION_FAILED"
                    ? "Back to desk"
                    : undefined
              }
              recoveryHref={
                store.error.code === "CONFIGURATION_ERROR"
                  ? "/settings"
                  : store.error.code === "VALIDATION_FAILED"
                    ? "/editor"
                    : undefined
              }
            />
          </div>
        )}

        {store.isAnalyzing && (
          <div class="card mb-6" aria-busy="true">
            <EditorialLoader
              personas={store.personas}
              label={
                store.isSynthesizing
                  ? "Writing the room’s verdict"
                  : "Writing the editors’ memos"
              }
            />
          </div>
        )}

        {store.loaded && !store.result && !store.isAnalyzing && (
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
              {store.folioId
                ? `Run full analysis to give every editor a full memo on your draft, followed by the room’s combined verdict. Your draft needs at least ${MIN_EDITOR_WORDS} words.`
                : "Open a folio at the desk, then return here to run its full analysis."}
            </p>
            {!store.folioId && (
              <Link href="/editor" class="btn-press mt-4 inline-block text-sm">
                ← Back to desk
              </Link>
            )}
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
                  data-speech-id="analysis-synthesis"
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
                      <div class="persona-critique-head">
                        <PersonaMasthead
                          personaId={memo.personaId}
                          name={memo.personaName}
                          role={
                            store.personas.find((p) => p.id === memo.personaId)
                              ?.role
                          }
                        />
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
                        data-speech-id={`analysis-memo-${memo.personaId}`}
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
