import { component$, type PropFunction } from "@builder.io/qwik";
import type { Editor } from "@tiptap/core";
import { findTable } from "@tiptap/pm/tables";
import {
  TABLE_ACTIONS,
  TABLE_ALIGNMENTS,
  TABLE_STYLE_IDS,
  getActiveTableFormat,
  getTableActionAvailability,
  type TableActionAvailability,
  type TableActionId,
  type TableFormatAttributes,
  type TableToolbarIntent,
} from "./extensions/table-format";
import {
  getSelectedCellFormat,
  type SelectedCellFormat,
} from "./extensions/table-cell-format";
import { Icon } from "../ui/icon";
import type { TwyneIconName } from "../../utils/icon-system";

export const TABLE_TOOLBAR_GAP = 8;
export const TABLE_TOOLBAR_VIEWPORT_MARGIN = 8;
export const TABLE_TOOLBAR_IDEAL_WIDTH = 760;
export const TABLE_TOOLBAR_IDEAL_HEIGHT = 112;
/** Estimated rendered height of the optional cell-format panel stacked below the toolbar. */
export const TABLE_CELL_FORMAT_PANEL_HEIGHT = 68;

/** Marks the elements the controller measures instead of guessing at. */
export const TABLE_TOOLBAR_ATTR = "data-floating-table-toolbar";
export const TABLE_CELL_FORMAT_PANEL_ATTR = "data-table-cell-format-panel";

/**
 * Rendered heights of the floating stack. The constants above are only a
 * first-paint estimate: a different font, zoom level, or button wrap changes
 * the real height, and an underestimate parks the stack on top of the table's
 * first row where it silently eats every click. Once the elements exist we
 * measure them.
 */
export interface TableToolbarMetrics {
  width?: number;
  height?: number;
  cellPanelHeight?: number;
}

/** Read the live heights of the floating stack, if it is on screen. */
export function measureTableToolbar(
  doc: Document | undefined = typeof document === "undefined"
    ? undefined
    : document,
): TableToolbarMetrics {
  if (!doc) return {};
  const toolbar = doc.querySelector(`[${TABLE_TOOLBAR_ATTR}]`);
  const panel = doc.querySelector(`[${TABLE_CELL_FORMAT_PANEL_ATTR}]`);
  const metrics: TableToolbarMetrics = {};
  const toolbarHeight = toolbar?.getBoundingClientRect().height;
  if (toolbarHeight) metrics.height = toolbarHeight;
  const panelHeight = panel?.getBoundingClientRect().height;
  if (panelHeight) metrics.cellPanelHeight = panelHeight;
  return metrics;
}

export interface PlainRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface TableToolbarPosition {
  left: number;
  top: number;
  width: number;
  placement: "above" | "below";
}

/** The toolbar plus the optional cell-format panel stacked just below it. */
export interface TableToolbarStackPosition extends TableToolbarPosition {
  /** Top of the cell-format panel when shown, or null when hidden. */
  cellRowTop: number | null;
}

export interface TableToolbarSnapshot {
  visible: boolean;
  anchor: PlainRect | null;
  position: TableToolbarStackPosition | null;
  availability: TableActionAvailability;
  format: TableFormatAttributes;
}

function emptyAvailability(): TableActionAvailability {
  return {
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
  };
}

export const EMPTY_TABLE_TOOLBAR_SNAPSHOT: TableToolbarSnapshot = {
  visible: false,
  anchor: null,
  position: null,
  availability: emptyAvailability(),
  format: {
    tableWidth: null,
    tableAlignment: "left",
    tableCaption: null,
    tableStyle: null,
  },
};

export function toPlainRect(rect: DOMRect): PlainRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export function computeTableToolbarPosition(
  anchor: PlainRect,
  viewport: { width: number; height: number },
  toolbar: { width?: number; height?: number } = {},
  forcePlacement?: "above" | "below",
): TableToolbarPosition {
  const margin = TABLE_TOOLBAR_VIEWPORT_MARGIN;
  const gap = TABLE_TOOLBAR_GAP;
  const width = Math.max(
    0,
    Math.min(
      toolbar.width ?? TABLE_TOOLBAR_IDEAL_WIDTH,
      viewport.width - margin * 2,
    ),
  );
  const height = toolbar.height ?? TABLE_TOOLBAR_IDEAL_HEIGHT;
  const roomAbove = anchor.top - margin - gap;
  const roomBelow = viewport.height - anchor.bottom - margin - gap;
  const placement =
    forcePlacement ??
    (roomAbove >= height || roomAbove >= roomBelow ? "above" : "below");
  const desiredLeft = anchor.left + anchor.width / 2 - width / 2;
  const left = Math.max(
    margin,
    Math.min(desiredLeft, viewport.width - width - margin),
  );
  const desiredTop =
    placement === "above" ? anchor.top - height - gap : anchor.bottom + gap;
  const top = Math.max(
    margin,
    Math.min(desiredTop, viewport.height - height - margin),
  );
  return { left, top, width, placement };
}

