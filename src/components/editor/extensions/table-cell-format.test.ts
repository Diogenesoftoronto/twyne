import { describe, expect, test } from "bun:test";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { withEditor } from "../test-harness";
import { createTableCoreExtensions } from "./table-format";
import {
  CELL_STYLE_PRESETS,
  MIXED_CELL_FORMAT,
  TableCellFormat,
  createTableCellFormatExtensions,
  getSelectedCellFormat,
  normalizeCellBorderWidth,
  normalizeCellColor,
  runTableCellFormatIntent,
} from "./table-cell-format";

function extensions() {
  return [...createTableCoreExtensions(), TableCellFormat];
}

function cellPositions(doc: ProseMirrorNode): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    const role = node.type.spec.tableRole;
    if (role === "cell" || role === "header_cell") positions.push(pos);
  });
  return positions;
}

describe("table cell format normalization", () => {
  test("accepts portable literal colours and bounded pixel borders", () => {
    expect(normalizeCellColor("#AbC")).toBe("#aabbcc");
    expect(normalizeCellColor("var(--color-mustard)")).toBeNull();
    expect(normalizeCellColor("red")).toBeNull();
    expect(normalizeCellBorderWidth("2px")).toBe(2);
    expect(normalizeCellBorderWidth(99)).toBe(12);
    expect(normalizeCellBorderWidth("thin")).toBeNull();
  });

  test("preset ids are unique and carry explicit persisted attributes", () => {
    const ids = CELL_STYLE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      CELL_STYLE_PRESETS.every(
        (preset) => preset.attributes.stylePreset === preset.id,
      ),
    ).toBe(true);
  });
});

