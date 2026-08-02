import { describe, expect, test } from "bun:test";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { withEditor } from "../test-harness";
import {
  TABLE_ACTIONS,
  createTableCoreExtensions,
  getActiveTableFormat,
  getTableActionAvailability,
  normalizeTableAlignment,
  normalizeTableCaption,
  normalizeTableStyle,
  normalizeTableWidth,
  resolveDistributedColumnWidths,
  runTableToolbarIntent,
} from "./table-format";

function tableCellPositions(doc: ProseMirrorNode): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    const role = node.type.spec.tableRole;
    if (role === "cell" || role === "header_cell") positions.push(pos);
  });
  return positions;
}

describe("table format normalization", () => {
  test("bounds table widths and rejects unsupported units", () => {
    expect(normalizeTableWidth("75%")).toBe("75%");
    expect(normalizeTableWidth("150%")).toBe("100%");
    expect(normalizeTableWidth("1%")).toBe("10%");
    expect(normalizeTableWidth(640)).toBe("640px");
    expect(normalizeTableWidth("12px")).toBe("120px");
    expect(normalizeTableWidth("9999px")).toBe("2400px");
    expect(normalizeTableWidth("42rem")).toBeNull();
    expect(normalizeTableWidth("auto")).toBe("auto");
  });

  test("normalizes alignment, caption, and style identifiers", () => {
    expect(normalizeTableAlignment("center")).toBe("center");
    expect(normalizeTableAlignment("justify")).toBeNull();
    expect(normalizeTableCaption("  A   compact\ncaption  ")).toBe(
      "A compact caption",
    );
    expect(normalizeTableCaption("   ")).toBeNull();
    expect(normalizeTableStyle("banded-rows")).toBe("banded-rows");
    expect(normalizeTableStyle("unknown")).toBeNull();
  });

  test("distributes integer pixels without losing the remainder", () => {
    expect(resolveDistributedColumnWidths(3, 601)).toEqual([201, 200, 200]);
    expect(resolveDistributedColumnWidths(3, 60)).toEqual([40, 40, 40]);
    expect(resolveDistributedColumnWidths(0, 600)).toEqual([]);
  });
});

