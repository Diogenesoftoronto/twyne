import { component$ } from "@builder.io/qwik";
import type { UsageMetrics } from "../../utils/usage-summary";

export interface SynchronizedCoverage {
  firstOccurredAt?: number;
  lastOccurredAt?: number;
  generations: number;
  unknownCostGenerations: number;
}

export const DeskSummary = component$<{
  displayName: string;
  signedIn: boolean;
  rangeLabel: string;
  writingDays: number;
  folioCount: number;
  writingDaysLabel?: string;
  combined?: boolean;
  metrics: UsageMetrics;
  sourceState:
    | "loading"
    | "local"
    | "combined"
    | "partial"
    | "offline"
    | "error";
  synchronized?: SynchronizedCoverage;
}>((props) => (
  <header class="grid gap-6 border-b-2 border-[var(--color-ink)] pb-5 lg:grid-cols-[1fr_auto_18rem]">
    <div class="self-end">
      <p class="dept-label">Writer's usage dossier</p>
      <h1 class="mt-2 font-display text-4xl leading-none sm:text-5xl">
        My Desk
      </h1>
    </div>
    <div class="self-end lg:text-right">
      <p class="text-xs tracking-[0.12em] uppercase text-[var(--color-ink-muted)]">
        Prepared for
      </p>
      <p class="mt-1 font-display text-xl">{props.displayName}</p>
      <p class="mt-1 text-xs text-[var(--color-ink-muted)]">
        {props.rangeLabel}
      </p>
    </div>
    <aside class="row-span-2 border-l border-[var(--color-ink)] pl-5 text-xs leading-5">
      <p class="font-semibold uppercase tracking-[0.1em]">Desk facts</p>
      <dl class="mt-2 divide-y divide-dotted divide-[var(--color-ink-muted)] border-y border-[var(--color-ink)]">
        {[
          [
            props.writingDaysLabel ?? "Days writing",
            props.writingDays.toLocaleString(),
          ],
          [
            "On the desk",
            `${props.folioCount.toLocaleString()} folio${props.folioCount === 1 ? "" : "s"}`,
          ],
          ["Editorial actions", props.metrics.logicalActions.toLocaleString()],
          [
            "Actual hosted cost",
            `$${(props.metrics.actualCostMicrousd / 1_000_000).toFixed(4)}`,
          ],
        ].map(([label, value]) => (
          <div key={label} class="py-2">
            <dt class="text-[var(--color-ink-muted)]">{label}</dt>
            <dd class="font-display text-lg tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p class="mt-4 font-semibold uppercase tracking-[0.1em]">Provenance</p>
      <p class="mt-1 text-[var(--color-ink-muted)]">
        {props.sourceState === "loading"
          ? "Reading this device ledger"
          : props.sourceState === "combined"
            ? "Combined account ledger and pending device rows"
            : props.sourceState === "offline"
              ? "Offline. Showing this device"
              : props.sourceState === "partial"
                ? props.combined
                  ? "Combined view is partial; bounds are clearly marked"
                  : "Partial detail is clearly marked"
                : props.sourceState === "error"
                  ? "Usage data could not be read"
                  : "This device ledger loaded"}
        .
      </p>
      <p class="mt-1 text-[var(--color-ink-muted)]">
        {props.signedIn
          ? props.synchronized
            ? `${props.synchronized.generations} synchronized generations in account coverage.`
            : "Signed in. Synchronized coverage is being checked."
          : "Not signed in. Nothing is combined across devices."}
      </p>
    </aside>
    <p class="border-t border-dotted border-[var(--color-ink-muted)] pt-4 text-sm leading-6 text-[var(--color-ink-muted)] lg:col-span-2">
      {props.combined
        ? "Account aggregates are combined with unsynchronized device rows. Synchronized browser events are counted only by the account ledger."
        : "Writing activity and content-free AI usage are assembled from this browser first. Sign in and enable usage sync to combine devices."}
    </p>
  </header>
));
