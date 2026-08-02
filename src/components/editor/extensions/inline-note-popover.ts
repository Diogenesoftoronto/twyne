import type { Editor, NodeViewRendererProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import { EndnoteNode } from "./endnote-node";
import {
  adjacentInlineNote,
  collectInlineNotes,
  convertInlineNote,
  deleteInlineNote,
  focusInlineNoteReference,
  normalizeInlineNoteKind,
  updateInlineNote,
  type InlineNoteKind,
} from "../note-editing";

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  return element;
}

function stylePopover(element: HTMLElement): void {
  Object.assign(element.style, {
    position: "fixed",
    zIndex: "var(--z-dropdown, 40)",
    width: "min(22rem, calc(100vw - 2rem))",
    padding: "0.8rem",
    border: "1px solid var(--color-paper-3, #d2c8b5)",
    borderRadius: "4px",
    background: "var(--color-paper, #fffdf8)",
    color: "var(--color-ink, #221f1a)",
    boxShadow: "0 12px 36px rgb(0 0 0 / 0.18)",
    fontFamily: "var(--font-typewriter, monospace)",
  });
}

function positionPopover(popover: HTMLElement, marker: HTMLElement): void {
  const rect = marker.getBoundingClientRect();
  const width = Math.min(352, Math.max(240, window.innerWidth - 32));
  const height = popover.getBoundingClientRect().height || 260;
  const left = Math.max(
    16,
    Math.min(rect.left, Math.max(16, window.innerWidth - width - 16)),
  );
  const below = rect.bottom + 8;
  const above = rect.top - height - 8;
  const top =
    below + height <= window.innerHeight - 16 ? below : Math.max(16, above);

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.maxHeight = `${Math.max(120, window.innerHeight - 32)}px`;
  popover.style.overflowY = "auto";
}

/**
 * DOM NodeView kept in a new adapter file so the existing endnote node remains
 * untouched. Integration can register InlineNoteNode wherever EndnoteNode is
 * currently registered; its schema and HTML contract are inherited verbatim.
 */
export class InlineNotePopoverView implements NodeView {
  dom: HTMLElement;

  private node: ProseMirrorNode;

  private readonly editor: Editor;

  private readonly getPos: NodeViewRendererProps["getPos"];

  private popover: HTMLElement | null = null;

  private textarea: HTMLTextAreaElement | null = null;

  private outsidePointerDown: ((event: PointerEvent) => void) | null = null;

  private readonly refreshMarker = () => {
    this.renderMarker();
    if (this.popover) {
      this.syncPopover();
      positionPopover(this.popover, this.dom);
    }
  };