describe("TableFormat extension", () => {
  test("inserts an arbitrary N-by-M table through the public bundle", async () => {
    await withEditor(
      { extensions: createTableCoreExtensions() },
      ({ editor, host }) => {
        expect(
          editor.commands.insertTable({
            rows: 4,
            cols: 6,
            withHeaderRow: false,
          }),
        ).toBe(true);
        expect(host.querySelectorAll("tr")).toHaveLength(4);
        expect(host.querySelectorAll("td")).toHaveLength(24);
      },
    );
  });

  test("caption and style attributes survive an HTML round trip", async () => {
    let serialized = "";
    await withEditor(
      { extensions: createTableCoreExtensions() },
      ({ editor }) => {
        editor.commands.insertTable({ rows: 2, cols: 3 });
        editor.commands.setTableWidth("75%");
        editor.commands.setTableAlignment("center");
        editor.commands.setTableCaption('Results <draft> & "notes"');
        editor.commands.setTableStyle("banded-rows");
        serialized = editor.getHTML();

        expect(serialized).toContain('data-table-width="75%"');
        expect(serialized).toContain('data-table-alignment="center"');
        expect(serialized).toContain('data-table-style="banded-rows"');
        expect(serialized).toContain("<caption");
        expect(serialized).toContain('Results &lt;draft&gt; &amp; "notes"');
        expect(serialized).toContain("margin-left: auto");
        expect(serialized).toContain("margin-right: auto");
      },
    );

    await withEditor(
      {
        content: serialized,
        extensions: createTableCoreExtensions(),
      },
      ({ editor }) => {
        editor.commands.setTextSelection(4);
        expect(getActiveTableFormat(editor)).toEqual({
          tableWidth: "75%",
          tableAlignment: "center",
          tableCaption: 'Results <draft> & "notes"',
          tableStyle: "banded-rows",
        });
        expect(editor.getHTML()).toContain("<caption");
      },
    );
  });

  test("imports semantic captions and legacy alignment styles", async () => {
    await withEditor(
      {
        content:
          '<table style="width: 640px; margin-left: auto; margin-right: 0"><caption>Quarterly results</caption><tbody><tr><td><p>A</p></td></tr></tbody></table>',
        extensions: createTableCoreExtensions(),
      },
      ({ editor }) => {
        editor.commands.setTextSelection(4);
        expect(getActiveTableFormat(editor)).toMatchObject({
          tableWidth: "640px",
          tableAlignment: "right",
          tableCaption: "Quarterly results",
        });
      },
    );
  });

  test("clears table format attributes back to document defaults", async () => {
    await withEditor(
      { extensions: createTableCoreExtensions() },
      ({ editor }) => {
        editor.commands.insertTable({ rows: 2, cols: 2 });
        editor.commands.setTableWidth("50%");
        editor.commands.setTableAlignment("right");
        editor.commands.setTableCaption("Caption");
        editor.commands.setTableStyle("grid");

        expect(editor.commands.unsetTableFormat()).toBe(true);
        expect(getActiveTableFormat(editor)).toEqual({
          tableWidth: null,
          tableAlignment: "left",
          tableCaption: null,
          tableStyle: null,
        });
        expect(editor.getHTML()).not.toContain("data-table-caption");
        expect(editor.getHTML()).not.toContain("data-table-style");
      },
    );
  });

  test("equal column distribution updates every cell and colspan", async () => {
    await withEditor(
      { extensions: createTableCoreExtensions() },
      ({ editor }) => {
        editor.commands.insertTable({
          rows: 2,
          cols: 3,
          withHeaderRow: false,
        });
        editor.commands.setTableWidth("600px");
        expect(editor.commands.distributeTableColumns()).toBe(true);

        const widths: number[][] = [];
        editor.state.doc.descendants((node) => {
          const role = node.type.spec.tableRole;
          if (role === "cell" || role === "header_cell") {
            widths.push(node.attrs.colwidth);
          }
        });
        expect(widths).toHaveLength(6);
        expect(widths.every((width) => width[0] === 200)).toBe(true);

        const cells = tableCellPositions(editor.state.doc);
        editor.commands.setCellSelection({
          anchorCell: cells[0],
          headCell: cells[1],
        });
        editor.commands.mergeCells();
        expect(editor.commands.distributeTableColumns()).toBe(true);
        let merged: ProseMirrorNode | null = null;
        editor.state.doc.descendants((node) => {
          if (node.attrs.colspan === 2) {
            merged = node;
            return false;
          }
          return true;
        });
        expect(merged).not.toBeNull();
        expect((merged as unknown as ProseMirrorNode).attrs.colwidth).toEqual([
          200, 200,
        ]);
      },
    );
  });

  test("action availability reflects merge and split preconditions", async () => {
    await withEditor(
      { extensions: createTableCoreExtensions() },
      ({ editor }) => {
        expect(
          Object.values(getTableActionAvailability(editor)).every(
            (available) => !available,
          ),
        ).toBe(true);

        editor.commands.insertTable({
          rows: 2,
          cols: 2,
          withHeaderRow: false,
        });
        let availability = getTableActionAvailability(editor);
        expect(availability.addRowAfter).toBe(true);
        expect(availability.deleteTable).toBe(true);
        expect(availability.mergeCells).toBe(false);
        expect(availability.splitCell).toBe(false);

        const cells = tableCellPositions(editor.state.doc);
        editor.commands.setCellSelection({
          anchorCell: cells[0],
          headCell: cells[1],
        });
        availability = getTableActionAvailability(editor);
        expect(availability.mergeCells).toBe(true);
        expect(
          runTableToolbarIntent(editor, {
            kind: "action",
            action: "mergeCells",
          }),
        ).toBe(true);
        expect(getTableActionAvailability(editor).splitCell).toBe(true);
      },
    );
  });

  test("the action registry is complete and has unique ids", () => {
    const ids = TABLE_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "addRowBefore",
        "addRowAfter",
        "deleteRow",
        "addColumnBefore",
        "addColumnAfter",
        "deleteColumn",
        "mergeCells",
        "splitCell",
        "distributeColumns",
        "deleteTable",
      ]),
    );
  });
});
