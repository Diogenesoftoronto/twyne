import type { NoSerialize } from "@builder.io/qwik";
import type { Editor } from "@tiptap/core";
import type {
  DocumentMeta,
  Folio,
  LayoutSettings,
  PersonaReply,
} from "../../types";
import type { UserCommentReply } from "../../utils/user-comments";
import type { ImageUploadAdapter } from "../../utils/image-upload";
import type { CompositorTab } from "../../utils/compositor-toolbar";
import type { DocumentOutlineModel } from "../../utils/document-outline";
import type { NoteKind } from "./extensions/endnote-node";
import type { ImageNodeAttributes } from "./extensions/image-node";
import type { SelectedCellFormat } from "./extensions/table-cell-format";
import type { TableToolbarSnapshot } from "./table-core";

/** A persona note anchored beside the passage it discusses. */
export interface NotePopover {
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
  quote?: string;
  briefTitle?: string;
  draft: string;
  dismissed: boolean;
  pinned: boolean;
  thread: PersonaReply[];
  replying: boolean;
  streamingReply: string;
  error: string | null;
}

/** A persona's proposed rewrite, presented for an explicit accept/strike decision. */
export interface SuggestionPopover {
  id: string;
  versionId: string;
  author: string;
  color: string;
  original: string;
  replacement: string;
  rationale: string;
  x: number;
  y: number;
  busy: boolean;
}

/** A note collected live from the document, in reading order and numbered per kind. */
export interface EditorNote {
  kind: NoteKind;
  number: number;
  text: string;
  pos: number;
}

/** A writer-authored inline comment and its reply thread. */
export interface UserCommentPopover {
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

/**
 * Shared reactive state for the editor shell and its panels.
 *
 * Tiptap and persistence remain owned by `twyne-editor.tsx`; extracted panels
 * only read this state and send typed intents back to that orchestrator.
 */
export interface EditorStore {
  editor: Editor | null;
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
  noteInputKind: "endnote" | "footnote" | null;
  noteText: string;
  notes: EditorNote[];
  hasSelection: boolean;
  notePopover: NotePopover | null;
  suggestionPopover: SuggestionPopover | null;
  stampVisible: boolean;
  lastSavedAt: number | null;
  userCommentPopover: UserCommentPopover | null;
  canUndo: boolean;
  canRedo: boolean;
  activeFolioId: string;
  layout: LayoutSettings;
  headerText: string;
  footerText: string;
  showLayout: boolean;
  layoutPanelMaxH: number;
  exportingPdf: boolean;
  showFindReplace: boolean;
  showGrammar: boolean;
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
  zenMode: boolean;
  openPicker: "highlight" | "textColor" | "type" | "spacing" | null;
  currentColor: string | null;
  currentHighlight: string | null;
  currentFontFamily: string | null;
  currentFontSize: string | null;
  currentLineHeight: string | null;
  currentSpaceBefore: number | null;
  currentSpaceAfter: number | null;
  currentKeepWithNext: boolean;
  pageCount: number;
  paginationActive: boolean;
  toolbarTab: CompositorTab;
}

/** The serializable slice that rendered panels may read and update. */
export type EditorPanelState = Omit<
  EditorStore,
  "editor" | "imageUploadAdapter"
>;

export interface TwyneEditorProps {
  initialContent?: string;
  /** The folio this draft belongs to. Used to scope user comments. */
  activeFolioId?: string;
  /** The full active folio — carries layout, header, and footer. */
  activeFolio?: Folio | null;
  /** The current project brief, used to derive running-header metadata. */
  brief?: import("../../types").ProjectBrief | null;
  /** When set, the editor joins a multiplayer session. */
  sharedLixId?: string;
  /** Commenters can inspect and discuss a shared folio without editing it. */
  readOnly?: boolean;
}
