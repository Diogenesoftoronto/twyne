import { component$, type QRL } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import type { HostedUsageSummary } from "../../utils/hosted-usage";
import {
  formatDay,
  formatDayRange,
  formatUsd,
  type CreditForecast,
} from "../../utils/writing-forecasts";

export type HostedCostState = "signed-out" | "loading" | "ready" | "error";

/**
 * Where this month's hosted spend is heading. The interval carries the
 * uncertainty; the copy states the date plainly.
 */
export const CreditRunway = component$<{ forecast: CreditForecast }>(
  ({ forecast: f }) => (
    <div
      class="mt-4 border-t border-dotted border-[var(--color-ink-muted)] pt-3"
      data-testid="credit-runway"
    >
      <p class="text-xs font-semibold tracking-[0.1em] uppercase text-[var(--color-ink-muted)]">
        This month
      </p>
      <p class="mt-1 text-sm tabular-nums">
        Heading for ~{formatUsd(f.month.median)}{" "}
        <span class="text-[var(--color-ink-light)]">
          ({formatUsd(f.month.p10)}–{formatUsd(f.month.p90)})
        </span>
        {" · "}
        {formatUsd(f.availableMicros)} credit left
      </p>
      <p
        class={{
          "mt-1 text-sm tabular-nums": true,
          "text-[var(--color-vermilion)]": !f.outlastsMonth,
        }}
      >
        {f.runsOut && !f.outlastsMonth ? (
          <>
            Credit runs out around {formatDay(f.runsOut.median)}{" "}
            <span class="text-[var(--color-ink-light)]">
              ({formatDayRange(f.runsOut.early, f.runsOut.late)})
            </span>
          </>
        ) : (
          <>Credit lasts past {formatDay(f.monthEnd)}</>
        )}
      </p>
    </div>
  ),
);

export const HostedCost = component$<{
  state: HostedCostState;
  summary?: HostedUsageSummary;
  runway?: CreditForecast | null;
  onRefresh$?: QRL<() => void>;
}>((props) => (
  <div class="mb-6 border-y border-[var(--color-ink)] py-4" aria-live="polite">
    <h3 class="font-display text-lg">Hosted wallet charges</h3>
    {props.state === "signed-out" ? (
      <p class="mt-2 text-sm">Sign in to see your hosted AI charges.</p>
    ) : props.state === "loading" ? (
      <p class="mt-2 text-sm" role="status">
        Checking hosted charges…
      </p>
    ) : props.state === "error" || !props.summary ? (
      <p class="mt-2 text-sm" role="status">
        Hosted charges are unavailable. Your local ledger is shown below.
      </p>
    ) : (
      <>
        <p class="mt-2 font-display text-2xl tabular-nums">
          {props.summary.settledRequests > 0
            ? `$${(props.summary.billedMicrousd / 1_000_000).toFixed(4)}`
            : "No confirmed charges"}
        </p>
        <p class="mt-1 text-sm">
          {props.summary.settledRequests} settled Twyne requests in this range.
          {props.summary.unresolvedRequests > 0 &&
            ` ${props.summary.unresolvedRequests} request${props.summary.unresolvedRequests === 1 ? "" : "s"} still await${props.summary.unresolvedRequests === 1 ? "s" : ""} confirmed billing.`}
        </p>
        <p class="mt-2 text-xs text-[var(--color-ink-light)]">
          Confirmed Not Organic wallet charges, separate from the token
          estimates below.
          {props.summary.truncated &&
            " Partial coverage: only the latest 100 account requests were available; older charges may be missing."}
        </p>
        {props.summary.unverifiedCostRequests > 0 && (
          <p class="mt-2 text-sm">
            Includes $
            {(props.summary.unverifiedCostMicrousd / 1_000_000).toFixed(4)}{" "}
            charged across {props.summary.unverifiedCostRequests} requests
            without final provider cost evidence.
          </p>
        )}
        {props.runway && <CreditRunway forecast={props.runway} />}
      </>
    )}
    <div class="mt-3 flex flex-wrap items-center gap-4 text-sm">
      {props.state === "signed-out" ? (
        <Link
          href="/signin/?returnTo=%2Fdesk%2F"
          class="btn-paper inline-flex min-h-11 items-center"
        >
          Sign in to view charges
        </Link>
      ) : (
        <button
          type="button"
          class="btn-paper"
          disabled={props.state === "loading"}
          onClick$={props.onRefresh$}
        >
          Refresh charges
        </button>
      )}
      <a href="https://id.notorganic.info/?product=twyne" class="underline">
        View Not Organic wallet
      </a>
    </div>
  </div>
));
