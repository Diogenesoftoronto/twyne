import { $, component$, useSignal, type QRL } from "@builder.io/qwik";
import type { UsageSummary } from "../../utils/usage-summary";
import { captureProductEvent } from "../../utils/product-analytics";
import { ChartTable } from "./chart-table";
import { TokenDimensions } from "./token-dimensions";
import { UsageBreakdowns } from "./usage-breakdowns";

const TABS = ["cost", "features", "models", "tokens"] as const;
type UsageTab = (typeof TABS)[number];

export const UsageCost = component$<{
  summary: UsageSummary;
  totalsOnly?: boolean;
  onSection$?: QRL<(section: UsageTab) => void>;
}>((props) => {
  const active = useSignal<UsageTab>("cost");
  const selectTab = $((tab: UsageTab) => {
    active.value = tab;
    props.onSection$?.(tab);
    void captureProductEvent("desk_section_opened", { section: tab });
  });
  const costRows = props.summary.daily.map((point) => ({
    key: point.day,
    cells: {
      day: point.day,
      actual: `$${(point.actualCostMicrousd / 1_000_000).toFixed(4)}`,
      estimated: `$${(point.estimatedCostMicrousd / 1_000_000).toFixed(4)}`,
      unknown: point.unknownCostGenerations,
    },
  }));
  const maxCost = Math.max(
    1,
    ...props.summary.daily.map(
      (point) => point.actualCostMicrousd + point.estimatedCostMicrousd,
    ),
  );
  return (
    <section
      aria-labelledby="usage-cost-heading"
      class="border-b-2 border-[var(--color-ink)] py-7"
    >
      <p class="dept-label">02 / AI ledger</p>
      <h2 id="usage-cost-heading" class="mt-1 font-display text-2xl">
        Usage and cost
      </h2>
      <div
        class="mt-5 grid grid-cols-4 border-y border-[var(--color-ink)]"
        role="tablist"
        aria-label="AI usage view"
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active.value === tab}
            onClick$={() => selectTab(tab)}
            class={{
              "min-w-0 border-r border-[var(--color-ink)] px-1 py-2 text-[0.65rem] font-semibold tracking-[0.08em] uppercase focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--color-cobalt)] sm:px-4 sm:text-xs sm:tracking-[0.1em]": true,
              "bg-[var(--color-ink)] text-[var(--color-paper)]":
                active.value === tab,
            }}
          >
            {tab}
          </button>
        ))}
      </div>
      {props.totalsOnly && (
        <p class="mt-3 text-xs text-[var(--color-ink-muted)]">
          All-time totals and breakdowns are shown. Daily activity is limited to
          the most recent 90 UTC days.
        </p>
      )}
      <div class="pt-5" role="tabpanel">
        {active.value === "cost" && (
          <div>
            <div class="grid gap-6 sm:grid-cols-[1fr_15rem]">
              <div>
                {props.summary.daily.length ? (
                  <div
                    class="flex h-40 items-end gap-1 border-b border-[var(--color-ink)]"
                    role="img"
                    aria-label="Daily actual and estimated AI cost"
                  >
                    {props.summary.daily.map((point) => (
                      <div
                        key={point.day}
                        class="flex min-w-2 flex-1 flex-col-reverse"
                        title={`${point.day}: actual $${(point.actualCostMicrousd / 1_000_000).toFixed(4)}, estimated $${(point.estimatedCostMicrousd / 1_000_000).toFixed(4)}`}
                      >
                        <i
                          class="block bg-[var(--color-cobalt)]"
                          style={{
                            height: `${(point.actualCostMicrousd / maxCost) * 140}px`,
                          }}
                        />
                        <i
                          class="block bg-[var(--color-mustard)]"
                          style={{
                            height: `${(point.estimatedCostMicrousd / maxCost) * 140}px`,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p class="py-6 text-sm text-[var(--color-ink-muted)]">
                    No AI cost evidence is available for this range.
                  </p>
                )}
                <p class="mt-2 flex gap-4 text-xs text-[var(--color-ink-muted)]">
                  <span>
                    <i class="mr-1 inline-block h-2 w-2 bg-[var(--color-cobalt)]" />
                    Actual
                  </span>
                  <span>
                    <i class="mr-1 inline-block h-2 w-2 bg-[var(--color-mustard)]" />
                    Estimated
                  </span>
                </p>
              </div>
              <dl class="divide-y divide-dotted divide-[var(--color-ink-muted)] border-y border-[var(--color-ink)] text-sm">
                <div class="py-3">
                  <dt class="text-xs text-[var(--color-ink-muted)]">
                    Actual provider cost
                  </dt>
                  <dd class="font-display text-xl tabular-nums">
                    $
                    {(
                      props.summary.overall.actualCostMicrousd / 1_000_000
                    ).toFixed(4)}
                  </dd>
                </div>
                <div class="py-3">
                  <dt class="text-xs text-[var(--color-ink-muted)]">
                    Catalog estimate
                  </dt>
                  <dd class="font-display text-xl tabular-nums">
                    $
                    {(
                      props.summary.overall.estimatedCostMicrousd / 1_000_000
                    ).toFixed(4)}
                  </dd>
                </div>
                <div class="py-3">
                  <dt class="text-xs text-[var(--color-ink-muted)]">
                    Local, no cash cost
                  </dt>
                  <dd class="font-display text-xl tabular-nums">
                    {props.summary.overall.localGenerations}
                  </dd>
                </div>
                <div class="py-3">
                  <dt class="text-xs text-[var(--color-ink-muted)]">
                    Unknown price
                  </dt>
                  <dd class="font-display text-xl tabular-nums">
                    {props.summary.overall.unknownCostGenerations}
                  </dd>
                </div>
              </dl>
            </div>
            <ChartTable
              caption="Daily actual and estimated AI cost"
              columns={[
                { key: "day", label: "UTC day" },
                { key: "actual", label: "Actual" },
                { key: "estimated", label: "Estimated" },
                { key: "unknown", label: "Unknown" },
              ]}
              rows={costRows}
            />
          </div>
        )}
        {active.value === "features" && (
          <UsageBreakdowns
            kind="features"
            features={props.summary.features}
            providers={props.summary.providers}
          />
        )}
        {active.value === "models" && (
          <UsageBreakdowns
            kind="models"
            features={props.summary.features}
            providers={props.summary.providers}
          />
        )}
        {active.value === "tokens" && (
          <TokenDimensions tokens={props.summary.overall.tokens} />
        )}
      </div>
    </section>
  );
});
