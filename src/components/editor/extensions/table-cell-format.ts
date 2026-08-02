import { Extension, type CommandProps, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { CellSelection, isInTable, selectionCell } from "@tiptap/pm/tables";
import { normalizeHex } from "../../../utils/palette";

export const CELL_HORIZONTAL_ALIGNMENTS = ["left", "center", "right"] as const;
export type CellHorizontalAlignment =
  (typeof CELL_HORIZONTAL_ALIGNMENTS)[number];

export const CELL_VERTICAL_ALIGNMENTS = ["top", "middle", "bottom"] as const;
export type CellVerticalAlignment = (typeof CELL_VERTICAL_ALIGNMENTS)[number];

export const CELL_BORDER_STYLES = [
  "none",
  "solid",
  "dashed",
  "dotted",
  "double",
] as const;
export type CellBorderStyle = (typeof CELL_BORDER_STYLES)[number];

export const CELL_STYLE_PRESET_IDS = [
  "plain",
  "grid",
  "banded-rows",
  "minimal",
  "header",
  "accent",
] as const;
export type CellStylePresetId = (typeof CELL_STYLE_PRESET_IDS)[number];

export const CELL_BORDER_WIDTH_MAX_PX = 12;
export const MIXED_CELL_FORMAT = "mixed" as const;
export type MixedCellFormat = typeof MIXED_CELL_FORMAT;

export interface CellBorderOptions {
  color?: string | null;
  style?: CellBorderStyle | null;
  width?: number | string | null;
}

export interface CellFormatAttributes {
  backgroundColor: string | null;
  horizontalAlignment: CellHorizontalAlignment | null;
  verticalAlignment: CellVerticalAlignment | null;
  borderColor: string | null;
  borderStyle: CellBorderStyle | null;
  borderWidth: number | null;
  stylePreset: CellStylePresetId | null;
}

export interface SelectedCellFormat {
  cellCount: number;
  backgroundColor: string | null | MixedCellFormat;
  horizontalAlignment: CellHorizontalAlignment | null | MixedCellFormat;
  verticalAlignment: CellVerticalAlignment | null | MixedCellFormat;
  borderColor: string | null | MixedCellFormat;
  borderStyle: CellBorderStyle | null | MixedCellFormat;
  borderWidth: number | null | MixedCellFormat;
  stylePreset: CellStylePresetId | null | MixedCellFormat;
}

interface PersistedCellAttributes {
  backgroundColor: string | null;
  align: CellHorizontalAlignment | null;
  verticalAlign: CellVerticalAlignment | null;
  borderColor: string | null;
  borderStyle: CellBorderStyle | null;
  borderWidth: number | null;
  cellStylePreset: CellStylePresetId | null;
}

export interface CellStylePresetDefinition {
  id: CellStylePresetId;
  label: string;
  attributes: CellFormatAttributes;
}

const DEFAULT_CELL_FORMAT: CellFormatAttributes = {
  backgroundColor: null,
  horizontalAlignment: null,
  verticalAlignment: null,
  borderColor: null,
  borderStyle: null,
  borderWidth: null,
  stylePreset: null,
};

const GRID_BORDER = "#d6d0c6";

export const CELL_STYLE_PRESETS: readonly CellStylePresetDefinition[] = [
  {
    id: "plain",
    label: "Plain",
    attributes: { ...DEFAULT_CELL_FORMAT, stylePreset: "plain" },
  },
  {
    id: "grid",
    label: "Grid",
    attributes: {
      ...DEFAULT_CELL_FORMAT,
      borderColor: GRID_BORDER,
      borderStyle: "solid",
      borderWidth: 1,
      stylePreset: "grid",
    },
  },
  {
    id: "banded-rows",
    label: "Banded",
    attributes: {
      ...DEFAULT_CELL_FORMAT,
      backgroundColor: "#f3eee5",
      borderColor: GRID_BORDER,
      borderStyle: "solid",
      borderWidth: 1,
      stylePreset: "banded-rows",
    },
  },
  {
    id: "minimal",
    label: "Minimal",
    attributes: {
      ...DEFAULT_CELL_FORMAT,
      borderStyle: "none",
      borderWidth: 0,
      stylePreset: "minimal",
    },
  },
  {
    id: "header",
    label: "Header",
    attributes: {
      ...DEFAULT_CELL_FORMAT,
      backgroundColor: "#e8e1d5",
      horizontalAlignment: "center",
      verticalAlignment: "middle",
      borderColor: GRID_BORDER,
      borderStyle: "solid",
      borderWidth: 1,
      stylePreset: "header",
    },
  },
  {
    id: "accent",
    label: "Accent",
    attributes: {
      ...DEFAULT_CELL_FORMAT,
      backgroundColor: "#fbeaa8",
      verticalAlignment: "middle",
      borderColor: "#d4a017",
      borderStyle: "solid",
      borderWidth: 1,
      stylePreset: "accent",
    },
  },
] as const;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableCellFormat: {
      setCellBackground: (color: string | null) => ReturnType;
      setCellHorizontalAlignment: (
        alignment: CellHorizontalAlignment | null,
      ) => ReturnType;
      setCellVerticalAlignment: (
        alignment: CellVerticalAlignment | null,
      ) => ReturnType;
      setCellBorder: (border: CellBorderOptions) => ReturnType;
      setCellBorderColor: (color: string | null) => ReturnType;
      setCellBorderStyle: (style: CellBorderStyle | null) => ReturnType;
      setCellBorderWidth: (width: number | string | null) => ReturnType;
      applyCellStylePreset: (preset: CellStylePresetId) => ReturnType;
      unsetCellFormat: () => ReturnType;
    };
  }
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
): T | null {
  return values.includes(value as T) ? (value as T) : null;
}

