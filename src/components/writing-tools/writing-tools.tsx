import { loadModelBriefForFolio } from "../../utils/model-context";
import { liveReviewSnapshot } from "../../utils/live-review";
import {
  $,
  component$,
  useStore,
  useStylesScoped$,
  useVisibleTask$,
} from "@qwik.dev/core";
import { askJudgement } from "../../utils/judgement-client";
import { Link } from "@qwik.dev/router";
import { Icon } from "../ui/icon";
import type { TwyneIconName } from "../../utils/icon-system";
import { SiteSelect } from "../ui/site-select";
import { paragraphTextFromHtml as manuscriptText } from "../../utils/draft-trajectory";
import { cachedWritingLens } from "../../utils/writing-lens-cache";
import { loadMetaFromIdb } from "../../utils/idb";
import { useConvexClient } from "../../utils/convex-context";
import {
  loadActiveFolioIdFromIdb,
  loadFolioContentFromIdb,
  loadFoliosFromIdb,
} from "../../utils/idb";
import { loadPersonaNotesLocally } from "../../utils/convex-sync";
import { loadRevisionHistory } from "../../utils/revision-history";
import {
  emptyWritingToolsNotebook,
  loadWritingToolsNotebook,
  saveWritingToolsNotebook,
  type WritingToolsNotebook,
} from "../../utils/writing-tools-storage";
import {
  WRITING_LENSES,
  type WritingLensId,
  type WritingLensInput,
  type WritingLensResult,
} from "../../utils/writing-lenses";

const LENS_ICONS: Record<WritingLensId, TwyneIconName> = {
  reader: "search",
  revision: "history",
  voice: "quote",
  promises: "checklist",
  scraps: "page",
  room: "comment-add",
  circling: "redo",
  research: "link",
};

interface ToolsState {
  loaded: boolean;
  folioId: string;
  folioName: string;
  draft: string;
  revisions: { id: string; text: string; label: string }[];
  notes: { id: string; text: string; author: string }[];
  notebook: WritingToolsNotebook;
  lens: WritingLensId;
  previousId: string;
  currentId: string;
  focus: string;
  newPassage: string;
  claim: string;
  previousClaim: string;
  source: string;
  busy: boolean;
  saving: boolean;
  saveNotice: string;
  error: string;
  result: WritingLensResult | null;
  resultKey: string;
  stale: boolean;
  refreshId: number;
  attemptedKey: string;
  automatic: boolean;
  explicitSelection: boolean;
  saveVersion: number;
}

function inputs(state: ToolsState): WritingLensInput {
  const comparesRevisions = state.lens === "revision" || state.lens === "voice";
  return {
    draft:
      !comparesRevisions || state.currentId === "current"
        ? state.draft
        : (state.revisions.find((revision) => revision.id === state.currentId)
            ?.text ?? ""),
    audience: state.notebook.audience,
    ...(comparesRevisions
      ? {
          previousDraft: state.revisions.find(
            (revision) => revision.id === state.previousId,
          )?.text,
        }
      : {}),
    ...(state.lens === "voice"
      ? { voiceSamples: state.notebook.voiceSamples }
      : {}),
    ...(state.lens === "scraps"
      ? { scraps: state.notebook.scraps, focus: state.focus }
      : {}),
    ...(state.lens === "room" ? { notes: state.notes } : {}),
    ...(state.lens === "circling"
      ? {
          revisions: [...state.revisions]
            .reverse()
            .map(({ id, text }) => ({ id, text })),
          focus: state.focus,
        }
      : {}),
    ...(state.lens === "research" ? { sources: state.notebook.sources } : {}),
    ...(state.lens === "promises"
      ? { intentionalPromises: state.notebook.intentionalPromises }
      : {}),
  };
}

function inputKey(state: ToolsState): string {
  return JSON.stringify([state.folioId, state.lens, inputs(state)]);
}

