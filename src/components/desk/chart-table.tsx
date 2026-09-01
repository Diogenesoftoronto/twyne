import { component$ } from "@qwik.dev/core";

export interface ChartTableColumn {
  key: string;
  label: string;
}

export interface ChartTableRow {
  key: string;
  cells: Record<string, string | number>;
}

export const ChartTable = component$<{
  caption: string;
  columns: ChartTableColumn[];
  rows: ChartTableRow[];
  open?: boolean;
}>((props) => {
  return (
    <details
      class="mt-4 border-t border-dotted border-[var(--color-ink-muted)] pt-3"
      open={props.open}
    >
      <summary class="cursor-pointer text-xs font-semibold tracking-[0.12em] uppercase text-[var(--color-ink-muted)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-cobalt)]">
        View data table
      </summary>
      <div class="mt-3 overflow-x-auto">
        <table class="w-full border-collapse text-left text-sm">
          <caption class="sr-only">{props.caption}</caption>
          <thead>
            <tr class="border-y border-[var(--color-ink)]">
              {props.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  class="px-2 py-2 text-xs tracking-[0.08em] uppercase"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr
                key={row.key}
                class="border-b border-dotted border-[var(--color-ink-muted)]"
              >
                {props.columns.map((column, index) =>
                  index === 0 ? (
                    <th
                      key={column.key}
                      scope="row"
                      class="px-2 py-2 font-medium"
                    >
                      {row.cells[column.key]}
                    </th>
                  ) : (
                    <td key={column.key} class="px-2 py-2 tabular-nums">
                      {row.cells[column.key]}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
});