/**
 * Position the toolbar and, when a cell selection is active, the stacked
 * cell-format panel together so the whole floating stack hovers over a side
 * of the table without ever covering it. The stacked panel is glued to the
 * bottom of the toolbar with a gap, and the available vertical room is
 * measured against the combined height so the stack picks a side where it
 * fully fits.
 */
export function computeTableToolbarStackPosition(
  anchor: PlainRect,
  viewport: { width: number; height: number },
  showCellFormatRow: boolean,
  toolbar: TableToolbarMetrics = {},
): TableToolbarStackPosition {
  const toolbarHeight = toolbar.height ?? TABLE_TOOLBAR_IDEAL_HEIGHT;
  const panelHeight =
    toolbar.cellPanelHeight ?? TABLE_CELL_FORMAT_PANEL_HEIGHT;
  const stackedHeight =
    toolbarHeight + TABLE_TOOLBAR_GAP + (showCellFormatRow ? panelHeight : 0);
  const metrics = {
    width: toolbar.width,
    height: showCellFormatRow ? stackedHeight : toolbarHeight,
  };

  let position = computeTableToolbarPosition(anchor, viewport, metrics);

  // `computeTableToolbarPosition` clamps into the viewport, which can shove an
  // "above" stack back down over the table it is meant to float clear of —
  // landing on the first row and eating its clicks. When that happens, drop
  // below the table instead. Overlapping the *bottom* of a tall table is the
  // lesser evil: the row being edited stays reachable.
  if (
    position.placement === "above" &&
    position.top + metrics.height > anchor.top
  ) {
    position = computeTableToolbarPosition(anchor, viewport, metrics, "below");
  }

  return {
    ...position,
    cellRowTop: showCellFormatRow
      ? position.top + toolbarHeight + TABLE_TOOLBAR_GAP
      : null,
  };
}

/**
 * Resolve the rendered table for the current ProseMirror selection. Tiptap's
 * resizable TableView returns a wrapper from nodeDOM, so both the direct table
 * and wrapped cases are supported.
 */
export function getActiveTableElement(editor: Editor): HTMLTableElement | null {
  const table = findTable(editor.state.selection.$from);
  if (!table) return null;
  if (typeof HTMLElement === "undefined") return null;
  const nodeDom = editor.view.nodeDOM(table.pos);
  if (nodeDom instanceof HTMLElement) {
    if (nodeDom.tagName === "TABLE") {
      return nodeDom as HTMLTableElement;
    }
    const nested = nodeDom.querySelector("table");
    if (nested) return nested;
  }

  // Some NodeViews and JSDOM do not expose the table at `nodeDOM(table.pos)`.
  // The live selection still resolves into the table's content DOM, so walk
  // outward from that position before declaring the toolbar inactive.
  const domAtSelection = editor.view.domAtPos(editor.state.selection.from).node;
  const selectionElement =
    domAtSelection instanceof HTMLElement
      ? domAtSelection
      : domAtSelection.parentElement;
  return (
    (selectionElement?.closest("table") as HTMLTableElement | null) ?? null
  );
}

export function readTableToolbarSnapshot(
  editor: Editor,
  viewport: { width: number; height: number },
  showCellFormatRow = false,
  toolbar: TableToolbarMetrics = {},
): TableToolbarSnapshot {
  const table = getActiveTableElement(editor);
  if (!table) return EMPTY_TABLE_TOOLBAR_SNAPSHOT;
  const anchor = toPlainRect(table.getBoundingClientRect());
  return {
    visible: true,
    anchor,
    position: computeTableToolbarStackPosition(
      anchor,
      viewport,
      showCellFormatRow,
      toolbar,
    ),
    availability: getTableActionAvailability(editor),
    format: getActiveTableFormat(editor),
  };
}

export interface TableToolbarController {
  refresh: () => void;
  destroy: () => void;
}

