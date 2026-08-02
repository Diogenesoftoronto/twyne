import { describe, expect, test } from "bun:test";

import { withEditor } from "../test-harness";
import { SectionReorder, getSectionReorderState } from "./section-reorder";

const extensions = [SectionReorder];

describe("SectionReorder extension", () => {
  test("moves a parent and nested section in one undoable transaction", async () => {
    await withEditor(
      {
        content:
          "<h1>First</h1><p>Opening</p><h2>Nested</h2><p>Nested body</p><h1>Second</h1><p>Closing</p>",
        extensions,
      },
      ({ editor, html }) => {
        const before = html();
        expect(editor.commands.moveSection("first", "second", "after")).toBe(
          true,
        );
        expect(editor.getText()).toBe(
          "Second\n\nClosing\n\nFirst\n\nOpening\n\nNested\n\nNested body",
        );

        expect(editor.commands.undo()).toBe(true);
        expect(html()).toBe(before);
        expect(editor.commands.undo()).toBe(false);
      },
    );
  });

  test("rejects a parent drop onto its own child without changing history", async () => {
    await withEditor(
      {
        content:
          "<h1>Parent</h1><p>Body</p><h2>Child</h2><p>Detail</p><h1>Other</h1><p>Tail</p>",
        extensions,
      },
      ({ editor, html }) => {
        const before = html();
        expect(editor.commands.moveSection("parent", "child", "after")).toBe(
          false,
        );
        expect(html()).toBe(before);
        expect(editor.commands.undo()).toBe(false);
      },
    );
  });

  test("renders one accessible drag handle for each heading", async () => {
    await withEditor(
      {
        content: "<h1>One</h1><p>Body</p><h2>Two</h2>",
        extensions,
      },
      ({ host }) => {
        const handles = host.querySelectorAll<HTMLElement>(
          "[data-section-drag-handle]",
        );
        expect(handles).toHaveLength(2);
        expect(handles[0].draggable).toBe(true);
        expect(handles[0].getAttribute("aria-label")).toBe("Move section: One");
      },
    );
  });

  test("a rendered handle starts the plugin drag interaction", async () => {
    await withEditor(
      { content: "<h1>One</h1><p>Body</p>", extensions },
      ({ dom, editor, host }) => {
        const handle = host.querySelector<HTMLElement>(
          "[data-section-drag-handle]",
        )!;
        const event = new dom.window.Event("dragstart", {
          bubbles: true,
          cancelable: true,
        });

        handle.dispatchEvent(event);

        expect(getSectionReorderState(editor.state)?.draggingId).toBe("one");
      },
    );
  });

  test("an invalid DOM self-drop is cancelled without changing content", async () => {
    await withEditor(
      {
        content:
          "<h1>Parent</h1><p>Body</p><h2>Child</h2><p>Detail</p><h1>Other</h1><p>Tail</p>",
        extensions,
      },
      ({ dom, editor, host, html }) => {
        const before = html();
        const handle = host.querySelector<HTMLElement>(
          '[data-section-drag-handle="parent"]',
        )!;
        handle.dispatchEvent(
          new dom.window.Event("dragstart", {
            bubbles: true,
            cancelable: true,
          }),
        );

        const child = host.querySelector("h2")!;
        const drop = new dom.window.Event("drop", {
          bubbles: true,
          cancelable: true,
        });
        child.dispatchEvent(drop);

        expect(drop.defaultPrevented).toBe(true);
        expect(getSectionReorderState(editor.state)?.draggingId).toBeNull();
        expect(html()).toBe(before);
      },
    );
  });
});
