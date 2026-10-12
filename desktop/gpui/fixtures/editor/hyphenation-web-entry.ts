// Verification bundle: mount the current web editor's real view decoration.
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { IlluminatedInitial } from "../../../../src/components/editor/extensions/illuminated-initial";

declare global {
  interface Window {
    twyneHyphenationFixture: { html: string; manual: boolean };
    twyneFixtureEditor: Editor;
  }
}

const { html, manual } = window.twyneHyphenationFixture;
const editor = new Editor({
  element: document.querySelector("#fixture")!,
  extensions: [StarterKit, IlluminatedInitial],
  content: html,
});
if (manual) {
  for (const paragraph of editor.view.dom.querySelectorAll("p")) {
    // This is the existing CSS selector's explicit-alignment/manual control.
    paragraph.style.textAlign = "justify";
  }
}
window.twyneFixtureEditor = editor;
