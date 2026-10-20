import { component$, type QRL } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import type { HostedUsageSummary } from "../../utils/hosted-usage";

export type HostedCostState = "signed-out" | "loading" | "ready" | "error";

export const HostedCost = component$<{
  state: HostedCostState;
  summary?: HostedUsageSummary;
  onRefresh$?: QRL<() => void>;
}>((props) => (
  <div class="mb-6 border-y border-[var(--color-ink)] py-4" aria-live="polite">
    <h3 class="font-display text-lg">Hosted wallet charges</h3>
    {props.state === "signed-out" ? (
      <p class="mt-2 text-sm">
        <Link href="/signin/" class="underline">
          Sign in
        </Link>{" "}
        to see your hosted AI charges.
      </p>
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
      </>
    )}
    <div class="mt-3 flex flex-wrap items-center gap-4 text-sm">
      {props.state !== "signed-out" && (
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
