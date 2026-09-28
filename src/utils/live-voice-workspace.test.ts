import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
// @ts-expect-error jsdom has no installed declaration package in this workspace.
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  applyVoiceEdit,
  invalidateVoiceWorkspace,
  registerVoiceEditor,
  voiceWorkspace,
} from "./live-voice-workspace";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

const release = await lockBrowserGlobalsForTestFile();
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const names = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "DOMParser",
  "getComputedStyle",
] as const;
const previous = new Map(
  names.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]),
);
for (const name of names)
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value:
      name === "getComputedStyle"
        ? dom.window.getComputedStyle.bind(dom.window)
        : dom.window[name],
  });
let editor: Editor;
let unregister: () => void;
beforeEach(() => {
  editor = new Editor({
    extensions: [StarterKit],
    content:
      "<p>A <strong>bright</strong> morning.</p><p>Keep this paragraph.</p>",
  });
  unregister = registerVoiceEditor(editor);
});
afterEach(() => {
  unregister();
  editor.destroy();
});
afterAll(() => {
  for (const name of names) {
    const descriptor = previous.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  dom.window.close();
  release();
});
const edit = {
  kind: "replace" as const,
  original: "morning",
  text: "afternoon",
  target: "",
};

test("a spoken edit preserves unrelated rich text and remains undoable", () => {
  const before = editor.getHTML();
  applyVoiceEdit(edit, voiceWorkspace()!.revision);
  expect(editor.getHTML()).toContain("<strong>bright</strong>");
  expect(editor.getText()).toContain("afternoon");
  expect(editor.getText()).toContain("Keep this paragraph.");
  editor.commands.undo();
  expect(editor.getHTML()).toBe(before);
});
test("a pending voice edit cannot overwrite intervening typing or another folio", () => {
  const revision = voiceWorkspace()!.revision;
  editor.commands.insertContentAt(
    editor.state.doc.content.size,
    "<p>New writing</p>",
  );
  expect(() => applyVoiceEdit(edit, revision)).toThrow("draft changed");
  const next = voiceWorkspace()!.revision;
  invalidateVoiceWorkspace();
  expect(() => applyVoiceEdit(edit, next)).toThrow("draft changed");
});
test("ambiguous passages and read-only documents reject edits", () => {
  editor.commands.setContent("<p>morning</p><p>morning</p>");
  expect(() => applyVoiceEdit(edit, voiceWorkspace()!.revision)).toThrow(
    "more than once",
  );
  editor.setEditable(false);
  expect(() => applyVoiceEdit(edit, voiceWorkspace()!.revision)).toThrow(
    "not editable",
  );
});
test("spoken additions are text, never executable markup", () => {
  applyVoiceEdit(
    {
      kind: "append",
      original: "",
      text: '<img src=x onerror="alert(1)">',
      target: "",
    },
    voiceWorkspace()!.revision,
  );
  expect(editor.getHTML()).toContain("&lt;img");
  expect(editor.getHTML()).not.toContain("<img");
});
