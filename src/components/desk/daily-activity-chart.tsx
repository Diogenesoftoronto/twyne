import { component$ } from "@builder.io/qwik";
import type { DailyUsagePoint } from "../../utils/usage-summary";
import { ChartTable } from "./chart-table";

export const DailyActivityChart = component$<{ points: DailyUsagePoint[] }>(
  (props) => {
    if (!props.points.length) {
      return (
        <p class="py-5 text-sm text-[var(--color-ink-muted)]">
          No writing or AI actions fall inside this range yet.
        </p>
      );
    }
    const maximum = Math.max(
      1,
      ...props.points.map((point) =>
        Math.max(point.writingCount, point.logicalActions),
      ),
    );
    return (
      <div>
        <div
          class="flex h-36 items-end gap-1 border-b border-[var(--color-ink)]"
          role="img"
          aria-label="Daily writing and editorial actions"
        >
          {props.points.map((point) => (
            <div
              key={point.day}
              class="group flex min-w-2 flex-1 items-end gap-px"
              title={`${point.day}: ${point.writingCount} writing marks, ${point.logicalActions} AI actions`}
            >
              <span
                class="block w-1/2 bg-[var(--color-sage)]"
                style={{
                  height: `${Math.max(2, (point.writingCount / maximum) * 100)}%`,
                }}
              />
              <span
                class="block w-1/2 bg-[var(--color-vermilion)]"
                style={{
                  height: `${Math.max(2, (point.logicalActions / maximum) * 100)}%`,
                }}
              />
            </div>
          ))}
        </div>
        <p class="mt-2 flex gap-4 text-xs text-[var(--color-ink-muted)]">
          <span>
            <i class="mr-1 inline-block h-2 w-2 bg-[var(--color-sage)]" />
            Writing marks
          </span>
          <span>
            <i class="mr-1 inline-block h-2 w-2 bg-[var(--color-vermilion)]" />
            AI actions
          </span>
        </p>
        <ChartTable
          caption="Daily writing and AI activity"
          columns={[
            { key: "day", label: "UTC day" },
            { key: "writing", label: "Writing" },
            { key: "actions", label: "Actions" },
            { key: "failed", label: "Failed" },
          ]}
          rows={props.points.map((point) => ({
            key: point.day,
            cells: {
              day: point.day,
              writing: point.writingCount,
              actions: point.logicalActions,
              failed: point.failedActions,
            },
          }))}
        />
      </div>
    );
  },
);