export function normalizeCellColor(value: unknown): string | null {
  return typeof value === "string" ? normalizeHex(value) : null;
}

export function normalizeCellHorizontalAlignment(
  value: unknown,
): CellHorizontalAlignment | null {
  return enumValue(value, CELL_HORIZONTAL_ALIGNMENTS);
}

export function normalizeCellVerticalAlignment(
  value: unknown,
): CellVerticalAlignment | null {
  return enumValue(value, CELL_VERTICAL_ALIGNMENTS);
}

export function normalizeCellBorderStyle(
  value: unknown,
): CellBorderStyle | null {
  return enumValue(value, CELL_BORDER_STYLES);
}

export function normalizeCellBorderWidth(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          /^\d+(?:\.\d+)?(?:px)?$/i.test(value.trim())
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) return null;
  return Math.min(CELL_BORDER_WIDTH_MAX_PX, Math.max(0, Math.round(numeric)));
}

export function normalizeCellStylePreset(
  value: unknown,
): CellStylePresetId | null {
  return enumValue(value, CELL_STYLE_PRESET_IDS);
}

function inlineDeclaration(element: HTMLElement, property: string): string {
  const style = element.getAttribute("style") ?? "";
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+)`, "i").exec(
    style,
  );
  return match?.[1]?.trim() ?? "";
}

function parseColorAttribute(
  element: HTMLElement,
  dataAttribute: string,
  cssProperty: string,
  legacyAttribute?: string,
): string | null {
  return normalizeCellColor(
    element.getAttribute(dataAttribute) ||
      inlineDeclaration(element, cssProperty) ||
      (legacyAttribute ? element.getAttribute(legacyAttribute) : null) ||
      "",
  );
}

function styleAttribute(property: string, value: string | number): string {
  return `${property}: ${value}`;
}

function selectedCells(state: EditorState): Array<{
  node: ProseMirrorNode;
  pos: number;
}> {
  if (!isInTable(state)) return [];
  if (state.selection instanceof CellSelection) {
    const cells: Array<{ node: ProseMirrorNode; pos: number }> = [];
    state.selection.forEachCell((node, pos) => cells.push({ node, pos }));
    return cells;
  }
  const $cell = selectionCell(state);
  return $cell.nodeAfter ? [{ node: $cell.nodeAfter, pos: $cell.pos }] : [];
}

function updateSelectedCells(
  patch: Partial<PersistedCellAttributes>,
): (props: CommandProps) => boolean {
  return ({ state, tr, dispatch }) => {
    const cells = selectedCells(state);
    if (!cells.length) return false;
    const changed = cells.filter(({ node }) =>
      Object.entries(patch).some(([name, value]) => node.attrs[name] !== value),
    );
    if (!changed.length) return false;
    if (dispatch) {
      for (const { node, pos } of changed) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
      }
      dispatch(tr);
    }
    return true;
  };
}

function presetPatch(preset: CellStylePresetId): PersistedCellAttributes {
  const definition = CELL_STYLE_PRESETS.find((item) => item.id === preset);
  const attributes = definition?.attributes ?? DEFAULT_CELL_FORMAT;
  return {
    backgroundColor: attributes.backgroundColor,
    align: attributes.horizontalAlignment,
    verticalAlign: attributes.verticalAlignment,
    borderColor: attributes.borderColor,
    borderStyle: attributes.borderStyle,
    borderWidth: attributes.borderWidth,
    cellStylePreset: preset,
  };
}

function commonValue<T>(values: T[]): T | MixedCellFormat {
  const first = values[0];
  return values.every((value) => Object.is(value, first))
    ? first
    : MIXED_CELL_FORMAT;
}

/** Read a selection without relying on the rendered DOM. */
export function getSelectedCellFormat(editor: Editor): SelectedCellFormat {
  const cells = selectedCells(editor.state);
  if (!cells.length) {
    return { cellCount: 0, ...DEFAULT_CELL_FORMAT };
  }
  return {
    cellCount: cells.length,
    backgroundColor: commonValue(
      cells.map(({ node }) => normalizeCellColor(node.attrs.backgroundColor)),
    ),
    horizontalAlignment: commonValue(
      cells.map(({ node }) =>
        normalizeCellHorizontalAlignment(node.attrs.align),
      ),
    ),
    verticalAlignment: commonValue(
      cells.map(({ node }) =>
        normalizeCellVerticalAlignment(node.attrs.verticalAlign),
      ),
    ),
    borderColor: commonValue(
      cells.map(({ node }) => normalizeCellColor(node.attrs.borderColor)),
    ),
    borderStyle: commonValue(
      cells.map(({ node }) => normalizeCellBorderStyle(node.attrs.borderStyle)),
    ),
    borderWidth: commonValue(
      cells.map(({ node }) => normalizeCellBorderWidth(node.attrs.borderWidth)),
    ),
    stylePreset: commonValue(
      cells.map(({ node }) =>
        normalizeCellStylePreset(node.attrs.cellStylePreset),
      ),
    ),
  };
}

export type TableCellFormatIntent =
  | { kind: "background"; color: string | null }
  | {
      kind: "horizontal-alignment";
      alignment: CellHorizontalAlignment | null;
    }
  | {
      kind: "vertical-alignment";
      alignment: CellVerticalAlignment | null;
    }
  | { kind: "border"; border: CellBorderOptions }
  | { kind: "preset"; preset: CellStylePresetId }
  | { kind: "clear" };

/** Coordinator-facing dispatcher used by the isolated controls component. */
export function runTableCellFormatIntent(
  editor: Editor,
  intent: TableCellFormatIntent,
): boolean {
  const chain = editor.chain().focus();
  switch (intent.kind) {
    case "background":
      return chain.setCellBackground(intent.color).run();
    case "horizontal-alignment":
      return chain.setCellHorizontalAlignment(intent.alignment).run();
    case "vertical-alignment":
      return chain.setCellVerticalAlignment(intent.alignment).run();
    case "border":
      return chain.setCellBorder(intent.border).run();
    case "preset":
      return chain.applyCellStylePreset(intent.preset).run();
    case "clear":
      return chain.unsetCellFormat().run();
  }
}

export const TableCellFormat = Extension.create({
  name: "tableCellFormat",

  addGlobalAttributes() {
    return [
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (element) =>
              parseColorAttribute(
                element,
                "data-cell-background",
                "background-color",
                "bgcolor",
              ),
            renderHTML: (attrs) => {
              const color = normalizeCellColor(attrs.backgroundColor);
              return color
                ? {
                    "data-cell-background": color,
                    style: styleAttribute("background-color", color),
                  }
                : {};
            },
          },
          align: {
            default: null,
            parseHTML: (element) =>
              normalizeCellHorizontalAlignment(
                element.getAttribute("data-cell-horizontal-alignment") ||
                  inlineDeclaration(element, "text-align") ||
                  element.getAttribute("align"),
              ),
            renderHTML: (attrs) => {
              const alignment = normalizeCellHorizontalAlignment(attrs.align);
              return alignment
                ? {
                    "data-cell-horizontal-alignment": alignment,
                    style: styleAttribute("text-align", alignment),
                  }
                : {};
            },
          },
          verticalAlign: {
            default: null,
            parseHTML: (element) =>
              normalizeCellVerticalAlignment(
                element.getAttribute("data-cell-vertical-alignment") ||
                  inlineDeclaration(element, "vertical-align") ||
                  element.getAttribute("valign"),
              ),
            renderHTML: (attrs) => {
              const alignment = normalizeCellVerticalAlignment(
                attrs.verticalAlign,
              );
              return alignment
                ? {
                    "data-cell-vertical-alignment": alignment,
                    style: styleAttribute("vertical-align", alignment),
                  }
                : {};
            },
          },
          borderColor: {
            default: null,
            parseHTML: (element) =>
              parseColorAttribute(
                element,
                "data-cell-border-color",
                "border-color",
              ),
            renderHTML: (attrs) => {
              const color = normalizeCellColor(attrs.borderColor);
              return color
                ? {
                    "data-cell-border-color": color,
                    style: styleAttribute("border-color", color),
                  }
                : {};
            },
          },
          borderStyle: {
            default: null,
            parseHTML: (element) =>
              normalizeCellBorderStyle(
                element.getAttribute("data-cell-border-style") ??
                  inlineDeclaration(element, "border-style"),
              ),
            renderHTML: (attrs) => {
              const style = normalizeCellBorderStyle(attrs.borderStyle);
              return style
                ? {
                    "data-cell-border-style": style,
                    style: styleAttribute("border-style", style),
                  }
                : {};
            },
          },
          borderWidth: {
            default: null,
            parseHTML: (element) =>
              normalizeCellBorderWidth(
                element.getAttribute("data-cell-border-width") ??
                  inlineDeclaration(element, "border-width"),
              ),
            renderHTML: (attrs) => {
              const width = normalizeCellBorderWidth(attrs.borderWidth);
              return width != null
                ? {
                    "data-cell-border-width": String(width),
                    style: styleAttribute("border-width", `${width}px`),
                  }
                : {};
            },
          },
          cellStylePreset: {
            default: null,
            parseHTML: (element) =>
              normalizeCellStylePreset(
                element.getAttribute("data-cell-style-preset"),
              ),
            renderHTML: (attrs) => {
              const preset = normalizeCellStylePreset(attrs.cellStylePreset);
              return preset ? { "data-cell-style-preset": preset } : {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setCellBackground: (color) => {
        const normalized = normalizeCellColor(color);
        if (color != null && !normalized) return () => false;
        return updateSelectedCells({
          backgroundColor: normalized,
          cellStylePreset: null,
        });
      },
      setCellHorizontalAlignment: (alignment) => {
        const normalized = normalizeCellHorizontalAlignment(alignment);
        if (alignment != null && !normalized) return () => false;
        return updateSelectedCells({
          align: normalized,
          cellStylePreset: null,
        });
      },
      setCellVerticalAlignment: (alignment) => {
        const normalized = normalizeCellVerticalAlignment(alignment);
        if (alignment != null && !normalized) return () => false;
        return updateSelectedCells({
          verticalAlign: normalized,
          cellStylePreset: null,
        });
      },
      setCellBorder: (border) => {
        const patch: Partial<PersistedCellAttributes> = {
          cellStylePreset: null,
        };
        if ("color" in border) {
          const color = normalizeCellColor(border.color);
          if (border.color != null && !color) return () => false;
          patch.borderColor = color;
        }
        if ("style" in border) {
          const style = normalizeCellBorderStyle(border.style);
          if (border.style != null && !style) return () => false;
          patch.borderStyle = style;
        }
        if ("width" in border) {
          const width = normalizeCellBorderWidth(border.width);
          if (border.width != null && width == null) return () => false;
          patch.borderWidth = width;
        }
        return updateSelectedCells(patch);
      },
      setCellBorderColor: (color) => {
        const normalized = normalizeCellColor(color);
        if (color != null && !normalized) return () => false;
        return updateSelectedCells({
          borderColor: normalized,
          cellStylePreset: null,
        });
      },
      setCellBorderStyle: (style) => {
        const normalized = normalizeCellBorderStyle(style);
        if (style != null && !normalized) return () => false;
        return updateSelectedCells({
          borderStyle: normalized,
          cellStylePreset: null,
        });
      },
      setCellBorderWidth: (width) => {
        const normalized = normalizeCellBorderWidth(width);
        if (width != null && normalized == null) return () => false;
        return updateSelectedCells({
          borderWidth: normalized,
          cellStylePreset: null,
        });
      },
      applyCellStylePreset: (preset) => {
        const normalized = normalizeCellStylePreset(preset);
        if (!normalized) return () => false;
        return updateSelectedCells(presetPatch(normalized));
      },
      unsetCellFormat: () =>
        updateSelectedCells({
          backgroundColor: null,
          align: null,
          verticalAlign: null,
          borderColor: null,
          borderStyle: null,
          borderWidth: null,
          cellStylePreset: null,
        }),
    };
  },
});

/** Add this after `createTableCoreExtensions()` in the editor bundle. */
export function createTableCellFormatExtensions() {
  return [TableCellFormat];
}
