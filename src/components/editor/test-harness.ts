// @ts-expect-error — jsdom ships JS only; no @types/jsdom is installed.
import { JSDOM } from "jsdom";
import { Editor, type EditorOptions } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { CommentMark } from "./extensions/comment-mark";
import { PersonaNoteMark } from "./extensions/persona-note-mark";
import { SuggestionMark } from "./extensions/suggestion-mark";

/**
 * Tiptap + JSDOM test harness. The project's editor mounts inside a
 * Qwik component, which is too much ceremony to drive under test; the
 * extensions and the documents they operate on, however, are pure and
 * cover the lion's share of the bug surface (mark shape, anchor
 * preservation, setComment command, etc.). This file stands up a
 * minimal JSDOM, installs the project extensions on a fresh editor,
 * and yields the editor for the test to drive.
 *
 * Tests should not import this file directly. They use the `withEditor`
 * helper, which handles setup, teardown, and DOM global management in
 * one call.
 */

export interface EditorHarness {
  dom: JSDOM;
  editor: Editor;
  host: HTMLElement;
  /** Convenience for tests that need to read the rendered HTML. */
  html: () => string;
}

export interface WithEditorOptions {
  content?: string;
  /** Extra extensions on top of the project's standard set. */
  extensions?: EditorOptions["extensions"];
}

/** Standard Tiptap extensions used by the project's editor. */
export const projectExtensions = [
  StarterKit,
  CommentMark,
  PersonaNoteMark,
  SuggestionMark,
];

/**
 * Mount a Tiptap editor in a fresh JSDOM and yield it to the test.
 * Installs DOM globals for the lifetime of the callback, then tears
 * them down so a follow-up test gets a clean slate.
 */
export async function withEditor(
  opts: WithEditorOptions | ((harness: EditorHarness) => Promise<void> | void),
  run?: (harness: EditorHarness) => Promise<void> | void,
): Promise<void> {
  // Backwards-compatible: `withEditor(cb)` still works.
  if (typeof opts === "function") {
    run = opts as (h: EditorHarness) => Promise<void> | void;
    opts = {};
  }
  const options = (opts ?? {}) as WithEditorOptions;

  const dom = new JSDOM(
    `<!DOCTYPE html><html><body><div id="editor-mount"></div></body></html>`,
  );

  const previousGlobals: Record<string, unknown> = {};
  const install = (key: string, value: unknown) => {
    previousGlobals[key] = (globalThis as Record<string, unknown>)[key];
    (globalThis as Record<string, unknown>)[key] = value;
  };

  install("document", dom.window.document);
  install("window", dom.window);
  install("HTMLElement", dom.window.HTMLElement);
  install("Node", dom.window.Node);
  install("Element", dom.window.Element);
  install("navigator", dom.window.navigator);
  install("getComputedStyle", dom.window.getComputedStyle);
  install(
    "requestAnimationFrame",
    (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number,
  );
  install("cancelAnimationFrame", (id: number) => clearTimeout(id));

  const host = document.getElementById("editor-mount")!;
  const editor = new Editor({
    element: host,
    extensions: [...projectExtensions, ...(options.extensions ?? [])],
    content: options.content ?? "",
  });

  const harness: EditorHarness = {
    dom,
    editor,
    host,
    html: () => editor.getHTML(),
  };

  try {
    await run?.(harness);
  } finally {
    editor.destroy();
    dom.window.close();
    for (const key of Object.keys(previousGlobals)) {
      (globalThis as Record<string, unknown>)[key] = previousGlobals[key];
    }
  }
}
