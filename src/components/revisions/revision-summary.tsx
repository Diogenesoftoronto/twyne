import { component$, useStylesScoped$ } from "@qwik.dev/core";
import type { RevisionComparison } from "../../utils/revision-history";

export const RevisionSummary = component$<{ comparison: RevisionComparison }>(
  ({ comparison }) => {
    useStylesScoped$(`
    .revision-summary { margin-top:1rem; padding:.75rem 0; border-block:1px solid var(--color-paper-3); color:var(--color-ink-light); font: .75rem/1.5 var(--font-sans); }
    .change-count { display:flex; align-items:baseline; gap:.4rem; margin-bottom:.75rem; }
    .change-count strong { color:var(--color-ink); font-variant-numeric:tabular-nums; }
    .size-comparison { display:grid; gap:1rem; margin:0; }
    .size-heading { display:flex; align-items:baseline; justify-content:space-between; gap:.5rem; margin-bottom:.3rem; }
    dt { color:var(--color-ink); font-weight:600; }
    dd { margin:0; }
    .delta { font-variant-numeric:tabular-nums; }
    .bar-row { display:grid; grid-template-columns:3.75rem minmax(0,1fr) 4.5rem; align-items:center; gap:.5rem; min-height:1.4rem; }
    .bar-track { height:.375rem; background:var(--color-paper-3); }
    .bar { display:block; height:100%; background:var(--color-ink-light); }
    .bar--after { background:var(--color-vermilion-2); }
    .count { text-align:right; color:var(--color-ink); font-variant-numeric:tabular-nums; }
  `);
    const metrics = [
      {
        label: "Words",
        before: comparison.wordsBefore,
        after: comparison.wordsAfter,
      },
      {
        label: "Passages",
        before: comparison.paragraphsBefore,
        after: comparison.paragraphsAfter,
      },
    ];
    return (
      <section class="revision-summary" aria-label="Revision changes">
        <p
          class="change-count"
          title="Counts added and removed words, including both sides of a replacement. This is different from the net word-count change."
        >
          <strong>{comparison.wordsChanged.toLocaleString()}</strong> words
          changed
        </p>
        <dl class="size-comparison">
          {metrics.map((metric) => {
            const maximum = Math.max(metric.before, metric.after, 1);
            const delta = metric.after - metric.before;
            return (
              <div key={metric.label}>
                <div class="size-heading">
                  <dt>{metric.label}</dt>
                  <dd class="delta">
                    {delta === 0
                      ? "No change"
                      : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toLocaleString()} net`}
                  </dd>
                </div>
                <dd>
                  <div class="bar-row">
                    <span>Before</span>
                    <span class="bar-track" aria-hidden="true">
                      <span
                        class="bar"
                        style={{ width: `${(metric.before / maximum) * 100}%` }}
                      />
                    </span>
                    <span class="count">{metric.before.toLocaleString()}</span>
                  </div>
                  <div class="bar-row">
                    <span>After</span>
                    <span class="bar-track" aria-hidden="true">
                      <span
                        class="bar bar--after"
                        style={{ width: `${(metric.after / maximum) * 100}%` }}
                      />
                    </span>
                    <span class="count">{metric.after.toLocaleString()}</span>
                  </div>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>
    );
  },
);
