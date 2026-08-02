import {
  Extension,
  mergeAttributes,
  type CommandProps,
  type Editor,
} from "@tiptap/core";
import {
  Table,
  createColGroup,
  type TableOptions,
} from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import type { DOMOutputSpec, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { findTable, TableMap } from "@tiptap/pm/tables";

export const TABLE_WIDTH_MIN_PERCENT = 10;
export const TABLE_WIDTH_MIN_PX = 120;
export const TABLE_WIDTH_MAX_PX = 2400;
export const TABLE_COLUMN_MIN_PX = 40;
export const TABLE_COLUMN_FALLBACK_PX = 120;
export const TABLE_CAPTION_MAX_LENGTH = 500;

export const TABLE_ALIGNMENTS = ["left", "center", "right"] as const;
export type TableAlignment = (typeof TABLE_ALIGNMENTS)[number];

export const TABLE_STYLE_IDS = [
  "plain",
  "grid",
  "banded-rows",
  "minimal",
] as const;
export type TableStyleId = (typeof TABLE_STYLE_IDS)[number];

export type TableWidth = "auto" | `${number}%` | `${number}px`;
export type TableWidthInput = TableWidth | number | null | undefined;

export interface TableFormatAttributes {
  tableWidth: TableWidth | null;
  tableAlignment: TableAlignment;
  tableCaption: string | null;
  tableStyle: TableStyleId | null;
}

export interface DistributeTableColumnsOptions {
  /**
   * The rendered table width. The floating toolbar should pass the active
   * table's DOM width for percentage and automatic-width tables.
   */
  availableWidth?: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableFormat: {
      setTableWidth: (width: TableWidthInput) => ReturnType;
      setTableAlignment: (alignment: TableAlignment) => ReturnType;
      setTableCaption: (caption: string | null) => ReturnType;
      setTableStyle: (style: TableStyleId | null) => ReturnType;
      distributeTableColumns: (
        options?: DistributeTableColumnsOptions,
      ) => ReturnType;
      unsetTableFormat: () => ReturnType;
    };
  }
}

function directCaption(element: HTMLElement): string | null {
  const caption = Array.from(element.children).find(
    (child) => child.tagName === "CAPTION",
  );
  return caption?.textContent ?? element.getAttribute("data-table-caption");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function tidyNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * Normalize persisted or user-entered table widths.
 *
 * Numbers mean pixels. Percentages and pixels are bounded so malformed imports
 * cannot create an unusably tiny table or a multi-thousand-pixel canvas.
 */
export function normalizeTableWidth(input: unknown): TableWidth | null {
  if (input == null || input === "") return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return `${Math.round(clamp(input, TABLE_WIDTH_MIN_PX, TABLE_WIDTH_MAX_PX))}px`;
  }

  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (value === "auto") return "auto";

  const match = value.match(/^(-?\d+(?:\.\d+)?)\s*(%|px)$/);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;

  if (match[2] === "%") {
    return `${tidyNumber(clamp(numeric, TABLE_WIDTH_MIN_PERCENT, 100))}%` as TableWidth;
  }
  return `${Math.round(clamp(numeric, TABLE_WIDTH_MIN_PX, TABLE_WIDTH_MAX_PX))}px`;
}

export function normalizeTableAlignment(input: unknown): TableAlignment | null {
  return TABLE_ALIGNMENTS.includes(input as TableAlignment)
    ? (input as TableAlignment)
    : null;
}

export function normalizeTableCaption(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const caption = input.replace(/\s+/g, " ").trim();
  if (!caption) return null;
  return caption.slice(0, TABLE_CAPTION_MAX_LENGTH);
}

export function normalizeTableStyle(input: unknown): TableStyleId | null {
  return TABLE_STYLE_IDS.includes(input as TableStyleId)
    ? (input as TableStyleId)
    : null;
}

function parseAlignmentFromElement(
  element: HTMLElement,
): TableAlignment | null {
  const persisted = normalizeTableAlignment(
    element.getAttribute("data-table-alignment"),
  );
  if (persisted) return persisted;

  const left = element.style.marginLeft.trim().toLowerCase();
  const right = element.style.marginRight.trim().toLowerCase();
  if (left === "auto" && (right === "0" || right === "0px")) return "right";
  if (left === "auto" && right === "auto") return "center";
  if ((left === "0" || left === "0px") && right === "auto") return "left";
  return null;
}

function parseWidthFromElement(element: HTMLElement): TableWidth | null {
  return normalizeTableWidth(
    element.getAttribute("data-table-width") || element.style.width,
  );
}

