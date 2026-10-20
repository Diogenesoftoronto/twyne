import {
  component$,
  useComputed$,
  useSignal,
  useVisibleTask$,
  $,
} from "@qwik.dev/core";
import { Link, useLocation, type DocumentHead } from "@qwik.dev/router";
import { useConvexClient } from "../../utils/convex-context";
import {
  hasAuthenticatedConvexIdentity,
  useAuth,
} from "../../utils/auth-context";
import type { AppError } from "../../types/application-errors";
import {
  createAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import { ApplicationNotice } from "../../components/ui/application-notice";

import {
  createNotOrganicCheckout,
  getNotOrganicWallet,
} from "../../utils/notorganic-provider";
import {
  hasCurrentTwynePlan,
  availableCreditPacks,
  TWYNE_PRO_PLAN,
} from "../../utils/subscription-plan";
import {
  isCheckoutReturn,
  refreshCheckoutReturnWallet,
  type CheckoutReturnStatus,
} from "../../utils/checkout-return";

// Must accompany a mapped provider price and verified hosted billing deployment.
const CHECKOUT_ENABLED =
  import.meta.env.PUBLIC_NOTORGANIC_TWYNE_PRO_V2_ENABLED === "true";

import { TWYNE_CREDIT_PACKS } from "../../../convex/lib/providerCheckout";
import {
  creditPurchaseAction,
  purchaseWaitlistUrl,
  type PurchaseWalletStatus,
} from "../../utils/purchase-waitlist";

const FREE_FEATURES = [
  "The full editorial room: personas, rubric, citations",
  "Project interview that shapes each dossier",
  "Local-first drafts, with AI and voice on your own keys",
];

const PRO_FEATURES = [
  "Everything in Free",
  "$10 in Not Organic AI credit each month",
  "Hosted editorial AI, metered by the model you choose",
  "Live voice conversations with your editors, using wallet credit",
  "Unused included credit rolls over for one billing cycle",
  "Optional wallet top-ups when you need more",
];

const WALLET_URL = "https://id.notorganic.info/?product=twyne";

export default component$(() => {
  const clientSig = useConvexClient();
  const auth = useAuth();
  const location = useLocation();
  const walletAccount = useComputed$(() =>
    hasAuthenticatedConvexIdentity(auth.value)
      ? (auth.value.user?.id ?? null)
      : null,
  );
  const busy = useSignal(false);
  const error = useSignal<AppError | null>(null);
  const availablePacks = useSignal<string[]>([]);
  const walletStatus = useSignal<PurchaseWalletStatus>("idle");
  const creditAvailability = useComputed$(() =>
    creditPurchaseAction(
      auth.value.loading,
      !!auth.value.user,
      walletStatus.value,
      availablePacks.value.length > 0,
    ),
  );
  const creditError = useSignal<string | null>(null);
  const providerPlanActive = useSignal(false);
  const checkoutReturnStatus = useSignal<CheckoutReturnStatus | null>(null);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const client = track(clientSig);
    const userId = track(walletAccount);
    const search = track(() => location.url.search);
    providerPlanActive.value = false;
    availablePacks.value = [];
    walletStatus.value = "idle";
    checkoutReturnStatus.value = null;
    if (!client || !userId) return;
    walletStatus.value = "loading";

    let disposed = false;
    const isCurrent = () =>
      !disposed && clientSig.value === client && walletAccount.value === userId;
    cleanup(() => {
      disposed = true;
    });
    const updateWallet = (wallet: unknown) => {
      providerPlanActive.value = hasCurrentTwynePlan(wallet);
      availablePacks.value = availableCreditPacks(wallet);
      walletStatus.value = "ready";
    };

    if (isCheckoutReturn(search)) {
      const stop = refreshCheckoutReturnWallet({
        readWallet: () => getNotOrganicWallet(client),
        isCurrent,
        onWallet: updateWallet,
        onStatus: (status) => {
          checkoutReturnStatus.value = status;
          if (status === "unavailable") walletStatus.value = "error";
        },
      });
      cleanup(stop);
      return;
    }
    void getNotOrganicWallet(client)
      .then((wallet) => {
        if (isCurrent()) updateWallet(wallet);
      })
      .catch(() => {
        if (isCurrent()) {
          providerPlanActive.value = false;
          availablePacks.value = [];
          walletStatus.value = "error";
        }
      });
  });

  const subscribe = $(async () => {
    error.value = null;
    if (!auth.value.user) {
      error.value = createAppError("AUTHENTICATION_REQUIRED", {
        source: "auth",
        recovery: { action: "sign-in", canRetry: false },
        metadata: { operation: "start-checkout" },
      });
      return;
    }
    if (!CHECKOUT_ENABLED) {
      error.value = createAppError("CONFIGURATION_ERROR", {
        recovery: { action: "contact-support", canRetry: false },
        metadata: { operation: "start-checkout" },
      });
      return;
    }
    const client = clientSig.value;
    if (!client) {
      error.value = createAppError("NETWORK_UNAVAILABLE", {
        source: "convex",
        metadata: { operation: "start-checkout" },
      });
      return;
    }
    busy.value = true;
    try {
      const { checkoutUrl } = await createNotOrganicCheckout(client, {
        planId: TWYNE_PRO_PLAN.id,
      });
      window.location.href = checkoutUrl;
    } catch (err) {
      reportApplicationDiagnostic("twyne:pricing:start-checkout", err, {
        operation: "start-checkout",
      });
      error.value = normalizeApplicationError(err, {
        source: "convex",
        metadata: { operation: "start-checkout" },
      });
      busy.value = false;
    }
  });

  const buyCredits = $(async (packId: string) => {
    creditError.value = null;
    if (!auth.value.user) {
      creditError.value =
        "Sign in and link your Not Organic account to add credits.";
      return;
    }
    if (!availablePacks.value.includes(packId) || !clientSig.value) {
      creditError.value =
        "Credit checkout is not available yet. No payment was taken.";
      return;
    }
    busy.value = true;
    try {
      const { checkoutUrl } = await createNotOrganicCheckout(clientSig.value, {
        packId,
      });
      window.location.href = checkoutUrl;
    } catch {
      creditError.value =
        "We couldn’t open credit checkout. Check your linked Not Organic account and try again. No credit has been added.";
      busy.value = false;
    }
  });

  const creditNote =
    creditAvailability.value === "loading"
      ? "Checking your wallet before showing purchase options."
      : creditAvailability.value === "unavailable"
        ? "We couldn’t check your wallet. Open your wallet or reload to try again."
        : availablePacks.value.length > 0
          ? "Requires a linked Not Organic account. Credit appears after payment is confirmed."
          : "Credit purchases aren’t open yet. Choosing a pack opens the Not Organic waitlist; no payment is taken.";
  const creditsBlocked =
    creditAvailability.value === "loading" ||
    creditAvailability.value === "unavailable";
  const packClass =
    "btn-paper flex min-h-12 w-full items-center justify-center px-4 py-3 text-center text-sm disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <main class="mx-auto max-w-5xl px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
      <nav class="mb-10" aria-label="Return to writing">
        <Link
          href="/editor/"
          class="btn-paper inline-flex min-h-11 items-center gap-2"
        >
          <span aria-hidden="true">←</span>
          Back to writing
        </Link>
      </nav>

      <header class="mb-10 max-w-2xl">
        <h1
          class="text-3xl font-bold leading-tight text-[var(--color-ink)] sm:text-4xl"
          style="font-family: var(--font-serif);"
        >
          Keep the room open
        </h1>
        <p class="mt-3 text-base leading-relaxed text-[var(--color-ink-light)] sm:text-lg">
          Write free with your own AI keys or a supported local model. For
          hosted editorial AI, subscribe to Pro for a monthly budget or add
          credit only when you need it.
        </p>
      </header>

      {isCheckoutReturn(location.url.search) && (
        <section
          class="mb-10 rounded border border-[var(--color-rule)] bg-[var(--color-paper-soft)] p-5"
          aria-live="polite"
          aria-atomic="true"
        >
          <p class="font-semibold text-[var(--color-ink)]">
            {!hasAuthenticatedConvexIdentity(auth.value)
              ? auth.value.loading || auth.value.user
                ? "Waiting for your wallet connection…"
                : "Sign in to check your wallet"
              : checkoutReturnStatus.value === "pro-active"
                ? "Pro is active"
                : checkoutReturnStatus.value === "pending"
                  ? "Check payment status in Not Organic"
                  : checkoutReturnStatus.value === "unavailable"
                    ? "We couldn’t refresh your wallet"
                    : "Checking your Not Organic wallet…"}
          </p>
          <p class="mt-2 text-sm text-[var(--color-ink-light)]">
            {!hasAuthenticatedConvexIdentity(auth.value)
              ? auth.value.loading || auth.value.user
                ? "Your authenticated wallet connection is not ready yet."
                : "Sign in to refresh your wallet and check your current Pro plan."
              : checkoutReturnStatus.value === "pro-active"
                ? "Your Not Organic wallet confirms your current Pro billing period."
                : checkoutReturnStatus.value === "pending"
                  ? "Your wallet has not confirmed an active Pro plan here yet. Payment processing can take a little longer."
                  : checkoutReturnStatus.value === "unavailable"
                    ? "Open your wallet to check payment status, or reload this page to check Pro again."
                    : "We’re refreshing your wallet to check your current Pro plan."}{" "}
            Payment receipts and credit pack status are available in your Not
            Organic wallet.
          </p>
          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <a href={WALLET_URL} class="underline">
              View wallet and payment status
            </a>
            {!auth.value.user && (
              <Link href="/signin/" class="underline">
                Sign in
              </Link>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="plans-title">
        <h2 id="plans-title" class="sr-only">
          Plans
        </h2>
        <div class="grid overflow-hidden rounded-md border border-[var(--color-rule)] md:grid-cols-2">
          {/* Free */}
          <article
            aria-labelledby="plan-free-title"
            class="flex flex-col bg-[var(--color-paper)] p-6 sm:p-8"
          >
            <h3
              id="plan-free-title"
              class="text-xl font-bold text-[var(--color-ink)]"
              style="font-family: var(--font-serif);"
            >
              Free
            </h3>
            <p class="mt-3 flex items-baseline gap-2 text-[var(--color-ink)]">
              <span class="text-4xl font-bold tabular-nums">$0</span>
            </p>
            <p class="mt-2 text-sm text-[var(--color-ink-light)]">
              Bring your own AI keys or a local model.
            </p>
            <ul class="mt-6 space-y-3 text-[0.95rem] leading-snug text-[var(--color-ink)]">
              {FREE_FEATURES.map((f) => (
                <li key={f} class="flex gap-3">
                  <span
                    aria-hidden="true"
                    class="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-ink-muted)]"
                  />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div class="mt-8 md:mt-auto md:pt-8">
              <Link
                href="/editor/"
                class="btn-paper inline-flex min-h-11 w-full items-center justify-center px-5 text-sm sm:w-auto"
              >
                Start writing
              </Link>
              <p class="mt-3 text-sm text-[var(--color-ink-light)] md:min-h-10">
                Write locally without an account.
              </p>
            </div>
          </article>

          {/* Pro */}
          <article
            aria-labelledby="plan-pro-title"
            class="flex flex-col border-t border-[var(--color-rule)] bg-[var(--color-paper-soft)] p-6 sm:p-8 md:border-l md:border-t-0"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3
                id="plan-pro-title"
                class="text-xl font-bold text-[var(--color-ink)]"
                style="font-family: var(--font-serif);"
              >
                Pro
              </h3>
              {providerPlanActive.value && (
                <span class="rounded-full border border-[var(--color-vermilion)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-vermilion-2)]">
                  Current plan
                </span>
              )}
            </div>
            <p class="mt-3 flex flex-wrap items-baseline gap-x-2 text-[var(--color-ink)]">
              <span class="text-4xl font-bold tabular-nums">
                ${TWYNE_PRO_PLAN.monthlyUsd}
              </span>
              <span class="text-sm text-[var(--color-ink-light)]">
                USD / month, before tax
              </span>
            </p>
            <p class="mt-2 text-sm text-[var(--color-ink-light)]">
              Hosted AI with a monthly credit budget.
            </p>
            <ul class="mt-6 space-y-3 text-[0.95rem] leading-snug text-[var(--color-ink)]">
              {PRO_FEATURES.map((f) => (
                <li key={f} class="flex gap-3">
                  <span
                    aria-hidden="true"
                    class="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-vermilion)]"
                  />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div class="mt-8 md:mt-auto md:pt-8">
              {!CHECKOUT_ENABLED && !providerPlanActive.value ? (
                <a
                  href={purchaseWaitlistUrl("subscription", TWYNE_PRO_PLAN.id)}
                  aria-describedby="pro-note"
                  class="btn-press inline-flex min-h-11 w-full items-center justify-center px-5 sm:w-auto"
                >
                  Subscribe to Pro
                </a>
              ) : (
                <button
                  onClick$={subscribe}
                  aria-describedby="pro-note"
                  disabled={
                    busy.value ||
                    checkoutReturnStatus.value === "checking" ||
                    providerPlanActive.value ||
                    !CHECKOUT_ENABLED
                  }
                  class="btn-press inline-flex min-h-11 w-full items-center justify-center px-5 sm:w-auto"
                >
                  {providerPlanActive.value
                    ? "Pro is active"
                    : !CHECKOUT_ENABLED
                      ? "New subscriptions available soon"
                      : busy.value
                        ? "Starting checkout…"
                        : "Subscribe to Pro"}
                </button>
              )}
              <p
                id="pro-note"
                class="mt-3 text-sm text-[var(--color-ink-light)] md:min-h-10"
              >
                {providerPlanActive.value
                  ? "Not Organic confirms your current Pro billing period."
                  : CHECKOUT_ENABLED
                    ? "Uses your Not Organic account. Your wallet confirms payment and credit availability."
                    : "Subscriptions aren’t open yet. This opens the Not Organic waitlist; no payment is taken."}
              </p>
              {error.value && (
                <div class="mt-3">
                  <ApplicationNotice
                    error={error.value}
                    compact
                    recoveryLabel={
                      error.value.code === "AUTHENTICATION_REQUIRED"
                        ? "Sign in"
                        : undefined
                    }
                    recoveryHref={
                      error.value.code === "AUTHENTICATION_REQUIRED"
                        ? "/signin/"
                        : undefined
                    }
                    onRetry$={
                      error.value.recovery.canRetry ? subscribe : undefined
                    }
                    onDismiss$={() => {
                      error.value = null;
                    }}
                  />
                </div>
              )}
            </div>
          </article>
        </div>
      </section>

      <section
        aria-labelledby="credits-title"
        class="mt-12 grid gap-6 border-t border-[var(--color-rule)] pt-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:gap-10"
      >
        <div>
          <h2
            id="credits-title"
            class="text-xl font-bold text-[var(--color-ink)]"
            style="font-family: var(--font-serif);"
          >
            Credit packs
          </h2>
          <p class="mt-2 max-w-prose text-[0.95rem] leading-relaxed text-[var(--color-ink-light)]">
            Hosted editorial AI without a subscription. A one-time pack is spent
            at the selected model’s rate, with no monthly charge or automatic
            refill.
          </p>
        </div>
        <div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {TWYNE_CREDIT_PACKS.map((pack) =>
              creditsBlocked ? (
                <button
                  key={pack.id}
                  disabled
                  aria-describedby="credit-note"
                  class={packClass}
                >
                  Add ${pack.usd} credit
                </button>
              ) : availablePacks.value.includes(pack.id) ? (
                <button
                  key={pack.id}
                  onClick$={() => buyCredits(pack.id)}
                  disabled={busy.value}
                  aria-describedby="credit-note"
                  class={packClass}
                >
                  Add ${pack.usd} credit
                </button>
              ) : (
                <a
                  key={pack.id}
                  href={purchaseWaitlistUrl("credits", pack.id)}
                  aria-describedby="credit-note"
                  class={packClass}
                >
                  Add ${pack.usd} credit
                </a>
              ),
            )}
          </div>
          <p
            id="credit-note"
            class="mt-3 text-sm text-[var(--color-ink-light)]"
            role="status"
          >
            {creditNote}
          </p>
          {busy.value && (
            <p class="mt-2 text-sm text-[var(--color-ink)]" role="status">
              Opening checkout…
            </p>
          )}
          {creditError.value && (
            <p class="mt-2 text-sm text-[var(--color-ink)]" role="alert">
              {creditError.value}{" "}
              <Link href="/signin/" class="underline">
                Sign in
              </Link>
            </p>
          )}
        </div>
      </section>

      <footer class="mt-12 border-t border-[var(--color-rule)] pt-8 text-sm text-[var(--color-ink-light)]">
        <div class="-my-3 flex flex-wrap gap-x-5">
          <a
            href={WALLET_URL}
            class="inline-flex min-h-11 items-center underline text-[var(--color-ink)]"
          >
            Open Not Organic wallet
          </a>
          {!auth.value.user && (
            <Link
              href="/signin/"
              class="inline-flex min-h-11 items-center underline text-[var(--color-ink)]"
            >
              Sign in to buy credits
            </Link>
          )}
        </div>
        <ul class="mt-5 max-w-3xl list-disc space-y-1.5 pl-5 leading-relaxed">
          <li>
            Prices are in USD, before tax. Cancel future renewals anytime.
          </li>
          <li>
            Included and purchased credit is service credit, not cash. Model
            choice and manuscript length affect usage.
          </li>
          <li>
            Extra AI use and live voice draw on wallet credit, including
            eligible first-time members’ welcome credit.
          </li>
          <li>
            Credit packs do not add Pro features. Custom model training is not
            included.
          </li>
        </ul>
      </footer>
    </main>
  );
});

export const head: DocumentHead = {
  title: "Pricing — Twyne",
  meta: [
    {
      name: "description",
      content:
        "Twyne pricing — write free, buy hosted AI credits without a subscription, or choose Pro.",
    },
  ],
};
