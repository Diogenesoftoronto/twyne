import {
  component$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
} from "@qwik.dev/core";
import type { LayoutSettings } from "../../types";
import { formatWordCount, readingTimeLabel } from "../../utils/document";
import { formatFolioCount } from "../../utils/draft-thresholds";
import { isFileDrag } from "../../utils/file-drag";
import type { EditorStore } from "./editor-state";
import { PageChrome, type PageChromeProps } from "./page-chrome";
import { PageRuler } from "./page-ruler";
import { LastSavedLine } from "./sync-indicator";

export const MANUSCRIPT_READING_ID = "manuscript";

type PageChromeGeometry = Pick<
  PageChromeProps,
  "pageH" | "gap" | "marginTop" | "marginBottom" | "marginLeft" | "marginRight"
>;

interface ManuscriptPanelProps {
  store: EditorStore;
  pageWidthRem: number;
  canvasMinHeight: number;
  pageChromeGeometry: PageChromeGeometry;
  onDragOver$: PropFunction<(event: DragEvent) => void>;
  onDragLeave$: PropFunction<(event: DragEvent) => void>;
  onDrop$: PropFunction<(event: DragEvent) => void>;
  onLayoutChange$: PropFunction<(next: LayoutSettings) => void>;
  onHeaderCommit$: PropFunction<(value: string) => void>;
  onFooterCommit$: PropFunction<(value: string) => void>;
  onJumpToNote$: PropFunction<(position: number) => void>;
}

/**
 * The manuscript surface: ruler, physical page furniture, Tiptap mount,
 * collected notes, and the colophon. It renders editor state but does not own
 * Tiptap, persistence, or cross-panel coordination.
 */
export const ManuscriptPanel = component$<ManuscriptPanelProps>((props) => {
  const { store } = props;
  const onJumpToNote$ = props.onJumpToNote$;
  const scrollerRef = useSignal<HTMLDivElement>();

  /**
   * Stop the browser navigating away from a file dropped on the manuscript.
   *
   * This used to be Qwik's `preventdefault:dragover` / `:drop` attributes, but
   * those fire from qwikloader's single document-level *capture* listener, so
   * they cancelled the event before ProseMirror ever saw it — and ProseMirror
   * ignores any event whose default is already prevented. That silently
   * disabled dragging a selection, the drop cursor that shows where it will
   * land, and image file drops, all at once.
   *
   * Listening in the bubble phase inverts the order: ProseMirror gets first
   * refusal, and if it handled the drop it has already called preventDefault by
   * the time the event reaches us. We only step in for a file that landed on
   * the surrounding margin, where nothing else is listening.
   */
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const el = scrollerRef.value;
    if (!el) return;
    const guard = (event: DragEvent) => {
      if (event.defaultPrevented) return;
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
    };
    el.addEventListener("dragover", guard);
    el.addEventListener("drop", guard);
    cleanup(() => {
      el.removeEventListener("dragover", guard);
      el.removeEventListener("drop", guard);
    });
  });

  return (
    <>
      <div
        ref={scrollerRef}
        class="flex-1 overflow-y-auto overflow-x-auto scroll-pb-12"
        style="background: var(--color-editor-bg);"
        onDragOver$={props.onDragOver$}
        onDragLeave$={props.onDragLeave$}
        onDrop$={props.onDrop$}
      >
        {store.isDragOver && (
          <div class="drag-overlay">
            <span>Drop plate or tabular here</span>
          </div>
        )}

        <PageRuler
          layout={store.layout}
          pageWidthRem={props.pageWidthRem}
          zen={store.zenMode}
          onChange$={props.onLayoutChange$}
        />

        <div
          class={[
            "mx-auto twyne-editor page-canvas relative",
            {
              "show-margin-guides": store.layout.showMarginGuides,
              "zen-mode": store.zenMode,
              "is-paginated": store.paginationActive,
            },
          ]}
          style={{
            ...(store.paginationActive
              ? {
                  width: "var(--page-w)",
                  "flex-shrink": "0",
                  "min-height": `${props.canvasMinHeight}px`,
                }
              : { "max-width": "var(--doc-width, 48rem)" }),
            "padding-left": "var(--doc-pad-left, 3rem)",
            "padding-right": "var(--doc-pad-right, 3rem)",
            "padding-top": "var(--doc-pad-y, 2.5rem)",
            "padding-bottom": "var(--doc-pad-bottom, 4rem)",
          }}
        >
          <PageChrome
            pageCount={store.pageCount}
            active={store.paginationActive}
            layout={store.layout}
            title={store.meta.title}
            headerText={store.headerText}
            footerText={store.footerText}
            zen={store.zenMode}
            onHeaderCommit$={props.onHeaderCommit$}
            onFooterCommit$={props.onFooterCommit$}
            {...props.pageChromeGeometry}
          />

          <div
            id="twyne-editor-mount"
            data-speech-id={MANUSCRIPT_READING_ID}
            data-speech-source="plain"
            style={{ position: "relative", zIndex: 1 }}
          />

          {store.notes.length > 0 && (
            <div
              class="manuscript-notes mt-10 pt-6 border-t border-[var(--color-paper-3)]"
              style="font-family: var(--font-serif);"
            >
              {(["endnote", "footnote"] as const).map((kind) => {
                const items = store.notes.filter((note) => note.kind === kind);
                if (items.length === 0) return null;
                return (
                  <div key={kind} class="manuscript-notes-group">
                    <h3
                      class="dept-label mb-2"
                      style="font-family: var(--font-typewriter); font-size: 0.7rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-ink-muted);"
                    >
                      {kind === "endnote" ? "Notes" : "Footnotes"}
                    </h3>
                    <ol class="manuscript-notes-list">
                      {items.map((note) => (
                        <li key={`${kind}-${note.number}`}>
                          <button
                            type="button"
                            class="manuscript-note-marker"
                            style={{
                              color:
                                kind === "footnote"
                                  ? "var(--color-cobalt)"
                                  : "var(--color-vermilion)",
                            }}
                            onClick$={() => onJumpToNote$(note.pos)}
                            aria-label={`Jump to ${kind} ${note.number} in the text`}
                          >
                            {kind === "footnote"
                              ? `†${note.number}`
                              : note.number}
                          </button>
                          <span class="manuscript-note-text">{note.text}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        class="flex items-center justify-between px-5 py-1.5 border-t border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] text-[var(--color-ink-light)] sticky bottom-0"
        style={{
          fontFamily: "var(--font-typewriter)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontSize: "0.72rem",
          zIndex: "var(--z-sticky)",
        }}
      >
        <span>
          {formatWordCount(store.meta.wordCount)} words ·{" "}
          {formatFolioCount(store.meta.wordCount)} folios
        </span>
        <span>
          <LastSavedLine savedAt={store.lastSavedAt} /> ·{" "}
          {readingTimeLabel(store.meta.readingTime)} · set in Lora &amp; Libre
          Baskerville
        </span>
      </div>
    </>
  );
});
