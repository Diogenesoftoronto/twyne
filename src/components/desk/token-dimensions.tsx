import { component$ } from "@builder.io/qwik";
import type { TokenDimensionTotals } from "../../utils/usage-summary";
import { ChartTable } from "./chart-table";

const DIMENSIONS = [
  ["inputTokens", "Input"],
  ["outputTokens", "Output"],
  ["cacheReadTokens", "Cache read"],
  ["cacheWriteTokens", "Cache write"],
  ["reasoningTokens", "Reasoning"],
  ["totalTokens", "Provider total"],
] as const;

export const TokenDimensions = component$<{ tokens: TokenDimensionTotals }>(
  (props) => {
    const maximum = Math.max(
      1,
      ...DIMENSIONS.map(([key]) => props.tokens[key]),
    );
    const hasAny = DIMENSIONS.some(
      ([key]) => props.tokens.coverage[key].reportedEvents > 0,
    );
    if (!hasAny)
      return (
        <p class="py-6 text-sm text-[var(--color-ink-muted)]">
          Providers did not report token dimensions for these generations.
        </p>
      );
    return (
      <div>
        <ol class="divide-y divide-dotted divide-[var(--color-ink-muted)]">
          {DIMENSIONS.map(([key, label]) => (
            <li
              key={key}
              class="grid grid-cols-[7rem_1fr_auto] items-center gap-3 py-3"
            >
              <span class="text-sm">{label}</span>
              <span class="h-2 bg-[var(--color-paper-3)]">
                <i
                  class="block h-full bg-[var(--color-mustard)]"
                  style={{ width: `${(props.tokens[key] / maximum) * 100}%` }}
                />
              </span>
              <span class="text-xs tabular-nums">
                {props.tokens[key].toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
        {props.tokens.reportedTotalDiscrepancies > 0 && (
          <p class="mt-3 text-xs text-[var(--color-ink-muted)]">
            {props.tokens.reportedTotalDiscrepancies} provider totals differed
            from input plus output. Reported totals are preserved.
          </p>
        )}
        <ChartTable
          caption="Token dimensions and reporting coverage"
          columns={[
            { key: "dimension", label: "Dimension" },
            { key: "tokens", label: "Tokens" },
            { key: "reported", label: "Reported" },
            { key: "missing", label: "Missing" },
          ]}
          rows={DIMENSIONS.map(([key, label]) => ({
            key,
            cells: {
              dimension: label,
              tokens: props.tokens[key].toLocaleString(),
              reported: props.tokens.coverage[key].reportedEvents,
              missing: props.tokens.coverage[key].missingEvents,
            },
          }))}
        />
      </div>
    );
  },
);
