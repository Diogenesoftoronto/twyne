import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import { DeskFigure } from "./desk-figure";
import type {
  EvidencePattern,
  WriterPatterns as WriterPatternEvidence,
} from "../../utils/usage-summary";

function evidence<T>(
  pattern: EvidencePattern<T>,
  render: (value: T) => string,
): string {
  return pattern.status === "available" && pattern.value !== undefined
    ? render(pattern.value)
    : `Needs ${Math.max(0, pattern.minimum - pattern.evidenceCount)} more evidence point${pattern.minimum - pattern.evidenceCount === 1 ? "" : "s"}`;
}

export const WriterPatterns = component$<{
  patterns: WriterPatternEvidence;
  folioTitles: Record<string, string>;
}>((props) => {
  const newlyFiled = useSignal<string[]>([]);
  const patternKeys = [
    "currentStreak",
    "longestStreak",
    "mostActiveWeekday",
    "mostUsedTool",
    "mostRevisedFolio",
  ];
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const keys = track(() =>
      Object.entries(props.patterns)
        .filter(([, pattern]) => pattern.status === "available")
        .map(([key]) => key)
        .join(","),
    );
    try {
      const seen = JSON.parse(
        localStorage.getItem("twyne.desk.patterns-seen") ?? "[]",
      ) as string[];
      const fresh = keys
        ? keys.split(",").filter((key) => !seen.includes(key))
        : [];
      // Grow-only for this visit: a later re-read of the ledger must not
      // take back a stamp the writer has just watched land.
      if (fresh.length) {
        newlyFiled.value = [...new Set([...newlyFiled.value, ...fresh])];
      }
      localStorage.setItem(
        "twyne.desk.patterns-seen",
        JSON.stringify([...new Set([...seen, ...fresh])]),
      );
    } catch {
      // Storage refused: no stamp is better than one that replays forever.
    }
  });
  const rows = [
    [
      "Current streak",
      evidence(
        props.patterns.currentStreak,
        (value) => `${value} day${value === 1 ? "" : "s"}`,
      ),
    ],
    [
      "Longest streak",
      evidence(
        props.patterns.longestStreak,
        (value) => `${value} day${value === 1 ? "" : "s"}`,
      ),
    ],
    [
      "Most active weekday",
      evidence(props.patterns.mostActiveWeekday, (value) => value.join(", ")),
    ],
    [
      "Most used tool",
      evidence(props.patterns.mostUsedTool, (value) => value.join(", ")),
    ],
    [
      "Most revised folio",
      evidence(props.patterns.mostRevisedFolio, (value) =>
        value
          .map((id) => props.folioTitles[id] ?? "Untitled local folio")
          .join(", "),
      ),
    ],
  ];
  return (
    <section
      aria-labelledby="patterns-heading"
      class="border-b-2 border-[var(--color-ink)] py-7"
    >
      <p class="dept-label">03 / Evidence</p>
      <h2 id="patterns-heading" class="mt-1 font-display text-2xl">
        Writer patterns
      </h2>
      <p class="mt-2 max-w-2xl text-sm text-[var(--color-ink-muted)]">
        Patterns appear only after fixed evidence thresholds are met. Ties are
        retained instead of broken arbitrarily.
      </p>
      <dl class="mt-5 divide-y divide-dotted divide-[var(--color-ink-muted)] border-y border-[var(--color-ink)]">
        {rows.map(([label, value], index) => (
          <div key={label} class="grid gap-1 py-3 sm:grid-cols-[13rem_1fr]">
            <dt class="text-xs font-semibold tracking-[0.08em] uppercase text-[var(--color-ink-muted)]">
              {label}
            </dt>
            <dd class="text-sm">
              <DeskFigure value={value} />{" "}
              {newlyFiled.value.includes(patternKeys[index]) && (
                <span class="desk-filed">Filed</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
});
