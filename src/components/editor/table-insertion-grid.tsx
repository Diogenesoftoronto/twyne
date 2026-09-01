import {
  $,
  component$,
  sync$,
  useSignal,
  type PropFunction,
} from "@qwik.dev/core";

export const TABLE_GRID_DEFAULT_ROWS = 8;
export const TABLE_GRID_DEFAULT_COLUMNS = 10;
export const TABLE_INSERT_MAX_ROWS = 20;
export const TABLE_INSERT_MAX_COLUMNS = 12;

export interface TableDimensions {
  rows: number;
  columns: number;
}

export type TableGridDirection =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End";

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.floor(numeric)) : fallback;
}

export function clampTableDimensions(
  dimensions: Partial<TableDimensions>,
  limits: Partial<TableDimensions> = {},
): TableDimensions {
  const maxRows = Math.min(
    TABLE_INSERT_MAX_ROWS,
    positiveInteger(limits.rows, TABLE_INSERT_MAX_ROWS),
  );
  const maxColumns = Math.min(
    TABLE_INSERT_MAX_COLUMNS,
    positiveInteger(limits.columns, TABLE_INSERT_MAX_COLUMNS),
  );
  return {
    rows: Math.min(maxRows, positiveInteger(dimensions.rows, 1)),
    columns: Math.min(maxColumns, positiveInteger(dimensions.columns, 1)),
  };
}

export function moveTableGridSelection(
  current: TableDimensions,
  direction: TableGridDirection,
  limits: TableDimensions,
): TableDimensions {
  const selection = clampTableDimensions(current, limits);
  switch (direction) {
    case "ArrowUp":
      return { ...selection, rows: Math.max(1, selection.rows - 1) };
    case "ArrowDown":
      return {
        ...selection,
        rows: Math.min(limits.rows, selection.rows + 1),
      };
    case "ArrowLeft":
      return {
        ...selection,
        columns: Math.max(1, selection.columns - 1),
      };
    case "ArrowRight":
      return {
        ...selection,
        columns: Math.min(limits.columns, selection.columns + 1),
      };
    case "Home":
      return { rows: 1, columns: 1 };
    case "End":
      return clampTableDimensions(limits, limits);
  }
}

export function isTableGridCellSelected(
  cell: TableDimensions,
  selection: TableDimensions,
): boolean {
  return cell.rows <= selection.rows && cell.columns <= selection.columns;
}

interface TableInsertionGridProps {
  maxRows?: number;
  maxColumns?: number;
  withHeaderRow?: boolean;
  onInsert$: PropFunction<
    (rows: number, columns: number, withHeaderRow: boolean) => void
  >;
  onCancel$?: PropFunction<() => void>;
}

/**
 * Keyboard and pointer accessible N-by-M table chooser.
 *
 * The highlighted rectangle is the insertion size. Arrow keys resize it,
 * Enter inserts, and Escape returns control to the caller.
 */
export const TableInsertionGrid = component$<TableInsertionGridProps>(
  (props) => {
    const limits = clampTableDimensions(
      {
        rows: props.maxRows ?? TABLE_GRID_DEFAULT_ROWS,
        columns: props.maxColumns ?? TABLE_GRID_DEFAULT_COLUMNS,
      },
      {
        rows: TABLE_INSERT_MAX_ROWS,
        columns: TABLE_INSERT_MAX_COLUMNS,
      },
    );
    const selectedRows = useSignal(1);
    const selectedColumns = useSignal(1);

    const select = $((rows: number, columns: number) => {
      const next = clampTableDimensions({ rows, columns }, limits);
      selectedRows.value = next.rows;
      selectedColumns.value = next.columns;
    });

    const commit = $((rows?: number, columns?: number) => {
      const dimensions = clampTableDimensions(
        {
          rows: rows ?? selectedRows.value,
          columns: columns ?? selectedColumns.value,
        },
        limits,
      );
      return props.onInsert$(
        dimensions.rows,
        dimensions.columns,
        props.withHeaderRow ?? true,
      );
    });

    const preventGridKeys = sync$((event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
          "Enter",
          "Escape",
        ].includes(event.key)
      ) {
        event.preventDefault();
      }
    });

    const handleGridKey = $((event: KeyboardEvent) => {
      if (event.key === "Enter") {
        void commit();
        return;
      }
      if (event.key === "Escape") {
        void props.onCancel$?.();
        return;
      }
      if (
        ![
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
        ].includes(event.key)
      ) {
        return;
      }
      const next = moveTableGridSelection(
        { rows: selectedRows.value, columns: selectedColumns.value },
        event.key as TableGridDirection,
        limits,
      );
      selectedRows.value = next.rows;
      selectedColumns.value = next.columns;
    });

    const rows = Array.from({ length: limits.rows }, (_, index) => index + 1);
    const columns = Array.from(
      { length: limits.columns },
      (_, index) => index + 1,
    );
    const selection = {
      rows: selectedRows.value,
      columns: selectedColumns.value,
    };

    return (
      <div
        data-table-insertion-grid
        class="w-fit bg-[var(--color-paper)] p-3 text-[var(--color-ink)]"
        style={{
          border: "1px solid var(--color-paper-3)",
          borderRadius: "4px",
          fontFamily: "var(--font-typewriter)",
          boxShadow:
            "0 6px 8px color-mix(in srgb, var(--color-ink) 12%, transparent)",
        }}
      >
        <p
          class="mb-2 text-[0.72rem] font-semibold"
          aria-live="polite"
          aria-atomic="true"
        >
          {selection.rows} × {selection.columns} table
        </p>
        <div
          role="grid"
          aria-label="Choose table size"
          aria-rowcount={limits.rows}
          aria-colcount={limits.columns}
          tabIndex={0}
          class="grid gap-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-vermilion)]"
          style={{
            gridTemplateColumns: `repeat(${limits.columns}, 1.15rem)`,
          }}
          onKeyDown$={[preventGridKeys, handleGridKey]}
        >
          {rows.flatMap((row) =>
            columns.map((column) => {
              const active = isTableGridCellSelected(
                { rows: row, columns: column },
                selection,
              );
              return (
                <button
                  key={`${row}:${column}`}
                  type="button"
                  role="gridcell"
                  aria-rowindex={row}
                  aria-colindex={column}
                  aria-selected={active}
                  aria-label={`${row} by ${column} table`}
                  class={[
                    "h-[1.15rem] w-[1.15rem] border transition-colors duration-150",
                    active
                      ? "border-[var(--color-vermilion)] bg-[color-mix(in_srgb,var(--color-vermilion)_22%,transparent)]"
                      : "border-[var(--color-paper-3)] bg-[var(--color-paper-2)] hover:border-[var(--color-ink-muted)]",
                  ]}
                  onPointerEnter$={() => select(row, column)}
                  onFocus$={() => select(row, column)}
                  onClick$={() => commit(row, column)}
                />
              );
            }),
          )}
        </div>
        <p class="mt-2 text-[0.62rem] text-[var(--color-ink-muted)]">
          Arrow keys resize. Enter inserts.
        </p>
      </div>
    );
  },
);
