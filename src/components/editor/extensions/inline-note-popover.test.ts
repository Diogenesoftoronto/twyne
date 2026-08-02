import { describe, expect, test } from "bun:test";
import { InlineNoteNode } from "./inline-note-popover";
import { collectInlineNotes } from "../note-editing";
import { withEditor } from "../test-harness";

const CONTENT =
  '<p>A<sup data-endnote-text="Alpha" data-type="endnote"></sup> ' +
  'B<sup data-endnote-text="Beta" data-type="footnote"></sup></p>';

function dispatchKey(
  target: HTMLElement,
  key: string,
  window: typeof globalThis.window,
): void {
  target.dispatchEvent(
    new window.KeyboardEvent("keydown", { key, bubbles: true }),
  );
}

describe("inline note popover NodeView", () => {
  test("opens beside the reference with editing, kind, navigation, and delete controls", async () => {
    await withEditor(
      { content: CONTENT, extensions: [InlineNoteNode] },
      async ({ dom, host }) => {
        const marker = host.querySelector<HTMLElement>(
          ".twyne-inline-note-reference",
        )!;
        marker.click();

        const popover = dom.window.document.querySelector<HTMLElement>(
          "[data-inline-note-popover]",
        )!;
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(popover).toBeTruthy();
        expect(popover.style.position).toBe("fixed");
        expect(popover.querySelector('textarea[aria-label="Note text"]')).toBe(
          dom.window.document.activeElement,
        );
        expect(
          popover.querySelector('select[aria-label="Note kind"]'),
        ).toBeTruthy();
        expect(popover.querySelector("[data-note-previous]")).toBeTruthy();
        expect(popover.querySelector("[data-note-reference]")).toBeTruthy();
        expect(popover.querySelector("[data-note-next]")).toBeTruthy();
        expect(popover.querySelector("[data-note-delete]")).toBeTruthy();
      },
    );
  });

  test("typing edits the note immediately and kind conversion updates serialized HTML", async () => {
    await withEditor(
      { content: CONTENT, extensions: [InlineNoteNode] },
      ({ dom, editor, host }) => {
        host
          .querySelector<HTMLElement>(".twyne-inline-note-reference")!
          .click();
        const textarea = dom.window.document.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Note text"]',
        )!;
        textarea.value = "Revised";
        textarea.dispatchEvent(
          new dom.window.Event("input", { bubbles: true }),
        );

        const select = dom.window.document.querySelector<HTMLSelectElement>(
          'select[aria-label="Note kind"]',
        )!;
        select.value = "footnote";
        select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

        expect(collectInlineNotes(editor.state.doc)[0]).toMatchObject({
          text: "Revised",
          kind: "footnote",
          number: 1,
        });
        expect(editor.getHTML()).toContain('data-endnote-text="Revised"');
        expect(editor.getHTML()).toContain('data-type="footnote"');
      },
    );
  });

  test("Escape closes the popover and returns focus to the note reference", async () => {
    await withEditor(
      { content: CONTENT, extensions: [InlineNoteNode] },
      ({ dom, editor, host }) => {
        const marker = host.querySelector<HTMLElement>(
          ".twyne-inline-note-reference",
        )!;
        marker.click();
        const textarea = dom.window.document.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Note text"]',
        )!;

        dispatchKey(textarea, "Escape", dom.window);

        expect(
          dom.window.document.querySelector("[data-inline-note-popover]"),
        ).toBeNull();
        expect(dom.window.document.activeElement).toBe(marker);
        expect(editor.state.selection.constructor.name).toBe("NodeSelection");
      },
    );
  });

  test("Reference button returns to the marker and delete removes the note", async () => {
    await withEditor(
      { content: CONTENT, extensions: [InlineNoteNode] },
      ({ dom, editor, host }) => {
        const marker = host.querySelector<HTMLElement>(
          ".twyne-inline-note-reference",
        )!;
        marker.click();
        dom.window.document
          .querySelector<HTMLButtonElement>("[data-note-reference]")!
          .click();
        expect(dom.window.document.activeElement).toBe(marker);

        marker.click();
        dom.window.document
          .querySelector<HTMLButtonElement>("[data-note-delete]")!
          .click();
        expect(collectInlineNotes(editor.state.doc)).toHaveLength(1);
        expect(editor.getHTML()).not.toContain('data-endnote-text="Alpha"');
      },
    );
  });

  test("Next opens the adjacent note and updates navigation boundaries", async () => {
    await withEditor(
      { content: CONTENT, extensions: [InlineNoteNode] },
      ({ dom, host }) => {
        const markers = host.querySelectorAll<HTMLElement>(
          ".twyne-inline-note-reference",
        );
        markers[0]!.click();
        const previous = dom.window.document.querySelector<HTMLButtonElement>(
          "[data-note-previous]",
        )!;
        const next =
          dom.window.document.querySelector<HTMLButtonElement>(
            "[data-note-next]",
          )!;
        expect(previous.disabled).toBe(true);
        expect(next.disabled).toBe(false);

        next.click();

        const heading = dom.window.document.querySelector<HTMLElement>(
          "[data-note-heading]",
        )!;
        expect(heading.textContent).toBe("Footnote 1");
        expect(
          dom.window.document.querySelector<HTMLButtonElement>(
            "[data-note-previous]",
          )?.disabled,
        ).toBe(false);
        expect(
          dom.window.document.querySelector<HTMLButtonElement>(
            "[data-note-next]",
          )?.disabled,
        ).toBe(true);
      },
    );
  });
});
