import type { Editor } from "@tiptap/core";

export type MathNodeName = "inlineMath" | "blockMath";

export interface MathSourceEditorOptions {
  editor: Editor;
  getPos: () => number | undefined;
  nodeName: MathNodeName;
  source: string;
  label: string;
  onClose: () => void;
}

export interface MathSourceEditor {
  dom: HTMLFormElement;
  input: HTMLTextAreaElement;
  focus: () => void;
  destroy: () => void;
}

function updateSource(
  editor: Editor,
  getPos: () => number | undefined,
  nodeName: MathNodeName,
  source: string,
): boolean {
  const pos = getPos();
  if (typeof pos !== "number") return false;

  return editor
    .chain()
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node || node.type.name !== nodeName) return false;

      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        source,
      });
      return true;
    })
    .focus()
    .run();
}

/**
 * A small DOM editor used inside both math NodeViews. It intentionally commits
 * through the Tiptap transaction pipeline, so edits are undoable and survive
 * the manuscript's ordinary HTML persistence path.
 */
export function createMathSourceEditor(
  options: MathSourceEditorOptions,
): MathSourceEditor {
  const form = document.createElement("form");
  form.className = "twyne-math-source-editor";
  form.setAttribute("data-math-source-editor", options.nodeName);

  const label = document.createElement("label");
  label.className = "twyne-math-source-label";
  label.textContent = options.label;

  const input = document.createElement("textarea");
  input.className = "twyne-math-source-input";
  input.rows = options.nodeName === "blockMath" ? 3 : 2;
  input.value = options.source;
  input.spellcheck = false;
  input.autocapitalize = "off";
  input.autocomplete = "off";
  input.setAttribute("aria-label", options.label);

  const actions = document.createElement("span");
  actions.className = "twyne-math-source-actions";

  const save = document.createElement("button");
  save.className = "twyne-math-source-save";
  save.type = "submit";
  save.textContent = "Render equation";

  const cancel = document.createElement("button");
  cancel.className = "twyne-math-source-cancel";
  cancel.type = "button";
  cancel.textContent = "Cancel";

  actions.append(save, cancel);
  label.append(input);
  form.append(label, actions);

  const closeAndFocusNode = () => {
    const pos = options.getPos();
    options.onClose();
    if (typeof pos === "number") {
      options.editor.chain().setNodeSelection(pos).focus().run();
    } else {
      options.editor.commands.focus();
    }
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (
      updateSource(
        options.editor,
        options.getPos,
        options.nodeName,
        input.value,
      )
    ) {
      options.onClose();
    }
  };

  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocusNode();
      return;
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      (event.metaKey || event.ctrlKey || options.nodeName === "inlineMath")
    ) {
      event.preventDefault();
      event.stopPropagation();
      form.requestSubmit();
    }
  };

  const cancelEdit = () => closeAndFocusNode();

  form.addEventListener("submit", submit);
  input.addEventListener("keydown", keydown);
  cancel.addEventListener("click", cancelEdit);

  return {
    dom: form,
    input,
    focus: () => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    },
    destroy: () => {
      form.removeEventListener("submit", submit);
      input.removeEventListener("keydown", keydown);
      cancel.removeEventListener("click", cancelEdit);
    },
  };
}