function materialPreview(state: ToolsState): string {
  const input = inputs(state);
  const sections = [`Draft\n${input.draft}`];
  if (input.audience) sections.push(`Intended reader\n${input.audience}`);
  if (input.previousDraft)
    sections.push(`Earlier revision\n${input.previousDraft}`);
  if (input.focus) sections.push(`Your focus\n${input.focus}`);
  for (const [index, passage] of (input.voiceSamples ?? []).entries())
    sections.push(`Voice example ${index + 1}\n${passage.text}`);
  for (const [index, passage] of (input.scraps ?? []).entries())
    sections.push(`Saved scrap ${index + 1}\n${passage.text}`);
  for (const note of input.notes ?? [])
    sections.push(`Room note · ${note.author || "Editor"}\n${note.text}`);
  for (const [index, revision] of (input.revisions ?? []).entries())
    sections.push(`Checkpoint ${index + 1} (oldest first)\n${revision.text}`);
  for (const [index, pair] of (input.sources ?? []).entries())
    sections.push(
      `Source pair ${index + 1}\nCurrent claim: ${pair.claim}${pair.previousClaim ? `\nEarlier wording: ${pair.previousClaim}` : ""}\nSource excerpt: ${pair.source}`,
    );
  return sections.join("\n\n———\n\n");
}

