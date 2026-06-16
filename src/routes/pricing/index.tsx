import { component$, useSignal, $ } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { useConvexClient } from "../../utils/convex-context";
import { useAuth } from "../../utils/auth-context";
import { api } from "../../../convex/_generated/api";

const PRO_PRODUCT_ID = import.meta.env.PUBLIC_CREEM_PRODUCT_PRO as
  | string
  | undefined;

const FREE_FEATURES = [
  "The full editorial room — personas, rubric, citations",
  "Anti-tabula-rasa project interview",
  "Local-first drafts, BYOK AI (your own keys)",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Hosted AI — no keys to manage",
  "Priority sync and publishing",
  "Early access to the desktop local model",
];

export default component$(() => {
  const clientSig = useConvexClient();
  const auth = useAuth();
  const busy = useSignal(false);
  const error = useSignal<string | null>(null);

  const subscribe = $(async () => {
    error.value = null;
    if (!auth.value.user) {
      error.value = "Please sign in first, then come back to subscribe.";
      return;
    }
    if (!PRO_PRODUCT_ID) {
      error.value = "Pricing is not fully configured yet (missing product id).";
      return;
    }
    const client = clientSig.value;
    if (!client) {
      error.value = "Not connected. Try again in a moment.";
      return;
    }
    busy.value = true;
    try {
      const { checkoutUrl } = await client.action(api.payments.createCheckout, {
        productId: PRO_PRODUCT_ID,
      });
      window.location.href = checkoutUrl;
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Could not start checkout.";
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
          Subscriptions
        </p>
        <h1
          class="mt-2 text-4xl font-bold text-[var(--color-ink)]"
          style="font-family: var(--font-serif);"
        >
          Keep the room open
        </h1>
        <p class="mt-3 text-[var(--color-ink-light)]">
          Twyne is free to use with your own keys. Pro hosts the AI and takes
          the plumbing off your desk.
        </p>
      </header>

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
            $12
            <span class="text-base font-normal text-[var(--color-ink-light)]">
              {" "}
              / month
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
            disabled={busy.value}
            class="btn-press mt-8 inline-block rounded bg-[var(--color-vermilion)] px-5 py-2 text-sm text-[var(--color-paper)] disabled:opacity-60"
          >
            {busy.value ? "Starting checkout…" : "Subscribe to Pro"}
          </button>
          {error.value && (
            <p class="mt-3 text-sm text-[var(--color-accent-red)]">
              {error.value}
            </p>
          )}
        </section>
      </div>

      <p class="mt-10 text-center text-[0.8rem] text-[var(--color-ink-light)]">
        Payments are handled by Creem. Cancel anytime.
      </p>
    </main>
  );
});

export const head: DocumentHead = {
  title: "Pricing — Twyne",
  meta: [
    {
      name: "description",
      content: "Twyne pricing — free with your own keys, or Pro for hosted AI.",
    },
  ],
};
