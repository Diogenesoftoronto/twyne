import {
  component$,
  useStore,
  useStyles$,
  useVisibleTask$,
  noSerialize,
  $,
} from "@builder.io/qwik";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Highlight } from "@tiptap/extension-highlight";
import { Underline } from "@tiptap/extension-underline";
import { TextAlign } from "@tiptap/extension-text-align";
import { Link as TiptapLink } from "@tiptap/extension-link";
import { Typography } from "@tiptap/extension-typography";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type {
  CitationInsertionDetail,
  CitationInsertionResult,
  DraftContentDetail,
  LayoutSettings,
  PersonaNotePayload,
  PersonaReply,
} from "../../types";
import {
  DEFAULT_LAYOUT,
  DOC_WIDTH_REM,
  resolveMargins,
  resolvePageSetup,
} from "../../types";
import { computePageGeometry } from "./pagination-geometry";
import { pxToRem, rootFontSize } from "../../utils/css-units";
import { exportPdf } from "../../utils/exchange";
import { buildFolioExportPayload } from "../../utils/folio-export";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import { detectCitations } from "../../utils/citations";
import { useConvexClient } from "../../utils/convex-context";
import { useAuth } from "../../utils/auth-context";
import { DEFAULT_COMPOSITOR_TAB } from "../../utils/compositor-toolbar";
import {
  recaseTextSegments,
  type TextCase,
} from "../../utils/typography-options";
import { speak } from "../../utils/speech";
import { createRevisionSnapshot } from "../../utils/revision-history";
import { MANUSCRIPT_READING_ID, ManuscriptPanel } from "./manuscript-panel";
import { SuggestionPanel } from "./suggestion-panel";
import { UserCommentPanel } from "./user-comment-panel";
import { PersonaNotePanel } from "./persona-note-panel";
import { InsertPanels } from "./insert-panels";
import { CompositorPanel } from "./compositor-panel";

/**
 * The reading the toolbar owns. Stable rather than derived from the
 * selection, so the transport can find the reading it started.
 */
const REGISTRY_COMMAND_ALIASES: Partial<Record<EditorCommandId, string>> = {
  "format.bold": "bold",
  "format.italic": "italic",
  "format.underline": "underline",
  "format.strike": "strike",
  "format.highlight": "highlight",
  "format.superscript": "superscript",
  "format.subscript": "subscript",
  "format.clear": "clearFormatting",
  "paragraph.heading-1": "h1",
  "paragraph.heading-2": "h2",
  "paragraph.heading-3": "h3",
  "paragraph.bullet-list": "bullet",
  "paragraph.numbered-list": "ordered",
  "paragraph.task-list": "taskList",
  "paragraph.blockquote": "blockquote",
  "paragraph.code-block": "code",
  "paragraph.align-left": "left",
  "paragraph.align-center": "center",
  "paragraph.align-right": "right",
  "paragraph.justify": "justify",
  "insert.horizontal-rule": "horizontal",
  "insert.page-break": "pageBreak",
  "history.undo": "undo",
  "history.redo": "redo",
  "table.add-row-before": "addRowBefore",
  "table.add-row-after": "addRowAfter",
  "table.add-column-before": "addColumnBefore",
  "table.add-column-after": "addColumnAfter",
  "table.merge-cells": "mergeCells",
  "table.split-cell": "splitCell",
  "table.delete-row": "deleteRow",
  "table.delete-column": "deleteColumn",
  "table.delete-table": "deleteTable",
};
import { api } from "../../../convex/_generated/api";
import {
  loadUserComments,
  upsertUserComment,
  appendUserCommentReply,
  toggleUserCommentResolved,
  deleteUserComment,
  type UserCommentReply,
} from "../../utils/user-comments";
import {
  collectCommentMarkIdsFromHtml,
  reconcileCommentAnchors,
} from "../../utils/reconcile-comments";
import { bindNetworkStatusEvents } from "../../utils/convex-sync";
import { applyDocumentMeta } from "../../utils/document";
import { CommentMark } from "./extensions/comment-mark";
import { PersonaNoteMark } from "./extensions/persona-note-mark";
import { SuggestionMark } from "./extensions/suggestion-mark";
import { MermaidDiagram } from "./extensions/mermaid-node";
import type { NoteKind } from "./extensions/endnote-node";
import { InlineNoteNode } from "./extensions/inline-note-popover";
import { FindReplace } from "./extensions/find-replace";
import { MathExtensions } from "./extensions/math";
import { SectionReorder } from "./extensions/section-reorder";
import { FindReplacePanel } from "./find-replace-panel";
import { GrammarPanel } from "./grammar-panel";
import { ShortcutDialog } from "./shortcut-dialog";
import { EDITOR_KEYBINDINGS, chordMatches } from "../../utils/keybindings";
import { DocumentOutline } from "./document-outline";
import { buildDocumentOutline } from "../../utils/document-outline";
import { RemoteCursors } from "./extensions/remote-cursors";
import { type RemoteCursor } from "./extensions/remote-cursors";
import { Indent } from "./extensions/indent";
import { MarkAnchorWidgets } from "./extensions/mark-anchor-widgets";
import { PageBreakNode } from "./extensions/page-break-node";
import { Pagination, type PaginationInfo } from "./extensions/pagination";
import { ParagraphFormat } from "./extensions/paragraph-format";
import {
  DRAFT_SNAPSHOT_REQUEST,
  type DraftSnapshotRequest,
  startPresence,
  stopPresence,
  updateCursor,
  watchRemoteChanges,
  stopWatchingRemote,
} from "../../utils/collaboration";
import mermaid from "mermaid";
import {
  syncDraftToLix,
  mergeAgentChanges,
  proposeBlockEdit,
  splitBlocks,
} from "../../utils/lix";
import {
  updateSuggestionStatusLocally,
  saveSuggestionLocally,
} from "../../utils/convex-sync";
import type { SuggestionPayload, Suggestion } from "../../types";
import { computePopoverGeometry } from "./popover-positioning";
import {
  EMPTY_TABLE_TOOLBAR_SNAPSHOT,
  FloatingTableToolbar,
  TableInsertionGrid,
  createTableCoreExtensions,
  createTableToolbarController,
  runTableToolbarIntent,
  type TableToolbarIntent,
} from "./table-core";
import {
  TableCellFormat,
  runTableCellFormatIntent,
  type TableCellFormatIntent,
} from "./extensions/table-cell-format";
import { TableCellFormatControls } from "./table-cell-format-controls";
import { SlashCommand, getSlashCommandState } from "./extensions/slash-command";
import { SlashCommandMenu } from "./slash-command-menu";
import type { EditorCommandId } from "../../utils/editor-commands";
import {
  ImageNode,
  chooseAndInsertImages,
  retryImageUpload,
  type ImageNodeAttributes,
} from "./extensions/image-node";
import { ImageInspector } from "./image-inspector";
import {
  createImageUploadAdapter,
  type ImageUploadAdapter,
} from "../../utils/image-upload";
import type {
  EditorNote,
  EditorStore,
  NotePopover,
  TwyneEditorProps,
} from "./editor-state";
export type { EditorNote, EditorStore } from "./editor-state";

/**
 * Walk every table in the editor mount and ensure the first row of each
 * (i.e. the header row) carries a `.row-resize-handle` in every <th>.
 * Strips stale handles on cells that are no longer in the header row so
 * toggling the header row off cleans up the grip.
 */
const refreshRowResizeHandles = (mount: HTMLElement) => {
  const tables = mount.querySelectorAll("table");
  tables.forEach((table) => {
    const firstRow = table.querySelector("tr");
    if (!firstRow) return;
    const ths = firstRow.children;
    if (ths.length === 0) return;
    Array.from(ths).forEach((cell) => {
      if (cell.tagName !== "TH") {
        const stale = cell.querySelectorAll(".row-resize-handle");
        stale.forEach((n) => n.remove());
        return;
      }
      if (cell.querySelector(".row-resize-handle")) return;
      const handle = document.createElement("span");
      handle.className = "row-resize-handle";
      handle.setAttribute("contenteditable", "false");
      handle.setAttribute("aria-hidden", "true");
      cell.appendChild(handle);
    });
  });
};

