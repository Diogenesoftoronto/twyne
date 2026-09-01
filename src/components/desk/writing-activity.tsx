import { $, component$, useSignal } from "@qwik.dev/core";
import type {
  DailyUsagePoint,
  WritingHeatmapDay,
} from "../../utils/usage-summary";
import { WritingHeatmap } from "../profile/writing-heatmap";
import { ChartTable } from "./chart-table";
import { DailyActivityChart } from "./daily-activity-chart";

export const WritingActivity = component$<{
  days: WritingHeatmapDay[];
  daily: DailyUsagePoint[];
  folioTitles: Record<string, string>;
  selectedDay?: string;
  truncated?: boolean;
  windowLabel?: string;
}>((props) => {
  const selected = useSignal(props.selectedDay ?? props.days.at(-1)?.day ?? "");
  const day = props.days.find((item) => item.day === selected.value);
  const daily = props.daily.find((item) => item.day === selected.value);
  const selectDay = $((value: string) => {
    selected.value = value;
  });
  return (
    <section
      aria-labelledby="writing-activity-heading"
      class="border-b-2 border-[var(--color-ink)] py-7"
    >
      <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="dept-label">01 / Activity</p>
          <h2 id="writing-activity-heading" class="mt-1 font-display text-2xl">
            Writing days
          </h2>
        </div>
        <p class="max-w-md text-xs leading-5 text-[var(--color-ink-muted)]">
          A UTC-day record of saved writing activity. A ruled cell means legacy
          totals exceed available folio detail.
        </p>
      </div>
      {props.windowLabel && (
        <p class="mb-4 border-y border-dotted border-[var(--color-ink-muted)] py-2 text-xs text-[var(--color-ink-muted)]">
          {props.windowLabel}
        </p>
      )}
      <WritingHeatmap
        days={props.days.map((item) => ({ day: item.day, count: item.count }))}
        partialDays={props.days
          .filter((item) => !item.detailComplete)
          .map((item) => item.day)}
        selectedDay={selected.value}
        onSelectDay$={selectDay}
      />
      <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(15rem,0.7fr)]">
        <div>
          <h3 class="font-display text-lg">Daily activity</h3>
          <DailyActivityChart points={props.daily} />
        </div>
        <aside
          class="border-l border-[var(--color-ink)] pl-5"
          aria-live="polite"
        >
          <p class="text-xs font-semibold tracking-[0.12em] uppercase text-[var(--color-ink-muted)]">
            Selected UTC day
          </p>
          <h3 class="mt-1 font-display text-xl">
            {selected.value || "Choose a day"}
          </h3>
          {!day && !daily ? (
            <p class="mt-4 text-sm text-[var(--color-ink-muted)]">
              Choose a marked day to inspect its writing and AI actions.
            </p>
          ) : (
            <>
              <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt class="text-xs text-[var(--color-ink-muted)]">
                    Writing marks
                  </dt>
                  <dd class="font-semibold tabular-nums">{day?.count ?? 0}</dd>
                </div>
                <div>
                  <dt class="text-xs text-[var(--color-ink-muted)]">
                    AI actions
                  </dt>
                  <dd class="font-semibold tabular-nums">
                    {daily?.logicalActions ?? 0}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-[var(--color-ink-muted)]">
                    Generations
                  </dt>
                  <dd class="font-semibold tabular-nums">
                    {daily?.generations ?? 0}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-[var(--color-ink-muted)]">Failed</dt>
                  <dd class="font-semibold tabular-nums">
                    {daily?.failedActions ?? 0}
                  </dd>
                </div>
              </dl>
              <ol class="mt-4 divide-y divide-dotted divide-[var(--color-ink-muted)] border-t border-dotted border-[var(--color-ink-muted)]">
                {(day?.folios ?? []).map((folio) => (
                  <li
                    key={folio.folioId}
                    class="flex justify-between gap-3 py-2 text-sm"
                  >
                    <span>
                      {props.folioTitles[folio.folioId] ??
                        "Untitled local folio"}
                    </span>
                    <span class="tabular-nums text-[var(--color-ink-muted)]">
                      {folio.count}
                    </span>
                  </li>
                ))}
              </ol>
              {day && !day.detailComplete && (
                <p class="mt-3 text-xs text-[var(--color-ink-muted)]">
                  Folio detail is partial for this legacy day. The day total is
                  retained.
                </p>
              )}
            </>
          )}
          {props.truncated && (
            <p class="mt-3 text-xs font-semibold text-[var(--color-vermilion)]">
              The local detail view reached its safety limit. Totals may extend
              beyond the rows shown.
            </p>
          )}
        </aside>
      </div>
      <ChartTable
        caption="Writing-day totals and folio detail coverage"
        columns={[
          { key: "day", label: "UTC day" },
          { key: "total", label: "Writing" },
          { key: "folios", label: "Folios" },
          { key: "detail", label: "Detail" },
        ]}
        rows={props.days.map((item) => ({
          key: item.day,
          cells: {
            day: item.day,
            total: item.count,
            folios: item.folios.length,
            detail: item.detailComplete ? "Complete" : "Partial",
          },
        }))}
      />
    </section>
  );
});
