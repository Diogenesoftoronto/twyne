import type { Editor } from "@tiptap/core";
import type { ExportPayload } from "../exchange";
import { createRevisionSnapshot } from "../revision-history";
import {
  FOLIO_CONTENT_SAVED,
  loadFolioContentSnapshotFromIdb,
  saveFolioTypstToIdb,
  type FolioContentSavedDetail,
} from "../idb";
import { htmlToTypst, typstToHtml, reconcileTypstSource } from "./document";
import { compileTypstSource, type TypstCompilation } from "./client";
import {
  loadTypstSourceDraft,
  saveTypstSourceDraft,
  clearTypstSourceDraft,
} from "./source-drafts";

export interface TypstSessionState {
  source: string;
  dirty: boolean;
  conflict: boolean;
  status: string;
  error: string;
  pages: string[];
  pdfUrl: string;
  proofStale: boolean;
  applying: boolean;
}
export interface TypstSession {
  flushVisual(): void;
  setProofActive(active: boolean): void;
  changeSource(source: string): void;
  apply(): Promise<void>;
  discard(): Promise<void>;
  refreshProof(force?: boolean): void;
  destroy(): void;
}
export interface TypstSessionOptions {
  editor: Editor;
  folioId: string;
  readOnly: boolean;
  proofActive?: boolean;
  onState(state: TypstSessionState): void;
  getPayload(source: string): Promise<ExportPayload>;
  onPages(pageCount: number): void;
}

export interface TypstSessionDependencies {
  loadSnapshot: typeof loadFolioContentSnapshotFromIdb;
  saveSource: typeof saveFolioTypstToIdb;
  loadDraft: typeof loadTypstSourceDraft;
  saveDraft: typeof saveTypstSourceDraft;
  clearDraft: typeof clearTypstSourceDraft;
  compile: typeof compileTypstSource;
  saveRevision: typeof createRevisionSnapshot;
}