  constructor(props: NodeViewRendererProps) {
    this.node = props.node;
    this.editor = props.editor;
    this.getPos = props.getPos;

    this.dom = document.createElement("sup");
    this.dom.className = "twyne-endnote twyne-inline-note-reference";
    this.dom.tabIndex = 0;
    this.dom.setAttribute("contenteditable", "false");
    this.dom.setAttribute("aria-haspopup", "dialog");

    this.dom.addEventListener("click", (event) => {
      event.preventDefault();
      this.open();
    });
    this.dom.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.open();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.returnFocusToReference();
      }
    });

    this.editor.on("transaction", this.refreshMarker);
    this.renderMarker();
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.refreshMarker();
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    return (
      target instanceof globalThis.Node &&
      (this.dom.contains(target) || Boolean(this.popover?.contains(target)))
    );
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.editor.off("transaction", this.refreshMarker);
    this.close(false);
  }

  open(): void {
    if (this.popover) {
      this.textarea?.focus();
      return;
    }

    const note = this.currentNote();
    if (!note) return;

    const popover = document.createElement("div");
    popover.className = "twyne-inline-note-popover";
    popover.dataset.inlineNotePopover = "true";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-modal", "false");
    stylePopover(popover);

    const heading = document.createElement("div");
    heading.dataset.noteHeading = "true";
    Object.assign(heading.style, {
      marginBottom: "0.55rem",
      fontSize: "0.72rem",
      fontWeight: "700",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    });

    const textarea = document.createElement("textarea");
    textarea.value = note.text;
    textarea.rows = 5;
    textarea.setAttribute("aria-label", "Note text");
    Object.assign(textarea.style, {
      display: "block",
      width: "100%",
      boxSizing: "border-box",
      resize: "vertical",
      padding: "0.55rem",
      border: "1px solid var(--color-paper-3, #d2c8b5)",
      borderRadius: "3px",
      background: "var(--color-paper-soft, #faf6ed)",
      color: "inherit",
      font: "inherit",
      lineHeight: "1.45",
    });
    textarea.addEventListener("input", () => {
      updateInlineNote(this.editor, this.getPos, { text: textarea.value });
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.returnFocusToReference();
      }
    });

    const kindLabel = document.createElement("label");
    kindLabel.textContent = "Kind ";
    Object.assign(kindLabel.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.4rem",
      marginTop: "0.65rem",
      fontSize: "0.75rem",
    });

    const kindSelect = document.createElement("select");
    kindSelect.setAttribute("aria-label", "Note kind");
    for (const [value, label] of [
      ["footnote", "Footnote"],
      ["endnote", "Endnote"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      kindSelect.append(option);
    }
    kindSelect.value = note.kind;
    kindSelect.addEventListener("change", () => {
      convertInlineNote(
        this.editor,
        this.getPos,
        normalizeInlineNoteKind(kindSelect.value),
      );
    });
    kindLabel.append(kindSelect);

    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "0.35rem",
      marginTop: "0.75rem",
    });

    const previous = button("Previous");
    previous.dataset.notePrevious = "true";
    previous.addEventListener("click", () => this.openAdjacent("previous"));

    const reference = button("Reference");
    reference.dataset.noteReference = "true";
    reference.addEventListener("click", () => this.returnFocusToReference());

    const next = button("Next");
    next.dataset.noteNext = "true";
    next.addEventListener("click", () => this.openAdjacent("next"));

    const remove = button("Delete");
    remove.dataset.noteDelete = "true";
    remove.setAttribute("aria-label", "Delete note");
    remove.addEventListener("click", () => {
      this.close(false);
      deleteInlineNote(this.editor, this.getPos);
      this.editor.view.focus();
    });

    for (const action of [previous, reference, next, remove]) {
      Object.assign(action.style, {
        padding: "0.35rem 0.5rem",
        border: "1px solid var(--color-paper-3, #d2c8b5)",
        borderRadius: "3px",
        background: "var(--color-paper-soft, #faf6ed)",
        color: "inherit",
        cursor: "pointer",
        font: "inherit",
        fontSize: "0.72rem",
      });
      actions.append(action);
    }

    popover.append(heading, textarea, kindLabel, actions);
    document.body.append(popover);
    this.popover = popover;
    this.textarea = textarea;
    this.syncPopover();
    positionPopover(popover, this.dom);

    this.outsidePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof globalThis.Node)) return;
      if (this.dom.contains(target) || popover.contains(target)) return;
      this.close(false);
    };
    document.addEventListener("pointerdown", this.outsidePointerDown, true);

    requestAnimationFrame(() => {
      this.textarea?.focus();
      this.textarea?.setSelectionRange(
        this.textarea.value.length,
        this.textarea.value.length,
      );
    });
  }

  close(returnFocus = false): void {
    if (this.outsidePointerDown) {
      document.removeEventListener(
        "pointerdown",
        this.outsidePointerDown,
        true,
      );
      this.outsidePointerDown = null;
    }
    this.popover?.remove();
    this.popover = null;
    this.textarea = null;

    if (returnFocus) {
      focusInlineNoteReference(this.editor, this.getPos);
      this.dom.focus();
    }
  }

  private currentNote() {
    const pos = this.getPos();
    if (typeof pos !== "number") return null;
    return (
      collectInlineNotes(this.editor.state.doc).find(
        (note) => note.pos === pos,
      ) ?? null
    );
  }

  private renderMarker(): void {
    const note = this.currentNote();
    if (!note) return;

    const kind = normalizeInlineNoteKind(note.kind);
    this.dom.dataset.type = kind;
    this.dom.dataset.inlineNoteNumber = String(note.number);
    this.dom.setAttribute("data-endnote-text", note.text);
    this.dom.title = note.text;
    this.dom.setAttribute(
      "aria-label",
      `${kind === "footnote" ? "Footnote" : "Endnote"} ${note.number}: ${
        note.text || "Empty note"
      }. Activate to edit.`,
    );
  }

  private syncPopover(): void {
    const note = this.currentNote();
    if (!note || !this.popover) return;

    const heading = this.popover.querySelector<HTMLElement>(
      "[data-note-heading]",
    );
    const select = this.popover.querySelector<HTMLSelectElement>(
      'select[aria-label="Note kind"]',
    );
    const previous = this.popover.querySelector<HTMLButtonElement>(
      "[data-note-previous]",
    );
    const next =
      this.popover.querySelector<HTMLButtonElement>("[data-note-next]");

    if (heading) {
      heading.textContent = `${
        note.kind === "footnote" ? "Footnote" : "Endnote"
      } ${note.number}`;
    }
    if (select && select.value !== note.kind) select.value = note.kind;
    if (this.textarea && document.activeElement !== this.textarea) {
      this.textarea.value = note.text;
    }

    if (previous) {
      previous.disabled = !adjacentInlineNote(
        this.editor.state.doc,
        this.getPos,
        "previous",
      );
    }
    if (next) {
      next.disabled = !adjacentInlineNote(
        this.editor.state.doc,
        this.getPos,
        "next",
      );
    }
  }

  private returnFocusToReference(): void {
    this.close(true);
  }

  private openAdjacent(direction: "previous" | "next"): void {
    const adjacent = adjacentInlineNote(
      this.editor.state.doc,
      this.getPos,
      direction,
    );
    if (!adjacent) return;

    this.close(false);
    focusInlineNoteReference(this.editor, adjacent.pos);
    const target = this.editor.view.nodeDOM(adjacent.pos);
    const marker =
      target instanceof HTMLElement
        ? target
        : target?.parentElement instanceof HTMLElement
          ? target.parentElement
          : null;
    marker?.closest<HTMLElement>(".twyne-inline-note-reference")?.click();
  }
}

export const InlineNoteNode = EndnoteNode.extend({
  addNodeView() {
    return (props) => new InlineNotePopoverView(props);
  },
});

export type { InlineNoteKind };