/**
 * Keeps toolbar state attached to the active rendered table. The coordinator
 * can copy each snapshot into a Qwik store and render FloatingTableToolbar.
 * The cell format of the selection is resolved alongside the snapshot so the
 * toolbar can reserve room for the stacked cell-format panel.
 */
export function createTableToolbarController(
  editor: Editor,
  onChange: (
    snapshot: TableToolbarSnapshot,
    cellFormat: SelectedCellFormat,
  ) => void,
  targetWindow: Window = window,
): TableToolbarController {
  let observedTable: HTMLTableElement | null = null;
  let observer: ResizeObserver | null =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => refresh());

  // Heights used for the last emitted snapshot. The first paint has nothing to
  // measure, so it runs on the constants; once the stack is on screen we
  // re-settle against its real height. Tracking what we used is what stops
  // that second pass from looping.
  let lastMetrics: TableToolbarMetrics = {};
  let resettling = false;

  const refresh = () => {
    const nextTable = getActiveTableElement(editor);
    if (nextTable !== observedTable) {
      if (observedTable) observer?.unobserve(observedTable);
      observedTable = nextTable;
      if (observedTable) observer?.observe(observedTable);
    }
    const cellFormat = getSelectedCellFormat(editor);
    const metrics = measureTableToolbar(targetWindow.document);
    lastMetrics = metrics;
    onChange(
      readTableToolbarSnapshot(
        editor,
        {
          width: targetWindow.innerWidth,
          height: targetWindow.innerHeight,
        },
        cellFormat.cellCount > 0,
        metrics,
      ),
      cellFormat,
    );

    // Showing or resizing the stack can change its own height, which moves
    // where it must sit. Re-measure on the next frame and reposition if the
    // guess was wrong — otherwise an underestimate leaves the panel parked on
    // the table's first row until the next unrelated event.
    if (resettling || typeof targetWindow.requestAnimationFrame !== "function") {
      return;
    }
    resettling = true;
    targetWindow.requestAnimationFrame(() => {
      resettling = false;
      const settled = measureTableToolbar(targetWindow.document);
      if (
        settled.height !== lastMetrics.height ||
        settled.cellPanelHeight !== lastMetrics.cellPanelHeight
      ) {
        refresh();
      }
    });
  };

  editor.on("selectionUpdate", refresh);
  editor.on("transaction", refresh);
  editor.on("focus", refresh);
  targetWindow.addEventListener("resize", refresh);
  targetWindow.addEventListener("scroll", refresh, true);
  refresh();

  return {
    refresh,
    destroy: () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
      editor.off("focus", refresh);
      targetWindow.removeEventListener("resize", refresh);
      targetWindow.removeEventListener("scroll", refresh, true);
      observer?.disconnect();
      observer = null;
      observedTable = null;
    },
  };
}

interface FloatingTableToolbarProps {
  snapshot: TableToolbarSnapshot;
  onIntent$: PropFunction<(intent: TableToolbarIntent) => void>;
}

const ACTION_GROUPS = ["rows", "columns", "cells", "table"] as const;

const ACTION_GROUP_LABELS: Record<(typeof ACTION_GROUPS)[number], string> = {
  rows: "Rows",
  columns: "Columns",
  cells: "Cells",
  table: "Table",
};

/** One governed icon meaning for every structural table action. */
export const TABLE_ACTION_ICONS: Record<TableActionId, TwyneIconName> = {
  addRowBefore: "arrow-up",
  addRowAfter: "arrow-down",
  deleteRow: "trash",
  toggleHeaderRow: "row-horizontal",
  addColumnBefore: "arrow-left",
  addColumnAfter: "arrow-right",
  deleteColumn: "trash",
  toggleHeaderColumn: "row-vertical",
  mergeCells: "link",
  splitCell: "link-broken",
  distributeColumns: "align-horizontal-spacing",
  deleteTable: "trash",
};

/**
 * Floating controls for the active table. It is intentionally editor-agnostic:
 * all state and intents cross the public contract above, leaving central
 * editor registration to the coordinator-owned integration wave.
 */
