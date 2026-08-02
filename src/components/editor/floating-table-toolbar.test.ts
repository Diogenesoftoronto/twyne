import { describe, expect, test } from "bun:test";
import { withEditor } from "./test-harness";
import { createTableCoreExtensions } from "./extensions/table-format";
import {
  computeTableToolbarPosition,
  computeTableToolbarStackPosition,
  createTableToolbarController,
  getActiveTableElement,
  readTableToolbarSnapshot,
  TABLE_CELL_FORMAT_PANEL_HEIGHT,
  TABLE_TOOLBAR_GAP,
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

describe("floating table toolbar stacked cell-format row", () => {
  test("keeps the stacked row above the table when placed above", () => {
    const stack = computeTableToolbarStackPosition(
      rect(200, 300, 400, 200),
      { width: 1000, height: 800 },
      true,
      { width: 600, height: 100 },
    );
    expect(stack.placement).toBe("above");
    expect(stack.cellRowTop).not.toBeNull();
    // The cell row must hover above the table's top edge, never cover it.
    expect(stack.cellRowTop! + TABLE_CELL_FORMAT_PANEL_HEIGHT).toBeLessThanOrEqual(
      300 - TABLE_TOOLBAR_GAP,
    );
  });

  test("does not reserve panel room when the cell row is hidden", () => {
    const stack = computeTableToolbarStackPosition(
      rect(200, 300, 400, 200),
      { width: 1000, height: 800 },
      false,
      { width: 600, height: 100 },
    );
    expect(stack.cellRowTop).toBeNull();
    expect(stack.top).toBe(300 - 100 - TABLE_TOOLBAR_GAP);
  });

  /**
   * The regression this whole stack exists for. The old code parked the
   * cell-format panel at `toolbar.top + 120`, which lands exactly on the
   * table's first row and swallows its clicks — the second row stayed
   * deletable, the first did not. Measured heights must not reintroduce it.
   */
  test("never covers the first row, whatever the measured heights are", () => {
    const tableTop = 300;
    for (const height of [80, 112, 160, 210]) {
      for (const cellPanelHeight of [40, 68, 96]) {
        const stack = computeTableToolbarStackPosition(
          rect(200, tableTop, 400, 200),
          { width: 1000, height: 900 },
          true,
          { width: 600, height, cellPanelHeight },
        );
        if (stack.placement !== "above") continue;
        expect(stack.cellRowTop! + cellPanelHeight).toBeLessThanOrEqual(
          tableTop,
        );
      }
    }
  });

  test("drops below rather than clamping back over the table", () => {
    // Tall stack, table high on the page: there is not enough room above once
    // the viewport margin is applied, so "above" would clamp down onto row 1.
    const stack = computeTableToolbarStackPosition(
      rect(200, 140, 400, 620),
      { width: 1000, height: 800 },
      true,
      { width: 600, height: 200, cellPanelHeight: 120 },
    );
    expect(stack.placement).toBe("below");
    expect(stack.top).toBeGreaterThanOrEqual(140);
  });

  test("uses the measured panel height instead of the estimate", () => {
    const measured = computeTableToolbarStackPosition(
      rect(200, 400, 400, 200),
      { width: 1000, height: 900 },
      true,
      { width: 600, height: 100, cellPanelHeight: 140 },
    );
    const estimated = computeTableToolbarStackPosition(
      rect(200, 400, 400, 200),
      { width: 1000, height: 900 },
      true,
      { width: 600, height: 100 },
    );
    // A taller panel has to push the whole stack further up the page.
    expect(measured.top).toBeLessThan(estimated.top);
    expect(measured.cellRowTop! + 140).toBeLessThanOrEqual(400);
  });

  test("keeps the stacked rows below the table near the viewport top", () => {
    const stack = computeTableToolbarStackPosition(
      rect(100, 20, 500, 200),
      { width: 900, height: 700 },
      true,
      { width: 600, height: 100 },
    );
    expect(stack.placement).toBe("below");
    expect(stack.cellRowTop).not.toBeNull();
    expect(stack.cellRowTop! + TABLE_CELL_FORMAT_PANEL_HEIGHT).toBeLessThanOrEqual(
      700 - 8,
    );
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
