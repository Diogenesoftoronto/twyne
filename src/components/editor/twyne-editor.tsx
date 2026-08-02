import {
  component$,
  useStore,
  useStyles$,
  useVisibleTask$,
  noSerialize,
  $,
  type NoSerialize,
} from "@builder.io/qwik";
import ImgApprovalStamp from "../../media/approval-stamp.svg?jsx";
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
  DocumentMeta,
  Folio,
  LayoutSettings,
  PersonaNotePayload,
  PersonaReply,
} from "../../types";
import {
  DEFAULT_LAYOUT,
  DOC_WIDTH_REM,
  MARGIN_RANGE,
  resolveMargins,
  resolvePageSetup,
} from "../../types";
import { PageRuler } from "./page-ruler";
import { PageChrome } from "./page-chrome";
import { computePageGeometry } from "./pagination-geometry";
import { pxToRem, rootFontSize } from "../../utils/css-units";
import { exportPdf } from "../../utils/exchange";
import { buildFolioExportPayload } from "../../utils/folio-export";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import { detectCitations } from "../../utils/citations";
import { useConvexClient } from "../../utils/convex-context";
import { useAuth } from "../../utils/auth-context";
import { SpeakButton } from "../ui/speak-button";
import { SpeechTransport } from "../ui/speech-transport";
import { ColorPicker } from "../ui/color-picker";
import {
  FONT_CHOICES,
  FONT_SIZES,
  LINE_SPACINGS,
  PARAGRAPH_SPACINGS,
  recaseTextSegments,
  type TextCase,
} from "../../utils/typography-options";
import { speak } from "../../utils/speech";

/**
 * The reading the toolbar owns. Stable rather than derived from the
 * selection, so the transport can find the reading it started.
 */
