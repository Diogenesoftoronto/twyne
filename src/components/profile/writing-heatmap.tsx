/**
 * GitHub-style "days writing" contribution heatmap. Renders the last ~371
 * days as week-columns of 7 day-squares, colored by activity count.
 */

import { component$, type QRL } from "@builder.io/qwik";

export interface ActivityDay {
  day: string; // "YYYY-MM-DD"
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 53;

export function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

/**
 * A ramp from the paper rule up to full accent. Mixed rather than fixed so
 * the heatmap re-inks itself with the active theme instead of staying a strip
 * of warm orange on a cool or dark page.
 */
const LEVEL_COLORS = [
  "var(--color-paper-3)",
  "color-mix(in srgb, var(--color-vermilion) 22%, var(--color-paper-3))",
  "color-mix(in srgb, var(--color-vermilion) 48%, var(--color-paper-3))",
  "color-mix(in srgb, var(--color-vermilion) 74%, var(--color-paper-3))",
  "var(--color-vermilion)",
];

export interface HeatmapCell {
  day: string;
  count: number;
}

export function buildHeatmapWeeks(
  days: readonly ActivityDay[],
  now = Date.now(),
): HeatmapCell[][] {
  const byDay = new Map(days.map((day) => [day.day, day.count]));
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const totalDays = WEEKS * 7;
  const endDow = today.getUTCDay();
  const start = new Date(
    today.getTime() - (totalDays - 1 - (6 - endDow)) * DAY_MS,
  );
  const weeks: HeatmapCell[][] = [];
  let cursor = new Date(start);
  for (let week = 0; week < WEEKS; week += 1) {
    const column: HeatmapCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const key = cursor.toISOString().slice(0, 10);
      column.push({
        day: key,
        count: cursor.getTime() > today.getTime() ? -1 : (byDay.get(key) ?? 0),
      });
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
    weeks.push(column);
  }
  return weeks;
}

export interface WritingHeatmapProps {
  days: ActivityDay[];
  now?: number;
  selectedDay?: string;
  partialDays?: string[];
  onSelectDay$?: QRL<(day: string) => void>;
}

export const WritingHeatmap = component$<WritingHeatmapProps>((props) => {
  const weeks = buildHeatmapWeeks(props.days, props.now);
  const partialDays = new Set(props.partialDays ?? []);
  const totalContributions = props.days.reduce(
    (sum, day) => sum + day.count,
    0,
  );

  return (
    <div>
      <div class="flex gap-[3px] overflow-x-auto pb-1">
        {weeks.map((col, wi) => (
          <div key={wi} class="flex flex-col gap-[3px]">
            {col.map((cell, di) => (
              <button
                key={di}
                type="button"
                disabled={cell.count < 0 || !props.onSelectDay$}
                aria-label={
                  cell.count >= 0
                    ? `${cell.day}: ${cell.count} ${cell.count === 1 ? "entry" : "entries"}${partialDays.has(cell.day) ? ", partial detail" : ""}`
                    : undefined
                }
                aria-pressed={props.selectedDay === cell.day}
                onClick$={() => props.onSelectDay$?.(cell.day)}
                class="h-[10px] w-[10px] rounded-[1px] p-0 enabled:cursor-pointer enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-[var(--color-cobalt)]"
                style={{
                  background:
                    cell.count < 0
                      ? "transparent"
                      : LEVEL_COLORS[levelFor(cell.count)],
                  boxShadow:
                    props.selectedDay === cell.day
                      ? "0 0 0 1px var(--color-ink)"
                      : partialDays.has(cell.day)
                        ? "inset 0 0 0 1px var(--color-ink-muted)"
                        : undefined,
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
});