/** One folio owns its source draft, compiler cancellation and proof object URLs. */
export async function createTypstSession(
  options: TypstSessionOptions,
  overrides: Partial<TypstSessionDependencies> = {},
): Promise<TypstSession> {
  const { editor, folioId } = options;
  const deps: TypstSessionDependencies = {
    loadSnapshot: loadFolioContentSnapshotFromIdb,
    saveSource: saveFolioTypstToIdb,
    loadDraft: loadTypstSourceDraft,
    saveDraft: saveTypstSourceDraft,
    clearDraft: clearTypstSourceDraft,
    compile: compileTypstSource,
    saveRevision: createRevisionSnapshot,
    ...overrides,
  };
  let proofActive = options.proofActive ?? true;
  let destroyed = false;
  let applying = false;
  let replacing = false;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let visualTimer: ReturnType<typeof setTimeout> | undefined;
  let visualPending = false;
  let requestId = 0;
  let pendingRequest: Promise<boolean> | undefined;
  let job:
    | {
        key: string;
        controller: AbortController;
        promise: Promise<TypstCompilation>;
      }
    | undefined;
  let completedKey: string | undefined;
  let completedPageCount = 0;
  let baselineHtml = editor.getHTML();
  const visualHistory = new Set([baselineHtml]);
  const snapshot = await deps.loadSnapshot(folioId);
  let baseSource = snapshot?.typstSource;
  let committedHtml = snapshot?.html ?? baselineHtml;
  const recovered = await deps.loadDraft(folioId);
  baselineHtml = editor.getHTML();
  visualHistory.add(baselineHtml);
  let cleanSource =
    baseSource !== undefined
      ? reconcileTypstSource(baseSource, baselineHtml)
      : htmlToTypst(baselineHtml);
  const state: TypstSessionState = {
    source: recovered?.source ?? cleanSource,
    dirty: Boolean(recovered && recovered.source !== cleanSource),
    conflict: Boolean(
      recovered &&
        recovered.source !== cleanSource &&
        recovered.baseSource !== (baseSource ?? cleanSource),
    ),
    status: recovered
      ? "Recovered source draft"
      : proofActive
        ? "Preparing proof…"
        : "Proof updates when opened",
    error: "",
    pages: [],
    pdfUrl: "",
    proofStale: true,
    applying: false,
  };
  if (recovered && state.dirty) baseSource = recovered.baseSource;
  function emit() {
    if (destroyed) return;
    state.applying = applying;
    const editable = !options.readOnly && !state.dirty && !applying;
    if (editor.isEditable !== editable) editor.setEditable(editable, false);
    options.onState({ ...state, pages: [...state.pages] });
  }
  function sourceEvent() {
    window.dispatchEvent(
      new CustomEvent("twyne:typst-source-state", {
        detail: { folioId, source: state.source, pending: state.dirty },
      }),
    );
  }
  function draft() {
    if (destroyed || options.readOnly) return;
    void deps
      .saveDraft({
        folioId,
        source: state.source,
        baseSource: baseSource ?? cleanSource,
        updatedAt: Date.now(),
      })
      .catch((error) => {
        if (destroyed) return;
        state.error =
          error instanceof Error
            ? error.message
            : "Source could not be saved on this device.";
        emit();
      });
  }
  function clearScheduledCompile() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  function cancel() {
    clearScheduledCompile();
    job?.controller.abort();
    job = undefined;
    pendingRequest = undefined;
    requestId++;
    revision++;
  }
  function releaseProof() {
    state.pages.forEach((url) => URL.revokeObjectURL(url));
    if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  }
  function readyStatus() {
    return `${completedPageCount} ${completedPageCount === 1 ? "page" : "pages"}${state.dirty ? " · source draft" : ""}`;
  }
  function compile(force = false): Promise<boolean> {
    flushVisual();
    clearScheduledCompile();
    const currentRevision = revision;
    const currentRequest = ++requestId;
    const source = state.source;
    const current = () =>
      !destroyed && currentRevision === revision && source === state.source;
    state.status = "Typesetting…";
    state.error = "";
    state.proofStale = true;
    emit();
    const run = async (): Promise<boolean> => {
      let currentJob: typeof job;
      try {
        const payload = await options.getPayload(source);
        if (!current()) return false;
        // A later request owns publication. Joining it also lets Apply wait for
        // the newest payload check instead of silently dropping the apply.
        if (currentRequest !== requestId) return pendingRequest ?? false;
        const key = JSON.stringify([source, payload]);
        if (job?.key === key && !job.controller.signal.aborted) {
          currentJob = job;
        } else if (!force && completedKey === key) {
          job?.controller.abort();
          job = undefined;
          state.proofStale = false;
          state.status = readyStatus();
          emit();
          return true;
        } else {
          job?.controller.abort();
          const controller = new AbortController();
          currentJob = {
            key,
            controller,
            promise: deps.compile(source, {
              payload,
              signal: controller.signal,
              onProgress: (status) => {
                if (current() && job === currentJob) {
                  state.status = status;
                  emit();
                }
              },
            }),
          };
          job = currentJob;
        }
        const compiled = await currentJob.promise;
        if (!current()) return false;
        if (currentRequest !== requestId) return pendingRequest ?? false;
        if (currentJob.controller.signal.aborted) return false;
        const urls = compiled.pages.map((svg) =>
          URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
        );
        const pdfUrl = URL.createObjectURL(compiled.pdf);
        releaseProof();
        state.pages = urls;
        state.pdfUrl = pdfUrl;
        completedKey = key;
        completedPageCount = compiled.pageCount;
        state.proofStale = false;
        state.status = readyStatus();
        options.onPages(compiled.pageCount);
        emit();
        return true;
      } catch (error) {
        if (!current()) return false;
        if (currentRequest !== requestId) return pendingRequest ?? false;
        if (currentJob?.controller.signal.aborted) return false;
        // A failed payload check also supersedes any older worker. Do not keep
        // a rejected job available for the next retry to accidentally rejoin.
        job?.controller.abort();
        job = undefined;
        // A failed explicit refresh must remain retryable even when the last
        // valid proof used the same inputs.
        completedKey = undefined;
        state.status = state.pages.length
          ? "Showing last valid proof"
          : "Proof unavailable";
        state.error =
          error instanceof Error
            ? error.message
            : "The source could not be typeset.";
        emit();
        return false;
      } finally {
        if (currentRequest === requestId) {
          if (job === currentJob) job = undefined;
          // Keep the latest settled validation available to older payload
          // requests (notably Apply) until it is superseded or cancelled.
        }
      }
    };
    pendingRequest = run();
    return pendingRequest;
  }
  function schedule() {
    cancel();
    if (!proofActive) return;
    timer = setTimeout(() => {
      timer = undefined;
      void compile();
    }, 450);
  }
  function flushVisual() {
    if (visualTimer !== undefined) clearTimeout(visualTimer);
    visualTimer = undefined;
    if (!visualPending || destroyed || replacing || applying) return;
    visualPending = false;
    const html = editor.getHTML();
    if (state.dirty) {
      if (html !== baselineHtml) {
        state.conflict = true;
        state.error =
          "The visual manuscript changed. Keep a source copy before discarding or resolving this draft.";
        emit();
      }
      return;
    }
    baselineHtml = html;
    visualHistory.add(html);
    if (visualHistory.size > 100)
      visualHistory.delete(visualHistory.values().next().value!);
    cleanSource = reconcileTypstSource(state.source, html);
    state.proofStale ||= state.source !== cleanSource;
    state.source = cleanSource;
    sourceEvent();
    emit();
    schedule();
  }
  function editorUpdated() {
    if (destroyed || replacing || applying) return;
    // Serialization, source reconciliation and updating the hidden CodeMirror
    // document must never run synchronously inside a typing transaction.
    visualPending = true;
    if (!state.proofStale) {
      state.proofStale = true;
      emit();
    }
    cancel(); // Invalidate proofs of the previous manuscript immediately.
    if (visualTimer !== undefined) clearTimeout(visualTimer);
    visualTimer = setTimeout(flushVisual, 500);
  }
  function contentDerived(event: Event) {
    const html = (event as CustomEvent<{ html?: string }>).detail?.html;
    if (typeof html !== "string" || destroyed || applying || replacing) return;
    // Remember only snapshots that could actually be saved, rather than
    // retaining a full HTML copy of each of the last 100 keystrokes.
    visualHistory.add(html);
    if (visualHistory.size > 100)
      visualHistory.delete(visualHistory.values().next().value!);
  }
  function saved(event: Event) {
    const rec = (event as CustomEvent<FolioContentSavedDetail>).detail;
    // Remote restorations can match visualHistory. Only local acknowledgements
    // may advance a draft's base; remoteChanged detects remote conflicts.
    if (
      destroyed ||
      applying ||
      rec?.folioId !== folioId ||
      rec.origin === "remote" ||
      rec.typstSource === undefined
    )
      return;
    if (visualPending && !state.dirty && visualHistory.has(rec.html)) {
      // Acknowledge the saved snapshot without forcing newer unsaved typing
      // through source reconciliation. The idle timer still owns that work.
      committedHtml = rec.html;
      baseSource = rec.typstSource;
      return;
    }
    flushVisual();
    if (visualHistory.has(rec.html)) committedHtml = rec.html;
    if (visualHistory.has(rec.html) && rec.html !== baselineHtml) {
      // A debounced save can complete after another keystroke. Never project
      // that older local snapshot back over the live editor/source draft.
      baseSource = rec.typstSource;
      if (state.dirty) draft();
      return;
    }
    if (state.dirty) {
      // A save already queued by the visual editor before source editing began.
      if (rec.html === baselineHtml && rec.typstSource === cleanSource) {
        baseSource = rec.typstSource;
        draft();
      } else if (rec.typstSource !== baseSource) {
        state.conflict = true;
        state.error =
          "A newer manuscript was saved while you edited source. Download your draft, then discard it to load the latest revision.";
      }
      emit();
      return;
    }
    if (!visualHistory.has(rec.html)) return;
    baseSource = rec.typstSource;
    baselineHtml = editor.getHTML();
    cleanSource =
      rec.html === baselineHtml
        ? rec.typstSource
        : reconcileTypstSource(rec.typstSource, baselineHtml);
    const changed = state.source !== cleanSource;
    state.proofStale ||= changed;
    state.source = cleanSource;
    sourceEvent();
    emit();
    // Persistence acknowledgements do not change the rendered snapshot.
    if (changed) schedule();
  }
  function remoteChanged(event: Event) {
    const rec = (
      event as CustomEvent<{
        folioId: string;
        source: string;
        html: string;
        intentionalReplacement?: boolean;
      }>
    ).detail;
    if (destroyed || rec?.folioId !== folioId || applying) return;
    flushVisual();
    if (state.dirty) {
      if (rec.source !== baseSource) {
        state.conflict = true;
        state.error =
          "A newer manuscript arrived while you edited source. Download your draft before discarding it to load the latest revision.";
        emit();
      }
      return;
    }
    if (
      !rec.intentionalReplacement &&
      editor.getHTML() !== committedHtml &&
      editor.getHTML() !== rec.html
    ) {
      state.source = reconcileTypstSource(state.source, editor.getHTML());
      state.dirty = true;
      state.conflict = true;
      state.error =
        "A newer manuscript arrived before your visual edits were saved. Your local draft is preserved; download it before loading the newer revision.";
      draft();
      sourceEvent();
      emit();
      return;
    }
    const changed = state.source !== rec.source || baselineHtml !== rec.html;
    committedHtml = rec.html;
    baseSource = rec.source;
    cleanSource = rec.source;
    state.proofStale ||= changed;
    state.source = rec.source;
    replacing = true;
    try {
      if (editor.getHTML() !== rec.html) {
        window.dispatchEvent(
          new CustomEvent("twyne:typst-applying", { detail: { folioId } }),
        );
        editor.commands.setContent(rec.html, { emitUpdate: false });
      }
      baselineHtml = editor.getHTML();
    } finally {
      replacing = false;
    }
    sourceEvent();
    emit();
    if (changed) schedule();
  }
  function requestSource(event: Event) {
    const detail = (
      event as CustomEvent<{
        folioId?: string;
        source?: string;
        pending?: boolean;
      }>
    ).detail;
    if (detail && (!detail.folioId || detail.folioId === folioId)) {
      flushVisual();
      detail.source = state.source;
      detail.pending = state.dirty;
    }
  }
  editor.on("update", editorUpdated);
  window.addEventListener("twyne:content", contentDerived);
  window.addEventListener(FOLIO_CONTENT_SAVED, saved);
  window.addEventListener("twyne:typst-remote-change", remoteChanged);
  window.addEventListener("twyne:request-typst-source", requestSource);
  emit();
  sourceEvent();
  schedule();
  return {
    flushVisual,
    setProofActive(active) {
      if (destroyed || proofActive === active) return;
      proofActive = active;
      if (active) schedule();
      else cancel();
    },
    changeSource(source) {
      if (destroyed || options.readOnly || applying) return;
      flushVisual();
      if (source === state.source) return;
      state.source = source;
      state.proofStale = true;
      state.dirty = source !== cleanSource;
      state.error = "";
      if (!state.dirty) state.conflict = false;
      draft();
      sourceEvent();
      emit();
      schedule();
    },
    async apply() {
      if (destroyed || options.readOnly || applying) return;
      flushVisual();
      if (!state.dirty) return;
      if (state.conflict) {
        state.error =
          "Resolve the newer manuscript conflict before applying this draft.";
        emit();
        return;
      }
      applying = true;
      emit();
      try {
        const source = state.source;
        const result = await compile();
        if (!result || destroyed || state.source !== source) return;
        const html = typstToHtml(source);
        window.dispatchEvent(
          new CustomEvent("twyne:typst-applying", { detail: { folioId } }),
        );
        await deps.saveSource(folioId, source, html, baseSource ?? null);
        window.dispatchEvent(
          new CustomEvent("twyne:typst-source-committed", {
            detail: { folioId, source, html },
          }),
        );
        await deps.clearDraft(folioId);
        await deps.saveRevision({
          folioId,
          html,
          typstSource: source,
          source: "manual",
          label: "Typst source applied",
        });
        if (destroyed) return;
        baseSource = source;
        cleanSource = source;
        replacing = true;
        try {
          editor.commands.setContent(html, { emitUpdate: true });
          baselineHtml = editor.getHTML();
          committedHtml = baselineHtml;
        } finally {
          replacing = false;
        }
        state.dirty = false;
        state.conflict = false;
        state.error = "";
        state.status = "Source applied · saved on this device";
        sourceEvent();
      } catch (error) {
        state.error =
          error instanceof Error
            ? error.message
            : "Source could not be applied.";
        if (state.error.includes("manuscript changed")) state.conflict = true;
        draft();
      } finally {
        applying = false;
        emit();
      }
    },
    async discard() {
      if (destroyed || applying) return;
      applying = true;
      emit();
      cancel();
      try {
        const latest = await deps.loadSnapshot(folioId);
        if (destroyed) return;
        baseSource = latest?.typstSource;
        cleanSource = baseSource ?? htmlToTypst(editor.getHTML());
        state.proofStale ||= state.source !== cleanSource;
        state.source = cleanSource;
        state.dirty = false;
        state.conflict = false;
        state.error = "";
        replacing = true;
        try {
          editor.commands.setContent(latest?.html ?? typstToHtml(cleanSource), {
            emitUpdate: false,
          });
          baselineHtml = editor.getHTML();
          committedHtml = baselineHtml;
        } finally {
          replacing = false;
        }
        await deps.clearDraft(folioId);
        sourceEvent();
        schedule();
      } catch (error) {
        state.error =
          error instanceof Error
            ? error.message
            : "The latest manuscript could not be loaded.";
      } finally {
        applying = false;
        emit();
      }
    },
    refreshProof(force = true) {
      // Settings can change while Write hides the proof. Preserve the previous
      // artifact, but never advertise it as current until its payload is checked.
      state.proofStale = true;
      if (!destroyed && (proofActive || applying)) void compile(force);
      else emit();
    },
    destroy() {
      if (destroyed) return;
      if (state.dirty) draft();
      destroyed = true;
      if (visualTimer !== undefined) clearTimeout(visualTimer);
      cancel();
      releaseProof();
      editor.off("update", editorUpdated);
      window.removeEventListener("twyne:content", contentDerived);
      window.removeEventListener(FOLIO_CONTENT_SAVED, saved);
      window.removeEventListener("twyne:typst-remote-change", remoteChanged);
      window.removeEventListener("twyne:request-typst-source", requestSource);
      if (!editor.isDestroyed && editor.isEditable !== !options.readOnly)
        editor.setEditable(!options.readOnly, false);
    },
  };
}