const MANUSCRIPT_READING_ID = "manuscript";
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
import {
  computeDocumentMeta,
  formatWordCount,
  readingTimeLabel,
} from "../../utils/document";
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
import { ShortcutDialog } from "./shortcut-dialog";
import { TextModal } from "../ui/text-modal";
import { EDITOR_KEYBINDINGS, chordMatches } from "../../utils/keybindings";
import { DocumentOutline } from "./document-outline";
import {
  buildDocumentOutline,
  type DocumentOutlineModel,
} from "../../utils/document-outline";
import { RemoteCursors } from "./extensions/remote-cursors";
import { type RemoteCursor } from "./extensions/remote-cursors";
import { Indent } from "./extensions/indent";
import { MarkAnchorWidgets } from "./extensions/mark-anchor-widgets";
import { PageBreakNode } from "./extensions/page-break-node";
import { Pagination, type PaginationInfo } from "./extensions/pagination";
import { ParagraphFormat } from "./extensions/paragraph-format";
import { SyncDot, LastSavedLine } from "./sync-indicator";
import {
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
import { renderMarkdown } from "../../utils/markdown";
import { computePopoverGeometry } from "./popover-positioning";
import {
  EMPTY_TABLE_TOOLBAR_SNAPSHOT,
  FloatingTableToolbar,
  TableInsertionGrid,
  createTableCoreExtensions,
  createTableToolbarController,
  runTableToolbarIntent,
  type TableToolbarIntent,
  type TableToolbarSnapshot,
} from "./table-core";
import {
  TableCellFormat,
  getSelectedCellFormat,
  runTableCellFormatIntent,
  type SelectedCellFormat,
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

interface NotePopover {
  id: string;
  author: string;
  color: string;
  label: string;
  note: string;
  x: number;
  top: number | null;
  bottom: number | null;
  maxH: number;
  placement: "above" | "below";
  /** The passage the note is pinned to. */
  quote?: string;
  /** Brief title captured at convene time. */
  briefTitle?: string;
  /** Draft reply text. */
  draft: string;
  /** True when the writer has dismissed this note. */
  dismissed: boolean;
  /** True once the writer clicks the note: the card stays open on mouse-out. */
  pinned: boolean;
  /** Live reply thread (mirrored from the personas panel). */
  thread: PersonaReply[];
  /** True while the persona is generating a reply. */
  replying: boolean;
  /**
   * The reply as it is being written. Held apart from `thread` because it is
   * not a reply yet — it has no id, it is not persisted, and it is replaced
   * wholesale by the filed version the moment there is one.
   */
  streamingReply: string;
  /** Inline error to surface in the popover. */
  error: string | null;
}

/** Floating card for an editor's proposed rewrite (accept / strike). */
interface SuggestionPopover {
  id: string;
  versionId: string;
  author: string;
  color: string;
  /** The current (original) passage under the mark. */
  original: string;
  replacement: string;
  rationale: string;
  x: number;
  y: number;
  busy: boolean;
}

/** A note collected live from the document, in reading order, numbered per kind. */
export interface EditorNote {
  kind: NoteKind;
  number: number;
  text: string;
  pos: number;
}

export interface EditorStore {
  editor: Editor | null;
  content: string;
  meta: DocumentMeta;
  isDragOver: boolean;
  isAnalysisRunning: boolean;
  active: Record<string, boolean>;
  showImageInput: boolean;
  imageUrl: string;
  imageUploadAdapter: NoSerialize<ImageUploadAdapter> | null;
  selectedImage: ImageNodeAttributes | null;
  imageUploadError: string | null;
  showCommentInput: boolean;
  commentText: string;
  showMermaidInput: boolean;
  mermaidSource: string;
  /** Which note input row is open, if any. */
  noteInputKind: "endnote" | "footnote" | null;
  noteText: string;
  /** Endnotes/footnotes collected live from the doc, for the bottom-of-manuscript notes panel. */
  notes: EditorNote[];
  hasSelection: boolean;
  notePopover: NotePopover | null;
  suggestionPopover: SuggestionPopover | null;
  /** Approval stamp animation — set briefly when an edit is accepted. */
  stampVisible: boolean;
  /** Epoch ms of the most recent successful Lix mirror, drives the colophon's "saved Xs ago" line. */
  lastSavedAt: number | null;
  /** Floating margin card for the writer's own inline comments. */
  userCommentPopover: UserCommentPopover | null;
  /** Undo/redo availability — refreshed on every transaction. */
  canUndo: boolean;
  canRedo: boolean;
  /** Echoed from the parent route so the editor can scope user comments. */
  activeFolioId: string;
  /** Live document-chrome settings (one control drives editor + export + print). */
  layout: LayoutSettings;
  /** Editable running header. */
  headerText: string;
  /** Editable running footer. */
  footerText: string;
  /** Show the layout popover? */
  showLayout: boolean;
  /** A PDF print job is being prepared. */
  exportingPdf: boolean;
  /** Coordinator-owned navigation and help surfaces. */
  showFindReplace: boolean;
  showShortcutDialog: boolean;
  showOutline: boolean;
  outline: DocumentOutlineModel;
  showTableInsertion: boolean;
  tableToolbar: TableToolbarSnapshot;
  cellFormat: SelectedCellFormat;
  slashOpen: boolean;
  slashQuery: string;
  slashLeft: number;
  slashTop: number;
  /** Distraction-free mode: dims inline notes/comments and asks the route to collapse side panels. */
  zenMode: boolean;
  /** Which formatting popover is open, if any. Only one at a time. */
  openPicker: "highlight" | "textColor" | "type" | "spacing" | null;
  /** Applied text colour at the cursor, as a hex literal. */
  currentColor: string | null;
  /** Applied highlight colour at the cursor. */
  currentHighlight: string | null;
  currentFontFamily: string | null;
  currentFontSize: string | null;
  currentLineHeight: string | null;
  currentSpaceBefore: number | null;
  currentSpaceAfter: number | null;
  currentKeepWithNext: boolean;
  /** Sheets the manuscript currently occupies, reported by the pagination engine. */
  pageCount: number;
  /**
   * False when the engine fell back to a continuous column — either because
   * the writer asked for it, or because the document is past the size at
   * which painting page frames is worth doing.
   */
  paginationActive: boolean;
}

/** The popover for a writer-authored inline comment, anchored to its mark. */
interface UserCommentPopover {
  id: string;
  author: string;
  text: string;
  createdAt: number;
  x: number;
  y: number;
  resolved: boolean;
  replies: UserCommentReply[];
  draft: string;
}

interface TwyneEditorProps {
  initialContent?: string;
  /** The folio this draft belongs to. Used to scope user comments. */
  activeFolioId?: string;
  /** The full active folio — carries the layout, header, and footer. */
  activeFolio?: Folio | null;
  /** The current project brief — used to derive running-header metadata. */
  brief?: import("../../types").ProjectBrief | null;
  /** When set, the editor joins a multiplayer session (presence + remote cursors + sync). */
  sharedLixId?: string;
}

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
  }: TwyneEditorProps) => {
    const clientSig = useConvexClient();
    const auth = useAuth();
    const store = useStore<EditorStore>({
      editor: null,
      content: "",
      meta: {
        title: "Untitled",
        wordCount: 0,
        characterCount: 0,
        readingTime: 1,
        lastEdited: Date.now(),
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
      exportingPdf: false,
      showFindReplace: false,
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
        // Debounced mirror of the manuscript into Lix key_value blocks, so
        // editor branches (proposed edits) have real content to fork from.
        let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
        const mirrorDraft = (html: string) => {
          if (mirrorTimer) clearTimeout(mirrorTimer);
          mirrorTimer = setTimeout(() => {
            void syncDraftToLix(store.activeFolioId, html).then(() => {
              // Stamp the "Saved Xs ago" line. The mirror only
              // writes when there's actual content; we treat
              // that as the source of truth for "your changes
              // are on disk locally".
              store.lastSavedAt = Date.now();
            });
          }, 1200);
        };

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
            const text = e.getText();
            const html = e.getHTML();
            store.content = html;
            store.meta = computeDocumentMeta(text);
            mirrorDraft(html);
            reconcileCommentsDebounced(html);

            const citations = detectCitations(text);
            if (citations.length > 0) {
              window.dispatchEvent(
                new CustomEvent("twyne:citations", { detail: citations }),
              );
            }

            window.dispatchEvent(
              new CustomEvent("twyne:content", { detail: html }),
            );
          },
        });

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
        editor.on("selectionUpdate", refreshActive);
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
        editor.on("update", refreshNotes);
        refreshNotes();

        const refreshOutline = () => {
          store.outline = buildDocumentOutline(editor.state.doc);
        };
        editor.on("transaction", refreshOutline);
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
        store.meta = computeDocumentMeta(editor.getText());

        // ── Mermaid rendering ──
        mermaid.initialize({ startOnLoad: false, theme: "base" });
        const renderMermaid = () => {
          requestAnimationFrame(() => {
            mermaid
              .run({ querySelector: ".twyne-mermaid-diagram" })
              .catch(() => {
                // Mermaid syntax errors are benign; leave the source visible.
              });
          });
        };
        renderMermaid();
        editor.on("update", renderMermaid);

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
          (snapshot) => {
            store.tableToolbar = snapshot;
            store.cellFormat = getSelectedCellFormat(editor);
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
          store.meta = computeDocumentMeta(editor.getText());
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

        // ── Drop a citation at the cursor as an endnote marker ──
        const onInsertText = (e: Event) => {
          const text = (e as CustomEvent).detail as string;
          if (!text) return;
          editor.chain().focus().setEndnote({ text }).insertContent(" ").run();
        };
        window.addEventListener("twyne:insert-text", onInsertText);

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
          const span = el.querySelector(
            `[data-persona-note-id="${CSS.escape(id)}"]`,
          ) as HTMLElement | null;
          if (!span) return;
          const reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          span.scrollIntoView({
            behavior: reduceMotion ? "auto" : "smooth",
            block: "center",
          });
          span.classList.add("is-flashing");
          setTimeout(() => span.classList.remove("is-flashing"), 1600);
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
          const span = el.querySelector(
            `[data-suggestion-id="${CSS.escape(id)}"]`,
          ) as HTMLElement | null;
          if (!span) return;
          const reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          span.scrollIntoView({
            behavior: reduceMotion ? "auto" : "smooth",
            block: "center",
          });
          span.classList.add("is-flashing");
          setTimeout(() => span.classList.remove("is-flashing"), 1600);
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
      const text =
        from !== to
          ? editor.state.doc.textBetween(from, to, "\n\n")
          : editor.getText();
      if (!text.trim()) return;
      await speak({
        id: MANUSCRIPT_READING_ID,
        text,
        client: clientSig.value ?? null,
        signedIn: Boolean(auth.value.user),
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

    /* Editorial toolbar — typewriter labels, paper buttons */
    const Sep = () => (
      <span
        class="w-px h-5 bg-[var(--color-paper-3)] mx-1"
        aria-hidden="true"
      />
    );

    /* Folios: roughly 250 words per manuscript page, the old standard */
    const folios = (store.meta.wordCount / 250).toFixed(2);

    return (
      <div class="flex flex-1 flex-col min-h-0">
        {/* Sticky chrome stack: toolbar plus whichever inline input bar is
            active (image, note, comment, mermaid). All live in one sticky
            wrapper so the active bar always sits flush under the toolbar
            rather than scrolling out of view as the manuscript scrolls. */}
        <div
          class="sticky top-0"
          style={{ zIndex: "var(--z-sticky)" }}
        >
        {/* ── Toolbar (compositor's stick) ───────────────── */}
        <div
          class="twyne-toolbar flex items-center gap-1 px-4 py-1.5 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] flex-wrap"
          style="font-family: var(--font-typewriter);"
          role="toolbar"
          aria-label="Formatting"
        >
          <span class="dept-label mr-2 hidden md:inline">Compositor</span>

          <div class="flex items-center">
            <button
              title="Bold (⌘B)"
              aria-label="Bold"
              aria-pressed={!!store.active.bold}
              onClick$={() => runCommand("bold")}
              class="tool-btn"
            >
              <b style="font-family: var(--font-display);">B</b>
            </button>
            <button
              title="Italic (⌘I)"
              aria-label="Italic"
              aria-pressed={!!store.active.italic}
              onClick$={() => runCommand("italic")}
              class="tool-btn"
            >
              <i style="font-family: var(--font-display);">I</i>
            </button>
            <button
              title="Underline (⌘U)"
              aria-label="Underline"
              aria-pressed={!!store.active.underline}
              onClick$={() => runCommand("underline")}
              class="tool-btn"
            >
              <u style="font-family: var(--font-display);">U</u>
            </button>
            <button
              title="Strikethrough"
              aria-label="Strikethrough"
              aria-pressed={!!store.active.strike}
              onClick$={() => runCommand("strike")}
              class="tool-btn"
            >
              <s style="font-family: var(--font-display);">S</s>
            </button>
            <button
              title="Superscript"
              aria-label="Superscript"
              aria-pressed={!!store.active.superscript}
              onClick$={() => runCommand("superscript")}
              class="tool-btn"
            >
              <span style="font-family: var(--font-display);">
                x<sup>2</sup>
              </span>
            </button>
            <button
              title="Subscript"
              aria-label="Subscript"
              aria-pressed={!!store.active.subscript}
              onClick$={() => runCommand("subscript")}
              class="tool-btn"
            >
              <span style="font-family: var(--font-display);">
                x<sub>2</sub>
              </span>
            </button>

            {/* Highlight: a toggle for the last colour used, plus a caret to
                change it. Splitting the two is what makes multicolor usable —
                Highlight has been configured `multicolor: true` since the
                editor was written, and the toolbar only ever called the bare
                toggle, so the capability shipped unreachable. */}
            <div class="flex items-center relative">
              <button
                title="Highlight"
                aria-label="Highlight"
                aria-pressed={!!store.active.highlight}
                onClick$={() =>
                  store.active.highlight
                    ? applyHighlight(null)
                    : applyHighlight(store.currentHighlight ?? "#fbeaa8")
                }
                class="tool-btn"
              >
                <span
                  style={{
                    background: `linear-gradient(transparent 60%, ${store.currentHighlight ?? "#fbeaa8"} 60%)`,
                  }}
                >
                  Hi
                </span>
              </button>
              <button
                title="Highlight colour"
                aria-label="Choose highlight colour"
                aria-expanded={store.openPicker === "highlight"}
                onClick$={() => {
                  store.openPicker =
                    store.openPicker === "highlight" ? null : "highlight";
                }}
                class="tool-btn px-1"
              >
                ▾
              </button>
              {store.openPicker === "highlight" && (
                <ColorPicker
                  kind="highlight"
                  title="Highlight"
                  value={store.currentHighlight}
                  clearLabel="No highlight"
                  onPick$={(hex) => applyHighlight(hex)}
                  onClear$={() => applyHighlight(null)}
                  onClose$={() => {
                    store.openPicker = null;
                  }}
                />
              )}
            </div>

            {/* Text colour, from the darker palette — every entry clears
                WCAG AA against the manuscript's paper. */}
            <div class="flex items-center relative">
              <button
                title="Text colour"
                aria-label="Text colour"
                aria-expanded={store.openPicker === "textColor"}
                onClick$={() => {
                  store.openPicker =
                    store.openPicker === "textColor" ? null : "textColor";
                }}
                class="tool-btn"
              >
                <span
                  style={{
                    color: store.currentColor ?? "var(--color-ink)",
                    fontFamily: "var(--font-display)",
                    borderBottom: `2px solid ${store.currentColor ?? "var(--color-ink)"}`,
                  }}
                >
                  A
                </span>
              </button>
              {store.openPicker === "textColor" && (
                <ColorPicker
                  kind="text"
                  title="Text colour"
                  value={store.currentColor}
                  clearLabel="Default ink"
                  onPick$={(hex) => applyTextColor(hex)}
                  onClear$={() => applyTextColor(null)}
                  onClose$={() => {
                    store.openPicker = null;
                  }}
                />
              )}
            </div>

            <button
              title="Clear formatting"
              aria-label="Clear formatting"
              onClick$={() => runCommand("clearFormatting")}
              class="tool-btn"
            >
              ⌫ fmt
            </button>
          </div>

          <Sep />

          {/* Type: family, size, line spacing, and case. One popover rather
              than five toolbar controls — this is the "open the dialog" end of
              formatting, not the every-sentence end. */}
          <div class="flex items-center relative">
            <button
              title="Type — font, size, spacing, case"
              aria-label="Type options"
              aria-expanded={store.openPicker === "type"}
              onClick$={() => {
                store.openPicker = store.openPicker === "type" ? null : "type";
              }}
              class="tool-btn"
            >
              Aa type
            </button>
            {store.openPicker === "type" && (
              <div
                data-type-popover
                class="absolute left-0 top-full mt-1 p-3 bg-[var(--color-paper)] border border-[var(--color-paper-3)] shadow-lg w-60"
                style={{
                  zIndex: "var(--z-dropdown)",
                  borderRadius: "2px",
                  fontFamily: "var(--font-typewriter)",
                }}
                role="dialog"
                aria-label="Type options"
              >
                <p class="dept-label mb-1.5">Family</p>
                <select
                  class="field-input mb-3 text-[0.7rem]"
                  value={store.currentFontFamily ?? ""}
                  onChange$={(_, el) =>
                    applyFontFamily(el.value === "" ? null : el.value)
                  }
                  aria-label="Font family"
                >
                  <option value="">Manuscript default</option>
                  {FONT_CHOICES.map((f) => (
                    <option key={f.id} value={f.stack}>
                      {f.label}
                    </option>
                  ))}
                </select>

                <p class="dept-label mb-1.5">Size</p>
                <select
                  class="field-input mb-3 text-[0.7rem]"
                  value={store.currentFontSize ?? ""}
                  onChange$={(_, el) =>
                    applyFontSize(el.value === "" ? null : el.value)
                  }
                  aria-label="Font size"
                >
                  <option value="">Default</option>
                  {FONT_SIZES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {`${s.label} pt`}
                    </option>
                  ))}
                </select>

                <p class="dept-label mb-1.5">Line spacing</p>
                <div class="flex items-center gap-1 mb-3">
                  {LINE_SPACINGS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick$={() => applyLineHeight(s.value)}
                      class={`flex-1 text-[0.62rem] py-1 border ${store.currentLineHeight === s.value ? "border-[var(--color-vermilion)] text-[var(--color-vermilion)]" : "border-[var(--color-paper-3)] text-[var(--color-ink-light)]"}`}
                      style="border-radius: 1px;"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <p class="dept-label mb-1.5">Paragraph spacing</p>
                <div class="grid grid-cols-2 gap-2 mb-3">
                  <label class="text-[0.62rem] text-[var(--color-ink-light)]">
                    <span class="block mb-1">Before</span>
                    <select
                      class="field-input text-[0.68rem]"
                      value={
                        store.currentSpaceBefore == null
                          ? ""
                          : String(store.currentSpaceBefore)
                      }
                      onChange$={(_, el) =>
                        applySpaceBefore(
                          el.value === "" ? null : Number(el.value),
                        )
                      }
                      aria-label="Space before paragraph"
                    >
                      <option value="">Default</option>
                      {PARAGRAPH_SPACINGS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="text-[0.62rem] text-[var(--color-ink-light)]">
                    <span class="block mb-1">After</span>
                    <select
                      class="field-input text-[0.68rem]"
                      value={
                        store.currentSpaceAfter == null
                          ? ""
                          : String(store.currentSpaceAfter)
                      }
                      onChange$={(_, el) =>
                        applySpaceAfter(
                          el.value === "" ? null : Number(el.value),
                        )
                      }
                      aria-label="Space after paragraph"
                    >
                      <option value="">Default</option>
                      {PARAGRAPH_SPACINGS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label class="flex items-center justify-between gap-3 mb-3 text-[0.68rem] text-[var(--color-ink-light)]">
                  <span>
                    Keep with next
                    {store.active.h1 || store.active.h2 || store.active.h3
                      ? " (heading default)"
                      : ""}
                  </span>
                  <input
                    type="checkbox"
                    checked={store.currentKeepWithNext}
                    disabled={
                      !!store.active.h1 ||
                      !!store.active.h2 ||
                      !!store.active.h3
                    }
                    onChange$={(_, el) => applyKeepWithNext(el.checked)}
                    aria-label="Keep paragraph with next"
                  />
                </label>

                <p class="dept-label mb-1.5">Case</p>
                <div class="flex items-center gap-1">
                  {(
                    [
                      ["upper", "AA"],
                      ["lower", "aa"],
                      ["title", "Aa"],
                      ["sentence", "A."],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={!store.hasSelection}
                      aria-label={`${mode} case`}
                      title={`${mode} case${store.hasSelection ? "" : " — select some text first"}`}
                      onClick$={() => applyTextCase(mode as TextCase)}
                      class="flex-1 text-[0.65rem] py-1 border border-[var(--color-paper-3)] text-[var(--color-ink-light)] disabled:opacity-30 disabled:cursor-not-allowed"
                      style="border-radius: 1px;"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Sep />

          <div class="flex items-center">
            <button
              title="Heading 1"
              aria-label="Heading 1"
              aria-pressed={!!store.active.h1}
              onClick$={() => runCommand("h1")}
              class="tool-btn"
              style="font-family: var(--font-display); font-weight: 600;"
            >
              H₁
            </button>
            <button
              title="Heading 2"
              aria-label="Heading 2"
              aria-pressed={!!store.active.h2}
              onClick$={() => runCommand("h2")}
              class="tool-btn"
              style="font-family: var(--font-display); font-weight: 600;"
            >
              H₂
            </button>
            <button
              title="Heading 3"
              aria-label="Heading 3"
              aria-pressed={!!store.active.h3}
              onClick$={() => runCommand("h3")}
              class="tool-btn"
              style="font-family: var(--font-display); font-weight: 600;"
            >
              H₃
            </button>
          </div>

          <Sep />

          <div class="flex items-center">
            <button
              title="Bullet list"
              aria-label="Bullet list"
              aria-pressed={!!store.active.bullet}
              onClick$={() => runCommand("bullet")}
              class="tool-btn"
            >
              ❦ list
            </button>
            <button
              title="Numbered list"
              aria-label="Numbered list"
              aria-pressed={!!store.active.ordered}
              onClick$={() => runCommand("ordered")}
              class="tool-btn"
            >
              I. list
            </button>
            <button
              title="Checklist"
              aria-label="Checklist"
              aria-pressed={!!store.active.taskList}
              onClick$={() => runCommand("taskList")}
              class="tool-btn"
            >
              ☑ list
            </button>
            <button
              title="Pull quote"
              aria-label="Pull quote"
              aria-pressed={!!store.active.blockquote}
              onClick$={() => runCommand("blockquote")}
              class="tool-btn"
            >
              ❝ pull
            </button>
            <button
              title="Code block"
              aria-label="Code block"
              aria-pressed={!!store.active.code}
              onClick$={() => runCommand("code")}
              class="tool-btn"
            >
              {"</>"}
            </button>
          </div>

          <Sep />

          <div class="flex items-center">
            <button
              title="Align left"
              aria-label="Align left"
              aria-pressed={!!store.active.left}
              onClick$={() => runCommand("left")}
              class="tool-btn"
            >
              ≡
            </button>
            <button
              title="Align center"
              aria-label="Align center"
              aria-pressed={!!store.active.center}
              onClick$={() => runCommand("center")}
              class="tool-btn"
            >
              ☰
            </button>
            <button
              title="Align right"
              aria-label="Align right"
              aria-pressed={!!store.active.right}
              onClick$={() => runCommand("right")}
              class="tool-btn"
            >
              ⌐
            </button>
            <button
              title="Justify"
              aria-label="Justify"
              aria-pressed={!!store.active.justify}
              onClick$={() => runCommand("justify")}
              class="tool-btn"
            >
              ▤
            </button>
          </div>

          <Sep />

          <div class="flex items-center">
            <button
              title="Insert plate (image)"
              aria-label="Insert image"
              onClick$={() => {
                store.showImageInput = true;
              }}
              class="tool-btn"
            >
              ▣ plate
            </button>
            <button
              title="Insert tabular (table)"
              aria-label="Insert table"
              aria-expanded={store.showTableInsertion}
              onClick$={() => {
                store.showTableInsertion = !store.showTableInsertion;
              }}
              class="tool-btn"
            >
              ▤ tab.
            </button>
            <button
              title="Insert diagram (Mermaid)"
              aria-label="Insert Mermaid diagram"
              onClick$={() => {
                store.showMermaidInput = true;
              }}
              class="tool-btn"
            >
              ⟢ mmd
            </button>
            <button
              title="Section break"
              aria-label="Section break"
              onClick$={() => runCommand("horizontal")}
              class="tool-btn"
            >
              ❦
            </button>
            <button
              title="Page break (Ctrl/Cmd + Enter)"
              aria-label="Insert page break"
              onClick$={() => runCommand("pageBreak")}
              class="tool-btn"
            >
              ⤓ page
            </button>
            <button
              title="Add comment"
              aria-label="Add comment"
              disabled={!store.hasSelection}
              onClick$={() => {
                store.showCommentInput = true;
              }}
              class="tool-btn disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ☍ comment
            </button>
            <SpeechTransport
              id={MANUSCRIPT_READING_ID}
              onPlay$={readAloud}
              playLabel="Read the selection aloud — or the whole draft when nothing is selected"
            />
            <button
              title="Insert endnote — collected under Notes on export"
              aria-label="Insert endnote"
              aria-pressed={store.noteInputKind === "endnote"}
              onClick$={() => {
                store.noteInputKind =
                  store.noteInputKind === "endnote" ? null : "endnote";
                store.noteText = "";
              }}
              class="tool-btn"
            >
              ¹ endnote
            </button>
            <button
              title="Insert footnote — collected under Footnotes on export"
              aria-label="Insert footnote"
              aria-pressed={store.noteInputKind === "footnote"}
              onClick$={() => {
                store.noteInputKind =
                  store.noteInputKind === "footnote" ? null : "footnote";
                store.noteText = "";
              }}
              class="tool-btn"
            >
              † footnote
            </button>
          </div>

          <div class="flex-1" />

          <div class="flex items-center">
            <button
              title="Undo (⌘Z)"
              aria-label="Undo"
              disabled={!store.canUndo}
              onClick$={() => runCommand("undo")}
              class="tool-btn disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ↶
            </button>
            <button
              title="Redo (⌘⇧Z)"
              aria-label="Redo"
              disabled={!store.canRedo}
              onClick$={() => runCommand("redo")}
              class="tool-btn disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ↷
            </button>
          </div>

          <Sep />

          {/* Sync dot — vermilion when offline, paper-3 while pending, accent-green when synced */}
          <div class="flex items-center" style="padding-left: 0.5rem;">
            <SyncDot />
          </div>

          {/* Zen mode — dims inline notes/comments and asks the route to
              collapse the side panels, for distraction-free writing. */}
          <button
            title={
              store.zenMode
                ? "Exit distraction-free writing"
                : "Distraction-free writing — hides notes, comments, and side panels"
            }
            aria-label="Toggle zen mode"
            aria-pressed={store.zenMode}
            onClick$={() => {
              store.zenMode = !store.zenMode;
              window.dispatchEvent(
                new CustomEvent("twyne:zen-mode", {
                  detail: { on: store.zenMode },
                }),
              );
            }}
            class="tool-btn"
          >
            {store.zenMode ? "◑ zen: on" : "◐ zen"}
          </button>

          <button
            title="Find and replace (⌘F / ⌘H)"
            aria-label="Find and replace"
            aria-pressed={store.showFindReplace}
            onClick$={() => {
              store.showFindReplace = !store.showFindReplace;
            }}
            class="tool-btn"
          >
            ⌕ find
          </button>
          <button
            title="Document outline (⌘⇧O)"
            aria-label="Document outline"
            aria-pressed={store.showOutline}
            onClick$={() => {
              store.showOutline = !store.showOutline;
            }}
            class="tool-btn"
          >
            ☷ outline
          </button>
          <button
            title="Keyboard shortcuts (⌘/)"
            aria-label="Keyboard shortcuts"
            onClick$={() => {
              store.showShortcutDialog = true;
            }}
            class="tool-btn"
          >
            ? keys
          </button>

          {/* Layout popover — one control for width, margin, running header, page numbers */}
          <div class="flex items-center relative">
            <button
              title="Page layout"
              aria-label="Page layout"
              aria-expanded={store.showLayout}
              onClick$={() => {
                store.showLayout = !store.showLayout;
              }}
              class="tool-btn"
            >
              ◫ layout
            </button>
            {store.showLayout && (
              <div
                data-layout-popover
                class="absolute right-0 top-full mt-1 z-50 w-64 p-3 bg-[var(--color-paper)] border border-[var(--color-paper-3)] shadow-lg"
                style="border-radius: 2px; font-family: var(--font-typewriter);"
                role="dialog"
                aria-label="Page layout"
              >
                <p class="dept-label mb-2">Paper</p>
                <div class="flex items-center gap-1 mb-2">
                  {(
                    [
                      ["letter", "Letter"],
                      ["a4", "A4"],
                      ["legal", "Legal"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      onClick$={() =>
                        emitLayout({ ...store.layout, paper: value })
                      }
                      class={`flex-1 text-[0.7rem] py-1 border ${resolvePageSetup(store.layout).paper === value ? "border-[var(--color-vermilion)] text-[var(--color-vermilion)]" : "border-[var(--color-paper-3)] text-[var(--color-ink-light)]"}`}
                      style="border-radius: 1px; text-transform: uppercase; letter-spacing: 0.1em;"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div class="flex items-center gap-1 mb-3">
                  {(
                    [
                      ["portrait", "Portrait"],
                      ["landscape", "Landscape"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      onClick$={() =>
                        emitLayout({ ...store.layout, orientation: value })
                      }
                      class={`flex-1 text-[0.7rem] py-1 border ${resolvePageSetup(store.layout).orientation === value ? "border-[var(--color-vermilion)] text-[var(--color-vermilion)]" : "border-[var(--color-paper-3)] text-[var(--color-ink-light)]"}`}
                      style="border-radius: 1px; text-transform: uppercase; letter-spacing: 0.1em;"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <p class="dept-label mb-2">Flow</p>
                <div class="flex items-center gap-1 mb-3">
                  {(
                    [
                      ["paginated", "Pages"],
                      ["continuous", "Scroll"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      onClick$={() =>
                        emitLayout({ ...store.layout, pagination: value })
                      }
                      class={`flex-1 text-[0.7rem] py-1 border ${resolvePageSetup(store.layout).pagination === value ? "border-[var(--color-vermilion)] text-[var(--color-vermilion)]" : "border-[var(--color-paper-3)] text-[var(--color-ink-light)]"}`}
                      style="border-radius: 1px; text-transform: uppercase; letter-spacing: 0.1em;"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* The column-width presets only mean anything without a
                    sheet. On a paginated canvas the paper decides the width
                    and the margins decide the column. */}
                {resolvePageSetup(store.layout).pagination === "continuous" && (
                  <>
                    <p class="dept-label mb-2">Column</p>
                    <div class="flex items-center gap-1 mb-3">
                      {(["narrow", "normal", "wide"] as const).map((w) => (
                        <button
                          key={w}
                          onClick$={() =>
                            emitLayout({ ...store.layout, width: w })
                          }
                          class={`flex-1 text-[0.7rem] py-1 border ${store.layout.width === w ? "border-[var(--color-vermilion)] text-[var(--color-vermilion)]" : "border-[var(--color-paper-3)] text-[var(--color-ink-light)]"}`}
                          style="border-radius: 1px; text-transform: uppercase; letter-spacing: 0.1em;"
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <p class="dept-label mb-2">Margins</p>
                {(
                  [
                    ["Left", "left", "marginLeft"],
                    ["Right", "right", "marginRight"],
                    ["Top", "top", "marginTop"],
                    ["Bottom", "bottom", "marginBottom"],
                  ] as const
                ).map(([label, rangeKey, field]) => {
                  const range = MARGIN_RANGE[rangeKey];
                  const value = resolveMargins(store.layout)[rangeKey];
                  return (
                    <label
                      key={field}
                      class="block mb-2.5 text-[0.7rem] text-[var(--color-ink-light)]"
                    >
                      <span class="flex items-center justify-between mb-1">
                        <span>{label}</span>
                        <span
                          class="tabular-nums text-[var(--color-ink-muted)]"
                          style="font-family: var(--font-typewriter);"
                        >
                          {value.toFixed(2)} rem
                        </span>
                      </span>
                      <input
                        type="range"
                        class="margin-slider"
                        min={range.min}
                        max={range.max}
                        step={range.step}
                        value={value}
                        onInput$={(e) =>
                          emitLayout({
                            ...store.layout,
                            [field]: Number(
                              (e.target as HTMLInputElement).value,
                            ),
                          })
                        }
                      />
                    </label>
                  );
                })}
                <label class="flex items-center justify-between text-[0.7rem] text-[var(--color-ink-light)] mb-1.5 cursor-pointer">
                  <span>Running header</span>
                  <input
                    type="checkbox"
                    checked={store.layout.runningHeader}
                    onChange$={(e) =>
                      emitLayout({
                        ...store.layout,
                        runningHeader: (e.target as HTMLInputElement).checked,
                      })
                    }
                  />
                </label>
                <div class="mb-3">
                  <label
                    class="block text-[0.63rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] mb-1"
                    for="layout-header-text"
                  >
                    Header line
                  </label>
                  <input
                    id="layout-header-text"
                    value={store.headerText}
                    placeholder="Optional running header"
                    class="field-input text-[0.78rem]"
                    style="font-family: var(--font-typewriter);"
                    onInput$={(e) =>
                      updateChromeText(
                        "header",
                        (e.target as HTMLInputElement).value,
                      )
                    }
                  />
                </div>
                <label class="flex items-center justify-between text-[0.7rem] text-[var(--color-ink-light)] cursor-pointer">
                  <span>Page numbers</span>
                  <input
                    type="checkbox"
                    checked={store.layout.pageNumbers}
                    onChange$={(e) =>
                      emitLayout({
                        ...store.layout,
                        pageNumbers: (e.target as HTMLInputElement).checked,
                      })
                    }
                  />
                </label>
                <label class="mt-1.5 flex items-center justify-between text-[0.7rem] text-[var(--color-ink-light)] cursor-pointer">
                  <span>Margin guides</span>
                  <input
                    type="checkbox"
                    checked={store.layout.showMarginGuides === true}
                    onChange$={(e) =>
                      emitLayout({
                        ...store.layout,
                        showMarginGuides: (e.target as HTMLInputElement)
                          .checked,
                      })
                    }
                  />
                </label>
                <div class="mt-3">
                  <label
                    class="block text-[0.63rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] mb-1"
                    for="layout-footer-text"
                  >
                    Footer line
                  </label>
                  <input
                    id="layout-footer-text"
                    value={store.footerText}
                    placeholder="Optional running footer"
                    class="field-input text-[0.78rem]"
                    style="font-family: var(--font-typewriter);"
                    onInput$={(e) =>
                      updateChromeText(
                        "footer",
                        (e.target as HTMLInputElement).value,
                      )
                    }
                  />
                </div>
                {/* Page setup and "print it" belong together — this is the
                    panel where the writer just decided what the page looks
                    like, so it is where they look to commit it to paper. */}
                <button
                  type="button"
                  onClick$={saveAsPdf}
                  disabled={store.exportingPdf}
                  class="btn-paper mt-3 w-full text-[0.7rem] disabled:opacity-40"
                >
                  {store.exportingPdf ? "Preparing…" : "Save as PDF…"}
                </button>
              </div>
            )}
          </div>
        </div>

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

        {/* Footnote / endnote modal — replaces the old single-line inline bar
            so the writer can hold a real sentence of gloss, with Cmd+Enter
            to commit. Visibility tracks `noteInputKind` so the existing
            toolbar toggle keeps working. */}
        <TextModal
          open={store.noteInputKind !== null}
          kicker={store.noteInputKind === "footnote" ? "Insert" : "Insert"}
          title={store.noteInputKind === "footnote" ? "Footnote" : "Endnote"}
          description={
            store.noteInputKind === "footnote"
              ? "Footnote text appears at the foot of the page on the same sheet as the marker — for asides the reader needs on the same page as the line that prompted them."
              : "Endnote text collects under Notes at the end of the manuscript — for sourcing, citations, and longer remarks."
          }
          inputLabel={
            store.noteInputKind === "footnote" ? "Footnote text" : "Endnote text"
          }
          placeholder={
            store.noteInputKind === "footnote"
              ? "e.g. See Smith 2019, p. 142, for the original formulation."
              : "e.g. The name 'Eleanor' surfaces across the archive in nine distinct hands."
          }
          helpText="Cmd/Ctrl + Enter to insert · Esc to cancel"
          rows={4}
          minHeightRem={8}
          submitLabel={
            store.noteInputKind === "footnote" ? "Insert footnote" : "Insert endnote"
          }
          onCancel$={() => {
            store.noteInputKind = null;
            store.noteText = "";
          }}
          onConfirm$={async (value) => {
            store.noteText = value.trim();
            if (!store.noteText) {
              store.noteInputKind = null;
              return;
            }
            await runCommand("insertNote");
          }}
        />

        {/* Mermaid modal — the inline bar couldn't hold a real diagram spec. */}
        <TextModal
          open={store.showMermaidInput}
          kicker="Insert"
          title="Mermaid diagram"
          description="Write a Mermaid diagram spec. It will render in-line where the cursor sits."
          inputLabel="Diagram source"
          placeholder="graph TD; A[Manuscript] --> B{Reviewed?}; B -->|Yes| C[Publish]; B -->|No| D[Revise]; D --> A"
          helpText="Cmd/Ctrl + Enter to insert · Esc to cancel. See mermaid.js.org for syntax."
          rows={8}
          minHeightRem={14}
          submitLabel="Insert diagram"
          onCancel$={() => {
            store.showMermaidInput = false;
            store.mermaidSource = "";
          }}
          onConfirm$={async (value) => {
            store.mermaidSource = value.trim();
            if (!store.mermaidSource) {
              store.showMermaidInput = false;
              return;
            }
            await runCommand("insertMermaid");
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
          store.cellFormat.cellCount > 0 && (
            <div
              class="fixed overflow-x-auto border border-[var(--color-paper-3)] bg-[var(--color-paper)] p-2 shadow-lg"
              style={{
                left: `${store.tableToolbar.position.left}px`,
                top: `${store.tableToolbar.position.top + 120}px`,
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

        {store.showImageInput && (
          <div
            class="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]"
            style="z-index: var(--z-sticky);"
          >
            <span
              class="text-xs text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter);"
            >
              Plate URL:
            </span>
            <button
              type="button"
              onClick$={chooseImageFiles}
              disabled={!store.imageUploadAdapter}
              class="tool-btn text-xs"
            >
              Choose file…
            </button>
            <span class="text-xs text-[var(--color-ink-muted)]">or</span>
            <input
              autoFocus
              value={store.imageUrl}
              onInput$={(e) => {
                store.imageUrl = (e.target as HTMLInputElement).value;
              }}
              onKeyDown$={(e) => {
                if (e.key === "Enter" && store.imageUrl.trim()) {
                  insertImage(store.imageUrl.trim());
                  store.showImageInput = false;
                  store.imageUrl = "";
                }
                if (e.key === "Escape") {
                  store.showImageInput = false;
                  store.imageUrl = "";
                }
              }}
              placeholder="https://…"
              class="flex-1 border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-vermilion)] focus:outline-none"
              style="font-family: var(--font-typewriter); border-radius: 2px;"
            />
            <button
              onClick$={() => {
                if (store.imageUrl.trim()) {
                  insertImage(store.imageUrl.trim());
                }
                store.showImageInput = false;
                store.imageUrl = "";
              }}
              class="tool-btn text-xs"
            >
              Insert
            </button>
            <button
              onClick$={() => {
                store.showImageInput = false;
                store.imageUrl = "";
              }}
              class="tool-btn text-xs"
            >
              Cancel
            </button>
            {store.imageUploadError && (
              <span role="alert" class="text-xs text-[var(--color-vermilion)]">
                {store.imageUploadError}
              </span>
            )}
          </div>
        )}

        {store.showCommentInput && (
          <div
            class="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]"
            style="z-index: var(--z-sticky);"
          >
            <span
              class="text-xs text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter);"
            >
              Comment:
            </span>
            <input
              autoFocus
              value={store.commentText}
              onInput$={(e) => {
                store.commentText = (e.target as HTMLInputElement).value;
              }}
              onKeyDown$={(e) => {
                if (e.key === "Enter" && store.commentText.trim()) {
                  runCommand("addComment");
                }
                if (e.key === "Escape") {
                  store.showCommentInput = false;
                  store.commentText = "";
                }
              }}
              placeholder="Type your editorial note…"
              class="flex-1 border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-vermilion)] focus:outline-none"
              style="font-family: var(--font-typewriter); border-radius: 2px;"
            />
            <button
              onClick$={() => {
                if (store.commentText.trim()) {
                  runCommand("addComment");
                }
              }}
              class="tool-btn text-xs"
            >
              Add
            </button>
            <button
              onClick$={() => {
                store.showCommentInput = false;
                store.commentText = "";
              }}
              class="tool-btn text-xs"
            >
              Cancel
            </button>
          </div>
        )}
        </div>

        {/* ── Editor area (the manuscript page) ──────────── */}
        <div
          class="flex-1 overflow-y-auto overflow-x-auto"
          style="background: var(--color-editor-bg);"
          preventdefault:dragover
          preventdefault:dragleave
          preventdefault:drop
          onDragOver$={handleDragOver}
          onDragLeave$={handleDragLeave}
          onDrop$={handleDrop}
        >
          {store.isDragOver && (
            <div class="drag-overlay">
              <span>Drop plate or tabular here</span>
            </div>
          )}
          {/* The ruler spans the page it describes, so its markers sit on the
              real margins rather than near them. */}
          <PageRuler
            layout={store.layout}
            pageWidthRem={pageWidthRem()}
            zen={store.zenMode}
            onChange$={emitLayout}
          />
          <div
            class={`mx-auto twyne-editor page-canvas relative ${store.layout.showMarginGuides ? "show-margin-guides" : ""} ${store.zenMode ? "zen-mode" : ""} ${store.paginationActive ? "is-paginated" : ""}`}
            style={{
              // A sheet is a physical size. Given only a max-width it would
              // shrink with the viewport, narrowing the column, making every
              // block taller, and silently changing how many pages the
              // manuscript is — a page count that moves when you drag the
              // window is not a page count. So the paginated canvas takes a
              // fixed width and the area around it scrolls, which is what
              // every word processor does.
              ...(store.paginationActive
                ? {
                    width: "var(--page-w)",
                    "flex-shrink": "0",
                    // The sheets are absolutely positioned, so they add no
                    // height of their own. Without this the last page — which
                    // is usually only part full — gets clipped where the prose
                    // happens to stop, and the paper ends mid-sheet.
                    "min-height": `${canvasMinHeight()}px`,
                  }
                : { "max-width": "var(--doc-width, 48rem)" }),
              "padding-left": "var(--doc-pad-left, 3rem)",
              "padding-right": "var(--doc-pad-right, 3rem)",
              "padding-top": "var(--doc-pad-y, 2.5rem)",
              "padding-bottom": "var(--doc-pad-bottom, 4rem)",
            }}
          >
            {/* Sheet edges, running headers and page numbers. Painted behind
                the prose from the engine's page count — it reads nothing from
                the DOM, because the uniform grid makes every position a
                multiply. */}
            <PageChrome
              pageCount={store.pageCount}
              active={store.paginationActive}
              layout={store.layout}
              title={store.meta.title}
              headerText={store.headerText}
              footerText={store.footerText}
              zen={store.zenMode}
              onHeaderCommit$={(value) => updateChromeText("header", value)}
              onFooterCommit$={(value) => updateChromeText("footer", value)}
              {...pageChromeGeometry()}
            />
            <div
              id="twyne-editor-mount"
              style={{ position: "relative", zIndex: 1 }}
            />

            {/* Notes — endnotes and footnotes collected live from the doc,
                set at the foot of the manuscript like a book's own notes
                page. Independent numbering per kind, mirroring the inline
                markers and the exported "Notes"/"Footnotes" sections. */}
            {store.notes.length > 0 && (
              <div
                class="manuscript-notes mt-10 pt-6 border-t border-[var(--color-paper-3)]"
                style="font-family: var(--font-serif);"
              >
                {(["endnote", "footnote"] as const).map((kind) => {
                  const items = store.notes.filter((n) => n.kind === kind);
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
                        {items.map((n) => (
                          <li key={`${kind}-${n.number}`}>
                            <button
                              type="button"
                              class="manuscript-note-marker"
                              style={{
                                color:
                                  kind === "footnote"
                                    ? "var(--color-cobalt)"
                                    : "var(--color-vermilion)",
                              }}
                              onClick$={() => jumpToNote(n.pos)}
                              aria-label={`Jump to ${kind} ${n.number} in the text`}
                            >
                              {kind === "footnote" ? `†${n.number}` : n.number}
                            </button>
                            <span class="manuscript-note-text">{n.text}</span>
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

        {/* ── Status bar (the colophon) ──────────────────── */}
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
            {formatWordCount(store.meta.wordCount)} words · {folios} folios
          </span>
          <span>
            <LastSavedLine savedAt={store.lastSavedAt} /> ·{" "}
            {readingTimeLabel(store.meta.readingTime)} · set in Lora &amp;
            Fraunces
          </span>
        </div>

        {/* ── Persona-note card: anchored below (or flipped above) the
              sentence, never overlapping the marked text. The card
              geometry is computed by `computePopoverGeometry` so the JSX
              just mirrors the resulting fields. Click pins the card so it
              survives mouse-out. ── */}
        {store.notePopover && (
          <div
            class="persona-note-card fixed z-50 flex flex-col"
            role="dialog"
            aria-label={`Note from ${store.notePopover.author}`}
            style={{
              left: `${store.notePopover.x}px`,
              top:
                store.notePopover.top != null
                  ? `${store.notePopover.top}px`
                  : "auto",
              bottom:
                store.notePopover.bottom != null
                  ? `${store.notePopover.bottom}px`
                  : "auto",
              width: "340px",
              "max-height": `${store.notePopover.maxH}px`,
              background: "var(--color-paper)",
              border: `2px solid ${store.notePopover.color}`,
              "border-radius": "4px",
              "box-shadow": "0 14px 36px rgba(0,0,0,0.28)",
            }}
            onClick$={(e) => {
              // Clicking the card itself pins it so it survives mouseout.
              e.stopPropagation();
              const p = store.notePopover;
              if (p && !p.pinned) {
                store.notePopover = { ...p, pinned: true };
              }
            }}
            onMouseLeave$={(e) => {
              if (store.notePopover?.pinned) return;
              // Mid-conversation: keep the live thread open even if the
              // popover was opened by hover rather than a click.
              if (store.notePopover?.replying) return;
              if ((store.notePopover?.thread.length ?? 0) > 0) return;
              const related = (e as MouseEvent)
                .relatedTarget as HTMLElement | null;
              if (related?.closest(".twyne-persona-note")) return;
              if (related?.closest(".twyne-mark-anchor")) return;
              store.notePopover = null;
            }}
          >
            <div
              class="px-5 py-3 border-b flex items-baseline justify-between gap-3"
              style={{
                "border-color": "var(--color-paper-3)",
                background: "var(--color-paper-soft)",
              }}
            >
              <div class="min-w-0">
                <p
                  class="text-base text-[var(--color-ink)] truncate"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                  }}
                >
                  {store.notePopover.author}
                </p>
                {store.notePopover.label && (
                  <p
                    class="text-[0.7rem] tracking-[0.14em] uppercase mt-0.5"
                    style={{
                      fontFamily: "var(--font-typewriter)",
                      color: store.notePopover.color,
                    }}
                  >
                    {store.notePopover.label}
                  </p>
                )}
              </div>
              <div class="flex items-center gap-1.5 flex-shrink-0">
                {/* Hear the note in its editor's voice, from the passage it
                    concerns — the same control the Cast panel carries, so a
                    writer working in the manuscript never has to go looking
                    for the panel to be read to. */}
                <SpeakButton
                  compact
                  id={`note-popover-${store.notePopover.id}`}
                  text={store.notePopover.note}
                  author={store.notePopover.author}
                  label={store.notePopover.author}
                />
                <button
                  onClick$={() => {
                    store.notePopover = null;
                  }}
                  class="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] text-base"
                  aria-label="Close note"
                >
                  ✕
                </button>
              </div>
            </div>
            <div class="px-5 py-4 space-y-3 overflow-y-auto">
              {store.notePopover.quote && (
                <blockquote
                  class="text-[0.85rem] leading-6 text-[var(--color-ink-light)] border-l-2 pl-3 italic"
                  style={{ "border-color": store.notePopover.color }}
                >
                  {`« ${store.notePopover.quote.length > 280 ? store.notePopover.quote.slice(0, 279) + "…" : store.notePopover.quote} »`}
                </blockquote>
              )}
              <div
                class="comment-markdown text-[0.95rem] leading-6 text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-serif)" }}
                dangerouslySetInnerHTML={renderMarkdown(store.notePopover.note)}
              />
              {store.notePopover.briefTitle && (
                <p
                  class="text-[0.65rem] text-[var(--color-ink-muted)]"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {`filed against “${store.notePopover.briefTitle}”`}
                </p>
              )}
              {store.notePopover.thread.length > 0 && (
                <div class="persona-note-thread space-y-2 pt-2">
                  {(() => {
                    const pop = store.notePopover!;
                    return store.notePopover.thread.map((r) =>
                      r.authorKind === "user" ? (
                        <div
                          key={r.id}
                          class="flex justify-end"
                          data-author-kind="user"
                        >
                          <div
                            class="max-w-[85%] px-3 py-2 border border-[var(--color-paper-3)] text-[0.85rem] leading-5 text-[var(--color-ink)]"
                            style={{
                              "background-color": "var(--color-paper-soft)",
                              "border-radius": "6px 6px 2px 6px",
                              fontFamily: "var(--font-serif)",
                            }}
                          >
                            <p
                              class="text-[0.6rem] tracking-[0.14em] uppercase mb-1 text-[var(--color-ink-muted)]"
                              style={{ fontFamily: "var(--font-typewriter)" }}
                            >
                              You
                            </p>
                            <div
                              class="comment-markdown whitespace-pre-wrap"
                              dangerouslySetInnerHTML={renderMarkdown(r.text)}
                            />
                          </div>
                        </div>
                      ) : (
                        <div
                          key={r.id}
                          class="flex justify-start"
                          data-author-kind="persona"
                        >
                          <div
                            class="max-w-[85%] px-3 py-2 border text-[0.85rem] leading-5 text-[var(--color-ink)]"
                            style={{
                              "background-color": pop.color,
                              "border-color": pop.color,
                              "border-radius": "6px 6px 6px 2px",
                              fontFamily: "var(--font-serif)",
                            }}
                          >
                            <p
                              class="text-[0.6rem] tracking-[0.14em] uppercase mb-1"
                              style={{
                                fontFamily: "var(--font-typewriter)",
                                color: "var(--color-paper)",
                                opacity: "0.9",
                              }}
                            >
                              {r.author}
                            </p>
                            <div
                              class="comment-markdown comment-markdown-on-color whitespace-pre-wrap"
                              style={{ color: "var(--color-paper)" }}
                              dangerouslySetInnerHTML={renderMarkdown(r.text)}
                            />
                          </div>
                        </div>
                      ),
                    );
                  })()}
                </div>
              )}
              {/* The reply as it is written. Once there are words the dots
                  are redundant — watching the sentence form is a better
                  progress indicator than any animation. It sits in the same
                  bubble the finished reply will occupy, so nothing jumps
                  when the two swap. */}
              {store.notePopover.replying &&
                store.notePopover.streamingReply.trim() && (
                  <div class="persona-note-streaming flex justify-start">
                    <div
                      class="max-w-[85%] px-3 py-2 border text-[0.85rem] leading-5"
                      style={{
                        "background-color": store.notePopover.color,
                        "border-color": store.notePopover.color,
                        "border-radius": "6px 6px 6px 2px",
                        fontFamily: "var(--font-serif)",
                      }}
                    >
                      <p
                        class="text-[0.6rem] tracking-[0.14em] uppercase mb-1"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          color: "var(--color-paper)",
                          opacity: "0.9",
                        }}
                      >
                        {store.notePopover.author}
                      </p>
                      <div
                        class="comment-markdown comment-markdown-on-color whitespace-pre-wrap"
                        style={{ color: "var(--color-paper)" }}
                        dangerouslySetInnerHTML={renderMarkdown(
                          store.notePopover.streamingReply,
                        )}
                      />
                    </div>
                  </div>
                )}
              {store.notePopover.replying &&
                !store.notePopover.streamingReply.trim() && (
                  <div
                    class="persona-note-typing flex items-center gap-2 pt-1 italic text-[0.75rem] text-[var(--color-ink-muted)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    <span class="typing-dots" aria-hidden="true">
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </span>
                    <span>{store.notePopover.author} is typing…</span>
                  </div>
                )}
              {store.notePopover.error && (
                <p
                  class="persona-note-error text-[0.7rem] leading-4 pt-1 text-[var(--color-vermilion)]"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {store.notePopover.error}
                </p>
              )}
              <div
                class="pt-2 border-t border-dashed"
                style={{ "border-color": "var(--color-paper-3)" }}
              >
                <textarea
                  value={store.notePopover.draft}
                  onInput$={(e) => {
                    if (!store.notePopover) return;
                    store.notePopover = {
                      ...store.notePopover,
                      draft: (e.target as HTMLTextAreaElement).value,
                    };
                  }}
                  onKeyDown$={(e) => {
                    if (
                      (e.metaKey || e.ctrlKey) &&
                      e.key === "Enter" &&
                      store.notePopover
                    ) {
                      e.preventDefault();
                      if (!store.notePopover.draft.trim()) return;
                      window.dispatchEvent(
                        new CustomEvent("twyne:persona-reply", {
                          detail: {
                            noteId: store.notePopover.id,
                            text: store.notePopover.draft,
                            author: store.notePopover.author,
                          },
                        }),
                      );
                      // Keep the popover open so the writer sees the
                      // optimistic reply, the typing indicator, and
                      // the persona's response land in the thread.
                      store.notePopover = {
                        ...store.notePopover,
                        draft: "",
                        error: null,
                      };
                    }
                  }}
                  placeholder={`Reply to ${store.notePopover.author}…`}
                  class="w-full mt-2 px-2 py-1.5 text-xs bg-[var(--color-paper-soft)] border border-[var(--color-paper-3)] resize-none focus:outline-none focus:border-[var(--color-mustard)]"
                  style="font-family: var(--font-serif); border-radius: 2px;"
                  rows={3}
                />
                <div class="mt-2 flex items-center justify-between gap-2">
                  <span
                    class="text-[10px] text-[var(--color-ink-muted)]"
                    style="font-family: var(--font-typewriter); letter-spacing: 0.12em;"
                  >
                    ⌘↩ to reply
                  </span>
                  <div class="flex gap-2">
                    <button
                      onClick$={() => {
                        if (!store.notePopover) return;
                        dismissNote(store.notePopover.id);
                        store.notePopover = null;
                      }}
                      class="btn-paper text-[11px]"
                    >
                      Strike
                    </button>
                    <button
                      onClick$={() => {
                        if (!store.notePopover) return;
                        if (!store.notePopover.draft.trim()) return;
                        window.dispatchEvent(
                          new CustomEvent("twyne:persona-reply", {
                            detail: {
                              noteId: store.notePopover.id,
                              text: store.notePopover.draft,
                              author: store.notePopover.author,
                            },
                          }),
                        );
                        // Live thread: stay open. The Cast panel and
                        // the popover now share the same source of
                        // truth via the `twyne:*` event bus, so the
                        // writer can keep replying in the text.
                        store.notePopover = {
                          ...store.notePopover,
                          draft: "",
                          error: null,
                        };
                      }}
                      disabled={!store.notePopover.draft.trim()}
                      class="btn-press text-[11px] disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Reply
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Suggestion modal: an editor's proposed rewrite (centered) ── */}
        {store.suggestionPopover && (
          <div
            class="fixed inset-0 z-50 flex items-center justify-center p-6"
            style="background: rgba(20, 16, 10, 0.55);"
            role="dialog"
            aria-label={`Proposed edit from ${store.suggestionPopover.author}`}
            onClick$={() => {
              store.suggestionPopover = null;
            }}
          >
            <div
              class="bg-[var(--color-paper)] border-2 w-full max-w-xl flex flex-col"
              style={{
                "border-color": store.suggestionPopover.color,
                "border-radius": "4px",
                "box-shadow": "0 20px 50px rgba(0,0,0,0.35)",
              }}
              onClick$={(e) => e.stopPropagation()}
            >
              <div
                class="px-5 py-3 border-b flex items-baseline justify-between gap-3"
                style={{
                  "border-color": "var(--color-paper-3)",
                  background: "var(--color-paper-soft)",
                }}
              >
                <p
                  class="text-[0.7rem] tracking-[0.14em] uppercase"
                  style={{
                    fontFamily: "var(--font-typewriter)",
                    color: store.suggestionPopover.color,
                  }}
                >
                  {store.suggestionPopover.author} proposes
                </p>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  {/* Hearing a proposed rewrite is the fastest way to tell
                      whether it sounds like you. */}
                  <SpeakButton
                    compact
                    id={`suggestion-${store.suggestionPopover.id}`}
                    text={store.suggestionPopover.replacement}
                    author={store.suggestionPopover.author}
                    label={store.suggestionPopover.author}
                  />
                  <button
                    onClick$={() => {
                      store.suggestionPopover = null;
                    }}
                    class="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] text-base"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div class="px-5 py-4 space-y-3">
                <p
                  class="text-[0.85rem] leading-6 line-through text-[var(--color-ink-muted)]"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {store.suggestionPopover.original}
                </p>
                <p
                  class="text-[0.95rem] leading-6 text-[var(--color-ink)]"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {store.suggestionPopover.replacement}
                </p>
                {store.suggestionPopover.rationale && (
                  <div
                    class="comment-markdown text-[0.78rem] italic leading-5 text-[var(--color-ink-light)]"
                    style={{ fontFamily: "var(--font-serif)" }}
                    dangerouslySetInnerHTML={renderMarkdown(
                      store.suggestionPopover.rationale,
                    )}
                  />
                )}
                <div class="pt-2 flex gap-2 justify-end">
                  <button
                    onClick$={strikeSuggestion}
                    disabled={store.suggestionPopover.busy}
                    class="btn-paper text-xs"
                  >
                    Strike
                  </button>
                  <button
                    onClick$={acceptSuggestion}
                    disabled={store.suggestionPopover.busy}
                    class="btn-press text-xs"
                  >
                    {store.suggestionPopover.busy
                      ? "Stamping…"
                      : "Accept & stamp"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Approval stamp: thunks onto the page when an edit is accepted ── */}
        {store.stampVisible && (
          <div class="approval-stamp-overlay" aria-hidden="true">
            <ImgApprovalStamp aria-hidden="true" width="220" height="220" />
          </div>
        )}

        {/* ── User inline-comment modal: centered, dismissable ── */}
        {store.userCommentPopover && (
          <div
            class="fixed inset-0 z-50 flex items-center justify-center p-6"
            style="background: rgba(20, 16, 10, 0.55);"
            role="dialog"
            aria-label={`Comment from ${store.userCommentPopover.author}`}
            onClick$={closeUserCommentPopover}
          >
            <div
              class="bg-[var(--color-paper)] border-2 w-full max-w-xl flex flex-col"
              style={{
                "border-color": store.userCommentPopover.resolved
                  ? "var(--color-accent-green)"
                  : "var(--color-mustard)",
                "border-radius": "4px",
                "box-shadow": "0 20px 50px rgba(0,0,0,0.35)",
              }}
              onClick$={(e) => e.stopPropagation()}
            >
              <div
                class="px-5 py-3 border-b flex items-baseline justify-between gap-3"
                style={{
                  "border-color": "var(--color-paper-3)",
                  background: "var(--color-paper-soft)",
                }}
              >
                <p
                  class="text-[0.7rem] tracking-[0.18em] uppercase"
                  style={{
                    fontFamily: "var(--font-typewriter)",
                    color: store.userCommentPopover.resolved
                      ? "var(--color-accent-green)"
                      : "var(--color-mustard)",
                  }}
                >
                  {store.userCommentPopover.resolved
                    ? "resolved · "
                    : "open · "}
                  {timeAgo(store.userCommentPopover.createdAt)}
                </p>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  <SpeakButton
                    compact
                    id={`user-comment-${store.userCommentPopover.id}`}
                    text={store.userCommentPopover.text}
                  />
                  <button
                    onClick$={closeUserCommentPopover}
                    class="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] text-base"
                    aria-label="Close comment"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div class="px-5 py-4 space-y-3">
                <div
                  class="comment-markdown text-[1rem] leading-6 text-[var(--color-ink)]"
                  style="font-family: var(--font-serif);"
                  dangerouslySetInnerHTML={renderMarkdown(
                    store.userCommentPopover.text,
                  )}
                />
                {store.userCommentPopover.replies.length > 0 && (
                  <div
                    class="pt-2 mt-2 border-t border-dashed space-y-2"
                    style={{ "border-color": "var(--color-paper-3)" }}
                  >
                    {store.userCommentPopover.replies.map((r) => (
                      <div key={r.id} class="text-[0.85rem]">
                        <p
                          class="text-[0.6rem] tracking-[0.16em] uppercase"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            color:
                              r.authorKind === "persona" && r.color
                                ? r.color
                                : "var(--color-ink-muted)",
                          }}
                        >
                          {r.author}
                          {r.authorKind === "persona" && (
                            <span class="ml-1.5 opacity-70">editor</span>
                          )}{" "}
                          · {timeAgo(r.createdAt)}
                        </p>
                        <div
                          class="comment-markdown mt-0.5 text-[var(--color-ink-light)] leading-5"
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontStyle:
                              r.authorKind === "persona" ? "italic" : "normal",
                          }}
                          dangerouslySetInnerHTML={renderMarkdown(r.text)}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <div
                  class="pt-2 mt-2 border-t border-dashed"
                  style={{ "border-color": "var(--color-paper-3)" }}
                >
                  <textarea
                    value={store.userCommentPopover.draft}
                    onInput$={(e) => {
                      if (!store.userCommentPopover) return;
                      store.userCommentPopover = {
                        ...store.userCommentPopover,
                        draft: (e.target as HTMLTextAreaElement).value,
                      };
                    }}
                    onKeyDown$={(e) => {
                      if (
                        (e.metaKey || e.ctrlKey) &&
                        e.key === "Enter" &&
                        store.userCommentPopover
                      ) {
                        submitUserCommentReply(store.userCommentPopover.id);
                      }
                    }}
                    placeholder="Reply as the writer…"
                    class="w-full mt-2 px-2 py-1.5 text-xs bg-[var(--color-paper-soft)] border border-[var(--color-paper-3)] resize-none focus:outline-none focus:border-[var(--color-mustard)]"
                    style="font-family: var(--font-serif); border-radius: 2px;"
                    rows={3}
                  />
                  <div class="mt-2 flex items-center justify-between gap-2">
                    <span
                      class="text-[10px] text-[var(--color-ink-muted)]"
                      style="font-family: var(--font-typewriter); letter-spacing: 0.12em;"
                    >
                      ⌘↩ to reply
                    </span>
                    <div class="flex gap-2">
                      <button
                        onClick$={() => {
                          if (!store.userCommentPopover) return;
                          toggleResolveUserComment(store.userCommentPopover.id);
                        }}
                        class="btn-paper text-[11px]"
                      >
                        {store.userCommentPopover.resolved
                          ? "Reopen"
                          : "Resolve"}
                      </button>
                      <button
                        onClick$={() => {
                          if (store.userCommentPopover)
                            deleteUserCommentLocal(store.userCommentPopover.id);
                        }}
                        class="btn-paper text-[11px] text-[var(--color-vermilion)]"
                      >
                        Erase
                      </button>
                      <button
                        onClick$={() => {
                          if (store.userCommentPopover)
                            submitUserCommentReply(store.userCommentPopover.id);
                        }}
                        disabled={!store.userCommentPopover.draft.trim()}
                        class="btn-press text-[11px] disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
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

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

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

function removePersonaNote(editor: Editor, id: string | null): void {
  const { state, view } = editor;
  const type = state.schema.marks.personaNote;
  if (!type) return;
  const tr = state.tr;
  state.doc.descendants((node: any, pos: number) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type === type && (id === null || mark.attrs.id === id)) {
        tr.removeMark(pos, pos + node.nodeSize, type);
      }
    }
    return true;
  });
  if (tr.docChanged) view.dispatch(tr);
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
  const { state, view } = editor;
  const type = state.schema.marks.suggestion;
  if (!type) return;
  const tr = state.tr;
  state.doc.descendants((node: any, pos: number) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type === type && (id === null || mark.attrs.id === id)) {
        tr.removeMark(pos, pos + node.nodeSize, type);
      }
    }
    return true;
  });
  if (tr.docChanged) view.dispatch(tr);
}

function removeAllSuggestions(editor: Editor): void {
  removeSuggestionMark(editor, null);
}
