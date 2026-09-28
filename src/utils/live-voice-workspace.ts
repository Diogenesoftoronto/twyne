import type { Editor } from "@tiptap/core";
import type { LiveAction } from "./live-voice-contract";

let current: Editor | null = null;
let generation = 0;
export function registerVoiceEditor(editor: Editor): () => void {
  current = editor;
  generation++;
  return () => {
    if (current === editor) {
      current = null;
      generation++;
      if (typeof window !== "undefined")
        window.dispatchEvent(new window.Event("twyne:voice-workspace-closed"));
    }
  };
}
export function invalidateVoiceWorkspace() {
  generation++;
}
export function voiceWorkspace() {
  const editor = current;
  if (!editor || editor.isDestroyed) return null;
  const { from, to } = editor.state.selection;
  return {
    text: editor.getText().slice(0, 20_000),
    selection: editor.state.doc.textBetween(from, to, "\n").slice(0, 8000),
    revision: `${generation}:${editor.getHTML()}`,
  };
}

/** Text-node positions preserve formatting outside the requested passage. Ambiguous matches never edit. */
export function voiceMatches(editor: Editor, text: string) {
  const matches: Array<{ from: number; to: number }> = [];
  if (!text.trim()) return matches;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const plain = node.textBetween(0, node.content.size, "", "\uFFFC");
    let offset = plain.indexOf(text);
    while (offset !== -1) {
      matches.push({
        from: pos + 1 + offset,
        to: pos + 1 + offset + text.length,
      });
      offset = plain.indexOf(text, offset + Math.max(1, text.length));
    }
    return false;
  });
  return matches;
}
export function findVoicePassage(text: string): string {
  if (!current) throw new Error("Open a manuscript first.");
  const matches = voiceMatches(current, text);
  if (!matches.length) return "That phrase was not found in the manuscript.";
  current.chain().setTextSelection(matches[0]).scrollIntoView().run();
  return `Selected the ${matches.length > 1 ? "first of " + matches.length + " matches" : "matching passage"}.`;
}
export function applyVoiceEdit(action: LiveAction, revision: string): string {
  const editor = current;
  if (!editor || editor.isDestroyed || !editor.isEditable)
    throw new Error("This manuscript is not editable.");
  if (voiceWorkspace()?.revision !== revision)
    throw new Error(
      "The draft changed. Ask for a fresh edit before applying it.",
    );
  const paragraphs = action.text.split(/\n\s*\n/).map((text) => ({
    type: "paragraph",
    content: text ? [{ type: "text", text }] : [],
  }));
  if (action.kind === "append") {
    if (!action.text.trim()) throw new Error("There is no text to add.");
    if (
      !editor
        .chain()
        .insertContentAt(editor.state.doc.content.size, paragraphs)
        .run()
    )
      throw new Error("The text could not be added.");
  } else if (action.kind === "replace") {
    const matches = voiceMatches(editor, action.original);
    if (matches.length !== 1)
      throw new Error(
        "The passage is missing or appears more than once. Select a unique passage and try again.",
      );
    const content = action.text
      ? action.text.includes("\n")
        ? paragraphs
        : [{ type: "text", text: action.text }]
      : [];
    if (!editor.chain().insertContentAt(matches[0], content).run())
      throw new Error("The edit could not be applied.");
  } else throw new Error("This is not a draft edit.");
  return "Applied to the manuscript. You can undo it in the editor.";
}

export const LIVE_OPEN_EVENT = "twyne:live-voice-open";
export function openLiveVoice(author?: string, passage?: string) {
  window.dispatchEvent(
    new CustomEvent(LIVE_OPEN_EVENT, { detail: { author, passage } }),
  );
}
