import { describe, expect, test } from "bun:test";
import { withEditor } from "../test-harness";
import {
  ALTERNATIVES_EVENT,
  Alternatives,
  alternativesController,
  alternativesPluginKey,
  alternativesSnapshot,
  type AlternativesSnapshot,
} from "./alternatives";

const extensions = [Alternatives];

const posOf = (doc: { textContent: string }, text: string) =>
  // One paragraph: position = offset + 1 (the paragraph's opening token).
  doc.textContent.indexOf(text) + 1;

describe("Alternatives extension", () => {
  test("locks the word at the caret and publishes its context", async () => {
    await withEditor(
      { content: "<p>It was a happy, quiet day.</p>", extensions },
      ({ editor }) => {
        const events: Array<AlternativesSnapshot | null> = [];
        const listen = (e: Event) =>
          events.push((e as CustomEvent<AlternativesSnapshot | null>).detail);
        window.addEventListener(ALTERNATIVES_EVENT, listen);
        const at = posOf(editor.state.doc, "happy") + 2;
        editor.commands.setTextSelection(at);
        const result = alternativesController()!.open();
        window.removeEventListener(ALTERNATIVES_EVENT, listen);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.snapshot).toMatchObject({
          text: "happy",
          scale: "word",
          before: "It was a ",
          after: ", quiet day.",
        });
        expect(events.at(-1)?.id).toBe(result.snapshot.id);
        // The palette needs the page and the area it scrolls in to find
        // margin room for a longer span.
        expect(result.snapshot.anchor.page).toBeDefined();
        expect(result.snapshot.anchor.bounds).toBeDefined();
        expect(alternativesSnapshot()?.text).toBe("happy");
        alternativesController()!.close();
        expect(alternativesSnapshot()).toBeNull();
      },
    );
  });

  test("a selection with trailing punctuation locks just the word", async () => {
    await withEditor(
      { content: "<p>It was a happy, quiet day.</p>", extensions },
      ({ editor }) => {
        const from = posOf(editor.state.doc, "happy");
        editor.commands.setTextSelection({ from, to: from + "happy, ".length });
        const result = alternativesController()!.open();
        expect(result.ok && result.snapshot.text).toBe("happy");
        alternativesController()!.close();
      },
    );
  });

  test("previewing leaves the document and history untouched", async () => {
    await withEditor(
      { content: "<p>The old house stood alone.</p>", extensions },
      ({ editor, html }) => {
        const before = html();
        const from = posOf(editor.state.doc, "old house");
        alternativesController()!.open({ from, to: from + "old house".length });
        alternativesController()!.preview("weathered cottage");
        expect(html()).toBe(before);
        const ghost = editor.view.dom.querySelector(".twyne-alt-ghost");
        expect(ghost?.textContent).toBe("weathered cottage");
        expect(
          editor.view.dom.querySelector(".twyne-alt-lock--previewing")
            ?.textContent,
        ).toBe("old house");
        alternativesController()!.preview(null);
        expect(editor.view.dom.querySelector(".twyne-alt-ghost")).toBeNull();
        expect(editor.can().undo()).toBe(false);
        alternativesController()!.close();
      },
    );
  });

  test("applying replaces the span in one undoable step and keeps marks", async () => {
    await withEditor(
      { content: "<p>The <em>old house</em> stood alone.</p>", extensions },
      ({ editor }) => {
        const from = posOf(editor.state.doc, "old house");
        alternativesController()!.open({ from, to: from + "old house".length });
        const result = alternativesController()!.apply("weathered cottage");
        expect(result.ok).toBe(true);
        expect(editor.getHTML()).toBe(
          "<p>The <em>weathered cottage</em> stood alone.</p>",
        );
        expect(alternativesSnapshot()).toBeNull();
        expect(
          alternativesPluginKey.getState(editor.state)?.lock ?? null,
        ).toBeNull();
        // jsdom has no layout; undo scrolls its selection into view.
        const range = editor.view.dom.ownerDocument.defaultView!.Range
          .prototype as Range & { getClientRects?: () => DOMRectList };
        range.getClientRects ??= () => [] as unknown as DOMRectList;
        range.getBoundingClientRect ??= () =>
          ({
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: 0,
            height: 0,
          }) as DOMRect;
        editor.commands.undo();
        expect(editor.getHTML()).toBe(
          "<p>The <em>old house</em> stood alone.</p>",
        );
      },
    );
  });

  test("the lock follows edits elsewhere and ends when its words change", async () => {
    await withEditor(
      { content: "<p>The old house stood alone.</p>", extensions },
      async ({ editor }) => {
        const from = posOf(editor.state.doc, "house");
        alternativesController()!.open({ from, to: from + "house".length });
        editor.commands.insertContentAt(1, "Then ");
        const lock = alternativesPluginKey.getState(editor.state)!.lock!;
        expect(editor.state.doc.textBetween(lock.from, lock.to)).toBe("house");
        expect(alternativesSnapshot()).not.toBeNull();
        editor.commands.insertContentAt(lock.from + 2, "x");
        await new Promise((resolve) => queueMicrotask(() => resolve(null)));
        expect(alternativesSnapshot()).toBeNull();
      },
    );
  });

  test("refuses spans across paragraphs and in code", async () => {
    await withEditor(
      {
        content:
          "<p>First line here.</p><p>Second line.</p><pre><code>let x = 1</code></pre>",
        extensions,
      },
      ({ editor }) => {
        const doc = editor.state.doc;
        const second = doc.child(0).nodeSize + 3;
        expect(alternativesController()!.open({ from: 2, to: second }).ok).toBe(
          false,
        );
        const code = doc.child(0).nodeSize + doc.child(1).nodeSize + 2;
        expect(
          alternativesController()!.open({ from: code, to: code }).ok,
        ).toBe(false);
        expect(alternativesSnapshot()).toBeNull();
      },
    );
  });

  // jsdom has no layout; undo scrolls its selection into view.
  const allowUndoScroll = (editor: { view: { dom: HTMLElement } }) => {
    const range = editor.view.dom.ownerDocument.defaultView!.Range
      .prototype as Range & { getClientRects?: () => DOMRectList };
    range.getClientRects ??= () => [] as unknown as DOMRectList;
    range.getBoundingClientRect ??= () =>
      ({
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
      }) as DOMRect;
  };

  test("applying is its own undo step, apart from typing just before it", async () => {
    await withEditor(
      { content: "<p>The old house.</p>", extensions },
      ({ editor }) => {
        allowUndoScroll(editor);
        const end = posOf(editor.state.doc, "old") + 3;
        editor.commands.insertContentAt(end, "x");
        const from = posOf(editor.state.doc, "oldx");
        alternativesController()!.open({ from, to: from + 4 });
        alternativesController()!.apply("aged");
        expect(editor.getText()).toBe("The aged house.");
        editor.commands.undo();
        expect(editor.getText()).toBe("The oldx house.");
      },
    );
  });

  test("new words take the formatting of the words they replace", async () => {
    await withEditor(
      { content: "<p>The <em>old</em> house stood.</p>", extensions },
      ({ editor }) => {
        const from = posOf(editor.state.doc, "old house");
        alternativesController()!.open({ from, to: from + "old house".length });
        alternativesController()!.apply("aged cottage");
        expect(editor.getHTML()).toBe(
          "<p>The <em>aged</em> cottage stood.</p>",
        );
      },
    );
  });

  test("kept words keep their own formatting", async () => {
    await withEditor(
      { content: "<p>The <strong>old</strong> house stood.</p>", extensions },
      ({ editor }) => {
        const from = posOf(editor.state.doc, "old house");
        alternativesController()!.open({ from, to: from + "old house".length });
        alternativesController()!.apply("old cottage");
        expect(editor.getHTML()).toBe(
          "<p>The <strong>old</strong> cottage stood.</p>",
        );
      },
    );
  });

  test("Escape gives back the writer's own selection, caret or backward", async () => {
    await withEditor(
      { content: "<p>The old house stood.</p>", extensions },
      ({ editor }) => {
        const caret = posOf(editor.state.doc, "old") + 1;
        editor.commands.setTextSelection(caret);
        alternativesController()!.open();
        alternativesController()!.close();
        expect(editor.state.selection.from).toBe(caret);
        expect(editor.state.selection.empty).toBe(true);

        const start = posOf(editor.state.doc, "old");
        const end = start + "old house ".length;
        editor.commands.setTextSelection({ from: end, to: start });
        alternativesController()!.open();
        alternativesController()!.close();
        expect(editor.state.selection.anchor).toBe(end);
        expect(editor.state.selection.head).toBe(start);
      },
    );
  });

  test("a queued auto-close never closes a newer lock", async () => {
    await withEditor(
      { content: "<p>The old house stood alone.</p>", extensions },
      async ({ editor }) => {
        const a = posOf(editor.state.doc, "house");
        alternativesController()!.open({ from: a, to: a + "house".length });
        editor.commands.insertContentAt(a + 2, "x");
        const b = posOf(editor.state.doc, "alone");
        const result = alternativesController()!.open({
          from: b,
          to: b + "alone".length,
        });
        await new Promise((resolve) => queueMicrotask(() => resolve(null)));
        expect(result.ok).toBe(true);
        expect(alternativesSnapshot()?.text).toBe("alone");
        alternativesController()!.close();
      },
    );
  });
});