function styleForTableFormat(
  width: TableWidth | null,
  alignment: TableAlignment,
): string {
  const declarations: string[] = [];
  if (width === "auto") declarations.push("width: auto");
  else if (width) declarations.push(`width: ${width}`);

  if (alignment === "center") {
    declarations.push("margin-left: auto", "margin-right: auto");
  } else if (alignment === "right") {
    declarations.push("margin-left: auto", "margin-right: 0");
  } else {
    declarations.push("margin-left: 0", "margin-right: auto");
  }
  return declarations.join("; ");
}

function joinStyles(...styles: Array<string | null | undefined>): string {
  return styles
    .map((style) => style?.trim().replace(/;+$/, ""))
    .filter((style): style is string => Boolean(style))
    .join("; ");
}

/**
 * The stock Tiptap table renderer cannot emit a caption child. This extension
 * keeps all stock commands and table behavior, but renders the explicit table
 * format attributes supplied by TableFormat and a semantic caption.
 */
export const FormattedTable = Table.extend<TableOptions>({
  renderHTML({ node, HTMLAttributes }) {
    const { colgroup, tableWidth, tableMinWidth } = createColGroup(
      node,
      this.options.cellMinWidth,
    );
    const { style: attributeStyle, ...attributesWithoutStyle } = HTMLAttributes;

    const width = normalizeTableWidth(node.attrs.tableWidth);
    const alignment =
      normalizeTableAlignment(node.attrs.tableAlignment) ?? "left";
    const caption = normalizeTableCaption(node.attrs.tableCaption);
    const sizingStyle = width
      ? null
      : tableWidth
        ? `width: ${tableWidth}`
        : `min-width: ${tableMinWidth}`;
    const style = joinStyles(
      this.options.HTMLAttributes.style,
      attributeStyle as string | undefined,
      sizingStyle,
      styleForTableFormat(width, alignment),
    );

    const tableChildren: DOMOutputSpec[] = [];
    if (caption) {
      tableChildren.push([
        "caption",
        { "data-table-caption": "true" },
        caption,
      ]);
    }
    tableChildren.push(colgroup, ["tbody", 0]);

    const table: DOMOutputSpec = [
      "table",
      mergeAttributes(
        this.options.HTMLAttributes,
        attributesWithoutStyle,
        style ? { style } : {},
      ),
      ...tableChildren,
    ];

    return this.options.renderWrapper
      ? ["div", { class: "tableWrapper" }, table]
      : table;
  },
});

function updateActiveTable(
  patch: Partial<TableFormatAttributes>,
): (props: CommandProps) => boolean {
  return ({ state, tr, dispatch }) => {
    const table = findTable(state.selection.$from);
    if (!table) return false;

    const attrs = { ...table.node.attrs, ...patch };
    const changed = Object.entries(patch).some(
      ([key, value]) => table.node.attrs[key] !== value,
    );
    if (!changed) return false;
    if (dispatch) dispatch(tr.setNodeMarkup(table.pos, undefined, attrs));
    return true;
  };
}

function existingColumnTotal(
  table: ProseMirrorNode,
  map: TableMap,
): number | null {
  const widths: Array<number | null> = Array.from(
    { length: map.width },
    () => null,
  );

  table.descendants((node, pos) => {
    const role = node.type.spec.tableRole;
    if (role !== "cell" && role !== "header_cell") return true;
    const rect = map.findCell(pos);
    const colwidth = Array.isArray(node.attrs.colwidth)
      ? node.attrs.colwidth
      : [];
    for (let column = rect.left; column < rect.right; column += 1) {
      const candidate = Number(colwidth[column - rect.left]);
      if (Number.isFinite(candidate) && candidate >= TABLE_COLUMN_MIN_PX) {
        widths[column] = candidate;
      }
    }
    return false;
  });

  return widths.every((width): width is number => width != null)
    ? widths.reduce((sum, width) => sum + width, 0)
    : null;
}

export function resolveDistributedColumnWidths(
  columnCount: number,
  availableWidth?: number,
): number[] {
  const columns = Math.max(0, Math.floor(columnCount));
  if (!columns) return [];

  const fallback = columns * TABLE_COLUMN_FALLBACK_PX;
  const requested =
    typeof availableWidth === "number" && Number.isFinite(availableWidth)
      ? Math.round(availableWidth)
      : fallback;
  const total = Math.max(columns * TABLE_COLUMN_MIN_PX, requested);
  const base = Math.floor(total / columns);
  let remainder = total - base * columns;

  return Array.from({ length: columns }, () => {
    const width = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return width;
  });
}

