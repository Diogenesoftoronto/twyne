import {
  component$,
  useStore,
  useStyles$,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import ImgApprovalStamp from "../../media/approval-stamp.svg?jsx";
import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Highlight } from "@tiptap/extension-highlight";
import { Underline } from "@tiptap/extension-underline";
import { TextAlign } from "@tiptap/extension-text-align";
import { Link as TiptapLink } from "@tiptap/extension-link";
import { Typography } from "@tiptap/extension-typography";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import type { Editor } from "@tiptap/core";
import type {
  DocumentMeta,
  Folio,
  LayoutSettings,
  PersonaNotePayload,
} from "../../types";
import { DEFAULT_LAYOUT, MARGIN_RANGE, resolveMargins } from "../../types";
import { detectCitations } from "../../utils/citations";
import { useConvexClient } from "../../utils/convex-context";
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
import { RemoteCursors } from "./extensions/remote-cursors";
import { type RemoteCursor } from "./extensions/remote-cursors";
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

interface NotePopover {
  id: string;
  author: string;
  color: string;
  label: string;
  note: string;
  x: number;
  y: number;
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

export interface EditorStore {
  editor: Editor | null;
  content: string;
  meta: DocumentMeta;
  isDragOver: boolean;
  isAnalysisRunning: boolean;
  active: Record<string, boolean>;
  showImageInput: boolean;
  imageUrl: string;
  showCommentInput: boolean;
  commentText: string;
  showMermaidInput: boolean;
  mermaidSource: string;
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
  /** Show the table tools popover? */
  showTableTools: boolean;
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
      showCommentInput: false,
      commentText: "",
      showMermaidInput: false,
      mermaidSource: "",
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
      showTableTools: false,
    });

    useStyles$(`
    .twyne-editor {
      min-height: 100%;
    }
  `);

    // Apply the live layout to the editor surface via CSS custom properties,
    // so the same LayoutSettings drive editor / export / print.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ track }) => {
      const layout = track(() => store.layout);
      const root = document.documentElement;
      const widthMap: Record<typeof layout.width, string> = {
        narrow: "36rem",
        normal: "48rem",
        wide: "62rem",
      };
      const m = resolveMargins(layout);
      root.style.setProperty("--doc-width", widthMap[layout.width]);
      root.style.setProperty("--doc-pad-x", `${m.x}rem`);
      root.style.setProperty("--doc-pad-y", `${m.top}rem`);
      root.style.setProperty("--doc-pad-bottom", `${m.bottom}rem`);
    });

    // Dismiss the editor popovers on outside click.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup, track }) => {
      const layoutOpen = track(() => store.showLayout);
      const tableOpen = track(() => store.showTableTools);
      if (!layoutOpen && !tableOpen) return;
      const onDoc = (e: MouseEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && t.closest("[data-layout-popover]")) return;
        if (t && t.closest('[aria-label="Page layout"]')) return;
        if (t && t.closest("[data-table-popover]")) return;
        if (t && t.closest('[aria-label="Table tools"]')) return;
        store.showLayout = false;
        store.showTableTools = false;
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
              const threads = await loadUserComments();
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
            }),
            Image.configure({
              inline: false,
              allowBase64: true,
              HTMLAttributes: { class: "twyne-image" },
            }),
            Table.configure({ resizable: true }),
            TableRow,
            TableCell,
            TableHeader,
            Placeholder.configure({
              placeholder:
                "Begin writing from the brief. The room of editors is listening...",
            }),
            Highlight.configure({ multicolor: true }),
            Underline,
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            TiptapLink.configure({
              openOnClick: true,
              autolink: true,
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
            RemoteCursors.configure({ cursors: [] }),
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

              const files = event.dataTransfer?.files;
              if (files && files.length > 0) {
                for (const file of Array.from(files)) {
                  if (file.type.startsWith("image/")) {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const src = reader.result as string;
                      const node = view.state.schema.nodes.image.create({
                        src,
                      });
                      const tr = view.state.tr.insert(pos.pos, node);
                      view.dispatch(tr);
                    };
                    reader.readAsDataURL(file);
                    return true;
                  }
                }
              }

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
            isInTable: editor.isActive("table"),
            canMergeCells: editor.can().mergeCells(),
            canSplitCell: editor.can().splitCell(),
          };
          if (!editor.isActive("table")) {
            store.showTableTools = false;
          }
          // History availability — driven by the Tiptap history
          // extension, which the StarterKit includes by default.
          // `can().undo()` / `can().redo()` are safe on every transaction.
          store.canUndo = editor.can().undo();
          store.canRedo = editor.can().redo();
        };
        editor.on("selectionUpdate", refreshActive);
        editor.on("transaction", refreshActive);

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

        // Build a persona-note popover, anchored near its sentence but always
        // kept fully inside the viewport (it prefers below, flips above when
        // there isn't room, and clamps on both axes as a last resort).
        const CARD_W = 340;
        const CARD_MARGIN = 8;
        const buildNotePopover = (
          noteSpan: HTMLElement,
          pinned: boolean,
        ): NotePopover => {
          const rect = noteSpan.getBoundingClientRect();
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          // Matches the card's CSS max-height: min(60vh, 520px).
          const cardH = Math.min(vh * 0.6, 520);

          const x = Math.max(
            CARD_MARGIN,
            Math.min(rect.left, vw - CARD_W - CARD_MARGIN),
          );

          // Prefer sitting just below the sentence; if that would run past the
          // bottom edge, shift up only as much as needed so the card's full box
          // stays in view (overlapping the sentence rather than leaving a gap,
          // which keeps it reachable on hover).
          let y = rect.bottom + CARD_MARGIN;
          const maxTop = vh - CARD_MARGIN - cardH;
          if (y > maxTop) y = Math.max(CARD_MARGIN, maxTop);

          return {
            id: noteSpan.getAttribute("data-persona-note-id") ?? "",
            author: noteSpan.getAttribute("data-persona-note-author") ?? "",
            color:
              noteSpan.getAttribute("data-persona-note-color") ??
              "var(--color-vermilion)",
            label: noteSpan.getAttribute("data-persona-note-label") ?? "",
            note: noteSpan.getAttribute("data-persona-note-note") ?? "",
            quote:
              noteSpan.getAttribute("data-persona-note-quote") ?? undefined,
            briefTitle:
              noteSpan.getAttribute("data-persona-note-brief") ?? undefined,
            draft: "",
            dismissed: false,
            pinned,
            x,
            y,
          };
        };

        // ── Hover: preview a persona note below its sentence ──
        el.addEventListener("mouseover", (e) => {
          const noteSpan = (e.target as HTMLElement).closest(
            ".twyne-persona-note",
          ) as HTMLElement | null;
          if (!noteSpan) return;
          // Don't clobber a pinned card the writer is interacting with.
          if (store.notePopover?.pinned) return;
          store.notePopover = buildNotePopover(noteSpan, false);
        });
        el.addEventListener("mouseout", (e) => {
          if (store.notePopover?.pinned) return;
          const related = e.relatedTarget as HTMLElement | null;
          // Stay open while moving onto the card or within the same note.
          if (related?.closest(".persona-note-card")) return;
          if (related?.closest(".twyne-persona-note")) return;
          store.notePopover = null;
        });

        // ── Comment + persona-note click handler ──
        el.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;

          // Writer's own inline comment → show the margin popover.
          const commentMark = target.closest(
            ".twyne-comment-mark",
          ) as HTMLElement | null;
          if (commentMark) {
            const commentId = commentMark.getAttribute("data-comment-id");
            if (commentId) {
              openUserCommentPopover(commentId, commentMark);
              // Don't bubble to the persona-note path below.
              return;
            }
          }

          // Editor's proposed rewrite → show the accept/strike card.
          const suggestionSpan = target.closest(
            ".twyne-suggestion",
          ) as HTMLElement | null;
          if (suggestionSpan) {
            const rect = suggestionSpan.getBoundingClientRect();
            store.suggestionPopover = {
              id: suggestionSpan.getAttribute("data-suggestion-id") ?? "",
              versionId:
                suggestionSpan.getAttribute("data-suggestion-versionId") ?? "",
              author:
                suggestionSpan.getAttribute("data-suggestion-author") ?? "",
              color:
                suggestionSpan.getAttribute("data-suggestion-color") ??
                "var(--color-vermilion)",
              original: suggestionSpan.textContent ?? "",
              replacement:
                suggestionSpan.getAttribute("data-suggestion-replacement") ??
                "",
              rationale:
                suggestionSpan.getAttribute("data-suggestion-rationale") ?? "",
              x: Math.max(8, Math.min(rect.left, window.innerWidth - 360)),
              y: rect.bottom + 8,
              busy: false,
            };
            return;
          }

          const noteSpan = target.closest(
            ".twyne-persona-note",
          ) as HTMLElement | null;
          if (noteSpan) {
            // Clicking the sentence pins the card open (survives mouse-out).
            store.notePopover = buildNotePopover(noteSpan, true);
          } else if (!target.closest(".persona-note-card")) {
            store.notePopover = null;
          }
          if (
            !target.closest(".twyne-suggestion") &&
            !target.closest(".suggestion-card")
          ) {
            store.suggestionPopover = null;
          }
        });

        // ── Double-click: click through an inline comment mark so the
        // writer can edit the sentence again. The single-click handler
        // above pins the popover open; a second click within the
        // browser's dblclick window dismisses it and drops the caret
        // into the marked passage. The mark itself stays in place so
        // the thread keeps its anchor — only the modal goes away. ──
        el.addEventListener("dblclick", (e) => {
          const target = e.target as HTMLElement;
          const commentMark = target.closest(
            ".twyne-comment-mark",
          ) as HTMLElement | null;
          if (!commentMark) return;
          // Don't fight the popover: dismissing it is the whole point.
          store.userCommentPopover = null;
          // Resolve the mark's first text node to a ProseMirror position
          // and focus the editor there. posAtDOM returns the document
          // offset for the DOM node, which is exactly the anchor we
          // want — the cursor lands inside the marked passage.
          const pos = editor.view.posAtDOM(commentMark, 0);
          if (typeof pos === "number" && pos >= 0) {
            editor.commands.focus(pos);
          } else {
            editor.commands.focus();
          }
        });

        store.editor = editor;

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

        // ── Drop plain text at the cursor (e.g. a citation marker) ──
        const onInsertText = (e: Event) => {
          const text = (e as CustomEvent).detail as string;
          if (!text) return;
          editor
            .chain()
            .focus()
            .insertContent([
              { type: "text", text, marks: [{ type: "code" }] },
              { type: "text", text: " " },
            ])
            .run();
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
            await saveSuggestionLocally(suggestion);
            const client = clientSig.value;
            if (client) {
              try {
                await client.mutation(api.sync.putSuggestion, {
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
          editor.destroy();
          store.editor = null;
        });
      });
    });

    const dismissNote = $((id: string) => {
      if (store.editor) removePersonaNote(store.editor, id);
      store.notePopover = null;
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
      await updateSuggestionStatusLocally(pop.id, "accepted");
      const client = clientSig.value;
      if (client) {
        try {
          await client.mutation(api.sync.updateSuggestionStatus, {
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
      await updateSuggestionStatusLocally(pop.id, "rejected");
      const client = clientSig.value;
      if (client) {
        try {
          await client.mutation(api.sync.updateSuggestionStatus, {
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
        const c = all.find((x) => x.id === commentId);
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
        .setImage({ src, alt: alt || "" })
        .run();
    });

    /** Push the new layout to the parent (which writes to the Folio) and apply live CSS vars. */
    const emitLayout = $((next: LayoutSettings) => {
      store.layout = next;
      window.dispatchEvent(new CustomEvent("twyne:layout", { detail: next }));
    });

    const updateChromeText = $((kind: "header" | "footer", next: string) => {
      if (kind === "header") store.headerText = next;
      else store.footerText = next;
      window.dispatchEvent(new CustomEvent(`twyne:${kind}`, { detail: next }));
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
        case "undo":
          chain.undo().run();
          break;
        case "redo":
          chain.redo().run();
          break;
        case "insertTable":
          chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          store.showTableTools = true;
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
          store.showTableTools = false;
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
        {/* ── Toolbar (compositor's stick) ───────────────── */}
        <div
          class="flex items-center gap-1 px-4 py-1.5 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] sticky top-0 flex-wrap"
          style="font-family: var(--font-typewriter); z-index: var(--z-sticky);"
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
              title="Highlight"
              aria-label="Highlight"
              aria-pressed={!!store.active.highlight}
              onClick$={() => runCommand("highlight")}
              class="tool-btn"
            >
              <span style="background: linear-gradient(transparent 60%, rgba(212,160,23,0.5) 60%);">
                Hi
              </span>
            </button>
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
              onClick$={() => runCommand("insertTable")}
              class="tool-btn"
            >
              ▤ tab.
            </button>
            {!!store.active.isInTable && (
              <div class="relative flex items-center">
                <button
                  title="Table tools"
                  aria-label="Table tools"
                  aria-expanded={store.showTableTools}
                  onClick$={() => {
                    store.showTableTools = !store.showTableTools;
                  }}
                  class="tool-btn"
                >
                  ≣ tab.
                </button>
                {store.showTableTools && (
                  <div
                    data-table-popover
                    class="absolute left-0 top-full mt-1 z-50 w-72 p-3 bg-[var(--color-paper)] border border-[var(--color-paper-3)] shadow-lg"
                    style="border-radius: 2px; font-family: var(--font-typewriter);"
                    role="dialog"
                    aria-label="Table tools"
                  >
                    <p class="dept-label mb-2">Table tools</p>
                    <div class="space-y-3">
                      <div>
                        <p class="mb-1 text-[0.63rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
                          Rows
                        </p>
                        <div class="grid grid-cols-2 gap-1.5">
                          <button
                            onClick$={() => runCommand("addRowBefore")}
                            class="btn-paper text-[0.65rem]"
                          >
                            Add above
                          </button>
                          <button
                            onClick$={() => runCommand("addRowAfter")}
                            class="btn-paper text-[0.65rem]"
                          >
                            Add below
                          </button>
                          <button
                            onClick$={() => runCommand("deleteRow")}
                            class="btn-paper text-[0.65rem]"
                          >
                            Delete row
                          </button>
                          <button
                            onClick$={() => runCommand("toggleHeaderRow")}
                            class="btn-paper text-[0.65rem]"
                          >
                            Toggle header
                          </button>
                        </div>
                      </div>

                      <div>
                        <p class="mb-1 text-[0.63rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
                          Columns
                        </p>
                        <div class="grid grid-cols-2 gap-1.5">
                          <button
                            onClick$={() => runCommand("addColumnBefore")}
                            class="btn-paper text-[0.65rem]"
                          >
                            Add left
                          </button>
                          <button
                            onClick$={() => runCommand("addColumnAfter")}
                            class="btn-paper text-[0.65rem]"
                          >
                            Add right
                          </button>
                          <button
                            onClick$={() => runCommand("deleteColumn")}
                            class="btn-paper text-[0.65rem]"
                          >
                            Delete column
                          </button>
                          <button
                            onClick$={() => runCommand("toggleHeaderColumn")}
                            class="btn-paper text-[0.65rem]"
                          >
                            Toggle header
                          </button>
                        </div>
                      </div>

                      <div>
                        <p class="mb-1 text-[0.63rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
                          Cells
                        </p>
                        <div class="grid grid-cols-2 gap-1.5">
                          <button
                            onClick$={() => runCommand("mergeCells")}
                            disabled={!store.active.canMergeCells}
                            class="btn-paper text-[0.65rem] disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Merge cells
                          </button>
                          <button
                            onClick$={() => runCommand("splitCell")}
                            disabled={!store.active.canSplitCell}
                            class="btn-paper text-[0.65rem] disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Split cell
                          </button>
                        </div>
                      </div>

                      <div class="border-t border-[var(--color-paper-3)] pt-2">
                        <button
                          onClick$={() => runCommand("deleteTable")}
                          class="btn-paper text-[0.65rem] text-[var(--color-vermilion)]"
                        >
                          Delete table
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
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
                <p class="dept-label mb-2">Page</p>
                <div class="flex items-center gap-1 mb-3">
                  {(["narrow", "normal", "wide"] as const).map((w) => (
                    <button
                      key={w}
                      onClick$={() => emitLayout({ ...store.layout, width: w })}
                      class={`flex-1 text-[0.7rem] py-1 border ${store.layout.width === w ? "border-[var(--color-vermilion)] text-[var(--color-vermilion)]" : "border-[var(--color-paper-3)] text-[var(--color-ink-light)]"}`}
                      style="border-radius: 1px; text-transform: uppercase; letter-spacing: 0.1em;"
                    >
                      {w}
                    </button>
                  ))}
                </div>
                <p class="dept-label mb-2">Margins</p>
                {(
                  [
                    ["Side", "x", "marginX"],
                    ["Header", "top", "marginTop"],
                    ["Footer", "bottom", "marginBottom"],
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
              </div>
            )}
          </div>
        </div>

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

        {store.showMermaidInput && (
          <div
            class="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]"
            style="z-index: var(--z-sticky);"
          >
            <span
              class="text-xs text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter);"
            >
              Mermaid:
            </span>
            <input
              autoFocus
              value={store.mermaidSource}
              onInput$={(e) => {
                store.mermaidSource = (e.target as HTMLInputElement).value;
              }}
              onKeyDown$={(e) => {
                if (e.key === "Enter" && store.mermaidSource.trim()) {
                  runCommand("insertMermaid");
                }
                if (e.key === "Escape") {
                  store.showMermaidInput = false;
                  store.mermaidSource = "";
                }
              }}
              placeholder="graph TD; A-->B;"
              class="flex-1 border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-vermilion)] focus:outline-none"
              style="font-family: var(--font-typewriter); border-radius: 2px;"
            />
            <button
              onClick$={() => {
                if (store.mermaidSource.trim()) {
                  runCommand("insertMermaid");
                }
              }}
              class="tool-btn text-xs"
            >
              Insert
            </button>
            <button
              onClick$={() => {
                store.showMermaidInput = false;
                store.mermaidSource = "";
              }}
              class="tool-btn text-xs"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ── Editor area (the manuscript page) ──────────── */}
        <div
          class="flex-1 overflow-y-auto"
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
          <div
            class="mx-auto twyne-editor page-canvas relative"
            style={{
              "max-width": "var(--doc-width, 48rem)",
              "padding-left": "var(--doc-pad-x, 3rem)",
              "padding-right": "var(--doc-pad-x, 3rem)",
              "padding-top": "var(--doc-pad-y, 2.5rem)",
              "padding-bottom": "var(--doc-pad-bottom, 4rem)",
            }}
          >
            {/* Manuscript running header — author-tunable, with brief-derived fallback */}
            <div
              class="mb-6 pb-2 flex items-center justify-between gap-3 border-b border-[var(--color-paper-3)]"
              style="font-family: var(--font-typewriter); font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-ink-muted);"
            >
              <span class="dept-label">The Manuscript</span>
              <span
                class="flex-1 text-right truncate"
                style="color: var(--color-ink-light);"
              >
                {store.layout.runningHeader
                  ? runningHeaderText(store.headerText, brief ?? null)
                  : store.headerText}
              </span>
              <button
                type="button"
                class="text-[0.6rem] text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                style="letter-spacing: 0.1em;"
                onClick$={() => {
                  store.showLayout = true;
                }}
              >
                edit
              </button>
            </div>

            <div id="twyne-editor-mount" />

            {/* Manuscript running footer — author-tunable, page numbers on export */}
            <div
              class="mt-6 pt-2 border-t border-[var(--color-paper-3)] flex items-center justify-between gap-3"
              style="font-family: var(--font-typewriter); font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-ink-muted);"
            >
              <span
                class="flex-1 truncate"
                style="color: var(--color-ink-light);"
              >
                {store.footerText}
              </span>
              <span class="dept-label" style="color: var(--color-ink-muted);">
                {store.layout.pageNumbers ? "page" : ""}
              </span>
              <button
                type="button"
                class="text-[0.6rem] text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                style="letter-spacing: 0.1em;"
                onClick$={() => {
                  store.showLayout = true;
                }}
              >
                edit
              </button>
            </div>
          </div>
        </div>

        {/* ── Status bar (the colophon) ──────────────────── */}
        <div
          class="flex items-center justify-between px-5 py-1.5 border-t border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] text-[var(--color-ink-light)]"
          style="font-family: var(--font-typewriter); letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.72rem;"
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

        {/* ── Persona-note card: anchored below the sentence, hover/pin ── */}
        {store.notePopover && (
          <div
            class="persona-note-card fixed z-50 flex flex-col"
            role="dialog"
            aria-label={`Note from ${store.notePopover.author}`}
            style={{
              left: `${store.notePopover.x}px`,
              top: `${store.notePopover.y}px`,
              width: "340px",
              "max-height": "min(60vh, 520px)",
              background: "var(--color-paper)",
              border: `2px solid ${store.notePopover.color}`,
              "border-radius": "4px",
              "box-shadow": "0 14px 36px rgba(0,0,0,0.28)",
            }}
            onClick$={(e) => e.stopPropagation()}
            onMouseLeave$={(e) => {
              if (store.notePopover?.pinned) return;
              const related = (e as MouseEvent)
                .relatedTarget as HTMLElement | null;
              if (related?.closest(".twyne-persona-note")) return;
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
            <div class="px-5 py-4 space-y-3 overflow-y-auto">
              {store.notePopover.quote && (
                <blockquote
                  class="text-[0.85rem] leading-6 text-[var(--color-ink-light)] border-l-2 pl-3 italic"
                  style={{ "border-color": store.notePopover.color }}
                >
                  {`« ${store.notePopover.quote.length > 280 ? store.notePopover.quote.slice(0, 279) + "…" : store.notePopover.quote} »`}
                </blockquote>
              )}
              <p
                class="text-[0.95rem] leading-6 text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {store.notePopover.note}
              </p>
              {store.notePopover.briefTitle && (
                <p
                  class="text-[0.65rem] text-[var(--color-ink-muted)]"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {`filed against “${store.notePopover.briefTitle}”`}
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
                          },
                        }),
                      );
                      store.notePopover = null;
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
                            },
                          }),
                        );
                        // Close the modal so the Cast panel (which the route
                        // reveals) shows the editor's reply landing.
                        store.notePopover = null;
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
                  <p
                    class="text-[0.78rem] italic leading-5 text-[var(--color-ink-light)]"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {store.suggestionPopover.rationale}
                  </p>
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
                <button
                  onClick$={closeUserCommentPopover}
                  class="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] text-base"
                  aria-label="Close comment"
                >
                  ✕
                </button>
              </div>
              <div class="px-5 py-4 space-y-3">
                <p
                  class="text-[1rem] leading-6 text-[var(--color-ink)]"
                  style="font-family: var(--font-serif);"
                >
                  {store.userCommentPopover.text}
                </p>
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
                        <p
                          class="mt-0.5 text-[var(--color-ink-light)] leading-5"
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontStyle:
                              r.authorKind === "persona" ? "italic" : "normal",
                          }}
                        >
                          {r.text}
                        </p>
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

/** Build the brief-derived running header — title · author/date. */
function runningHeaderText(
  override: string,
  brief: import("../../types").ProjectBrief | null,
): string {
  if (override && override.trim()) return override;
  if (!brief) return "";
  const title = brief.answers.workingTitle || "Untitled";
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `${title} · ${today}`;
}
