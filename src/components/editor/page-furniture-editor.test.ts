import { describe, expect, test } from "bun:test";
import {
  PAGE_FURNITURE_EVENT,
  createPageFurnitureChange,
  createPageFurnitureEditorState,
  dispatchPageFurnitureChange,
  normalizePageFurnitureValue,
  pageFurnitureDisplayValue,
  pageFurnitureKeyboardAction,
  transitionPageFurnitureEditor,
  type PageFurnitureEditorState,
} from "./page-furniture-editor";

function begin(value = "Draft title"): PageFurnitureEditorState {
  return transitionPageFurnitureEditor(createPageFurnitureEditorState(value), {
    type: "begin",
  }).state;
}

describe("page furniture value contract", () => {
  test("uses the exact existing per-folio event names", () => {
    expect(PAGE_FURNITURE_EVENT).toEqual({
      header: "twyne:header",
      footer: "twyne:footer",
    });
    expect(createPageFurnitureChange("header", "Running title")).toEqual({
      kind: "header",
      value: "Running title",
      eventName: "twyne:header",
    });
    expect(createPageFurnitureChange("footer", "Confidential")).toEqual({
      kind: "footer",
      value: "Confidential",
      eventName: "twyne:footer",
    });
  });

  test("whitespace-only edits clear the custom value and restore fallback", () => {
    expect(normalizePageFurnitureValue(" \n\t ")).toBe("");
    expect(pageFurnitureDisplayValue(" \n\t ", "Untitled")).toBe("Untitled");
    expect(pageFurnitureDisplayValue("", "7")).toBe("7");
  });

  test("preserves non-empty furniture text exactly", () => {
    expect(normalizePageFurnitureValue("  Part I  ")).toBe("  Part I  ");
    expect(pageFurnitureDisplayValue("  Part I  ", "Untitled")).toBe(
      "  Part I  ",
    );
  });

  test("dispatches the persisted value as CustomEvent detail", () => {
    const received: Event[] = [];
    const target = {
      dispatchEvent(event: Event) {
        received.push(event);
        return true;
      },
    };

    const result = dispatchPageFurnitureChange(
      createPageFurnitureChange("header", "Short title"),
      target,
    );

    expect(result).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("twyne:header");
    expect((received[0] as CustomEvent<string>).detail).toBe("Short title");
  });
});

describe("page furniture editing state", () => {
  test("begin snapshots the persisted value for cancellation", () => {
    expect(begin("Original")).toEqual({
      editing: true,
      value: "Original",
      original: "Original",
      draft: "Original",
    });
  });

  test("commit returns one changed effect and settles on the new value", () => {
    const editing = transitionPageFurnitureEditor(begin("Original"), {
      type: "input",
      value: "Revised",
    }).state;
    const committed = transitionPageFurnitureEditor(editing, {
      type: "commit",
    });

    expect(committed.effect).toEqual({
      type: "commit",
      value: "Revised",
      changed: true,
    });
    expect(committed.state).toEqual({
      editing: false,
      value: "Revised",
      original: "Revised",
      draft: "Revised",
    });
  });

  test("an unchanged commit is marked for de-duplication", () => {
    const committed = transitionPageFurnitureEditor(begin("Original"), {
      type: "commit",
    });
    expect(committed.effect).toEqual({
      type: "commit",
      value: "Original",
      changed: false,
    });
  });

  test("committing whitespace persists empty so the fallback can return", () => {
    const editing = transitionPageFurnitureEditor(begin("Original"), {
      type: "input",
      value: "   ",
    }).state;
    const committed = transitionPageFurnitureEditor(editing, {
      type: "commit",
    });

    expect(committed.effect).toEqual({
      type: "commit",
      value: "",
      changed: true,
    });
    expect(pageFurnitureDisplayValue(committed.state.value, "Untitled")).toBe(
      "Untitled",
    );
  });

  test("cancel restores the snapshot and exposes it to the focus owner", () => {
    const editing = transitionPageFurnitureEditor(begin("Original"), {
      type: "input",
      value: "Discard me",
    }).state;
    const cancelled = transitionPageFurnitureEditor(editing, {
      type: "cancel",
    });

    expect(cancelled.effect).toEqual({
      type: "cancel",
      value: "Original",
    });
    expect(cancelled.state).toEqual({
      editing: false,
      value: "Original",
      original: "Original",
      draft: "Original",
    });
  });

  test("external folio changes sync only while idle", () => {
    const idle = createPageFurnitureEditorState("First folio");
    expect(
      transitionPageFurnitureEditor(idle, {
        type: "external",
        value: "Second folio",
      }).state.value,
    ).toBe("Second folio");

    const editing = begin("First folio");
    expect(
      transitionPageFurnitureEditor(editing, {
        type: "external",
        value: "Second folio",
      }).state,
    ).toEqual(editing);
  });

  test("reopening uses the locally committed value until the parent syncs", () => {
    const editing = transitionPageFurnitureEditor(begin("Original"), {
      type: "input",
      value: "Locally committed",
    }).state;
    const committed = transitionPageFurnitureEditor(editing, {
      type: "commit",
    }).state;

    expect(
      transitionPageFurnitureEditor(committed, { type: "begin" }).state,
    ).toEqual({
      editing: true,
      value: "Locally committed",
      original: "Locally committed",
      draft: "Locally committed",
    });
  });

  test("commit and cancel are inert when the editor is already closed", () => {
    const idle = createPageFurnitureEditorState("Stable");
    expect(transitionPageFurnitureEditor(idle, { type: "commit" })).toEqual({
      state: idle,
    });
    expect(transitionPageFurnitureEditor(idle, { type: "cancel" })).toEqual({
      state: idle,
    });
  });
});

describe("page furniture keyboard contract", () => {
  test("Enter commits, Escape cancels, and ordinary keys keep editing", () => {
    expect(pageFurnitureKeyboardAction("Enter")).toBe("commit");
    expect(pageFurnitureKeyboardAction("Escape")).toBe("cancel");
    expect(pageFurnitureKeyboardAction("Tab")).toBeNull();
    expect(pageFurnitureKeyboardAction("a")).toBeNull();
  });

  test("composition keystrokes never commit or cancel", () => {
    expect(pageFurnitureKeyboardAction("Enter", true)).toBeNull();
    expect(pageFurnitureKeyboardAction("Escape", true)).toBeNull();
  });
});