describe("TableCellFormat extension", () => {
  test("exposes an isolated coordinator extension bundle", () => {
    expect(createTableCellFormatExtensions()).toEqual([TableCellFormat]);
  });

  test("formats every cell in a rectangular cell selection", async () => {
    await withEditor({ extensions: extensions() }, ({ editor }) => {
      editor.commands.insertTable({
        rows: 2,
        cols: 2,
        withHeaderRow: false,
      });
      const cells = cellPositions(editor.state.doc);

      // Deliberately make the anchor match the next command first. The stock
      // setCellAttribute command returns early in this case and misses the
      // differently formatted cells in a multi-cell selection.
      editor.commands.setTextSelection(cells[0] + 2);
      expect(editor.commands.setCellBackground("#fbeaa8")).toBe(true);
      editor.commands.setCellSelection({
        anchorCell: cells[0],
        headCell: cells[3],
      });
      expect(editor.commands.setCellBackground("#fbeaa8")).toBe(true);
      expect(editor.commands.setCellHorizontalAlignment("center")).toBe(true);
      expect(editor.commands.setCellVerticalAlignment("middle")).toBe(true);
      expect(
        editor.commands.setCellBorder({
          color: "#2c4a7c",
          style: "dashed",
          width: 2,
        }),
      ).toBe(true);

      const formatted = getSelectedCellFormat(editor);
      expect(formatted).toMatchObject({
        cellCount: 4,
        backgroundColor: "#fbeaa8",
        horizontalAlignment: "center",
        verticalAlignment: "middle",
        borderColor: "#2c4a7c",
        borderStyle: "dashed",
        borderWidth: 2,
      });
    });
  });

  test("reports mixed selection values instead of guessing from the anchor", async () => {
    await withEditor({ extensions: extensions() }, ({ editor }) => {
      editor.commands.insertTable({
        rows: 1,
        cols: 2,
        withHeaderRow: false,
      });
      const cells = cellPositions(editor.state.doc);
      editor.commands.setTextSelection(cells[0] + 2);
      editor.commands.setCellBackground("#fbeaa8");
      editor.commands.setCellSelection({
        anchorCell: cells[0],
        headCell: cells[1],
      });

      expect(getSelectedCellFormat(editor)).toMatchObject({
        cellCount: 2,
        backgroundColor: MIXED_CELL_FORMAT,
      });
    });
  });

  test("literal shading, alignment, borders, and preset data survive HTML", async () => {
    let serialized = "";
    await withEditor({ extensions: extensions() }, ({ editor }) => {
      editor.commands.insertTable({
        rows: 1,
        cols: 1,
        withHeaderRow: true,
      });
      expect(editor.commands.applyCellStylePreset("header")).toBe(true);
      expect(editor.commands.setCellBackground("#abc")).toBe(true);
      expect(editor.commands.setCellBorderColor("#2C4A7C")).toBe(true);
      expect(editor.commands.setCellBorderStyle("double")).toBe(true);
      expect(editor.commands.setCellBorderWidth(3)).toBe(true);
      expect(editor.commands.setCellVerticalAlignment("bottom")).toBe(true);
      expect(editor.commands.setCellHorizontalAlignment("right")).toBe(true);
      serialized = editor.getHTML();

      expect(serialized).toContain('data-cell-background="#aabbcc"');
      expect(serialized).toContain("background-color: rgb(170, 187, 204)");
      expect(serialized).toContain('data-cell-border-color="#2c4a7c"');
      expect(serialized).toContain("border-color: rgb(44, 74, 124)");
      expect(serialized).toContain('data-cell-border-style="double"');
      expect(serialized).toContain('data-cell-border-width="3"');
      expect(serialized).toContain('data-cell-horizontal-alignment="right"');
      expect(serialized).toContain('data-cell-vertical-alignment="bottom"');
      // Direct edits intentionally clear the preset id, since the selected
      // cells no longer exactly match the preset.
      expect(serialized).not.toContain("data-cell-style-preset");
    });

    await withEditor(
      { content: serialized, extensions: extensions() },
      ({ editor }) => {
        editor.commands.setTextSelection(4);
        expect(getSelectedCellFormat(editor)).toMatchObject({
          cellCount: 1,
          backgroundColor: "#aabbcc",
          horizontalAlignment: "right",
          verticalAlignment: "bottom",
          borderColor: "#2c4a7c",
          borderStyle: "double",
          borderWidth: 3,
        });
        expect(editor.getHTML()).toContain(
          "background-color: rgb(170, 187, 204)",
        );
      },
    );
  });

  test("presets serialize their id and concrete standalone styles", async () => {
    let serialized = "";
    await withEditor({ extensions: extensions() }, ({ editor }) => {
      editor.commands.insertTable({
        rows: 1,
        cols: 2,
        withHeaderRow: false,
      });
      const cells = cellPositions(editor.state.doc);
      editor.commands.setCellSelection({
        anchorCell: cells[0],
        headCell: cells[1],
      });
      expect(
        runTableCellFormatIntent(editor, {
          kind: "preset",
          preset: "accent",
        }),
      ).toBe(true);
      serialized = editor.getHTML();

      expect(serialized.match(/data-cell-style-preset="accent"/g)).toHaveLength(
        2,
      );
      expect(
        serialized.match(/background-color: rgb\(251, 234, 168\)/g),
      ).toHaveLength(2);
      expect(serialized).not.toContain("var(--");
    });

    await withEditor(
      { content: serialized, extensions: extensions() },
      ({ editor }) => {
        editor.commands.setTextSelection(4);
        expect(getSelectedCellFormat(editor)).toMatchObject({
          stylePreset: "accent",
          backgroundColor: "#fbeaa8",
          borderColor: "#d4a017",
        });
      },
    );
  });

  test("clears all portable cell formatting in one transaction", async () => {
    await withEditor({ extensions: extensions() }, ({ editor }) => {
      editor.commands.insertTable({ rows: 1, cols: 1 });
      editor.commands.applyCellStylePreset("accent");
      expect(editor.commands.unsetCellFormat()).toBe(true);
      expect(getSelectedCellFormat(editor)).toMatchObject({
        ...{
          backgroundColor: null,
          horizontalAlignment: null,
          verticalAlignment: null,
          borderColor: null,
          borderStyle: null,
          borderWidth: null,
          stylePreset: null,
        },
      });
      expect(editor.getHTML()).not.toContain("data-cell-");
    });
  });
});
