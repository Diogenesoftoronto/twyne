import { component$ } from "@qwik.dev/core";
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
    <section aria-labelledby="patterns-heading" class="py-7">
      <p class="dept-label">03 / Evidence</p>
      <h2 id="patterns-heading" class="mt-1 font-display text-2xl">
        Writer patterns
      </h2>
      <p class="mt-2 max-w-2xl text-sm text-[var(--color-ink-muted)]">
        Patterns appear only after fixed evidence thresholds are met. Ties are
        retained instead of broken arbitrarily.
      </p>
      <dl class="mt-5 divide-y divide-dotted divide-[var(--color-ink-muted)] border-y border-[var(--color-ink)]">
        {rows.map(([label, value]) => (
          <div key={label} class="grid gap-1 py-3 sm:grid-cols-[13rem_1fr]">
            <dt class="text-xs font-semibold tracking-[0.08em] uppercase text-[var(--color-ink-muted)]">
              {label}
            </dt>
            <dd class="text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
});