export const FloatingTableToolbar = component$<FloatingTableToolbarProps>(
  (props) => {
    const { snapshot } = props;
    if (!snapshot.visible || !snapshot.position) return null;

    return (
      <div
        data-floating-table-toolbar
        role="toolbar"
        aria-label="Table tools"
        data-placement={snapshot.position.placement}
        class="fixed flex flex-col gap-2 overflow-visible bg-[var(--color-paper)] p-2 text-[var(--color-ink)]"
        style={{
          left: `${snapshot.position.left}px`,
          top: `${snapshot.position.top}px`,
          width: `${snapshot.position.width}px`,
          zIndex: "var(--z-dropdown)",
          border: "1px solid var(--color-paper-3)",
          borderRadius: "4px",
          fontFamily: "var(--font-typewriter)",
          boxShadow:
            "0 6px 8px color-mix(in srgb, var(--color-ink) 12%, transparent)",
        }}
      >
        <div class="flex flex-wrap items-start gap-2">
          {ACTION_GROUPS.map((group) => {
            const actions = TABLE_ACTIONS.filter(
              (action) => action.group === group,
            );
            return (
              <div
                key={group}
                role="group"
                aria-label={`${ACTION_GROUP_LABELS[group]} actions`}
                class="flex items-center gap-1 rounded-sm border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-1"
              >
                <span class="px-1 text-[0.58rem] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                  {ACTION_GROUP_LABELS[group]}
                </span>
                {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={!snapshot.availability[action.id]}
                  class={[
                    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-transparent hover:border-[var(--color-paper-3)] hover:bg-[var(--color-paper)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-vermilion)] disabled:cursor-not-allowed disabled:opacity-35",
                    action.destructive
                      ? "text-[var(--color-vermilion)]"
                      : "text-[var(--color-ink-light)] hover:text-[var(--color-ink)]",
                  ]}
                  title={action.label}
                  aria-label={action.label}
                  onClick$={() =>
                    props.onIntent$({
                      kind: "action",
                      action: action.id,
                    })
                  }
                >
                  <Icon name={TABLE_ACTION_ICONS[action.id]} size={17} />
                </button>
                ))}
              </div>
            );
          })}
        </div>

        <div class="flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--color-paper-3)] pt-2">
          <label class="flex items-center gap-1 text-[0.65rem]">
            <span>Width</span>
            <select
              class="border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-1.5 py-1"
              value={snapshot.format.tableWidth ?? ""}
              onChange$={(_, element) =>
                props.onIntent$({
                  kind: "width",
                  width: (element.value || null) as
                    | `${number}%`
                    | `${number}px`
                    | "auto"
                    | null,
                })
              }
            >
              <option value="">Document default</option>
              <option value="auto">Auto</option>
              <option value="50%">50%</option>
              <option value="75%">75%</option>
              <option value="100%">100%</option>
              <option value="320px">320 px</option>
              <option value="480px">480 px</option>
              <option value="640px">640 px</option>
              {snapshot.format.tableWidth?.endsWith("px") && (
                <option value={snapshot.format.tableWidth}>
                  {snapshot.format.tableWidth}
                </option>
              )}
            </select>
          </label>

          <div role="group" aria-label="Table alignment" class="flex">
            {TABLE_ALIGNMENTS.map((alignment) => (
              <button
                key={alignment}
                type="button"
                class="btn-paper px-2 py-1 text-[0.65rem]"
                aria-pressed={snapshot.format.tableAlignment === alignment}
                onClick$={() =>
                  props.onIntent$({ kind: "alignment", alignment })
                }
              >
                {alignment}
              </button>
            ))}
          </div>

          <label class="flex items-center gap-1 text-[0.65rem]">
            <span>Style</span>
            <select
              class="border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-1.5 py-1"
              value={snapshot.format.tableStyle ?? ""}
              onChange$={(_, element) =>
                props.onIntent$({
                  kind: "style",
                  style: (element.value || null) as
                    | (typeof TABLE_STYLE_IDS)[number]
                    | null,
                })
              }
            >
              <option value="">Document default</option>
              {TABLE_STYLE_IDS.map((style) => (
                <option key={style} value={style}>
                  {style.replace("-", " ")}
                </option>
              ))}
            </select>
          </label>

          <label class="flex min-w-[11rem] flex-1 items-center gap-1 text-[0.65rem]">
            <span>Caption</span>
            <input
              type="text"
              maxLength={500}
              class="min-w-[10rem] flex-1 border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1"
              value={snapshot.format.tableCaption ?? ""}
              placeholder="Add a table caption"
              onChange$={(_, element) =>
                props.onIntent$({
                  kind: "caption",
                  caption: element.value || null,
                })
              }
            />
          </label>
        </div>
      </div>
    );
  },
);