export const TwyneEditor = component$(
  ({
    initialContent = "",
    activeFolioId,
    activeFolio,
    brief,
    sharedLixId,
    readOnly = false,
  }: TwyneEditorProps) => {
    const clientSig = useConvexClient();
    const auth = useAuth();
    const store = useStore<EditorStore>({
      editor: null,
      meta: {
        title: "Untitled",
        wordCount: 0,
        characterCount: 0,
        readingTime: 1,
      },
      isDragOver: false,
      isAnalysisRunning: false,
      active: {
        isInTable: false,
      },
      showImageInput: false,
      imageUrl: "",
      imageUploadAdapter: null,
      selectedImage: null,
      imageUploadError: null,
      showCommentInput: false,
      commentText: "",
      showMermaidInput: false,
      mermaidSource: "",
      noteInputKind: null,
      noteText: "",
      notes: [],
      hasSelection: false,
      notePopover: null,
      suggestionPopover: null,
      stampVisible: false,
      lastSavedAt: null,
      userCommentPopover: null,
      canUndo: false,
      canRedo: false,
      activeFolioId: activeFolioId ?? "",
      layout: activeFolio?.layout ?? DEFAULT_LAYOUT,
      headerText: activeFolio?.header ?? "",
      footerText: activeFolio?.footer ?? "",
      showLayout: false,
      layoutPanelMaxH: 544,
      exportingPdf: false,
      showFindReplace: false,
      showGrammar: false,
      showShortcutDialog: false,
      showOutline: false,
      outline: {
        items: [],
        flat: [],
        byId: {},
        documentSize: 0,
      },
      showTableInsertion: false,
      tableToolbar: EMPTY_TABLE_TOOLBAR_SNAPSHOT,
      cellFormat: {
        cellCount: 0,
        backgroundColor: null,
        horizontalAlignment: null,
        verticalAlignment: null,
        borderColor: null,
        borderStyle: null,
        borderWidth: null,
        stylePreset: null,
      },
      slashOpen: false,
      slashQuery: "",
      slashLeft: 0,
      slashTop: 0,
      zenMode: false,
      openPicker: null,
      currentColor: null,
      currentHighlight: null,
      currentFontFamily: null,
      currentFontSize: null,
      currentLineHeight: null,
      currentSpaceBefore: null,
      currentSpaceAfter: null,
      currentKeepWithNext: false,
      pageCount: 1,
      paginationActive: false,
      toolbarTab: DEFAULT_COMPOSITOR_TAB,
    });

    useStyles$(`
    .twyne-editor {
      min-height: 100%;
    }
    /* Zen mode: quiet the manuscript down to plain text while writing.
       The marks (and their data) are untouched — only the visual
       highlighting is suppressed, so nothing is lost on toggle-off.
       The toolbar and all marks fade out, reappearing on hover so the
       writer can still reach tools. */
    .twyne-editor.zen-mode .twyne-persona-note {
      background: none;
      border-bottom: none;
      cursor: text;
    }
    .twyne-editor.zen-mode .ProseMirror .twyne-comment-mark {
      background: none !important;
      border-bottom: none !important;
      cursor: text;
    }
    .twyne-editor.zen-mode .ProseMirror .citation-mark {
      background: none;
      border-bottom: none;
      cursor: text;
    }
    .twyne-editor.zen-mode .twyne-endnote {
      color: var(--color-ink-muted);
      background: none;
    }
    /* Fade out the toolbar in zen mode. It reappears on hover so tools
       remain reachable. */
    .twyne-editor.zen-mode .twyne-toolbar {
      opacity: 0.15;
      transition: opacity 0.3s ease;
    }
    .twyne-editor.zen-mode .twyne-toolbar:hover {
      opacity: 1;
    }
    .persona-note-thread {
      max-height: 240px;
      overflow-y: auto;
    }
    .persona-note-thread > [data-author-kind="user"] > div {
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    }
    .persona-note-thread > [data-author-kind="persona"] > div {
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
    }
    .persona-note-typing .typing-dots {
      display: inline-flex;
      gap: 2px;
      font-weight: 700;
    }
    .persona-note-typing .typing-dots span {
      animation: persona-note-bounce 1.1s infinite ease-in-out;
    }
    .persona-note-typing .typing-dots span:nth-child(2) {
      animation-delay: 0.18s;
    }
    .persona-note-typing .typing-dots span:nth-child(3) {
      animation-delay: 0.36s;
    }
    @keyframes persona-note-bounce {
      0%, 80%, 100% {
        transform: translateY(0);
        opacity: 0.4;
      }
      40% {
        transform: translateY(-3px);
        opacity: 1;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .persona-note-typing .typing-dots span {
        animation: none;
      }
    }
  `);

    // Apply the live layout to the editor surface via CSS custom properties,
    // so the same LayoutSettings drive editor / export / print.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ track }) => {
      const layout = track(() => store.layout);
      const root = document.documentElement;
      const m = resolveMargins(layout);
      const setup = resolvePageSetup(layout);

      if (setup.pagination === "paginated") {
        // The sheet, not the writer's column preference, decides how wide the
        // canvas is. `--doc-width` is a border-box max-width, so it carries
        // the full page — margins included — and the padding below carves the
        // text column out of it.
        const g = computePageGeometry(layout, rootFontSize());
        root.style.setProperty("--doc-width", `${g.pageW}px`);
        root.style.setProperty("--doc-pad-left", `${g.marginLeft}px`);
        root.style.setProperty("--doc-pad-right", `${g.marginRight}px`);
        root.style.setProperty("--doc-pad-y", `${g.marginTop}px`);
        root.style.setProperty("--doc-pad-bottom", `${g.marginBottom}px`);
        // Read by the sheet paint and by the `img { max-height }` rule that
        // stops a plate from being taller than the page it sits on.
        root.style.setProperty("--page-h", `${g.pageH}px`);
        root.style.setProperty("--page-w", `${g.pageW}px`);
        root.style.setProperty("--page-gap", `${g.gap}px`);
        root.style.setProperty("--page-content-h", `${g.contentH}px`);
      } else {
        root.style.setProperty(
          "--doc-width",
          `${DOC_WIDTH_REM[layout.width]}rem`,
        );
        root.style.setProperty("--doc-pad-left", `${m.left}rem`);
        root.style.setProperty("--doc-pad-right", `${m.right}rem`);
        root.style.setProperty("--doc-pad-y", `${m.top}rem`);
        root.style.setProperty("--doc-pad-bottom", `${m.bottom}rem`);
        root.style.removeProperty("--page-h");
        root.style.removeProperty("--page-w");
        root.style.removeProperty("--page-gap");
        root.style.removeProperty("--page-content-h");
      }

      // Push the new settings into the engine. A layout change invalidates
      // every measured height, so this is what makes the pages resettle after
      // a paper change or a margin drag.
      store.editor?.commands.setPaginationLayout(layout);
    });

    // Dismiss the editor popovers on outside click.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup, track }) => {
      const layoutOpen = track(() => store.showLayout);
      const pickerOpen = track(() => store.openPicker);
      if (!layoutOpen && !pickerOpen) return;
      const onDoc = (e: MouseEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && t.closest("[data-layout-popover]")) return;
        if (t && t.closest('[aria-label="Page layout"]')) return;
        // The formatting popovers and the buttons that open them. Matching on
        // the wrapper rather than each control keeps a click on a swatch from
        // closing the picker it came from.
        if (t && t.closest("[data-color-picker]")) return;
        if (t && t.closest("[data-type-popover]")) return;
        if (t && t.closest("[aria-expanded]")) return;
        store.showLayout = false;
        store.openPicker = null;
      };
      document.addEventListener("mousedown", onDoc);
      cleanup(() => document.removeEventListener("mousedown", onDoc));
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      import("@tiptap/core").then(async ({ Editor }) => {
        const el = document.getElementById("twyne-editor-mount");
        if (!el) {
          console.warn("[twyne:editor] #twyne-editor-mount not found in DOM");
          return;
        }
        const offlineImageAdapter = createImageUploadAdapter({
          mode: "offline",
        });
        const imageUploadAdapter: ImageUploadAdapter = {
          mode: navigator.onLine ? "online" : "offline",
          upload(file, onProgress) {
            if (!navigator.onLine) {
              return offlineImageAdapter.upload(file, onProgress);
            }
            const client = clientSig.value;
            if (!client) {
              return Promise.reject(
                new Error(
                  "Image storage is not connected yet. Try again shortly.",
                ),
              );
            }
            return createImageUploadAdapter({
              mode: "online",
              client,
              folioId: () => store.activeFolioId,
            }).upload(file, onProgress);
          },
        };
        store.imageUploadAdapter = noSerialize(imageUploadAdapter);
        // ── The update path ────────────────────────────────────────────────
        //
        // `onUpdate` fires on every keystroke, so nothing O(document) may run
        // in it directly. Two schedulers sit behind it:
        //
        //   scheduleLiveMeta  throttled, cheap  — keeps the word count moving
        //                                         while the writer types
        //   scheduleDerive    debounced, heavy  — one `getHTML()` feeding
        //                                         persistence, comments, the
        //                                         Lix mirror and citations
        //
        // `getHTML()` is a full DOMSerializer pass over the manuscript and is
        // the most expensive call in the path, so it belongs in the second
        // group only. The debounce carries a max-wait so a writer who never
        // pauses still gets persisted on a bounded schedule.
        const LIVE_META_THROTTLE_MS = 200;
        const DERIVE_DEBOUNCE_MS = 500;
        const DERIVE_MAX_WAIT_MS = 2500;

        let liveMetaTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleLiveMeta = (e: Editor) => {
          if (liveMetaTimer) return; // leading-edge throttle: counts keep moving
          liveMetaTimer = setTimeout(() => {
            liveMetaTimer = null;
            applyDocumentMeta(store.meta, e.getText());
          }, LIVE_META_THROTTLE_MS);
        };

        let deriveTimer: ReturnType<typeof setTimeout> | null = null;
        let deriveDeadline = 0;
        const runDerive = (e: Editor) => {
          if (deriveTimer) clearTimeout(deriveTimer);
          deriveTimer = null;
          deriveDeadline = 0;

          const text = e.getText();
          const html = e.getHTML();

          applyDocumentMeta(store.meta, text);
          reconcileCommentsDebounced(html);
          mirrorDraft(html);

          const citations = detectCitations(text);
          if (citations.length > 0) {
            window.dispatchEvent(
              new CustomEvent("twyne:citations", { detail: citations }),
            );
          }

          // Consumers read the derived fields off the detail. None of them
          // should run regexes back over `html` to recover prose or counts.
          window.dispatchEvent(
            new CustomEvent<DraftContentDetail>("twyne:content", {
              detail: { html, text, wordCount: store.meta.wordCount },
            }),
          );
        };
        const scheduleDerive = (e: Editor) => {
          const now = Date.now();
          if (!deriveDeadline) deriveDeadline = now + DERIVE_MAX_WAIT_MS;
          if (now >= deriveDeadline) {
            runDerive(e);
            return;
          }
          if (deriveTimer) clearTimeout(deriveTimer);
          deriveTimer = setTimeout(
            () => runDerive(e),
            Math.min(DERIVE_DEBOUNCE_MS, deriveDeadline - now),
          );
        };
        cleanup(() => {
          if (liveMetaTimer) clearTimeout(liveMetaTimer);
          if (deriveTimer) clearTimeout(deriveTimer);
        });

        // A debounce that never fires is lost work. If the writer closes the
        // tab mid-window, derive now so the route can persist the last
        // keystrokes — it flushes straight to disk once the page is hidden.
        const flushDerive = () => {
          if (deriveTimer) runDerive(editor);
        };
        window.addEventListener("pagehide", flushDerive);
        document.addEventListener("visibilitychange", flushDerive);
        cleanup(() => {
          window.removeEventListener("pagehide", flushDerive);
          document.removeEventListener("visibilitychange", flushDerive);
        });

        // The route stamps this once content is actually on disk locally.
        const onDraftSaved = () => {
          store.lastSavedAt = Date.now();
        };
        window.addEventListener("twyne:draft-saved", onDraftSaved);
        cleanup(() =>
          window.removeEventListener("twyne:draft-saved", onDraftSaved),
        );

        // Mirror of the manuscript into Lix key_value blocks, so editor
        // branches (proposed edits) have real content to fork from.
        //
        // Only a shared session needs a *continuous* mirror: `watchRemoteChanges`
        // is the sole reader, and it only runs when `sharedLixId` is set. Solo
        // writers were paying for a full DOMParser re-parse plus one SQLite
        // round trip per block, on the main thread, every time they paused
        // typing — to populate rows nobody read. The accept-suggestion flow
        // syncs on demand right before it needs the blocks, so it stays correct
        // either way.
        let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
        const mirrorDraft = (html: string) => {
          if (!sharedLixId) return;
          if (mirrorTimer) clearTimeout(mirrorTimer);
          mirrorTimer = setTimeout(() => {
            void syncDraftToLix(store.activeFolioId, html);
          }, 1200);
        };
        cleanup(() => {
          if (mirrorTimer) clearTimeout(mirrorTimer);
        });

        // Reconciliation of writer comments against the current
        // document. Debounced to avoid walking the doc on every
        // keystroke. Emits `twyne:comments-reconciled` with the
        // three buckets (live, ghost, headless) so the Marginalia
        // panel can show a writer what happened to their threads.
        let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
        const reconcileCommentsDebounced = (html: string) => {
          if (reconcileTimer) clearTimeout(reconcileTimer);
          reconcileTimer = setTimeout(() => {
            void (async () => {
              const markIds = collectCommentMarkIdsFromHtml(html);
              const threads = (await loadUserComments()).filter(
                (thread) => thread.folioId === store.activeFolioId,
              );
              const result = reconcileCommentAnchors(threads, markIds);
              window.dispatchEvent(
                new CustomEvent("twyne:comments-reconciled", {
                  detail: result,
                }),
              );
            })();
          }, 400);
        };
        const editor = new Editor({
          element: el,
          editable: !readOnly,
          extensions: [
            StarterKit.configure({
              heading: { levels: [1, 2, 3] },
              // Configured explicitly below so there is one extension name
              // and one command surface for each feature.
              link: false,
              underline: false,
            }),
            ImageNode.configure({
              uploadAdapter: imageUploadAdapter,
              onUploadError: (error) => {
                store.imageUploadError = error.message;
              },
            }),
            ...createTableCoreExtensions({ resizable: true }),
            TableCellFormat,
            Placeholder.configure({
              placeholder:
                "Begin writing from the brief. The room of editors is listening...",
            }),
            Highlight.configure({ multicolor: true }),
            Underline,
            Subscript,
            Superscript,
            // Line height is a paragraph property, not a character one — a
            // writer setting "double spaced" means the whole paragraph, not
            // the three words they had selected. The rest of the kit stays on
            // the default textStyle mark, where it belongs.
            TextStyleKit.configure({
              // TipTap 3.22's bundled LineHeight command always writes a
              // textStyle mark even when configured with paragraph types.
              // ParagraphFormat owns line height so a three-word selection
              // cannot make half a paragraph "double spaced".
              lineHeight: false,
            }),
            TextAlign.configure({
              types: ["heading", "paragraph"],
              alignments: ["left", "center", "right", "justify"],
            }),
            TiptapLink.configure({
              openOnClick: true,
              autolink: true,
              HTMLAttributes: {
                class: "editor-link",
                target: "_blank",
                rel: "noopener noreferrer",
              },
            }),
            Typography,
            TaskList.configure({
              HTMLAttributes: { class: "twyne-task-list" },
            }),
            TaskItem.configure({ nested: true }),
            CommentMark,
            PersonaNoteMark,
            SuggestionMark,
            MermaidDiagram,
            InlineNoteNode,
            RemoteCursors.configure({ cursors: [] }),
            MarkAnchorWidgets,
            Indent,
            FindReplace,
            SlashCommand,
            ...MathExtensions,
            SectionReorder,
            ParagraphFormat,
            PageBreakNode,
            Pagination.configure({
              layout: store.layout,
              // The notes block sits after the editor but inside the page
              // canvas, so it has to be counted or it spills past the last
              // sheet with nothing under it.
              getTailElement: () =>
                document.querySelector<HTMLElement>(".manuscript-notes"),
              onPaginate: (info: PaginationInfo) => {
                store.pageCount = info.pageCount;
                store.paginationActive = info.active;
              },
            }),
          ],
          content: initialContent,
          editorProps: {
            attributes: {
              class: "ProseMirror",
            },
            handleDrop: (view, event, _slice, moved) => {
              if (moved) return false;
              const coords = { left: event.clientX, top: event.clientY };
              const pos = view.posAtCoords(coords);
              if (!pos) return false;

              const html = event.dataTransfer?.getData("text/html");
              if (html) {
                if (html.includes("<table") || html.includes("<img")) {
                  const tempDiv = document.createElement("div");
                  tempDiv.innerHTML = html;
                  const img = tempDiv.querySelector("img");
                  if (img?.src) {
                    const node = view.state.schema.nodes.image.create({
                      src: img.src,
                      alt: img.alt || "",
                    });
                    const tr = view.state.tr.insert(pos.pos, node);
                    view.dispatch(tr);
                    return true;
                  }
                }
              }

              return false;
            },
          },
          onUpdate: ({ editor: e }) => {
            scheduleLiveMeta(e);
            scheduleDerive(e);
          },
        });

        // Sharing must serialize the exact document Tiptap owns, including
        // edits still inside the route's persistence debounce. The share
        // control requests this snapshot synchronously immediately before it
        // mirrors and serializes Lix.
        const provideDraftSnapshot = (event: Event) => {
          const detail = (event as CustomEvent<DraftSnapshotRequest>).detail;
          if (detail.folioId === store.activeFolioId) {
            detail.html = editor.getHTML();
          }
        };
        window.addEventListener(DRAFT_SNAPSHOT_REQUEST, provideDraftSnapshot);
        cleanup(() =>
          window.removeEventListener(
            DRAFT_SNAPSHOT_REQUEST,
            provideDraftSnapshot,
          ),
        );

        const refreshActive = () => {
          const { from, to } = editor.state.selection;
          store.hasSelection = from !== to;
          store.active = {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            underline: editor.isActive("underline"),
            strike: editor.isActive("strike"),
            highlight: editor.isActive("highlight"),
            h1: editor.isActive("heading", { level: 1 }),
            h2: editor.isActive("heading", { level: 2 }),
            h3: editor.isActive("heading", { level: 3 }),
            bullet: editor.isActive("bulletList"),
            ordered: editor.isActive("orderedList"),
            taskList: editor.isActive("taskList"),
            blockquote: editor.isActive("blockquote"),
            code: editor.isActive("codeBlock"),
            left: editor.isActive({ textAlign: "left" }),
            center: editor.isActive({ textAlign: "center" }),
            right: editor.isActive({ textAlign: "right" }),
            justify: editor.isActive({ textAlign: "justify" }),
            superscript: editor.isActive("superscript"),
            subscript: editor.isActive("subscript"),
            isInTable: editor.isActive("table"),
            canMergeCells: editor.can().mergeCells(),
            canSplitCell: editor.can().splitCell(),
          };
          store.selectedImage = editor.isActive("image")
            ? (editor.getAttributes("image") as ImageNodeAttributes)
            : null;
          // Current values, as opposed to on/off states — the pickers show
          // what is applied here rather than merely whether anything is.
          const attrs = editor.getAttributes("textStyle");
          store.currentColor = attrs.color ?? null;
          store.currentFontFamily = attrs.fontFamily ?? null;
          store.currentFontSize = attrs.fontSize ?? null;
          store.currentHighlight =
            editor.getAttributes("highlight").color ?? null;
          const paragraphAttrs = editor.isActive("heading")
            ? editor.getAttributes("heading")
            : editor.getAttributes("paragraph");
          store.currentLineHeight = paragraphAttrs.lineHeight ?? null;
          store.currentSpaceBefore =
            paragraphAttrs.spaceBefore == null
              ? null
              : Number(paragraphAttrs.spaceBefore);
          store.currentSpaceAfter =
            paragraphAttrs.spaceAfter == null
              ? null
              : Number(paragraphAttrs.spaceAfter);
          store.currentKeepWithNext =
            paragraphAttrs.keepWithNext === true || editor.isActive("heading");
          // History availability — driven by the Tiptap history
          // extension, which the StarterKit includes by default.
          // `can().undo()` / `can().redo()` are safe on every transaction.
          store.canUndo = editor.can().undo();
          store.canRedo = editor.can().redo();
        };
        // `transaction` already covers selection-only changes, so registering
        // `selectionUpdate` too just ran this — and its four `editor.can()`
        // dry-run transactions — a second time per keystroke.
        editor.on("transaction", refreshActive);

        // Walk the doc for endnote/footnote atoms so the bottom-of-manuscript
        // notes panel stays in sync — numbered per kind, in reading order,
        // matching the CSS-counter numbering of the inline markers.
        const refreshNotes = () => {
          const notes: EditorNote[] = [];
          let endnoteCount = 0;
          let footnoteCount = 0;
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name !== "endnote") return;
            const kind: NoteKind =
              node.attrs.kind === "footnote" ? "footnote" : "endnote";
            const number =
              kind === "footnote" ? ++footnoteCount : ++endnoteCount;
            notes.push({ kind, number, text: node.attrs.text ?? "", pos });
          });
          store.notes = notes;
        };

        const refreshOutline = () => {
          store.outline = buildDocumentOutline(editor.state.doc);
        };

        // The outline rail, the notes panel and the diagram renderer each walk
        // or re-render the whole document. None of them has to keep up with
        // the keyboard — they only have to be right once the writer pauses.
        // Previously all three ran on every transaction, so moving the caret
        // through a long manuscript re-walked it twice and re-ran Mermaid.
        const STRUCTURE_DEBOUNCE_MS = 300;
        let structureTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleStructureRefresh = () => {
          if (structureTimer) clearTimeout(structureTimer);
          structureTimer = setTimeout(() => {
            structureTimer = null;
            refreshOutline();
            refreshNotes();
            renderMermaid();
          }, STRUCTURE_DEBOUNCE_MS);
        };
        editor.on("update", scheduleStructureRefresh);
        cleanup(() => {
          if (structureTimer) clearTimeout(structureTimer);
        });

        refreshNotes();
        refreshOutline();

        const refreshSlashMenu = () => {
          const slash = getSlashCommandState(editor.state);
          store.slashOpen = slash.open;
          store.slashQuery = slash.query;
          if (!slash.open) return;
          try {
            const coords = editor.view.coordsAtPos(slash.to);
            store.slashLeft = coords.left;
            store.slashTop = coords.bottom + 6;
          } catch {
            store.slashOpen = false;
          }
        };
        editor.on("transaction", refreshSlashMenu);
        refreshSlashMenu();

        // Seed the colophon (word count, folios) from the loaded draft.
        applyDocumentMeta(store.meta, editor.getText());

        // ── Mermaid rendering ──
        mermaid.initialize({ startOnLoad: false, theme: "base" });
        function renderMermaid() {
          // Most manuscripts contain no diagram at all; there is no reason to
          // schedule a frame and hand Mermaid the document to scan for one.
          let hasDiagram = false;
          editor.state.doc.descendants((node) => {
            if (hasDiagram) return false;
            if (node.type.name === "mermaidDiagram") hasDiagram = true;
            return !hasDiagram;
          });
          if (!hasDiagram) return;
          requestAnimationFrame(() => {
            mermaid
              .run({ querySelector: ".twyne-mermaid-diagram" })
              .catch(() => {
                // Mermaid syntax errors are benign; leave the source visible.
              });
          });
        }
        renderMermaid();

        // ── Multiplayer: presence + remote cursors + remote content sync ──
        if (sharedLixId && clientSig.value) {
          const mpClient = clientSig.value;
          const folioForSync = activeFolioId ?? "";

          startPresence(mpClient, sharedLixId);
          watchRemoteChanges(editor, folioForSync);

          // Report local cursor + selection to the presence layer.
          const reportCursor = () => {
            const { from, to } = editor.state.selection;
            updateCursor(
              mpClient,
              from,
              from !== to ? from : undefined,
              from !== to ? to : undefined,
            );
          };
          editor.on("selectionUpdate", reportCursor);

          // Poll presence → update remote cursor decorations.
          const pollPresence = async () => {
            try {
              const presence = (await mpClient.query(
                api.collaboration.getPresence,
                { lixId: sharedLixId },
              )) as RemoteCursor[];
              editor.commands.setRemoteCursors(presence);
            } catch {
              // best-effort
            }
          };
          void pollPresence();
          const presenceTimer = setInterval(pollPresence, 3000);

          // Cleanup
          const origDestroy = editor.destroy.bind(editor);
          editor.destroy = () => {
            clearInterval(presenceTimer);
            stopPresence();
            stopWatchingRemote();
            origDestroy();
          };
        }

        // Build a persona-note popover, anchored to the mark but never
        // covering the sentence. Position is computed by the pure
        // `computePopoverGeometry` module so the placement rules are
        // unit-testable without a Tiptap editor. Splitting attribute
        // read from geometry lets us re-use the same attribute
        // extractor when opening from the mark-anchor chip (where the
        // chip's own rect is the anchor, not the marked text's rect).
        const buildNotePopoverFromRect = (
          rect: DOMRect,
          attrs: {
            id: string;
            author: string;
            color: string;
            label: string;
            note: string;
            quote?: string;
            briefTitle?: string;
          },
          pinned: boolean,
        ): NotePopover => {
          const geom = computePopoverGeometry({
            vw: window.innerWidth,
            vh: window.innerHeight,
            rect: {
              left: rect.left,
              top: rect.top,
              bottom: rect.bottom,
            },
          });
          return {
            id: attrs.id,
            author: attrs.author,
            color: attrs.color,
            label: attrs.label,
            note: attrs.note,
            quote: attrs.quote,
            briefTitle: attrs.briefTitle,
            draft: "",
            dismissed: false,
            pinned,
            x: geom.x,
            top: geom.top,
            bottom: geom.bottom,
            maxH: geom.maxH,
            placement: geom.placement,
            thread: [],
            replying: false,
            streamingReply: "",
            error: null,
          };
        };

        const readPersonaNoteAttrs = (noteSpan: HTMLElement) => ({
          id: noteSpan.getAttribute("data-persona-note-id") ?? "",
          author: noteSpan.getAttribute("data-persona-note-author") ?? "",
          color:
            noteSpan.getAttribute("data-persona-note-color") ??
            "var(--color-vermilion)",
          label: noteSpan.getAttribute("data-persona-note-label") ?? "",
          note: noteSpan.getAttribute("data-persona-note-note") ?? "",
          quote: noteSpan.getAttribute("data-persona-note-quote") ?? undefined,
          briefTitle:
            noteSpan.getAttribute("data-persona-note-brief") ?? undefined,
        });

        const buildNotePopover = (
          noteSpan: HTMLElement,
          pinned: boolean,
        ): NotePopover =>
          buildNotePopoverFromRect(
            noteSpan.getBoundingClientRect(),
            readPersonaNoteAttrs(noteSpan),
            pinned,
          );
        // When a new popover is born, ask the personas panel for any
        // existing reply thread for this note so the popover can
        // render the conversation inline. The panel mirrors it back
        // via `twyne:persona-reply-thread`.
        const requestThreadFor = (noteId: string) => {
          if (!noteId) return;
          window.dispatchEvent(
            new CustomEvent("twyne:request-persona-thread", {
              detail: { noteId },
            }),
          );
        };
        const buildAndPin = (noteSpan: HTMLElement, pinned: boolean) => {
          const pop = buildNotePopover(noteSpan, pinned);
          store.notePopover = pop;
          requestThreadFor(pop.id);
        };

        // Open the suggestion card from any source (click on the
        // marked text, click on its mark-anchor chip). The chip's own
        // rect is usually a better anchor than the marked text's (it
        // sits at the end of the run and is unambiguous), so we accept
        // an explicit `anchorEl` when one is available.
        const openSuggestionPopover = (
          suggestionSpan: HTMLElement,
          anchorEl?: HTMLElement,
        ) => {
          const target = anchorEl ?? suggestionSpan;
          const rect = target.getBoundingClientRect();
          store.suggestionPopover = {
            id: suggestionSpan.getAttribute("data-suggestion-id") ?? "",
            versionId:
              suggestionSpan.getAttribute("data-suggestion-versionId") ?? "",
            author: suggestionSpan.getAttribute("data-suggestion-author") ?? "",
            color:
              suggestionSpan.getAttribute("data-suggestion-color") ??
              "var(--color-vermilion)",
            original: suggestionSpan.textContent ?? "",
            replacement:
              suggestionSpan.getAttribute("data-suggestion-replacement") ?? "",
            rationale:
              suggestionSpan.getAttribute("data-suggestion-rationale") ?? "",
            x: Math.max(8, Math.min(rect.left, window.innerWidth - 360)),
            y: rect.bottom + 8,
            busy: false,
          };
        };

        // ── Hover: preview a persona note below its sentence ──
        // Non-blocking rules:
        //   1. Hover-intent delay (350ms) — passing through doesn't
        //      accidentally open a card.
        //   2. Typing disarm — once the writer types (or deletes /
        //      hits Enter), the next hover is suppressed. We re-arm
        //      only on real mouse motion (>3px), filtering the
        //      synthetic mousemove that scroll-under-cursor fires.
        //   3. Pinned / replying / has-thread cards never close from
        //      mouseout alone.
        let hoverTimer: ReturnType<typeof setTimeout> | null = null;
        let hoverArmed = true;
        let lastMouse = { x: 0, y: 0 };
        const clearHoverTimer = () => {
          if (hoverTimer) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
          }
        };
        el.addEventListener("mouseover", (e) => {
          const target = e.target as HTMLElement;
          const noteSpan = target.closest(
            ".twyne-persona-note",
          ) as HTMLElement | null;
          const chip = target.closest(
            ".twyne-mark-anchor",
          ) as HTMLElement | null;
          if (!noteSpan && !chip) return;
          // Don't clobber a pinned card the writer is interacting with.
          if (store.notePopover?.pinned) return;
          if (!hoverArmed) return;
          // Resolve to the actual note span for geometry. The chip
          // belongs to whichever note span it sits in (or directly
          // adjacent to).
          const anchor =
            noteSpan ??
            (chip?.closest(".twyne-persona-note") as HTMLElement | null);
          if (!anchor) return;
          clearHoverTimer();
          hoverTimer = setTimeout(() => {
            buildAndPin(anchor, false);
          }, 350);
        });
        el.addEventListener("mouseout", (e) => {
          const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
          // Stay open while moving onto the card, the marked span, or
          // its corresponding anchor chip (text → chip → card).
          if (related?.closest(".persona-note-card")) return;
          if (related?.closest(".twyne-persona-note")) return;
          if (related?.closest(".twyne-mark-anchor")) return;
          // Even when we don't close, cancel any pending hover-open
          // timer so a fast pass-through doesn't surprise the writer.
          clearHoverTimer();
          // Mid-conversation: keep the live thread open even if the
          // popover was opened by hover rather than a click.
          if (store.notePopover?.pinned) return;
          if (store.notePopover?.replying) return;
          if ((store.notePopover?.thread.length ?? 0) > 0) return;
          store.notePopover = null;
        });

        // ── Click handler: anchor-chip routes by data-anchor-kind; mark
        // clicks fall through to ProseMirror (caret placement, no popover). ──
        el.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;

          // Anchor chip first — must preventDefault so clicking the
          // chip doesn't also place the caret.
          const chip = target.closest(
            ".twyne-mark-anchor",
          ) as HTMLElement | null;
          if (chip) {
            e.preventDefault();
            const kind = chip.getAttribute("data-anchor-kind");
            const id = chip.getAttribute("data-anchor-id") ?? "";
            if (!id) return;
            const chipRect = chip.getBoundingClientRect();
            if (kind === "comment") {
              const span = el.querySelector(
                `.twyne-comment-mark[data-comment-id="${CSS.escape(id)}"]`,
              ) as HTMLElement | null;
              if (span) openUserCommentPopover(id, span);
            } else if (kind === "suggestion") {
              const span = el.querySelector(
                `.twyne-suggestion[data-suggestion-id="${CSS.escape(id)}"]`,
              ) as HTMLElement | null;
              if (span) openSuggestionPopover(span, chip);
            } else if (kind === "note") {
              const span = el.querySelector(
                `.twyne-persona-note[data-persona-note-id="${CSS.escape(id)}"]`,
              ) as HTMLElement | null;
              if (span) {
                const pop = buildNotePopoverFromRect(
                  chipRect,
                  readPersonaNoteAttrs(span),
                  true,
                );
                store.notePopover = pop;
                requestThreadFor(pop.id);
              }
            }
            return;
          }

          // Plain click on a marked span — defer to ProseMirror for
          // caret placement. Only act to close stray cards (click-away).
          if (!target.closest(".persona-note-card")) {
            const inNote = !!target.closest(".twyne-persona-note");
            if (!inNote) store.notePopover = null;
          }
          if (
            !target.closest(".twyne-suggestion") &&
            !target.closest(".suggestion-card")
          ) {
            store.suggestionPopover = null;
          }
          if (
            !target.closest(".twyne-comment-mark") &&
            !target.closest(".user-comment-card")
          ) {
            store.userCommentPopover = null;
          }
        });

        // ── Double-click on a comment mark: dismiss the popover and drop
        // the caret into the marked passage. Now a safety net since the
        // single-click path no longer opens the popover for marked text. ──
        el.addEventListener("dblclick", (e) => {
          const target = e.target as HTMLElement;
          const commentMark = target.closest(
            ".twyne-comment-mark",
          ) as HTMLElement | null;
          if (!commentMark) return;
          store.userCommentPopover = null;
          const pos = editor.view.posAtDOM(commentMark, 0);
          if (typeof pos === "number" && pos >= 0) {
            editor.commands.focus(pos);
          } else {
            editor.commands.focus();
          }
        });

        // ── Typing suppression: disarm hover, close no-thread previews ──
        // We listen on the editor element rather than
        // `editor.on("transaction")` so that remote multiplayer
        // transactions don't disarm hover based on *someone else's*
        // keystrokes.
        el.addEventListener("keydown", (e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          const k = e.key;
          const isPrintable = k.length === 1;
          if (
            !isPrintable &&
            k !== "Backspace" &&
            k !== "Delete" &&
            k !== "Enter"
          ) {
            return;
          }
          hoverArmed = false;
          clearHoverTimer();
          // An unpinned preview (no thread, not replying) closes — but a
          // pinned card or one that's mid-thread stays open so the
          // conversation can continue.
          const p = store.notePopover;
          if (p && !p.pinned && !p.replying && p.thread.length === 0) {
            store.notePopover = null;
          }
        });
        // Re-arm hover only on real mouse motion (not synthetic scroll
        // mousemove events). Listener on `document` so moving out of the
        // editor area still re-arms.
        const rearmOnMove = (e: MouseEvent) => {
          const dx = e.clientX - lastMouse.x;
          const dy = e.clientY - lastMouse.y;
          lastMouse = { x: e.clientX, y: e.clientY };
          if (Math.hypot(dx, dy) > 3) {
            hoverArmed = true;
          }
        };
        document.addEventListener("mousemove", rearmOnMove);

        // ── Global Escape: close any of the three popovers ──
        // Listens on `window` so it works even when focus is in the
        // reply textarea.
        const onGlobalKeydown = (e: KeyboardEvent) => {
          const target = e.target as HTMLElement | null;
          const editingField =
            !!target &&
            (target.matches("input, textarea, select") ||
              (target.isContentEditable && !target.closest(".ProseMirror")));
          const key = e.key.toLowerCase();

          if (!editingField) {
            const matched = EDITOR_KEYBINDINGS.find((binding) =>
              chordMatches(
                {
                  key,
                  metaKey: e.metaKey,
                  ctrlKey: e.ctrlKey,
                  altKey: e.altKey,
                  shiftKey: e.shiftKey,
                },
                binding.shortcut,
              ),
            );
            if (matched) {
              e.preventDefault();
              void runRegistryCommand(matched.commandId);
              return;
            }
          }
          if (e.key !== "Escape") return;
          if (store.notePopover) store.notePopover = null;
          if (store.userCommentPopover) store.userCommentPopover = null;
          if (store.suggestionPopover) store.suggestionPopover = null;
          if (store.openPicker) store.openPicker = null;
          store.showFindReplace = false;
          store.showOutline = false;
        };
        window.addEventListener("keydown", onGlobalKeydown);

        store.editor = editor;
        const tableToolbarController = createTableToolbarController(
          editor,
          (snapshot, cellFormat) => {
            store.tableToolbar = snapshot;
            store.cellFormat = cellFormat;
          },
        );

        // ── Vertical (row-height) resize on the header row ──
        // Tiptap's Table extension only ships a column-resize handle
        // (the 3px vertical strip on the right edge of each cell).
        // Header rows are tall by default and the writer often wants
        // them shorter — so we attach a thin horizontal grip along
        // the bottom of each <th> in the first row and translate
        // vertical mouse drags into row.style.height.
        const REFRESH = () => refreshRowResizeHandles(el);
        editor.on("update", REFRESH);
        editor.on("selectionUpdate", REFRESH);
        REFRESH();

        el.addEventListener("mousedown", (e) => {
          const handle = (e.target as HTMLElement).closest(
            ".row-resize-handle",
          ) as HTMLElement | null;
          if (!handle) return;
          e.preventDefault();
          e.stopPropagation();
          const th = handle.closest("th") as HTMLElement | null;
          const tr = th?.closest("tr") as HTMLTableRowElement | null;
          if (!tr) return;
          const startY = e.clientY;
          const startH = tr.getBoundingClientRect().height;
          const minH = 24;
          const onMove = (ev: MouseEvent) => {
            const next = Math.max(minH, startH + (ev.clientY - startY));
            tr.style.height = `${next}px`;
            for (const cell of Array.from(tr.children)) {
              (cell as HTMLElement).style.height = `${next}px`;
            }
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            el.classList.remove("row-resize-cursor");
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
          el.classList.add("row-resize-cursor");
        });

        // ── Listen for folio switches ──
        const onLoadFolio = (e: Event) => {
          const content = (e as CustomEvent).detail as string;
          editor.commands.setContent(content, { emitUpdate: false });
          applyDocumentMeta(store.meta, editor.getText());
        };
        window.addEventListener("twyne:load-folio", onLoadFolio);

        // ── Hand the live draft text to whoever asks (personas panel) ──
        const onRequestDraft = () => {
          window.dispatchEvent(
            new CustomEvent("twyne:draft-text", { detail: editor.getText() }),
          );
        };
        window.addEventListener("twyne:request-draft", onRequestDraft);

        // ── Hand the live draft HTML to whoever asks (export menu) ──
        const onRequestDraftHtml = () => {
          window.dispatchEvent(
            new CustomEvent("twyne:draft-html", { detail: editor.getHTML() }),
          );
        };
        window.addEventListener("twyne:request-draft-html", onRequestDraftHtml);

        // ── Place a citation beside the passage it actually supports ──
        const onInsertCitation = (event: Event) => {
          const detail = (event as CustomEvent<CitationInsertionDetail>).detail;
          if (!detail?.sourceId || !detail.text) return;

          let target = detail.anchor
            ? findTextRange(editor.state.doc, detail.anchor)
            : null;
          if (!target && detail.sourceUrl) {
            target = findTextRange(editor.state.doc, detail.sourceUrl);
          }
          if (
            !target &&
            detail.allowSelectionFallback &&
            !editor.state.selection.empty
          ) {
            target = {
              from: editor.state.selection.from,
              to: editor.state.selection.to,
            };
          }

          if (!target) {
            window.dispatchEvent(
              new CustomEvent<CitationInsertionResult>(
                "twyne:citation-inserted",
                {
                  detail: {
                    sourceId: detail.sourceId,
                    inserted: false,
                    reason: detail.anchor
                      ? "anchor-not-found"
                      : "select-passage",
                  },
                },
              ),
            );
            return;
          }

          const inserted = editor
            .chain()
            .focus()
            .setTextSelection(target.to)
            .setFootnote({ text: detail.text })
            .run();
          window.dispatchEvent(
            new CustomEvent<CitationInsertionResult>(
              "twyne:citation-inserted",
              {
                detail: { sourceId: detail.sourceId, inserted },
              },
            ),
          );
        };
        window.addEventListener("twyne:insert-citation", onInsertCitation);

        // ── Persona notes: pin feedback to the passages it concerns ──
        const onPersonaNotes = (e: Event) => {
          const notes = (e as CustomEvent).detail as PersonaNotePayload[];
          for (const n of notes) {
            const range = findTextRange(editor.state.doc, n.quote);
            if (!range) continue;
            editor
              .chain()
              .setTextSelection(range)
              .setPersonaNote({
                id: n.id,
                author: n.author,
                color: n.color,
                label: n.label,
                note: n.note,
                quote: n.quote,
                briefTitle: n.briefTitle,
              })
              .setTextSelection(range.to)
              .run();
          }
        };
        window.addEventListener("twyne:persona-notes", onPersonaNotes);

        const onClearPersonaNotes = () => {
          removeAllPersonaNotes(editor);
          store.notePopover = null;
        };
        window.addEventListener(
          "twyne:clear-persona-notes",
          onClearPersonaNotes,
        );

        const onScrollToNote = (e: Event) => {
          const id = (e as CustomEvent).detail as string;
          flashMarkedElement(el, `[data-persona-note-id="${CSS.escape(id)}"]`);
        };
        window.addEventListener("twyne:scroll-to-persona-note", onScrollToNote);

        // ── Inline reply thread, mirrored from the personas panel ──
        // The popover is a live conversation: the panel sends the writer's
        // optimistic reply, the persona's response, an in-flight flag, and
        // any error string. We patch the popover in place — but only when
        // the open popover is for the same note — so the writer sees the
        // thread right where they wrote it.
        const onReplyThread = (e: Event) => {
          const detail = (e as CustomEvent).detail as {
            noteId?: string;
            replies?: PersonaReply[];
          };
          if (!detail?.noteId || !store.notePopover) return;
          if (detail.noteId !== store.notePopover.id) return;
          store.notePopover = {
            ...store.notePopover,
            thread: detail.replies ?? [],
          };
        };
        const onReplying = (e: Event) => {
          const detail = (e as CustomEvent).detail as {
            noteId?: string;
            replying?: boolean;
          };
          if (!detail?.noteId || !store.notePopover) return;
          if (detail.noteId !== store.notePopover.id) return;
          store.notePopover = {
            ...store.notePopover,
            replying: !!detail.replying,
          };
        };
        // The reply as the editor writes it. Arrives as the full visible text
        // each time, so a discarded-and-regenerated answer simply resets.
        const onReplyStream = (e: Event) => {
          const detail = (e as CustomEvent).detail as {
            noteId?: string;
            text?: string;
          };
          if (!detail?.noteId || !store.notePopover) return;
          if (detail.noteId !== store.notePopover.id) return;
          store.notePopover = {
            ...store.notePopover,
            streamingReply: detail.text ?? "",
          };
        };
        const onReplyError = (e: Event) => {
          const detail = (e as CustomEvent).detail as {
            noteId?: string;
            message?: string;
          };
          if (!detail?.noteId || !store.notePopover) return;
          if (detail.noteId !== store.notePopover.id) return;
          store.notePopover = {
            ...store.notePopover,
            error: detail.message ?? null,
          };
        };
        window.addEventListener("twyne:persona-reply-thread", onReplyThread);
        window.addEventListener("twyne:persona-replying", onReplying);
        window.addEventListener("twyne:persona-reply-stream", onReplyStream);
        window.addEventListener("twyne:persona-reply-error", onReplyError);

        // Phase 4: the sync dot and the "Saved Xs ago" line read
        // the browser's online/offline events. Wire them once at
        // mount; the function is idempotent.
        bindNetworkStatusEvents();

        // ── Suggestions: pin an editor's proposed rewrite to its passage ──
        const applySuggestionMark = (s: SuggestionPayload) => {
          const range = findTextRange(editor.state.doc, s.quote);
          if (!range) return;
          editor
            .chain()
            .setTextSelection(range)
            .setSuggestion({
              id: s.id,
              versionId: s.versionId,
              author: s.author,
              color: s.color,
              replacement: s.replacement,
              rationale: s.rationale,
            })
            .setTextSelection(range.to)
            .run();
        };
        const onSuggestions = (e: Event) => {
          for (const s of (e as CustomEvent).detail as SuggestionPayload[]) {
            applySuggestionMark(s);
          }
        };
        window.addEventListener("twyne:suggestions", onSuggestions);

        // ── Propose-edit: the panel produced a rewrite; we own the doc, so we
        // locate the block, open a Lix branch for the edit, persist the
        // proposal, and render the inline tracked change. ──
        const onProposeEdit = (e: Event) => {
          const d = (e as CustomEvent).detail as {
            id: string;
            personaId: string;
            personaName: string;
            color: string;
            original: string;
            replacement: string;
            rationale: string;
            kind: Suggestion["kind"];
          };
          void (async () => {
            const folioId = store.activeFolioId;
            const html = editor.getHTML();
            await syncDraftToLix(folioId, html);
            const norm = (s: string) => s.replace(/\s+/g, " ").trim();
            const stripHtml = (h: string) => {
              const tmp = document.createElement("div");
              tmp.innerHTML = h;
              return tmp.textContent ?? "";
            };
            const blocks = splitBlocks(html);
            const target =
              blocks.find((b) =>
                norm(stripHtml(b.html)).includes(norm(d.original)),
              ) ?? blocks[0];
            const blockId = target?.id ?? "b0";
            const newBlockHtml = target
              ? target.html.replace(d.original, d.replacement)
              : `<p>${d.replacement}</p>`;

            let versionId = "";
            try {
              versionId = await proposeBlockEdit({
                folioId,
                personaName: d.personaName,
                blockId,
                html: newBlockHtml,
              });
            } catch (err) {
              console.warn("[twyne:suggestion] proposeBlockEdit failed", err);
            }

            const suggestion: Suggestion = {
              id: d.id,
              folioId,
              versionId,
              personaId: d.personaId,
              personaName: d.personaName,
              color: d.color,
              blockId,
              original: d.original,
              replacement: d.replacement,
              rationale: d.rationale,
              kind: d.kind,
              status: "open",
              createdAt: Date.now(),
            };
            await saveSuggestionLocally(suggestion, folioId);
            const client = clientSig.value;
            if (client) {
              try {
                await client.mutation(api.sync.putSuggestion, {
                  folioId,
                  suggestionId: suggestion.id,
                  versionId: suggestion.versionId,
                  personaId: suggestion.personaId,
                  personaName: suggestion.personaName,
                  color: suggestion.color,
                  blockId: suggestion.blockId,
                  original: suggestion.original,
                  replacement: suggestion.replacement,
                  rationale: suggestion.rationale,
                  kind: suggestion.kind,
                  status: "open",
                });
              } catch {
                /* sync will retry */
              }
            }
            applySuggestionMark({
              id: suggestion.id,
              versionId: suggestion.versionId,
              author: suggestion.personaName,
              color: suggestion.color,
              original: suggestion.original,
              replacement: suggestion.replacement,
              rationale: suggestion.rationale,
              quote: suggestion.original,
            });
          })();
        };
        window.addEventListener("twyne:propose-edit", onProposeEdit);

        const onClearSuggestions = () => {
          removeAllSuggestions(editor);
          store.suggestionPopover = null;
        };
        window.addEventListener("twyne:clear-suggestions", onClearSuggestions);

        const onScrollToSuggestion = (e: Event) => {
          const id = (e as CustomEvent).detail as string;
          flashMarkedElement(el, `[data-suggestion-id="${CSS.escape(id)}"]`);
        };
        window.addEventListener(
          "twyne:scroll-to-suggestion",
          onScrollToSuggestion,
        );

        // ── The juice: a vermilion approval stamp on accept ──
        let stampTimer: ReturnType<typeof setTimeout> | null = null;
        const onStamp = () => {
          store.stampVisible = false;
          // next tick so the animation restarts even on rapid accepts
          requestAnimationFrame(() => {
            store.stampVisible = true;
          });
          if (stampTimer) clearTimeout(stampTimer);
          stampTimer = setTimeout(() => {
            store.stampVisible = false;
          }, 1400);
        };
        window.addEventListener("twyne:stamp", onStamp);

        cleanup(() => {
          store.imageUploadAdapter = null;
          if (stampTimer) clearTimeout(stampTimer);
          window.removeEventListener("twyne:stamp", onStamp);
          window.removeEventListener("twyne:load-folio", onLoadFolio);
          window.removeEventListener("twyne:request-draft", onRequestDraft);
          window.removeEventListener(
            "twyne:request-draft-html",
            onRequestDraftHtml,
          );
          window.removeEventListener("twyne:insert-citation", onInsertCitation);
          window.removeEventListener("twyne:persona-notes", onPersonaNotes);
          window.removeEventListener(
            "twyne:clear-persona-notes",
            onClearPersonaNotes,
          );
          window.removeEventListener(
            "twyne:scroll-to-persona-note",
            onScrollToNote,
          );
          window.removeEventListener(
            "twyne:persona-reply-thread",
            onReplyThread,
          );
          window.removeEventListener("twyne:persona-replying", onReplying);
          window.removeEventListener(
            "twyne:persona-reply-stream",
            onReplyStream,
          );
          window.removeEventListener("twyne:persona-reply-error", onReplyError);
          window.removeEventListener("twyne:suggestions", onSuggestions);
          window.removeEventListener("twyne:propose-edit", onProposeEdit);
          window.removeEventListener(
            "twyne:clear-suggestions",
            onClearSuggestions,
          );
          window.removeEventListener(
            "twyne:scroll-to-suggestion",
            onScrollToSuggestion,
          );
          clearHoverTimer();
          document.removeEventListener("mousemove", rearmOnMove);
          window.removeEventListener("keydown", onGlobalKeydown);
          editor.off("transaction", refreshSlashMenu);
          tableToolbarController.destroy();
          editor.destroy();
          store.editor = null;
        });
      });
    });

    const dismissNote = $((id: string) => {
      if (store.editor) removePersonaNote(store.editor, id);
      store.notePopover = null;
    });

    /** Jump from a bottom-of-manuscript notes-panel entry to its marker in the text. */
    const jumpToNote = $((pos: number) => {
      const editor = store.editor;
      if (!editor) return;
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      dom?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      });
      dom?.classList.add("is-flashing");
      setTimeout(() => dom?.classList.remove("is-flashing"), 1600);
      editor.chain().focus().setTextSelection(pos).run();
    });

    /**
     * Accept an editor's proposed rewrite: swap the original passage for the
     * replacement in the manuscript, merge the proposal's Lix branch into the
     * writer's version (the version-control record), flip its status, and
     * stamp the page. The visible text and the merged branch agree because
     * the replacement is exactly what was written on the branch.
     */
    const acceptSuggestion = $(async () => {
      const pop = store.suggestionPopover;
      const editor = store.editor;
      if (!pop || !editor) return;
      store.suggestionPopover = { ...pop, busy: true };

      await createRevisionSnapshot({
        folioId: store.activeFolioId,
        html: editor.getHTML(),
        label: `Before accepting ${pop.author}'s suggestion`,
        source: "feedback",
        force: true,
      });

      const range = findSuggestionRange(editor, pop.id);
      if (range) {
        editor
          .chain()
          .setTextSelection(range)
          .insertContent(pop.replacement)
          .run();
      }
      removeSuggestionMark(editor, pop.id);

      try {
        if (pop.versionId) await mergeAgentChanges(pop.versionId);
      } catch (err) {
        console.warn("[twyne:suggestion] merge failed", err);
      }
      await updateSuggestionStatusLocally(
        pop.id,
        "accepted",
        store.activeFolioId,
      );
      const client = clientSig.value;
      if (client) {
        try {
          await client.mutation(api.sync.updateSuggestionStatus, {
            folioId: store.activeFolioId,
            suggestionId: pop.id,
            status: "accepted",
          });
        } catch {
          /* sync will retry */
        }
      }
      store.suggestionPopover = null;
      // The juice: a vermilion approval stamp thunks onto the page.
      window.dispatchEvent(
        new CustomEvent("twyne:stamp", { detail: { color: pop.color } }),
      );
    });

    /** Strike a proposal: remove the mark, leave the manuscript untouched. */
    const strikeSuggestion = $(async () => {
      const pop = store.suggestionPopover;
      if (!pop) return;
      if (store.editor) removeSuggestionMark(store.editor, pop.id);
      await updateSuggestionStatusLocally(
        pop.id,
        "rejected",
        store.activeFolioId,
      );
      const client = clientSig.value;
      if (client) {
        try {
          await client.mutation(api.sync.updateSuggestionStatus, {
            folioId: store.activeFolioId,
            suggestionId: pop.id,
            status: "rejected",
          });
        } catch {
          /* sync will retry */
        }
      }
      store.suggestionPopover = null;
    });

    /**
     * Open the user-comment popover for a given mark. Loads the body,
     * replies, and resolve state from Lix (Convex will catch up on
     * the next sync). The popover position is anchored to the mark's
     * bounding rect, with a small offset to keep it readable.
     */
    const openUserCommentPopover = $(
      async (commentId: string, markEl: HTMLElement) => {
        const all = await loadUserComments();
        const c = all.find(
          (x) => x.id === commentId && x.folioId === store.activeFolioId,
        );
        if (!c) {
          // The mark exists but the body didn't sync. Show a placeholder
          // so the writer can resolve or delete it; the next addComment
          // round-trip will populate the body.
          const rect = markEl.getBoundingClientRect();
          store.userCommentPopover = {
            id: commentId,
            author: "You",
            text: "(comment body not yet synced)",
            createdAt: Date.now(),
            x: Math.max(8, Math.min(rect.left, window.innerWidth - 360)),
            y: rect.bottom + 8,
            resolved: false,
            replies: [],
            draft: "",
          };
          return;
        }
        const rect = markEl.getBoundingClientRect();
        store.userCommentPopover = {
          id: c.id,
          author: c.author,
          text: c.text,
          createdAt: c.createdAt,
          x: Math.max(8, Math.min(rect.left, window.innerWidth - 360)),
          y: rect.bottom + 8,
          resolved: c.resolved,
          replies: c.replies,
          draft: "",
        };
      },
    );

    const closeUserCommentPopover = $(() => {
      store.userCommentPopover = null;
    });

    const submitUserCommentReply = $(async (commentId: string) => {
      const popover = store.userCommentPopover;
      if (!popover || popover.id !== commentId) return;
      const text = popover.draft.trim();
      if (!text) return;
      const reply: UserCommentReply = {
        id: `ucr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        author: "You",
        authorKind: "user",
        text,
        createdAt: Date.now(),
      };
      // Local persistence
      const all = await appendUserCommentReply(commentId, reply);
      const updated = all.find((x) => x.id === commentId);
      if (updated) {
        store.userCommentPopover = {
          ...popover,
          replies: updated.replies,
          draft: "",
        };
      }
      // Cloud sync (best-effort, silent on failure)
      const client = clientSig.value;
      if (client) {
        try {
          await client.mutation(api.userComments.addReply, {
            replyId: reply.id,
            commentId,
            author: reply.author,
            text: reply.text,
          });
        } catch (err) {
          console.warn("[twyne:editor] user comment reply sync failed:", err);
        }
      }
      // Tell the Marginalia panel (and any other listener) the thread grew.
      // Without this, the right-rail view stays stale until the panel
      // remounts, which makes it look like the reply vanished.
      window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
    });

    const toggleResolveUserComment = $(async (commentId: string) => {
      const all = await toggleUserCommentResolved(commentId);
      const updated = all.find((x) => x.id === commentId);
      const popover = store.userCommentPopover;
      if (popover && popover.id === commentId && updated) {
        store.userCommentPopover = { ...popover, resolved: updated.resolved };
      }
      const client = clientSig.value;
      if (client) {
        try {
          await client.mutation(api.userComments.resolveComment, { commentId });
        } catch (err) {
          console.warn("[twyne:editor] resolve sync failed:", err);
        }
      }
      window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
    });

    const deleteUserCommentLocal = $(async (commentId: string) => {
      await deleteUserComment(commentId);
      // Strike the mark from the document so the inline highlight goes away.
      if (store.editor) {
        const { state, view } = store.editor;
        const type = state.schema.marks.commentMark;
        if (type) {
          const tr = state.tr;
          state.doc.descendants((node: any, pos: number) => {
            if (!node.isText) return true;
            for (const mark of node.marks) {
              if (mark.type === type && mark.attrs.id === commentId) {
                tr.removeMark(pos, pos + node.nodeSize, type);
              }
            }
            return true;
          });
          if (tr.docChanged) view.dispatch(tr);
        }
      }
      store.userCommentPopover = null;
      const client = clientSig.value;
      if (client) {
        try {
          await client.mutation(api.userComments.deleteComment, { commentId });
        } catch (err) {
          console.warn("[twyne:editor] delete comment sync failed:", err);
        }
      }
      window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
    });

    /** Fire-and-forget: persist a new comment to Lix + Convex. */
    const persistNewComment = $(
      async (
        commentId: string,
        text: string,
        anchor: string,
        folioId: string,
      ) => {
        try {
          await upsertUserComment({
            id: commentId,
            folioId,
            text,
            author: "You",
            anchor,
            resolved: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            replies: [],
          });
          const client = clientSig.value;
          if (client && folioId) {
            try {
              await client.mutation(api.userComments.addComment, {
                commentId,
                folioId,
                text,
                author: "You",
                anchor,
              });
            } catch (err) {
              console.warn("[twyne:editor] addComment sync failed:", err);
            }
          }
          // The Marginalia panel lives in a sibling component and watches
          // this event to know when to refetch. Fire it once the local
          // write is committed so the writer's new note shows up there
          // without a manual reload.
          window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
        } catch (err) {
          console.warn("[twyne:editor] persistNewComment failed:", err);
        }
      },
    );

    const handleDragOver = $(() => {
      store.isDragOver = true;
    });

    const handleDragLeave = $(() => {
      store.isDragOver = false;
    });

    const handleDrop = $(() => {
      store.isDragOver = false;
    });

    const insertImage = $((src: string, alt?: string) => {
      store.editor
        ?.chain()
        .focus()
        .insertContent({
          type: "image",
          attrs: { src, alt: alt || "", offline: src.startsWith("data:") },
        })
        .run();
    });

    const chooseImageFiles = $(async () => {
      const editor = store.editor;
      const adapter = store.imageUploadAdapter;
      if (!editor || !adapter) return;
      store.imageUploadError = null;
      await chooseAndInsertImages(editor, adapter, undefined, (error) => {
        store.imageUploadError = error.message;
      });
      store.showImageInput = false;
    });

    const patchSelectedImage = $((patch: Partial<ImageNodeAttributes>) => {
      store.editor?.chain().focus().updateAttributes("image", patch).run();
    });

    const retrySelectedImage = $(async () => {
      const editor = store.editor;
      const adapter = store.imageUploadAdapter;
      const uploadId = store.selectedImage?.uploadId;
      if (!editor || !adapter || !uploadId) return;
      store.imageUploadError = null;
      await retryImageUpload(editor, uploadId, adapter, undefined, (error) => {
        store.imageUploadError = error.message;
      });
    });

    const removeSelectedImage = $(() => {
      store.editor?.chain().focus().deleteSelection().run();
    });

    /** Push the new layout to the parent (which writes to the Folio) and apply live CSS vars. */
    const emitLayout = $((next: LayoutSettings) => {
      store.layout = next;
      window.dispatchEvent(new CustomEvent("twyne:layout", { detail: next }));
    });

    /**
     * How wide the ruler should be. On a paginated canvas the ruler describes
     * the sheet, so its markers land on the real page margins; in continuous
     * mode there is no sheet and it describes the chosen column instead.
     */
    const pageWidthRem = () => {
      const setup = resolvePageSetup(store.layout);
      if (setup.pagination !== "paginated") {
        return DOC_WIDTH_REM[store.layout.width];
      }
      const root = rootFontSize();
      return pxToRem(computePageGeometry(store.layout, root).pageW, root);
    };

    /**
     * How tall the canvas must be to contain every sheet. The chrome is
     * absolutely positioned and contributes no height, so the canvas has to be
     * told; otherwise a final page that is only a third full is clipped where
     * the prose stops rather than showing a whole sheet.
     */
    const canvasMinHeight = () => {
      const g = computePageGeometry(store.layout, rootFontSize());
      return Math.max(0, store.pageCount * (g.pageH + g.gap) - g.gap);
    };

    /** The page box, in the CSS pixels the chrome overlay positions against. */
    const pageChromeGeometry = () => {
      const g = computePageGeometry(store.layout, rootFontSize());
      return {
        pageH: g.pageH,
        gap: g.gap,
        marginTop: g.marginTop,
        marginBottom: g.marginBottom,
        marginLeft: g.marginLeft,
        marginRight: g.marginRight,
      };
    };

    /**
     * Print the manuscript with the page setup the writer just chose. Goes
     * through the same payload builder as the File menu, so the PDF carries
     * the bibliography and marginalia rather than a bare draft.
     */
    const saveAsPdf = $(async () => {
      if (store.exportingPdf) return;
      store.exportingPdf = true;
      try {
        const payload = await buildFolioExportPayload({
          folioId: activeFolioId ?? null,
          folioName: activeFolio?.name || store.meta.title || "Untitled",
          brief: brief ?? null,
          layout: store.layout,
          header: store.headerText,
          footer: store.footerText,
        });
        await exportPdf(payload);
      } catch (err) {
        reportApplicationDiagnostic("twyne:editor:export-pdf", err, {
          operation: "export",
        });
      } finally {
        store.exportingPdf = false;
      }
    });

    const updateChromeText = $((kind: "header" | "footer", next: string) => {
      if (kind === "header") store.headerText = next;
      else store.footerText = next;
      window.dispatchEvent(new CustomEvent(`twyne:${kind}`, { detail: next }));
    });

    /**
     * Read the manuscript aloud — the selection when there is one, otherwise
     * the whole draft. Hearing your own prose in another voice is the oldest
     * revision trick there is, and the synthesis plumbing was already here.
     */
    /**
     * Read the selection aloud, or the whole draft when nothing is selected.
     *
     * The id is stable rather than derived from the selection: the transport
     * owns pause and resume, so this only ever runs from an idle state, and a
     * changing id would leave the transport unable to find the reading it just
     * started. `speak` is imported statically — a dynamic import here would
     * spend part of the user gesture that playback permission depends on.
     */
    const readAloud = $(async () => {
      const editor = store.editor;
      if (!editor) return;
      const { from, to } = editor.state.selection;
      const selectionOffset =
        from !== to ? editor.state.doc.textBetween(0, from, "\n\n").length : 0;
      const rawText =
        from !== to
          ? editor.state.doc.textBetween(from, to, "\n\n")
          : editor.getText();
      const leadingWhitespace = rawText.length - rawText.trimStart().length;
      const text = rawText.trim();
      if (!text) return;
      await speak({
        id: MANUSCRIPT_READING_ID,
        text,
        sourceOffset: selectionOffset + leadingWhitespace,
        client: clientSig.value ?? null,
        signedIn: Boolean(auth.value.user),
        progressive: true,
      });
    });

    /** Apply or clear the highlighter. Colours are hex literals — see palette.ts. */
    const applyHighlight = $((hex: string | null) => {
      const chain = store.editor?.chain().focus();
      if (!chain) return;
      if (hex) chain.setHighlight({ color: hex }).run();
      else chain.unsetHighlight().run();
      store.openPicker = null;
    });

    const applyTextColor = $((hex: string | null) => {
      const chain = store.editor?.chain().focus();
      if (!chain) return;
      if (hex) chain.setColor(hex).run();
      else chain.unsetColor().run();
      store.openPicker = null;
    });

    const applyFontFamily = $((stack: string | null) => {
      const chain = store.editor?.chain().focus();
      if (!chain) return;
      if (stack) chain.setFontFamily(stack).run();
      else chain.unsetFontFamily().run();
    });

    const applyFontSize = $((size: string | null) => {
      const chain = store.editor?.chain().focus();
      if (!chain) return;
      if (size) chain.setFontSize(size).run();
      else chain.unsetFontSize().run();
    });

    const applyLineHeight = $((value: string | null) => {
      const chain = store.editor?.chain().focus();
      if (!chain) return;
      chain.setParagraphLineHeight(value).run();
    });

    const applySpaceBefore = $((points: number | null) => {
      store.editor?.chain().focus().setSpaceBefore(points).run();
    });

    const applySpaceAfter = $((points: number | null) => {
      store.editor?.chain().focus().setSpaceAfter(points).run();
    });

    const applyKeepWithNext = $((enabled: boolean) => {
      store.editor?.chain().focus().setKeepWithNext(enabled).run();
    });

    /**
     * Recase the selection in place.
     *
     * Only text nodes are replaced, in reverse document order. That preserves
     * the marks on each node (bold, links, comments, suggestions) instead of
     * flattening the selected range into unformatted text.
     */
    const applyTextCase = $((mode: TextCase) => {
      const editor = store.editor;
      if (!editor) return;
      const { from, to } = editor.state.selection;
      if (from === to) return;
      const segments: Array<{
        from: number;
        to: number;
        text: string;
        marks: readonly any[];
      }> = [];
      editor.state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText || !node.text) return;
        const segmentFrom = Math.max(from, pos);
        const segmentTo = Math.min(to, pos + node.nodeSize);
        if (segmentFrom >= segmentTo) return;
        const start = segmentFrom - pos;
        const end = segmentTo - pos;
        segments.push({
          from: segmentFrom,
          to: segmentTo,
          text: node.text.slice(start, end),
          marks: node.marks,
        });
      });
      const edits = recaseTextSegments(segments, mode);
      let tr = editor.state.tr;
      for (let i = edits.length - 1; i >= 0; i--) {
        const edit = edits[i];
        if (edit.text === segments[i].text) continue;
        tr = tr.replaceWith(
          edit.from,
          edit.to,
          editor.state.schema.text(edit.text, segments[i].marks),
        );
      }
      if (!tr.docChanged) return;
      tr.setSelection(
        TextSelection.create(tr.doc, from, Math.min(to, tr.doc.content.size)),
      );
      editor.view.dispatch(tr);
      editor.commands.focus();
    });

    const runCommand = $((command: string) => {
      const chain = store.editor?.chain().focus();
      if (!chain) return;
      switch (command) {
        case "bold":
          chain.toggleBold().run();
          break;
        case "italic":
          chain.toggleItalic().run();
          break;
        case "underline":
          chain.toggleUnderline().run();
          break;
        case "strike":
          chain.toggleStrike().run();
          break;
        case "highlight":
          chain.toggleHighlight().run();
          break;
        case "superscript":
          // Mutually exclusive with subscript: text cannot be raised and
          // lowered at once, and TipTap will happily apply both.
          chain.unsetSubscript().toggleSuperscript().run();
          break;
        case "subscript":
          chain.unsetSuperscript().toggleSubscript().run();
          break;
        case "justify":
          chain.setTextAlign("justify").run();
          break;
        case "clearFormatting":
          // Marks and block type both — "clear formatting" that left a
          // heading a heading would not match anyone's expectation.
          chain.unsetAllMarks().unsetParagraphFormat().clearNodes().run();
          break;
        case "h1":
          chain.toggleHeading({ level: 1 }).run();
          break;
        case "h2":
          chain.toggleHeading({ level: 2 }).run();
          break;
        case "h3":
          chain.toggleHeading({ level: 3 }).run();
          break;
        case "bullet":
          chain.toggleBulletList().run();
          break;
        case "ordered":
          chain.toggleOrderedList().run();
          break;
        case "taskList":
          chain.toggleTaskList().run();
          break;
        case "blockquote":
          chain.toggleBlockquote().run();
          break;
        case "code":
          chain.toggleCodeBlock().run();
          break;
        case "left":
          chain.setTextAlign("left").run();
          break;
        case "center":
          chain.setTextAlign("center").run();
          break;
        case "right":
          chain.setTextAlign("right").run();
          break;
        case "horizontal":
          chain.setHorizontalRule().run();
          break;
        case "pageBreak":
          chain.setPageBreak().run();
          break;
        case "undo":
          chain.undo().run();
          break;
        case "redo":
          chain.redo().run();
          break;
        case "insertTable":
          chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          break;
        case "addRowBefore":
          chain.addRowBefore().run();
          break;
        case "addRowAfter":
          chain.addRowAfter().run();
          break;
        case "deleteRow":
          chain.deleteRow().run();
          break;
        case "addColumnBefore":
          chain.addColumnBefore().run();
          break;
        case "addColumnAfter":
          chain.addColumnAfter().run();
          break;
        case "deleteColumn":
          chain.deleteColumn().run();
          break;
        case "toggleHeaderRow":
          chain.toggleHeaderRow().run();
          break;
        case "toggleHeaderColumn":
          chain.toggleHeaderColumn().run();
          break;
        case "mergeCells":
          chain.mergeCells().run();
          break;
        case "splitCell":
          chain.splitCell().run();
          break;
        case "deleteTable":
          chain.deleteTable().run();
          break;
        case "addComment": {
          const editor = store.editor!;
          const { from, to } = editor.state.selection;
          if (from === to) break;
          const commentId = crypto.randomUUID();
          const body = store.commentText.trim() || "New comment";
          const anchor = editor.state.doc.textBetween(from, to);
          const folioId = store.activeFolioId || "";
          chain
            .setMark("commentMark", {
              commentId,
              author: "You",
              color: "var(--color-mustard)",
            })
            .run();

          // Persist the body locally + push to Convex. Fire-and-forget
          // so the sync doesn't block the mark from being set.
          void persistNewComment(commentId, body, anchor, folioId);

          // Open the popover immediately so the writer can keep typing
          // replies or strike the note.
          const sel = window.getSelection();
          const markEl = sel?.anchorNode?.parentElement?.closest(
            ".twyne-comment-mark",
          ) as HTMLElement | null;
          if (markEl) {
            void openUserCommentPopover(commentId, markEl);
          }

          store.commentText = "";
          store.showCommentInput = false;
          break;
        }
        case "insertNote": {
          const noteText = store.noteText.trim();
          if (noteText) {
            if (store.noteInputKind === "footnote") {
              chain.setFootnote({ text: noteText }).run();
            } else {
              chain.setEndnote({ text: noteText }).run();
            }
            store.editor?.chain().insertContent(" ").run();
          }
          store.noteText = "";
          store.noteInputKind = null;
          break;
        }

        case "insertMermaid": {
          if (store.mermaidSource.trim()) {
            chain
              .setMermaidDiagram({ source: store.mermaidSource.trim() })
              .run();
            store.mermaidSource = "";
            store.showMermaidInput = false;
          }
          break;
        }
      }
    });

    const handleTableToolbarIntent = $((intent: TableToolbarIntent) => {
      const editor = store.editor;
      if (!editor) return;
      runTableToolbarIntent(editor, intent, store.tableToolbar.anchor?.width);
    });

    const handleCellFormatIntent = $((intent: TableCellFormatIntent) => {
      const editor = store.editor;
      if (!editor) return;
      runTableCellFormatIntent(editor, intent);
    });

    const insertTableDimensions = $(
      (rows: number, columns: number, withHeaderRow: boolean) => {
        store.editor
          ?.chain()
          .focus()
          .insertTable({ rows, cols: columns, withHeaderRow })
          .run();
        store.showTableInsertion = false;
      },
    );

    const runRegistryCommand = $(async (commandId: EditorCommandId) => {
      const alias = REGISTRY_COMMAND_ALIASES[commandId];
      if (alias) {
        await runCommand(alias);
        return;
      }

      const editor = store.editor;
      switch (commandId) {
        case "insert.image":
          store.showImageInput = true;
          break;
        case "insert.table":
          store.showTableInsertion = true;
          break;
        case "insert.mermaid":
          store.showMermaidInput = true;
          break;
        case "insert.math-inline":
          editor?.chain().focus().setInlineMath({ source: "" }).run();
          break;
        case "insert.math-block":
          editor?.chain().focus().setBlockMath({ source: "" }).run();
          break;
        case "insert.endnote":
          store.noteInputKind = "endnote";
          store.noteText = "";
          break;
        case "insert.footnote":
          store.noteInputKind = "footnote";
          store.noteText = "";
          break;
        case "review.comment":
          store.showCommentInput = true;
          break;
        case "review.read-aloud":
          await readAloud();
          break;
        case "navigate.find":
        case "navigate.replace":
          store.showFindReplace = true;
          break;
        case "navigate.outline":
          store.showOutline = true;
          break;
        case "view.shortcuts":
          store.showShortcutDialog = true;
          break;
        case "view.zen":
          store.zenMode = !store.zenMode;
          window.dispatchEvent(
            new CustomEvent("twyne:zen-mode", {
              detail: { on: store.zenMode },
            }),
          );
          break;
        default:
          break;
      }
    });

    const selectSlashCommand = $(async (commandId: EditorCommandId) => {
      const editor = store.editor;
      if (!editor) return;
      editor.commands.removeSlashCommandQuery();
      await runRegistryCommand(commandId);
      editor.commands.focus();
      store.slashOpen = false;
    });

    return (
      <div class="flex flex-1 flex-col min-h-0">
        {readOnly && (
          <div
            class="border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-4 py-2 text-xs text-[var(--color-ink-light)]"
            role="status"
          >
            Commenter access. You can read and discuss this folio, but only its
            owner and editors can change the manuscript.
          </div>
        )}
        {/* Sticky chrome stack: toolbar plus whichever inline input bar is
            active (image, note, comment, mermaid). All live in one sticky
            wrapper so the active bar always sits flush under the toolbar
            rather than scrolling out of view as the manuscript scrolls. */}
        <div class="sticky top-0" style={{ zIndex: "var(--z-sticky)" }}>
          <CompositorPanel
            store={store}
            onCommand$={runCommand}
            onHighlight$={applyHighlight}
            onTextColor$={applyTextColor}
            onFontFamily$={applyFontFamily}
            onFontSize$={applyFontSize}
            onLineHeight$={applyLineHeight}
            onSpaceBefore$={applySpaceBefore}
            onSpaceAfter$={applySpaceAfter}
            onKeepWithNext$={applyKeepWithNext}
            onTextCase$={applyTextCase}
            onReadAloud$={readAloud}
            onLayoutChange$={emitLayout}
            onChromeTextChange$={updateChromeText}
            onSavePdf$={saveAsPdf}
          />
          {store.showFindReplace && (
            <div
              class="fixed right-4 top-16"
              style={{ zIndex: "var(--z-dropdown)" }}
            >
              <FindReplacePanel
                editor={store.editor ? noSerialize(store.editor) : null}
                onClose$={() => {
                  store.showFindReplace = false;
                }}
              />
            </div>
          )}

          {store.showGrammar && (
            <GrammarPanel
              editor={store.editor ? noSerialize(store.editor) : null}
              readOnly={readOnly}
              onClose$={() => {
                store.showGrammar = false;
              }}
            />
          )}

          {store.showOutline && (
            <aside
              class="fixed bottom-16 left-4 top-20 w-72 overflow-hidden border border-[var(--color-paper-3)] bg-[var(--color-paper)] p-3 shadow-lg"
              style={{ zIndex: "var(--z-dropdown)" }}
              aria-label="Document outline panel"
            >
              <div class="mb-2 flex items-center justify-between gap-3">
                <p class="dept-label">Document outline</p>
                <button
                  type="button"
                  class="tool-btn"
                  aria-label="Close document outline"
                  onClick$={() => {
                    store.showOutline = false;
                  }}
                >
                  ×
                </button>
              </div>
              <DocumentOutline
                outline={store.outline}
                editor={store.editor ? noSerialize(store.editor) : undefined}
              />
            </aside>
          )}

          <ShortcutDialog
            open={store.showShortcutDialog}
            onClose$={() => {
              store.showShortcutDialog = false;
            }}
          />

          <InsertPanels
            noteKind={store.noteInputKind}
            mermaidOpen={store.showMermaidInput}
            imageOpen={store.showImageInput}
            imageUrl={store.imageUrl}
            imageUploadAvailable={!!store.imageUploadAdapter}
            imageUploadError={store.imageUploadError}
            commentOpen={store.showCommentInput}
            commentText={store.commentText}
            onCancelNote$={() => {
              store.noteInputKind = null;
              store.noteText = "";
            }}
            onConfirmNote$={async (value) => {
              store.noteText = value.trim();
              if (!store.noteText) {
                store.noteInputKind = null;
                return;
              }
              await runCommand("insertNote");
            }}
            onCancelMermaid$={() => {
              store.showMermaidInput = false;
              store.mermaidSource = "";
            }}
            onConfirmMermaid$={async (value) => {
              store.mermaidSource = value.trim();
              if (!store.mermaidSource) {
                store.showMermaidInput = false;
                return;
              }
              await runCommand("insertMermaid");
            }}
            onChooseImage$={chooseImageFiles}
            onImageUrlChange$={(value) => {
              store.imageUrl = value;
            }}
            onInsertImage$={(url) => {
              if (url) insertImage(url);
              store.showImageInput = false;
              store.imageUrl = "";
            }}
            onCancelImage$={() => {
              store.showImageInput = false;
              store.imageUrl = "";
            }}
            onCommentChange$={(value) => {
              store.commentText = value;
            }}
            onAddComment$={() => {
              if (store.commentText.trim()) runCommand("addComment");
            }}
            onCancelComment$={() => {
              store.showCommentInput = false;
              store.commentText = "";
            }}
          />
          <SlashCommandMenu
            open={store.slashOpen}
            query={store.slashQuery}
            left={store.slashLeft}
            top={store.slashTop}
            context={{
              hasSelection: store.hasSelection,
              inTable: !!store.active.isInTable,
              canMergeCells: !!store.active.canMergeCells,
              canSplitCell: !!store.active.canSplitCell,
              canUndo: store.canUndo,
              canRedo: store.canRedo,
              hasDocument: true,
              paginationActive: store.paginationActive,
            }}
            onSelect$={selectSlashCommand}
            onClose$={() => {
              store.editor?.commands.closeSlashCommand();
              store.slashOpen = false;
            }}
          />

          {store.showTableInsertion && (
            <div
              class="fixed left-1/2 top-16 -translate-x-1/2"
              style={{ zIndex: "var(--z-dropdown)" }}
            >
              <TableInsertionGrid
                onInsert$={insertTableDimensions}
                onCancel$={() => {
                  store.showTableInsertion = false;
                }}
              />
            </div>
          )}

          <FloatingTableToolbar
            snapshot={store.tableToolbar}
            onIntent$={handleTableToolbarIntent}
          />
          {store.tableToolbar.visible &&
            store.tableToolbar.position &&
            store.tableToolbar.position.cellRowTop != null &&
            store.cellFormat.cellCount > 0 && (
              <div
                data-table-cell-format-panel
                class="fixed overflow-x-auto border border-[var(--color-paper-3)] bg-[var(--color-paper)] p-2 shadow-lg"
                style={{
                  left: `${store.tableToolbar.position.left}px`,
                  top: `${store.tableToolbar.position.cellRowTop}px`,
                  width: `${store.tableToolbar.position.width}px`,
                  zIndex: "var(--z-dropdown)",
                }}
              >
                <TableCellFormatControls
                  format={store.cellFormat}
                  onIntent$={handleCellFormatIntent}
                />
              </div>
            )}

          {store.selectedImage && (
            <div
              class="fixed right-4 top-24 w-72 shadow-lg"
              style={{ zIndex: "var(--z-dropdown)" }}
            >
              <ImageInspector
                attributes={store.selectedImage}
                onPatch$={patchSelectedImage}
                onChooseFiles$={chooseImageFiles}
                onRetry$={retrySelectedImage}
                onRemove$={removeSelectedImage}
              />
            </div>
          )}
        </div>
        <ManuscriptPanel
          store={store}
          pageWidthRem={pageWidthRem()}
          canvasMinHeight={canvasMinHeight()}
          pageChromeGeometry={pageChromeGeometry()}
          onDragOver$={handleDragOver}
          onDragLeave$={handleDragLeave}
          onDrop$={handleDrop}
          onLayoutChange$={emitLayout}
          onHeaderCommit$={(value) => updateChromeText("header", value)}
          onFooterCommit$={(value) => updateChromeText("footer", value)}
          onJumpToNote$={jumpToNote}
        />

        <PersonaNotePanel
          note={store.notePopover}
          onPin$={(noteId) => {
            const note = store.notePopover;
            if (note?.id === noteId && !note.pinned) {
              store.notePopover = { ...note, pinned: true };
            }
          }}
          onClose$={() => {
            store.notePopover = null;
          }}
          onDraftChange$={(draft) => {
            const note = store.notePopover;
            if (note) store.notePopover = { ...note, draft };
          }}
          onReply$={(noteId, text, author) => {
            window.dispatchEvent(
              new CustomEvent("twyne:persona-reply", {
                detail: { noteId, text, author },
              }),
            );
            const note = store.notePopover;
            if (note?.id === noteId) {
              store.notePopover = { ...note, draft: "", error: null };
            }
          }}
          onStrike$={(noteId) => {
            dismissNote(noteId);
            if (store.notePopover?.id === noteId) {
              store.notePopover = null;
            }
          }}
        />
        <SuggestionPanel
          suggestion={store.suggestionPopover}
          stampVisible={store.stampVisible}
          onClose$={() => {
            store.suggestionPopover = null;
          }}
          onStrike$={strikeSuggestion}
          onAccept$={acceptSuggestion}
        />

        <UserCommentPanel
          comment={store.userCommentPopover}
          onClose$={closeUserCommentPopover}
          onDraftChange$={(draft) => {
            if (!store.userCommentPopover) return;
            store.userCommentPopover = {
              ...store.userCommentPopover,
              draft,
            };
          }}
          onSubmit$={submitUserCommentReply}
          onToggleResolved$={toggleResolveUserComment}
          onDelete$={deleteUserCommentLocal}
        />
      </div>
    );
  },
);

/* ── Persona note helpers ─────────────────────────────────────── */

/**
 * Locate `quote` inside a single text block of the document and return its
 * absolute position range. Quotes never span blocks (they are sentences),
 * so the search resets per block.
 */

function findTextRange(
  doc: any,
  quote: string,
): { from: number; to: number } | null {
  // Whitespace-tolerant: the quote may come from tag-stripped HTML where
  // inline markup left extra spaces behind.
  const escaped = quote
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  if (!escaped) return null;
  const pattern = new RegExp(escaped);

  let found: { from: number; to: number } | null = null;
  doc.descendants((node: any, pos: number) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    let text = "";
    const positions: number[] = [];
    node.forEach((child: any, offset: number) => {
      if (!child.isText || !child.text) return;
      for (let i = 0; i < child.text.length; i++) {
        positions.push(pos + 1 + offset + i);
      }
      text += child.text;
    });
    const match = pattern.exec(text);
    if (match) {
      found = {
        from: positions[match.index],
        to: positions[match.index + match[0].length - 1] + 1,
      };
    }
    return false;
  });
  return found;
}

function flashMarkedElement(root: HTMLElement, selector: string): void {
  const element = root.querySelector(selector) as HTMLElement | null;
  if (!element) return;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  element.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "center",
  });
  element.classList.add("is-flashing");
  setTimeout(() => element.classList.remove("is-flashing"), 1600);
}

function removeEditorMark(
  editor: Editor,
  markName: "personaNote" | "suggestion",
  id: string | null,
): void {
  const { state, view } = editor;
  const type = state.schema.marks[markName];
  if (!type) return;
  const transaction = state.tr;
  state.doc.descendants((node: any, pos: number) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type === type && (id === null || mark.attrs.id === id)) {
        transaction.removeMark(pos, pos + node.nodeSize, type);
      }
    }
    return true;
  });
  if (transaction.docChanged) view.dispatch(transaction);
}

function removePersonaNote(editor: Editor, id: string | null): void {
  removeEditorMark(editor, "personaNote", id);
}

function removeAllPersonaNotes(editor: Editor): void {
  removePersonaNote(editor, null);
}

/** Find the absolute range of the suggestion mark with `id`, if present. */
function findSuggestionRange(
  editor: Editor,
  id: string,
): { from: number; to: number } | null {
  const type = editor.state.schema.marks.suggestion;
  if (!type) return null;
  let from: number | null = null;
  let to: number | null = null;
  editor.state.doc.descendants((node: any, pos: number) => {
    if (!node.isText) return true;
    if (node.marks.some((m: any) => m.type === type && m.attrs.id === id)) {
      from = from === null ? pos : Math.min(from, pos);
      to =
        to === null ? pos + node.nodeSize : Math.max(to, pos + node.nodeSize);
    }
    return true;
  });
  return from === null || to === null ? null : { from, to };
}

function removeSuggestionMark(editor: Editor, id: string | null): void {
  removeEditorMark(editor, "suggestion", id);
}

function removeAllSuggestions(editor: Editor): void {
  removeSuggestionMark(editor, null);
}
