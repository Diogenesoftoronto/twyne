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
  type TableFormatAttributes,
  type TableToolbarIntent,
} from "./extensions/table-format";

export const TABLE_TOOLBAR_GAP = 8;
export const TABLE_TOOLBAR_VIEWPORT_MARGIN = 8;
export const TABLE_TOOLBAR_IDEAL_WIDTH = 760;
export const TABLE_TOOLBAR_IDEAL_HEIGHT = 112;

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

export interface TableToolbarSnapshot {
  visible: boolean;
  anchor: PlainRect | null;
  position: TableToolbarPosition | null;
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
    roomAbove >= height || roomAbove >= roomBelow ? "above" : "below";
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
): TableToolbarSnapshot {
  const table = getActiveTableElement(editor);
  if (!table) return EMPTY_TABLE_TOOLBAR_SNAPSHOT;
  const anchor = toPlainRect(table.getBoundingClientRect());
  return {
    visible: true,
    anchor,
    position: computeTableToolbarPosition(anchor, viewport),
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
 */
export function createTableToolbarController(
  editor: Editor,
  onChange: (snapshot: TableToolbarSnapshot) => void,
  targetWindow: Window = window,
): TableToolbarController {
  let observedTable: HTMLTableElement | null = null;
  let observer: ResizeObserver | null =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => refresh());

  const refresh = () => {
    const nextTable = getActiveTableElement(editor);
    if (nextTable !== observedTable) {
      if (observedTable) observer?.unobserve(observedTable);
      observedTable = nextTable;
      if (observedTable) observer?.observe(observedTable);
    }
    onChange(
      readTableToolbarSnapshot(editor, {
        width: targetWindow.innerWidth,
        height: targetWindow.innerHeight,
      }),
    );
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
        class="fixed flex flex-col gap-2 overflow-x-auto bg-[var(--color-paper)] p-2 text-[var(--color-ink)]"
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
        <div class="flex min-w-max items-center gap-1">
          {ACTION_GROUPS.flatMap((group) => {
            const actions = TABLE_ACTIONS.filter(
              (action) => action.group === group,
            );
            return [
              ...(group === "rows"
                ? []
                : [
                    <span
                      key={`${group}:separator`}
                      aria-hidden="true"
                      class="mx-1 h-6 w-px bg-[var(--color-paper-3)]"
                    />,
                  ]),
              ...actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={!snapshot.availability[action.id]}
                  class={[
                    "btn-paper whitespace-nowrap px-2 py-1 text-[0.65rem] disabled:cursor-not-allowed disabled:opacity-40",
                    action.destructive ? "text-[var(--color-vermilion)]" : "",
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
                  {action.label}
                </button>
              )),
            ];
          })}
        </div>

        <div class="flex min-w-max items-center gap-2 border-t border-[var(--color-paper-3)] pt-2">
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

          <label class="flex min-w-[14rem] flex-1 items-center gap-1 text-[0.65rem]">
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
