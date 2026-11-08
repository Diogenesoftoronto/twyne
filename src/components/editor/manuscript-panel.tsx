import {
  component$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
} from "@qwik.dev/core";
import type { LayoutSettings } from "../../types";
import { resolveColumns, resolveColumnGap } from "../../types";
import { hasOrnateBorder } from "../../utils/page-ornaments";
import { isFileDrag } from "../../utils/file-drag";
import { hasAuthenticatedConvexIdentity, useAuth } from "../../utils/auth-context";
import { DestinationTag } from "../ui/destination-tag";
import { mountDeskLamp } from "./desk-lamp";
import { mountRunningFoot } from "./running-foot";
import type { EditorStore } from "./editor-state";
import { MarginRails } from "../in-flow/margin-rail";
import { FlowSurface } from "../in-flow/flow-surface";
import { PassageGather } from "../in-flow/passage-gather";
import { DocumentSpine } from "../living-desk/document-spine";
import { LivingDeskPanel } from "../living-desk/living-desk-panel";
import {
  LIVING_DESK_EVENT,
  livingDeskSnapshot,
  type LivingDeskSnapshot,
} from "../../utils/living-desk-contract";
import { PageChrome, type PageChromeProps } from "./page-chrome";
import { PageRuler } from "./page-ruler";
import { PageBorder } from "./page-border";
import { ManuscriptOpening } from "./manuscript-opening";

export const MANUSCRIPT_READING_ID = "manuscript";

type PageChromeGeometry = Pick<
  PageChromeProps,
  "pageH" | "gap" | "marginTop" | "marginBottom" | "marginLeft" | "marginRight"
>;

interface ManuscriptPanelProps {
  startupFailed?: boolean;
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
  /** Commenters get no margin tools; they are not writing this draft. */
  readOnly?: boolean;
}

/**
 * The manuscript surface: ruler, physical page furniture, Tiptap mount,
 * collected notes, and the colophon. It renders editor state but does not own
 * Tiptap, persistence, or cross-panel coordination.
 */
export const ManuscriptPanel = component$<ManuscriptPanelProps>((props) => {
  const { store } = props;
  const onJumpToNote$ = props.onJumpToNote$;
  const onDragOver$ = props.onDragOver$;
  const scrollerRef = useSignal<HTMLDivElement>();
  const deskOpen = useSignal(false);
  const auth = useAuth();
  // Read when a file is dragged in, so the docket says where it would land.
  const online = useSignal(true);
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      deskOpen.value = livingDeskSnapshot().open;
      const onDesk = (event: Event) => {
        deskOpen.value = (event as CustomEvent<LivingDeskSnapshot>).detail.open;
      };
      window.addEventListener(LIVING_DESK_EVENT, onDesk);
      cleanup(() => window.removeEventListener(LIVING_DESK_EVENT, onDesk));
    },
    { strategy: "document-ready" },
  );

  // The desk lamp lights the paper around the sheet (see desk-lamp.ts), and
  // the running foot follows which section is being read (running-foot.ts).
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const el = scrollerRef.value;
    if (!el) return;
    cleanup(mountDeskLamp(el));
    cleanup(mountRunningFoot(el));
  });

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
        class="manuscript-scroller flex-1 min-h-0 overflow-y-auto overflow-x-auto scroll-pb-12"
        data-living-desk-open={
          deskOpen.value && !store.zenMode ? "" : undefined
        }
        // Colour only: the desk lamp paints the background image.
        style="background-color: var(--color-editor-bg);"
        onDragOver$={(event) => {
          online.value = navigator.onLine;
          return onDragOver$(event);
        }}
        onDragLeave$={props.onDragLeave$}
        onDrop$={props.onDrop$}
      >
        {store.isDragOver && (
          <div class="drag-overlay">
            {/* The docket says where the image will live before it is let go:
                inline in the manuscript offline, in account storage online.
                Signed out and online, the upload has nowhere to go. */}
            <div class="drag-overlay__docket">
              <span class="drag-overlay__title">Drop a plate</span>
              {!online.value ? (
                <span class="drag-overlay__route">
                  <DestinationTag
                    to="local"
                    description="Kept in the manuscript on this device"
                  />
                  Kept in the manuscript on this device
                </span>
              ) : hasAuthenticatedConvexIdentity(auth.value) ? (
                <span class="drag-overlay__route">
                  <DestinationTag
                    to="synced"
                    description="Uploaded to your account's image storage"
                  />
                  Uploaded to your account's image storage
                </span>
              ) : (
                <span class="drag-overlay__route drag-overlay__route--blocked">
                  Sign in to store images while online
                </span>
              )}
            </div>
          </div>
        )}

        <div hidden={store.zenMode}>
          <PageRuler
            layout={store.layout}
            pageWidthRem={props.pageWidthRem}
            zen={store.zenMode}
            onChange$={props.onLayoutChange$}
          />
        </div>

        <div
          class={[
            "mx-auto twyne-editor page-canvas relative",
            {
              "show-margin-guides": store.layout.showMarginGuides,
              "zen-mode": store.zenMode,
              "is-paginated": store.paginationActive,
              "has-ornate-border": hasOrnateBorder(store.layout),
            },
          ]}
          style={{
            "--manuscript-columns": resolveColumns(store.layout),
            "--manuscript-column-gap": `${resolveColumnGap(store.layout)}rem`,
            ...(store.paginationActive
              ? {
                  width: "var(--page-w)",
                  "flex-shrink": "0",
                  "min-height": `${props.canvasMinHeight}px`,
                }
              : { "max-width": "var(--doc-width, 48rem)" }),
            "padding-left":
              "max(var(--ornament-clearance, 0px), var(--doc-pad-left, 3rem))",
            "padding-right":
              "max(var(--ornament-clearance, 0px), var(--doc-pad-right, 3rem))",
            "padding-top":
              "max(var(--ornament-clearance, 0px), var(--doc-pad-y, 2.5rem))",
            "padding-bottom":
              "max(var(--ornament-clearance, 0px), var(--doc-pad-bottom, 4rem))",
          }}
        >
          {!store.paginationActive && <PageBorder layout={store.layout} />}
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

          {!store.editor &&
            (props.startupFailed ? (
              <div role="alert">
                <p>
                  The editor could not start. Your saved draft has not been
                  replaced.
                </p>
                <a href="" class="underline">
                  Reload the editor
                </a>
              </div>
            ) : (
              <ManuscriptOpening />
            ))}
          <div
            id="twyne-editor-mount"
            data-speech-id={MANUSCRIPT_READING_ID}
            data-speech-source="plain"
            style={{ position: "relative", zIndex: 1 }}
          />

          <MarginRails zen={store.zenMode} readOnly={props.readOnly} />
          <FlowSurface zen={store.zenMode} readOnly={props.readOnly} />
          <PassageGather />
          <DocumentSpine zen={store.zenMode} readOnly={props.readOnly} />

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
      <LivingDeskPanel zen={store.zenMode} readOnly={props.readOnly} />
    </>
  );
});