export const TableFormat = Extension.create({
  name: "tableFormat",

  addGlobalAttributes() {
    return [
      {
        types: ["table"],
        attributes: {
          tableWidth: {
            default: null,
            parseHTML: parseWidthFromElement,
            renderHTML: (attrs) => {
              const width = normalizeTableWidth(attrs.tableWidth);
              return width ? { "data-table-width": width } : {};
            },
          },
          tableAlignment: {
            default: "left",
            parseHTML: (element) =>
              parseAlignmentFromElement(element) ?? "left",
            renderHTML: (attrs) => {
              const alignment =
                normalizeTableAlignment(attrs.tableAlignment) ?? "left";
              return { "data-table-alignment": alignment };
            },
          },
          tableCaption: {
            default: null,
            parseHTML: (element) =>
              normalizeTableCaption(directCaption(element)),
            renderHTML: (attrs) => {
              const caption = normalizeTableCaption(attrs.tableCaption);
              return caption ? { "data-table-caption": caption } : {};
            },
          },
          tableStyle: {
            default: null,
            parseHTML: (element) =>
              normalizeTableStyle(element.getAttribute("data-table-style")),
            renderHTML: (attrs) => {
              const style = normalizeTableStyle(attrs.tableStyle);
              return style ? { "data-table-style": style } : {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTableWidth: (width) => {
        const normalized = normalizeTableWidth(width);
        if (width != null && normalized == null) return () => false;
        return updateActiveTable({ tableWidth: normalized });
      },
      setTableAlignment: (alignment) => {
        const normalized = normalizeTableAlignment(alignment);
        if (!normalized) return () => false;
        return updateActiveTable({ tableAlignment: normalized });
      },
      setTableCaption: (caption) =>
        updateActiveTable({ tableCaption: normalizeTableCaption(caption) }),
      setTableStyle: (style) => {
        const normalized = normalizeTableStyle(style);
        if (style != null && !normalized) return () => false;
        return updateActiveTable({ tableStyle: normalized });
      },
      distributeTableColumns:
        (options = {}) =>
        ({ state, tr, dispatch }) => {
          const table = findTable(state.selection.$from);
          if (!table) return false;
          const map = TableMap.get(table.node);
          if (map.width < 2) return false;
          // `editor.can()` calls commands without a dispatch function. Equal
          // distribution is available for every multi-column table even when
          // the current widths already happen to be equal.
          if (!dispatch) return true;

          const fixedWidth = normalizeTableWidth(table.node.attrs.tableWidth);
          const fixedPixels =
            fixedWidth?.endsWith("px") === true
              ? Number(fixedWidth.slice(0, -2))
              : null;
          const total =
            options.availableWidth ??
            fixedPixels ??
            existingColumnTotal(table.node, map) ??
            map.width * TABLE_COLUMN_FALLBACK_PX;
          const widths = resolveDistributedColumnWidths(map.width, total);
          let changed = false;

          table.node.descendants((node, pos) => {
            const role = node.type.spec.tableRole;
            if (role !== "cell" && role !== "header_cell") return true;
            const rect = map.findCell(pos);
            const colwidth = widths.slice(rect.left, rect.right);
            if (
              Array.isArray(node.attrs.colwidth) &&
              node.attrs.colwidth.length === colwidth.length &&
              node.attrs.colwidth.every(
                (value: unknown, index: number) => value === colwidth[index],
              )
            ) {
              return false;
            }
            tr.setNodeMarkup(table.start + pos, undefined, {
              ...node.attrs,
              colwidth,
            });
            changed = true;
            return false;
          });

          if (changed) dispatch(tr);
          return true;
        },
      unsetTableFormat: () =>
        updateActiveTable({
          tableWidth: null,
          tableAlignment: "left",
          tableCaption: null,
          tableStyle: null,
        }),
    };
  },
});

export interface TableCoreExtensionOptions {
  resizable?: boolean;
  renderWrapper?: boolean;
  cellMinWidth?: number;
}

/**
 * Coordinator integration contract. Replace the four stock table extensions
 * with this returned bundle, then render TableInsertionGrid and
 * FloatingTableToolbar as editor overlays.
 */
export function createTableCoreExtensions(
  options: TableCoreExtensionOptions = {},
) {
  return [
    FormattedTable.configure({
      resizable: options.resizable ?? true,
      renderWrapper: options.renderWrapper ?? false,
      cellMinWidth: options.cellMinWidth ?? 40,
    }),
    TableRow,
    TableCell,
    TableHeader,
    TableFormat,
  ];
}

export type TableActionId =
  | "addRowBefore"
  | "addRowAfter"
  | "deleteRow"
  | "toggleHeaderRow"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteColumn"
  | "toggleHeaderColumn"
  | "mergeCells"
  | "splitCell"
  | "distributeColumns"
  | "deleteTable";

export type TableActionAvailability = Record<TableActionId, boolean>;

export interface TableActionDefinition {
  id: TableActionId;
  label: string;
  group: "rows" | "columns" | "cells" | "table";
  destructive?: boolean;
}

export const TABLE_ACTIONS: readonly TableActionDefinition[] = [
  { id: "addRowBefore", label: "Add row above", group: "rows" },
  { id: "addRowAfter", label: "Add row below", group: "rows" },
  { id: "deleteRow", label: "Delete row", group: "rows", destructive: true },
  { id: "toggleHeaderRow", label: "Toggle header row", group: "rows" },
  { id: "addColumnBefore", label: "Add column left", group: "columns" },
  { id: "addColumnAfter", label: "Add column right", group: "columns" },
  {
    id: "deleteColumn",
    label: "Delete column",
    group: "columns",
    destructive: true,
  },
  {
    id: "toggleHeaderColumn",
    label: "Toggle header column",
    group: "columns",
  },
  { id: "mergeCells", label: "Merge cells", group: "cells" },
  { id: "splitCell", label: "Split cell", group: "cells" },
  {
    id: "distributeColumns",
    label: "Distribute columns",
    group: "columns",
  },
  {
    id: "deleteTable",
    label: "Delete table",
    group: "table",
    destructive: true,
  },
] as const;

const unavailableActions = (): TableActionAvailability => ({
  addRowBefore: false,
  addRowAfter: false,
  deleteRow: false,
  toggleHeaderRow: false,
  addColumnBefore: false,
  addColumnAfter: false,
  deleteColumn: false,
  toggleHeaderColumn: false,
  mergeCells: false,
  splitCell: false,
  distributeColumns: false,
  deleteTable: false,
});

export function getTableActionAvailability(
  editor: Editor,
): TableActionAvailability {
  if (!editor.isActive("table")) return unavailableActions();
  const can = editor.can();
  return {
    addRowBefore: can.addRowBefore(),
    addRowAfter: can.addRowAfter(),
    deleteRow: can.deleteRow(),
    toggleHeaderRow: can.toggleHeaderRow(),
    addColumnBefore: can.addColumnBefore(),
    addColumnAfter: can.addColumnAfter(),
    deleteColumn: can.deleteColumn(),
    toggleHeaderColumn: can.toggleHeaderColumn(),
    mergeCells: can.mergeCells(),
    splitCell: can.splitCell(),
    distributeColumns: can.distributeTableColumns(),
    deleteTable: can.deleteTable(),
  };
}

export function getActiveTableFormat(editor: Editor): TableFormatAttributes {
  const attrs = editor.getAttributes("table");
  return {
    tableWidth: normalizeTableWidth(attrs.tableWidth),
    tableAlignment: normalizeTableAlignment(attrs.tableAlignment) ?? "left",
    tableCaption: normalizeTableCaption(attrs.tableCaption),
    tableStyle: normalizeTableStyle(attrs.tableStyle),
  };
}

export type TableToolbarIntent =
  | { kind: "action"; action: TableActionId }
  | { kind: "width"; width: TableWidthInput }
  | { kind: "alignment"; alignment: TableAlignment }
  | { kind: "caption"; caption: string | null }
  | { kind: "style"; style: TableStyleId | null };

/**
 * A single dispatcher for coordinator wiring. It always restores editor focus,
 * refuses unavailable actions, and passes the rendered table width to column
 * distribution so percentage-width tables distribute accurately.
 */
export function runTableToolbarIntent(
  editor: Editor,
  intent: TableToolbarIntent,
  activeTableWidth?: number,
): boolean {
  if (intent.kind === "width") {
    return editor.chain().focus().setTableWidth(intent.width).run();
  }
  if (intent.kind === "alignment") {
    return editor.chain().focus().setTableAlignment(intent.alignment).run();
  }
  if (intent.kind === "caption") {
    return editor.chain().focus().setTableCaption(intent.caption).run();
  }
  if (intent.kind === "style") {
    return editor.chain().focus().setTableStyle(intent.style).run();
  }

  const availability = getTableActionAvailability(editor);
  if (!availability[intent.action]) return false;
  const chain = editor.chain().focus();
  switch (intent.action) {
    case "addRowBefore":
      return chain.addRowBefore().run();
    case "addRowAfter":
      return chain.addRowAfter().run();
    case "deleteRow":
      return chain.deleteRow().run();
    case "toggleHeaderRow":
      return chain.toggleHeaderRow().run();
    case "addColumnBefore":
      return chain.addColumnBefore().run();
    case "addColumnAfter":
      return chain.addColumnAfter().run();
    case "deleteColumn":
      return chain.deleteColumn().run();
    case "toggleHeaderColumn":
      return chain.toggleHeaderColumn().run();
    case "mergeCells":
      return chain.mergeCells().run();
    case "splitCell":
      return chain.splitCell().run();
    case "distributeColumns":
      return chain
        .distributeTableColumns({ availableWidth: activeTableWidth })
        .run();
    case "deleteTable":
      return chain.deleteTable().run();
  }
}
