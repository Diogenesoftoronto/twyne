import { component$, useSignal, useVisibleTask$, $ } from "@qwik.dev/core";
import { Link, type DocumentHead } from "@qwik.dev/router";
import { useConvexClient } from "../../utils/convex-context";
import { useAuth } from "../../utils/auth-context";
import { api } from "../../../convex/_generated/api";
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

// Must accompany a mapped provider price and verified hosted billing deployment.
const CHECKOUT_ENABLED =
  import.meta.env.PUBLIC_NOTORGANIC_TWYNE_PRO_V2_ENABLED === "true";

import { TWYNE_CREDIT_PACKS } from "../../../convex/lib/providerCheckout";

const FREE_FEATURES = [
  "The full editorial room — personas, rubric, citations",
  "Anti-tabula-rasa project interview",
  "Local-first drafts, BYOK AI and voice (your own keys)",
];

const PRO_FEATURES = [
  "Everything in Free",
  "$10 in Not Organic AI credit each month",
  "Hosted editorial AI, metered by the model you choose",
  "Unused included credit rolls over for one billing cycle",
  "Optional wallet top-ups when you need more",
];

export default component$(() => {
  const clientSig = useConvexClient();
  const auth = useAuth();
  const busy = useSignal(false);
  const error = useSignal<AppError | null>(null);
  const availablePacks = useSignal<string[]>([]);
  const creditError = useSignal<string | null>(null);
  const subscriptionStatus = useSignal<string | null>(null);
  const providerPlanActive = useSignal(false);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const client = track(clientSig);
    const user = track(auth).user;
    if (!client || !user) {
      subscriptionStatus.value = null;
      providerPlanActive.value = false;
      availablePacks.value = [];
      return;
    }
    void getNotOrganicWallet(client)
      .then((wallet) => {
        providerPlanActive.value = hasCurrentTwynePlan(wallet);
        availablePacks.value = availableCreditPacks(wallet);
      })
      .catch(() => {
        providerPlanActive.value = false;
        availablePacks.value = [];
      });
    void client
      .query(api.payments.getMySubscription, {})
      .then((subscription) => {
        subscriptionStatus.value = subscription?.status ?? null;
      })
      .catch(() => {
        subscriptionStatus.value = null;
      });
  });

  const hasPro = ["active", "trialing", "paid"].includes(
    subscriptionStatus.value ?? "",
  );

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

  return (
    <main class="mx-auto max-w-4xl px-6 py-16">
      <header class="mb-12 text-center">
        <p
          class="text-[0.75rem] uppercase tracking-[0.2em] text-[var(--color-ink-light)]"
          style="font-family: var(--font-serif);"
        >
          Plans and credits
        </p>
        <h1
          class="mt-2 text-4xl font-bold text-[var(--color-ink)]"
          style="font-family: var(--font-serif);"
        >
          Keep the room open
        </h1>
        <p class="mt-3 text-[var(--color-ink-light)]">
          Write for free with your own AI keys or supported local models. Pro
          adds a monthly budget, or buy credits only when you need hosted
          editorial AI.
        </p>
      </header>

      <section
        aria-labelledby="credits-title"
        class="mb-10 border-y border-[var(--color-rule)] py-8"
      >
        <h2
          id="credits-title"
          class="text-2xl font-bold text-[var(--color-ink)]"
          style="font-family: var(--font-serif);"
        >
          Hosted AI without a subscription
        </h2>
        <p class="mt-3 max-w-2xl text-[var(--color-ink-light)]">
          Buy a one-time Not Organic credit pack and use it for editorial AI on
          your free account. No monthly charge or automatic refill. Credit is
          spent at the selected model’s rate.
        </p>
        <div class="mt-5 flex flex-wrap gap-3">
          {TWYNE_CREDIT_PACKS.map((pack) => (
            <button
              key={pack.id}
              onClick$={() => buyCredits(pack.id)}
              disabled={busy.value || !availablePacks.value.includes(pack.id)}
              class="btn-press min-h-11 rounded border border-[var(--color-rule)] bg-[var(--color-paper)] px-5 py-3 text-sm text-[var(--color-ink)] disabled:opacity-60"
            >
              Add ${pack.usd} credit
            </button>
          ))}
        </div>
        <p class="mt-3 text-sm text-[var(--color-ink-light)]">
          USD, before tax.{" "}
          {availablePacks.value.length > 0
            ? "Requires a linked Not Organic account. Credit appears after payment is confirmed."
            : "Credit checkout is being configured. No payment is taken while these options are unavailable."}{" "}
          Purchased credit does not grant separate subscription features.
        </p>
        {busy.value && (
          <p class="mt-3 text-sm" role="status">
            Opening checkout…
          </p>
        )}
        {creditError.value && (
          <p class="mt-3 text-sm" role="alert">
            {creditError.value}{" "}
            <Link href="/signin/" class="underline">
              Sign in
            </Link>
          </p>
        )}
        <a
          href="https://id.notorganic.info/?product=twyne"
          class="mt-3 inline-block underline text-sm"
        >
          View wallet and payment status
        </a>
        {!auth.value.user && (
          <Link href="/signin/" class="ml-4 inline-block underline text-sm">
            Sign in to buy credits
          </Link>
        )}
      </section>

      <div class="grid gap-6 md:grid-cols-2">
        {/* Free */}
        <section class="rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper)] p-8">
          <h2
            class="text-2xl font-bold text-[var(--color-ink)]"
            style="font-family: var(--font-serif);"
          >
            Free
          </h2>
          <p class="mt-1 text-3xl font-bold text-[var(--color-ink)]">$0</p>
          <ul class="mt-6 space-y-2 text-[0.95rem] text-[var(--color-ink-light)]">
            {FREE_FEATURES.map((f) => (
              <li key={f} class="flex gap-2">
                <span class="text-[var(--color-vermilion)]">—</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/editor"
            class="btn-press mt-8 inline-block rounded border border-[var(--color-rule)] px-5 py-2 text-sm"
          >
            Start writing
          </Link>
        </section>

        {/* Pro */}
        <section class="rounded-lg border-2 border-[var(--color-vermilion)] bg-[var(--color-paper)] p-8">
          <h2
            class="text-2xl font-bold text-[var(--color-ink)]"
            style="font-family: var(--font-serif);"
          >
            Pro
          </h2>
          <p class="mt-1 text-3xl font-bold text-[var(--color-ink)]">
            ${TWYNE_PRO_PLAN.monthlyUsd}
            <span class="text-base font-normal text-[var(--color-ink-light)]">
              {" "}
              USD / month, before tax
            </span>
          </p>
          <ul class="mt-6 space-y-2 text-[0.95rem] text-[var(--color-ink-light)]">
            {PRO_FEATURES.map((f) => (
              <li key={f} class="flex gap-2">
                <span class="text-[var(--color-vermilion)]">—</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <button
            onClick$={subscribe}
            disabled={
              busy.value ||
              hasPro ||
              providerPlanActive.value ||
              !CHECKOUT_ENABLED
            }
            class="btn-press mt-8 inline-block rounded bg-[var(--color-vermilion)] px-5 py-2 text-sm text-[var(--color-paper)] disabled:opacity-60"
          >
            {hasPro
              ? "Existing subscription active"
              : providerPlanActive.value
                ? "Pro is active"
                : !CHECKOUT_ENABLED
                  ? "New subscriptions available soon"
                  : busy.value
                    ? "Starting checkout…"
                    : "Subscribe to Pro"}
          </button>
          {hasPro && (
            <p
              class="mt-3 text-sm font-semibold text-[var(--color-accent-green)]"
              role="status"
            >
              Your existing subscription and price remain unchanged.
            </p>
          )}
          <p class="mt-3 text-sm text-[var(--color-ink-light)]">
            {CHECKOUT_ENABLED
              ? "Requires a linked Not Organic account. Your wallet confirms payment and credit availability."
              : "We’re finishing hosted billing setup. You can keep writing for free; no payment is taken here."}
          </p>
          {providerPlanActive.value && (
            <p class="mt-3 text-sm" role="status">
              Not Organic confirms your current Pro billing period.
            </p>
          )}
          <a
            href="https://id.notorganic.info/?product=twyne"
            class="mt-3 inline-block underline text-sm"
          >
            Open Not Organic wallet
          </a>
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
                onRetry$={error.value.recovery.canRetry ? subscribe : undefined}
                onDismiss$={() => {
                  error.value = null;
                }}
              />
            </div>
          )}
        </section>
      </div>

      <p class="mt-10 text-center text-[0.8rem] text-[var(--color-ink-light)]">
        New subscriptions use Not Organic checkout with Paddle payment
        processing. Cancel future renewals anytime. Included credit is service
        credit, not cash; model choice and manuscript length affect usage. Extra
        AI use requires available wallet credit. Custom model training and
        hosted voice are not included in this plan. Existing legacy
        subscriptions keep their terms.
      </p>
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
