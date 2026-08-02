import { describe, expect, test } from "bun:test";
import { withEditor } from "./test-harness";
import { createTableCoreExtensions } from "./extensions/table-format";
import {
  computeTableToolbarPosition,
  createTableToolbarController,
  getActiveTableElement,
  readTableToolbarSnapshot,
  type PlainRect,
} from "./floating-table-toolbar";

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): PlainRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

describe("floating table toolbar positioning", () => {
  test("prefers above and horizontally centers on the table", () => {
    expect(
      computeTableToolbarPosition(
        rect(200, 300, 400, 200),
        { width: 1000, height: 800 },
        { width: 600, height: 100 },
      ),
    ).toEqual({
      left: 100,
      top: 192,
      width: 600,
      placement: "above",
    });
  });

  test("flips below near the viewport top", () => {
    const position = computeTableToolbarPosition(
      rect(100, 20, 500, 200),
      { width: 900, height: 700 },
      { width: 600, height: 100 },
    );
    expect(position.placement).toBe("below");
    expect(position.top).toBe(228);
  });

  test("clamps a wide toolbar inside the viewport", () => {
    const position = computeTableToolbarPosition(
      rect(-50, 300, 200, 100),
      { width: 320, height: 640 },
      { width: 760, height: 100 },
    );
    expect(position.width).toBe(304);
    expect(position.left).toBe(8);
  });
});

describe("floating table toolbar active-table contract", () => {
  test("resolves the rendered table and returns live availability", async () => {
    await withEditor(
      {
        content:
          "<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>",
        extensions: createTableCoreExtensions(),
      },
      ({ editor }) => {
        editor.commands.setTextSelection(4);
        const table = getActiveTableElement(editor);
        expect(table).not.toBeNull();
        Object.defineProperty(table, "getBoundingClientRect", {
          configurable: true,
          value: () => ({
            left: 100,
            top: 200,
            right: 500,
            bottom: 350,
            width: 400,
            height: 150,
          }),
        });

        const snapshot = readTableToolbarSnapshot(editor, {
          width: 1000,
          height: 800,
        });
        expect(snapshot.visible).toBe(true);
        expect(snapshot.anchor?.width).toBe(400);
        expect(snapshot.position?.placement).toBe("above");
        expect(snapshot.availability.addColumnAfter).toBe(true);
        expect(snapshot.availability.mergeCells).toBe(false);
      },
    );
  });

  test("controller hides after the selection leaves the table", async () => {
    await withEditor(
      {
        content:
          "<table><tbody><tr><td><p>A</p></td></tr></tbody></table><p>After</p>",
        extensions: createTableCoreExtensions(),
      },
      ({ editor, dom }) => {
        editor.commands.setTextSelection(4);
        const snapshots: boolean[] = [];
        const controller = createTableToolbarController(
          editor,
          (snapshot) => snapshots.push(snapshot.visible),
          dom.window as unknown as Window,
        );
        expect(snapshots.at(-1)).toBe(true);

        editor.commands.setTextSelection(editor.state.doc.content.size - 2);
        expect(snapshots.at(-1)).toBe(false);

        controller.destroy();
      },
    );
  });
});
