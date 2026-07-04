/**
 * GitHub-style "days writing" contribution heatmap. Renders the last ~371
 * days as week-columns of 7 day-squares, colored by activity count.
 */

import { component$ } from "@builder.io/qwik";

export interface ActivityDay {
  day: string; // "YYYY-MM-DD"
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 53;

function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

const LEVEL_COLORS = [
  "var(--color-paper-3)",
  "#e8d5c4",
  "#e0a97a",
  "#d97b3f",
  "var(--color-vermilion)",
];

export const WritingHeatmap = component$(
  ({ days }: { days: ActivityDay[] }) => {
    const byDay = new Map(days.map((d) => [d.day, d.count]));

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const totalDays = WEEKS * 7;
    // Align the grid so the last column ends on today, in Sunday-first rows.
    const endDow = today.getUTCDay();
    const start = new Date(
      today.getTime() - (totalDays - 1 - (6 - endDow)) * DAY_MS,
    );

    const weeks: { date: Date; count: number }[][] = [];
    let cursor = new Date(start);
    for (let w = 0; w < WEEKS; w++) {
      const col: { date: Date; count: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const key = cursor.toISOString().slice(0, 10);
        col.push({
          date: new Date(cursor),
          count: cursor.getTime() > today.getTime() ? -1 : (byDay.get(key) ?? 0),
        });
        cursor = new Date(cursor.getTime() + DAY_MS);
      }
      weeks.push(col);
    }

    const totalContributions = days.reduce((sum, d) => sum + d.count, 0);

    return (
      <div>
        <div class="flex gap-[3px] overflow-x-auto pb-1">
          {weeks.map((col, wi) => (
            <div key={wi} class="flex flex-col gap-[3px]">
              {col.map((cell, di) => (
                <div
                  key={di}
                  title={
                    cell.count >= 0
                      ? `${cell.date.toISOString().slice(0, 10)}: ${cell.count} ${cell.count === 1 ? "entry" : "entries"}`
                      : undefined
                  }
                  class="h-[10px] w-[10px] rounded-[2px]"
                  style={{
                    background:
                      cell.count < 0
                        ? "transparent"
                        : LEVEL_COLORS[levelFor(cell.count)],
                  }}
                />
              ))}
            </div>
          ))}
        </div>
        <div
          class="mt-2 flex items-center gap-2 text-[10px] tracking-[0.1em] uppercase text-[var(--color-ink-muted)]"
          style="font-family: var(--font-typewriter);"
        >
          <span>{totalContributions} entries in the last year</span>
          <span class="ml-auto flex items-center gap-1 normal-case tracking-normal">
            Less
            {LEVEL_COLORS.map((c) => (
              <span
                key={c}
                class="h-[10px] w-[10px] rounded-[2px]"
                style={{ background: c }}
              />
            ))}
            More
          </span>
        </div>
      </div>
    );
  },
);
