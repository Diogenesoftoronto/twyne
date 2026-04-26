import {
  component$,
  useStore,
  useStyles$,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
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
import type { Editor } from "@tiptap/core";
import type { DocumentMeta } from "../../types";
import { loadDraftHtml, saveDraftHtml } from "../../utils/anti-tabula-rasa";
import { detectCitations } from "../../utils/citations";
import {
  computeDocumentMeta,
  formatWordCount,
  readingTimeLabel,
} from "../../utils/document";

export interface EditorStore {
  editor: Editor | null;
  content: string;
  meta: DocumentMeta;
  isDragOver: boolean;
  isAnalysisRunning: boolean;
}

interface TwyneEditorProps {
  initialContent?: string;
}

export const TwyneEditor = component$(
  ({ initialContent = "" }: TwyneEditorProps) => {
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
    });

    useStyles$(`
    .twyne-editor {
      min-height: 100%;
    }
  `);

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
      import("@tiptap/core").then(async ({ Editor }) => {
        const el = document.getElementById("twyne-editor-mount");
        if (!el) return;
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
                "Begin writing from the brief — your room of editors is listening...",
            }),
            Highlight.configure({ multicolor: true }),
            Underline,
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            TiptapLink.configure({
              openOnClick: true,
              autolink: true,
            }),
            Typography,
          ],
          content: loadSavedContent(initialContent),
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

            const citations = detectCitations(text);
            if (citations.length > 0) {
              window.dispatchEvent(
                new CustomEvent("twyne:citations", { detail: citations }),
              );
            }

            window.dispatchEvent(
              new CustomEvent("twyne:content", { detail: html }),
            );
            saveContent(html);
          },
        });

        store.editor = editor;
      });
    });

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

    const insertTable = $((rows = 3, cols = 3) => {
      store.editor
        ?.chain()
        .focus()
        .insertTable({ rows, cols, withHeaderRow: true })
        .run();
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
      }
    });

    return (
      <div class="flex flex-1 flex-col min-h-0">
        {/* Toolbar */}
        <div class="flex items-center gap-1 px-4 py-2 border-b border-[var(--color-surface-3)] bg-white/80 backdrop-blur-sm sticky top-0 z-10 flex-wrap">
          <div class="flex items-center gap-0.5">
            <button
              title="Bold (⌘B)"
              onClick$={() => runCommand("bold")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              <b>B</b>
            </button>
            <button
              title="Italic (⌘I)"
              onClick$={() => runCommand("italic")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              <i>I</i>
            </button>
            <button
              title="Underline (⌘U)"
              onClick$={() => runCommand("underline")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              <u>U</u>
            </button>
            <button
              title="Strikethrough"
              onClick$={() => runCommand("strike")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              <s>S</s>
            </button>
            <button
              title="Highlight"
              onClick$={() => runCommand("highlight")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              🖍️
            </button>
          </div>

          <div class="w-px h-6 bg-[var(--color-surface-3)] mx-1" />

          <div class="flex items-center gap-0.5">
            <button
              title="Heading 1"
              onClick$={() => runCommand("h1")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              H1
            </button>
            <button
              title="Heading 2"
              onClick$={() => runCommand("h2")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              H2
            </button>
            <button
              title="Heading 3"
              onClick$={() => runCommand("h3")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              H3
            </button>
          </div>

          <div class="w-px h-6 bg-[var(--color-surface-3)] mx-1" />

          <div class="flex items-center gap-0.5">
            <button
              title="Bullet List"
              onClick$={() => runCommand("bullet")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              • List
            </button>
            <button
              title="Numbered List"
              onClick$={() => runCommand("ordered")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              1. List
            </button>
            <button
              title="Blockquote"
              onClick$={() => runCommand("blockquote")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              ❝ Quote
            </button>
            <button
              title="Code Block"
              onClick$={() => runCommand("code")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              {"</>"}
            </button>
          </div>

          <div class="w-px h-6 bg-[var(--color-surface-3)] mx-1" />

          <div class="flex items-center gap-0.5">
            <button
              title="Align Left"
              onClick$={() => runCommand("left")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              ⬅
            </button>
            <button
              title="Align Center"
              onClick$={() => runCommand("center")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              ⬌
            </button>
            <button
              title="Align Right"
              onClick$={() => runCommand("right")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              ➡
            </button>
          </div>

          <div class="w-px h-6 bg-[var(--color-surface-3)] mx-1" />

          <div class="flex items-center gap-0.5">
            <button
              title="Insert Image"
              onClick$={() => {
                const url = prompt("Image URL:") || "";
                if (url) insertImage(url);
              }}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              🖼️ Image
            </button>
            <button
              title="Insert Table"
              onClick$={() => insertTable()}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              📊 Table
            </button>
            <button
              title="Horizontal Rule"
              onClick$={() => runCommand("horizontal")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              ───
            </button>
          </div>

          <div class="flex-1" />

          <div class="flex items-center gap-0.5">
            <button
              title="Undo (⌘Z)"
              onClick$={() => runCommand("undo")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              ↩
            </button>
            <button
              title="Redo (⌘⇧Z)"
              onClick$={() => runCommand("redo")}
              class="px-2 py-1 text-sm rounded hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
            >
              ↪
            </button>
          </div>
        </div>

        {/* Editor area */}
        <div
          class="flex-1 overflow-y-auto bg-[var(--color-editor-bg)]"
          preventdefault:dragover
          preventdefault:dragleave
          preventdefault:drop
          onDragOver$={handleDragOver}
          onDragLeave$={handleDragLeave}
          onDrop$={handleDrop}
        >
          {store.isDragOver && (
            <div class="drag-overlay">
              <span>Drop image or table here</span>
            </div>
          )}
          <div class="max-w-3xl mx-auto px-8 py-12 twyne-editor">
            <div id="twyne-editor-mount" />
          </div>
        </div>

        {/* Status bar */}
        <div class="flex items-center justify-between px-4 py-1.5 border-t border-[var(--color-surface-3)] bg-[var(--color-surface)] text-xs text-[var(--color-ink-muted)]">
          <span>{formatWordCount(store.meta.wordCount)} words</span>
          <span>{readingTimeLabel(store.meta.readingTime)}</span>
        </div>
      </div>
    );
  },
);

function saveContent(html: string): void {
  saveDraftHtml(html);
}

function loadSavedContent(initialContent: string): string {
  const saved = loadDraftHtml();
  return saved || initialContent;
}