export const WritingTools = component$<{ embedded?: boolean }>(
  ({ embedded = false }) => {
    const client = useConvexClient();
    const state = useStore<ToolsState>({
      loaded: false,
      folioId: "",
      folioName: "",
      draft: "",
      revisions: [],
      notes: [],
      notebook: emptyWritingToolsNotebook(),
      lens: "reader",
      previousId: "",
      currentId: "current",
      focus: "",
      newPassage: "",
      claim: "",
      previousClaim: "",
      source: "",
      busy: false,
      saving: false,
      saveNotice: "",
      error: "",
      result: null,
      resultKey: "",
      stale: false,
      refreshId: 0,
      attemptedKey: "",
      automatic: false,
      explicitSelection: false,
      saveVersion: 0,
    });

    const refresh = $(async () => {
      const refreshId = ++state.refreshId;
      const folioId = await loadActiveFolioIdFromIdb();
      if (refreshId !== state.refreshId) return;
      if (!folioId) {
        state.folioId = "";
        state.draft = "";
        state.result = null;
        state.loaded = true;
        return;
      }
      const [html, revisions, notes, folios] = await Promise.all([
        loadFolioContentFromIdb(folioId),
        loadRevisionHistory(folioId),
        loadPersonaNotesLocally(folioId),
        loadFoliosFromIdb(),
      ]);
      if (
        (await loadActiveFolioIdFromIdb()) !== folioId ||
        refreshId !== state.refreshId
      )
        return;
      if (state.folioId !== folioId) {
        const [notebook, brief] = await Promise.all([
          loadWritingToolsNotebook(folioId),
          loadModelBriefForFolio(folioId),
        ]);
        if (
          (await loadActiveFolioIdFromIdb()) !== folioId ||
          refreshId !== state.refreshId
        )
          return;
        state.explicitSelection = false;
        state.notebook = notebook;
        if (!notebook.audience)
          state.notebook.audience = brief?.answers.audience ?? "";
        state.previousId =
          revisions.find((revision) => revision.html !== html)?.id ??
          revisions[0]?.id ??
          "";
        state.currentId = "current";
        state.result = null;
        state.resultKey = "";
        state.stale = false;
        state.newPassage = "";
        state.claim = "";
        state.previousClaim = "";
        state.source = "";
        state.focus = "";
        state.saveNotice = "";
      }
      state.folioId = folioId;
      state.folioName =
        folios.find((folio) => folio.id === folioId)?.name ?? "Current folio";
      state.draft = manuscriptText(html);
      if (!state.explicitSelection) {
        state.previousId =
          revisions.find((revision) => revision.html !== html)?.id ??
          revisions[0]?.id ??
          "";
        state.currentId = "current";
      }
      state.revisions = revisions.map((revision) => ({
        id: revision.id,
        text: manuscriptText(revision.html),
        label: `${revision.label} · ${new Date(revision.createdAt).toLocaleString()}`,
      }));
      state.notes = notes.map((note, index) => ({
        id: note.noteId ?? `${note.personaId}:${note.timestamp}:${index}`,
        text: note.feedback,
        author: note.personaName,
      }));
      state.loaded = true;
      if (state.result && state.resultKey !== inputKey(state))
        state.stale = true;
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      void refresh().catch(() => {
        state.error =
          "Your folio could not be loaded. Return to the desk and try again.";
        state.loaded = true;
      });
      const onFocus = () => {
        void refresh().catch(() => {});
      };
      window.addEventListener("focus", onFocus);
      window.addEventListener("twyne:draft-saved", onFocus);
      window.addEventListener("twyne:background-room-notes", onFocus);
      const onSetting = async () => {
        state.automatic =
          (await loadMetaFromIdb<boolean>("live-review-enabled")) !== false;
      };
      void onSetting();
      window.addEventListener("twyne:live-review-setting", onSetting);
      const interval = window.setInterval(onFocus, 3000);
      cleanup(() => {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("twyne:draft-saved", onFocus);
        window.removeEventListener("twyne:background-room-notes", onFocus);
        window.removeEventListener("twyne:live-review-setting", onSetting);
        window.clearInterval(interval);
      });
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ track }) => {
      const key = track(() => inputKey(state));
      if (state.result && key !== state.resultKey) state.stale = true;
    });

    const save = $(async () => {
      const version = ++state.saveVersion;
      state.saving = true;
      state.saveNotice = "";
      const folioId = state.folioId;
      try {
        await saveWritingToolsNotebook(folioId, state.notebook);
        if (state.folioId !== folioId) return false;
        if (version === state.saveVersion) state.saveNotice = "";
        return true;
      } catch {
        if (state.folioId !== folioId) return false;
        if (version === state.saveVersion)
          state.saveNotice =
            "Could not save your changes on this device. Edit the field again to retry.";
        return false;
      } finally {
        if (version === state.saveVersion) state.saving = false;
      }
    });

    const run = $(async (explicit = false) => {
      if (state.busy) return;
      if (explicit) state.explicitSelection = true;
      state.busy = true;
      state.error = "";
      state.result = null;
      state.stale = false;
      try {
        await refresh();
        state.attemptedKey = inputKey(state);
        if (!state.automatic && !explicit) return;
        if (
          state.lens === "research" &&
          state.notebook.sources.some(
            (pair) => !pair.claim.trim() || !state.draft.includes(pair.claim),
          )
        ) {
          state.error =
            "Update the saved claims to match your current draft before rechecking their sources.";
          return;
        }
        if (!client.value) {
          state.error =
            "Writing tools are not connected yet. Please try again in a moment.";
          return;
        }
        const key = inputKey(state);
        state.attemptedKey = key;
        const requestInput = JSON.parse(
          JSON.stringify(inputs(state)),
        ) as WritingLensInput;
        const result = await cachedWritingLens(
          state.folioId,
          state.lens,
          requestInput,
          async (request) => {
            if (
              key !== inputKey(state) ||
              !client.value ||
              (!state.automatic && !explicit)
            )
              return { ok: false, error: "cancelled" };
            return askJudgement(client.value, {
              ...request,
              state: Object.fromEntries(
                Object.entries(request.state).map(([name, value]) => [
                  name,
                  typeof value === "string" ? value : JSON.stringify(value),
                ]),
              ),
            });
          },
        );
        await refresh();
        if (key !== inputKey(state) || (!state.automatic && !explicit)) {
          state.stale = true;
          return;
        }
        state.result = result;
        state.resultKey = key;
      } catch {
        state.error =
          "This check could not finish. Your draft and saved material are unchanged. Please try again.";
      } finally {
        state.busy = false;
      }
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ track, cleanup }) => {
      const key = track(() => inputKey(state));
      const loaded = track(() => state.loaded);
      const busy = track(() => state.busy);
      const automatic = track(() => state.automatic);
      const connected = track(() => client.value);
      if (
        embedded ||
        !loaded ||
        busy ||
        !automatic ||
        !connected ||
        !state.draft.trim() ||
        key === state.attemptedKey
      )
        return;
      const timer = setTimeout(() => {
        void run();
      }, 1000);
      cleanup(() => clearTimeout(timer));
    });

    // The board observes workspace-owned checks; only an explicit override starts another reading.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(
      ({ track, cleanup }) => {
        track(() => state.folioId);
        track(() => state.lens);
        track(() => state.explicitSelection);
        if (!embedded || state.explicitSelection) return;
        const update = () => {
          const snapshot = liveReviewSnapshot();
          if (
            snapshot.folioId !== state.folioId ||
            state.explicitSelection ||
            state.busy
          )
            return;
          state.result = snapshot.result?.lenses[state.lens] ?? null;
          state.resultKey = inputKey(state);
          state.stale = !!state.result && snapshot.status === "waiting";
          state.error =
            snapshot.status === "unavailable" && !state.result
              ? snapshot.message
              : "";
        };
        update();
        window.addEventListener("twyne:live-review", update);
        cleanup(() => window.removeEventListener("twyne:live-review", update));
      },
      { strategy: "document-ready" },
    );

    useStylesScoped$(`
    .tools { min-height:100vh; background:var(--color-paper); color:var(--color-ink); padding:2rem 1rem 4rem; font-family:var(--font-serif); text-align:left; }
    .tools.embedded { min-height:0; min-width:0; padding:1rem; background:transparent; }
    .embedded .tools-grid { grid-template-columns:minmax(0,1fr); gap:1.25rem; }
    .embedded .results { border-top:1px solid var(--color-paper-3); padding-top:1rem; }
    .embedded .controls { border-top:1px solid var(--color-paper-3); padding-top:1rem; }
    .tools-inner { width:100%; min-width:0; max-width:70rem; margin:auto; }
    .tools-header { display:flex; align-items:start; justify-content:space-between; gap:1rem; margin-bottom:2rem; }
    h1 { font-family:var(--font-display); font-size:2rem; line-height:1.2; font-weight:700; }
    h2 { font-family:var(--font-display); font-size:1.15rem; font-weight:650; margin-bottom:.6rem; }
    h3 { font-family:var(--font-display); font-size:1rem; font-weight:650; }
    p { line-height:1.6; } .muted { color:var(--color-ink-light); font-size:.9rem; }
    .tools-grid { display:grid; grid-template-columns:minmax(16rem,23rem) minmax(0,1fr); gap:2.5rem; align-items:start; }
    .controls { display:grid; gap:1.25rem; min-width:0; }
    .controls > *, .controls label { min-width:0; }
    .controls :is(input,textarea) { width:100%; min-width:0; }
    .lens-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,10.5rem),1fr)); gap:.5rem; border:0; padding:0; margin:0; min-width:0; }
    .lens-grid legend { font-size:.9rem; font-weight:550; margin-bottom:.5rem; padding:0; }
    .lens-card { display:grid; gap:.25rem; align-content:start; text-align:left; padding:.65rem .75rem; border:1px solid var(--color-paper-3); border-radius:2px; background:var(--color-paper); color:var(--color-ink); cursor:pointer; }
    .lens-card { transition:background-color 150ms ease, border-color 150ms ease, color 150ms ease; }
    .lens-card:hover, .lens-card:focus-visible { border-color:var(--color-ink-light); background:var(--color-paper-soft); }
    .lens-card:active { background:var(--color-paper-3); }
    .lens-card[aria-pressed="true"]:hover { border-color:var(--color-vermilion-2); background:var(--color-paper-2); }
    .lens-card[aria-pressed="true"] { border-color:var(--color-vermilion-2);  background:var(--color-paper-soft); }
    .lens-card__label { display:flex; align-items:center; gap:.5rem; font-family:var(--font-display); font-weight:650; font-size:.9rem; line-height:1.3; }
    .lens-card__desc { font-size:.78rem; line-height:1.45; color:var(--color-ink-light); }
    label { display:grid; gap:.4rem; font-size:.9rem; font-weight:550; }
    input,textarea { min-height:2.75rem; }
    textarea { min-height:6rem; resize:vertical; font-weight:400; line-height:1.5; }
    button,a { touch-action:manipulation; } button { min-height:2.75rem; }
    button:disabled { opacity:.55; cursor:wait; }
    :is(button,a,input,select,textarea,summary):focus-visible { outline:2px solid var(--color-vermilion-2); outline-offset:3px; }
    .saved-list { padding:0; list-style:none; display:grid; gap:.75rem; margin-top:.75rem; }
    .saved-list li { border-bottom:1px solid var(--color-paper-3); padding-bottom:.75rem; }
    .small-button { display:inline-flex; align-items:center; justify-content:center; gap:.5rem; margin-top:.4rem; }
    .small-button:hover { background:var(--color-paper-2); } .small-button:active { transform:translateY(1px); }
    .research-fields { display:grid; gap:.75rem; }
    .results { overflow-wrap:anywhere; border-top:3px solid var(--color-ink); padding-top:1rem; min-width:0; }
    .check-selector { margin-bottom:1rem; }
    .check-selector .check-purpose { margin-top:.75rem; margin-bottom:0; }
    .check-purpose { color:var(--color-ink-light); font-size:.875rem; margin-bottom:.75rem; max-width:65ch; }
    .finding { padding:1.25rem 0; border-bottom:1px solid var(--color-paper-3); }
    blockquote { margin:.75rem 0; padding:.25rem 0 .25rem 1rem; border-left:2px solid var(--color-paper-3); font-family:var(--font-serif); white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.65; }
    .review { font-size:.75rem; color:var(--color-ink-light); margin:.5rem 0; }
    .notice { padding:.8rem 0; color:var(--color-ink-light); font-size:.9rem; }
    details { margin-top:.75rem; } summary { cursor:pointer; min-height:2.5rem; font-size:.85rem; padding:.5rem 0; }
    pre { font: .8rem/1.5 var(--font-typewriter,monospace); white-space:pre-wrap; overflow-wrap:anywhere; max-height:20rem; overflow:auto; background:var(--color-paper-2); padding:1rem; }
    .empty { padding:2rem 0; max-width:42ch; }
    .run { display:flex; align-items:center; justify-content:center; gap:.5rem; width:100%; }
    summary { transition:color 150ms ease; }
    summary:hover { color:var(--color-vermilion-2); }
    .lens-card:disabled:hover { background:var(--color-paper); border-color:var(--color-paper-3); }
    @media(max-width:720px) { .tools-grid { grid-template-columns:1fr; gap:2rem; } .tools-header { flex-wrap:wrap; } .tools { padding-top:1.25rem; } }
    @media(prefers-reduced-motion:reduce) { .small-button:active { transform:none; } .lens-card, summary { transition:none; } }
  `);

    const needsRevision = state.lens === "revision" || state.lens === "voice";
    const passageType = state.lens === "voice" ? "voiceSamples" : "scraps";
    const selected = WRITING_LENSES.find((lens) => lens.id === state.lens)!;
    return (
      <section
        class={`tools${embedded ? " embedded" : ""}`}
        aria-label="Writing tools"
      >
        <div class="tools-inner">
          {!embedded && (
            <header class="tools-header">
              <div>
                <h1>Writing tools</h1>
              </div>
              {!embedded && (
                <Link href="/editor/" class="btn-paper">
                  ← Back to desk
                </Link>
              )}
            </header>
          )}
          {!state.loaded ? (
            <p role="status">Loading your folio and saved material…</p>
          ) : !state.folioId ? (
            <div class="empty">
              <h2>Start with a draft</h2>
              <p>
                Open a folio at your desk, then return here to explore its
                revisions, voice and reader experience.
              </p>
              <Link href="/editor/" class="btn-press">
                Open the desk
              </Link>
            </div>
          ) : (
            <>
              <div class="check-selector">
                <fieldset class="lens-grid">
                  <legend>Choose what to check</legend>
                  {WRITING_LENSES.map((lens) => (
                    <button
                      key={lens.id}
                      type="button"
                      title={lens.description}
                      class="lens-card"
                      aria-pressed={state.lens === lens.id}
                      onClick$={() => {
                        if (state.lens === lens.id) return;
                        state.lens = lens.id;
                        state.explicitSelection = false;
                        state.result = null;
                        state.stale = false;
                        state.error = "";
                      }}
                    >
                      <span class="lens-card__label">
                        <Icon name={LENS_ICONS[lens.id]} />
                        {lens.label}
                      </span>
                    </button>
                  ))}
                </fieldset>
                <p class="check-purpose">{selected.description}</p>
              </div>
              <div class="tools-grid">
                <section class="controls" aria-label="Choose a writing check">
                  {needsRevision && (
                    <>
                      <label>
                        Earlier draft
                        <SiteSelect
                          ariaLabel="Earlier revision"
                          value={state.previousId}
                          options={[
                            { value: "", label: "Choose a saved revision" },
                            ...state.revisions.map((revision) => ({
                              value: revision.id,
                              label: revision.label,
                            })),
                          ]}
                          onChange$={(value) => {
                            state.previousId = value;
                            state.explicitSelection = true;
                          }}
                        />
                      </label>
                      <label>
                        Later draft
                        <SiteSelect
                          ariaLabel="Later revision"
                          value={state.currentId}
                          options={[
                            { value: "current", label: "Current draft" },
                            ...state.revisions.map((revision) => ({
                              value: revision.id,
                              label: revision.label,
                            })),
                          ]}
                          onChange$={(value) => {
                            state.currentId = value;
                            state.explicitSelection = true;
                          }}
                        />
                      </label>
                      {!state.revisions.length && (
                        <p class="notice">
                          Save a checkpoint in the desk’s version history, make
                          an edit, then return to compare it.
                        </p>
                      )}
                    </>
                  )}
                  <label>
                    Intended reader
                    <textarea
                      class="field-input"
                      value={state.notebook.audience}
                      placeholder="A curious reader with no background in the subject…"
                      onInput$={async (_, element) => {
                        state.notebook.audience = element.value;
                        await save();
                      }}
                    />
                  </label>
                  {(state.lens === "scraps" || state.lens === "circling") && (
                    <label>
                      Passage or question to focus on (optional)
                      <textarea
                        class="field-input"
                        value={state.focus}
                        onInput$={(_, element) => {
                          state.focus = element.value;
                          state.explicitSelection = true;
                        }}
                      />
                    </label>
                  )}
                  {(state.lens === "voice" || state.lens === "scraps") && (
                    <section>
                      <h2>
                        {state.lens === "voice"
                          ? "This feels like me"
                          : "The scraps drawer"}
                      </h2>
                      <p class="muted">
                        {state.lens === "voice"
                          ? "Save passages whose character you want an edit to preserve."
                          : "Save your own cut passages to check where they might belong."}
                      </p>
                      <label>
                        {state.lens === "voice"
                          ? "Voice example"
                          : "Cut passage"}
                        <textarea
                          class="field-input"
                          value={state.newPassage}
                          onInput$={(_, element) => {
                            state.newPassage = element.value;
                          }}
                        />
                      </label>
                      <button
                        class="btn-paper small-button"
                        disabled={state.saving || !state.newPassage.trim()}
                        onClick$={async () => {
                          const key =
                            state.lens === "voice" ? "voiceSamples" : "scraps";
                          if (
                            !state.notebook[key].some(
                              (passage) =>
                                passage.text === state.newPassage.trim(),
                            )
                          ) {
                            state.notebook[key].push({
                              id: crypto.randomUUID(),
                              text: state.newPassage.trim(),
                            });
                          }
                          if (await save()) state.newPassage = "";
                        }}
                      >
                        <Icon name="add" /> Add passage
                      </button>
                      <ul class="saved-list">
                        {state.notebook[passageType].map((passage) => (
                          <li key={passage.id}>
                            <blockquote>{passage.text}</blockquote>
                            <button
                              class="btn-paper small-button"
                              disabled={state.saving}
                              onClick$={async () => {
                                state.notebook[passageType] = state.notebook[
                                  passageType
                                ].filter((item) => item.id !== passage.id);
                                await save();
                              }}
                            >
                              <Icon name="trash" /> Remove passage
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {state.lens === "room" && (
                    <section>
                      <h2>Notes from your room</h2>
                      <p class="muted">
                        {state.notes.length} saved notes for this folio. Convene
                        the room at your desk to add feedback.
                      </p>
                      <details>
                        <summary>Read the notes being compared</summary>
                        {state.notes.map((note) => (
                          <div key={note.id}>
                            <h3>{note.author}</h3>
                            <blockquote>{note.text}</blockquote>
                          </div>
                        ))}
                      </details>
                    </section>
                  )}
                  {state.lens === "circling" && (
                    <p class="muted">
                      Uses {state.revisions.length} saved checkpoints plus your
                      current draft. Checkpoint order reflects when each
                      revision was saved.
                    </p>
                  )}
                  {state.lens === "research" && (
                    <section class="research-fields">
                      <h2>Claims & sources</h2>
                      <p class="muted">
                        Paste the source excerpt that supports each claim. Only
                        supplied excerpts are checked; links are not fetched.
                      </p>
                      <label>
                        Earlier wording (optional)
                        <textarea
                          class="field-input"
                          value={state.previousClaim}
                          onInput$={(_, element) => {
                            state.previousClaim = element.value;
                          }}
                        />
                      </label>
                      <label>
                        Current claim, copied from your draft
                        <textarea
                          class="field-input"
                          value={state.claim}
                          onInput$={(_, element) => {
                            state.claim = element.value;
                          }}
                        />
                      </label>
                      <label>
                        Supporting source excerpt
                        <textarea
                          class="field-input"
                          value={state.source}
                          onInput$={(_, element) => {
                            state.source = element.value;
                          }}
                        />
                      </label>
                      <button
                        class="btn-paper small-button"
                        disabled={
                          state.saving ||
                          !state.claim.trim() ||
                          !state.source.trim()
                        }
                        onClick$={async () => {
                          if (
                            !state.notebook.sources.some(
                              (pair) =>
                                pair.claim === state.claim.trim() &&
                                pair.source === state.source.trim() &&
                                (pair.previousClaim ?? "") ===
                                  state.previousClaim.trim(),
                            )
                          )
                            state.notebook.sources.push({
                              id: crypto.randomUUID(),
                              claim: state.claim.trim(),
                              source: state.source.trim(),
                              ...(state.previousClaim.trim()
                                ? { previousClaim: state.previousClaim.trim() }
                                : {}),
                            });
                          if (await save()) {
                            state.claim = "";
                            state.previousClaim = "";
                            state.source = "";
                          }
                        }}
                      >
                        <Icon name="add" /> Add claim & source
                      </button>
                      <ul class="saved-list">
                        {state.notebook.sources.map((pair) => (
                          <li key={pair.id}>
                            <label>
                              Current claim
                              <textarea
                                class="field-input"
                                value={pair.claim}
                                onInput$={async (_, element) => {
                                  pair.claim = element.value;
                                  await save();
                                }}
                              />
                            </label>
                            {!state.draft.includes(pair.claim) && (
                              <p class="notice">
                                This wording is no longer in the draft. Update
                                it before rechecking.
                              </p>
                            )}
                            <details>
                              <summary>Earlier wording & source</summary>
                              {pair.previousClaim && (
                                <blockquote>{pair.previousClaim}</blockquote>
                              )}
                              <blockquote>{pair.source}</blockquote>
                            </details>
                            <button
                              class="btn-paper small-button"
                              disabled={state.saving}
                              onClick$={async () => {
                                state.notebook.sources =
                                  state.notebook.sources.filter(
                                    (item) => item.id !== pair.id,
                                  );
                                await save();
                              }}
                            >
                              <Icon name="trash" /> Remove claim & source
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {state.lens === "promises" &&
                    state.notebook.intentionalPromises.length > 0 && (
                      <details>
                        <summary>
                          {state.notebook.intentionalPromises.length} promises
                          left intentionally open
                        </summary>
                        <p class="muted">
                          These decisions apply to the exact original passage.
                        </p>
                        <button
                          class="btn-paper small-button"
                          disabled={state.saving}
                          onClick$={async () => {
                            state.notebook.intentionalPromises = [];
                            await save();
                          }}
                        >
                          <Icon name="undo" /> Reconsider these promises
                        </button>
                      </details>
                    )}
                  {state.saveNotice && (
                    <p class="notice" role="alert">
                      {state.saveNotice}
                    </p>
                  )}
                  <details>
                    <summary>What this check sends</summary>
                    <p class="muted">
                      The relevant saved text and selected material below are
                      sent for automatic analysis after a pause. Switch off
                      Automatic review in the Tools board to stop automatic
                      checks. You decide what to change.
                    </p>
                    <pre>{materialPreview(state)}</pre>
                  </details>
                  {embedded && state.explicitSelection && (
                    <button
                      class="btn-paper small-button"
                      disabled={state.busy}
                      onClick$={async () => {
                        state.explicitSelection = false;
                        state.focus = "";
                        state.result = null;
                        await refresh();
                      }}
                    >
                      <Icon name="undo" /> Use automatic reading
                    </button>
                  )}
                  <button
                    class="btn-press run"
                    disabled={state.busy || !state.draft.trim()}
                    onClick$={() => run(true)}
                  >
                    <Icon name="redo" />{" "}
                    {state.busy ? "Checking…" : "Run this check"}
                  </button>
                </section>
                <section
                  class="results"
                  aria-label="Writing check results"
                  aria-busy={state.busy}
                >
                  {state.busy && (
                    <p role="status" class="notice">
                      Reading the selected material… You can leave your choices
                      as they are while this finishes.
                    </p>
                  )}
                  {state.error && (
                    <p role="alert" class="notice">
                      {state.error}
                    </p>
                  )}
                  {state.stale && (
                    <p role="status" class="notice">
                      The draft or selected material changed. This reading will
                      update after a pause.
                    </p>
                  )}
                  {!state.busy &&
                    !state.result &&
                    !state.error &&
                    !state.stale && (
                      <div class="empty">
                        <p class="muted">
                          {embedded && !state.explicitSelection
                            ? "Waiting for automatic review."
                            : "No reading yet."}
                        </p>
                      </div>
                    )}
                  {state.result && !state.stale && (
                    <>
                      <details class="notice">
                        <summary class="focus-ring">
                          <Icon name="search" />{" "}
                          {state.result.status === "unavailable"
                            ? "Reading unavailable"
                            : state.result.notice
                              ? "Limited reading"
                              : "Review details"}
                        </summary>
                        <p>{state.result.coverage}</p>
                        {state.result.notice && <p>{state.result.notice}</p>}
                      </details>
                      {state.result.status === "complete" &&
                        !state.result.findings.length && (
                          <p class="notice">
                            No findings in the material checked. This is a
                            limited reading, not a guarantee that every issue
                            was found.
                          </p>
                        )}
                      {state.result.findings.map((finding) => (
                        <article class="finding" key={finding.id}>
                          <h3>{finding.title}</h3>
                          {finding.needsReview && (
                            <p class="review">
                              Tentative · review this in context
                            </p>
                          )}
                          <p>{finding.detail}</p>
                          {finding.passage && (
                            <blockquote>{finding.passage}</blockquote>
                          )}
                          {finding.relatedPassage && (
                            <>
                              <p class="muted">Related passage</p>
                              <blockquote>{finding.relatedPassage}</blockquote>
                            </>
                          )}
                          {state.lens === "promises" && (
                            <button
                              class="btn-paper small-button"
                              disabled={state.saving}
                              onClick$={async () => {
                                if (
                                  !state.notebook.intentionalPromises.includes(
                                    finding.id,
                                  )
                                )
                                  state.notebook.intentionalPromises.push(
                                    finding.id,
                                  );
                                await save();
                              }}
                            >
                              <Icon name="check" /> Leave intentionally
                              unresolved
                            </button>
                          )}
                        </article>
                      ))}
                    </>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </section>
    );
  },
);
