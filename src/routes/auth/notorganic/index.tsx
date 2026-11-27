import { component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link, type DocumentHead, useNavigate } from "@qwik.dev/router";
import {
  completeNotOrganicSignIn,
  SignInRefusedError,
} from "../../../utils/notorganic-connect";

interface CallbackStore {
  status: "checking" | "error";
  message: string;
  /** Lines a writer can copy into a support message. */
  details: string[];
}

/** Not Organic sends the writer back here with a one-time code. */
export default component$(() => {
  const nav = useNavigate();
  const store = useStore<CallbackStore>({
    status: "checking",
    message: "",
    details: [],
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    async () => {
      const url = new URL(location.href);
      history.replaceState(null, "", url.pathname);
      try {
        const destination = await completeNotOrganicSignIn(url);
        await nav(destination);
      } catch (error) {
        store.status = "error";
        store.message =
          error instanceof Error
            ? error.message
            : "Not Organic could not verify this sign-in.";
        if (error instanceof SignInRefusedError) {
          store.details = [
            error.stage && `Step: ${error.stage}`,
            error.upstreamStatus !== undefined &&
              `Not Organic answered: ${error.upstreamStatus}${error.upstreamCode ? ` ${error.upstreamCode}` : ""}`,
            `Address: ${location.origin}`,
            error.referenceId && `Reference: ${error.referenceId}`,
          ].filter((line): line is string => Boolean(line));
        }
      }
    },
    { strategy: "document-ready" },
  );

  return (
    <main
      class="min-h-screen bg-[var(--color-paper)] px-5 py-10 text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <section class="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-xl items-center">
        <div class="folio w-full p-6 sm:p-8">
          <p class="dept-label">Editor's Office</p>
          {store.status === "checking" ? (
            <>
              <h1
                class="mt-3 text-2xl text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
              >
                Confirming your sign-in
              </h1>
              <p class="mt-3 text-[0.95rem] leading-6 text-[var(--color-ink-light)]">
                Twyne is checking your Not Organic account.
              </p>
            </>
          ) : (
            <>
              <p class="error-slip mt-4" role="alert">
                {store.message}
              </p>
              <h1
                class="mt-5 text-2xl text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
              >
                Try signing in again.
              </h1>
              <Link href="/signin/" class="btn-press mt-6 inline-flex">
                Return to sign in
              </Link>
              {store.details.length > 0 && (
                <details class="mt-6 text-sm text-[var(--color-ink-muted)]">
                  <summary class="cursor-pointer">What happened</summary>
                  <pre
                    class="mt-2 whitespace-pre-wrap text-xs"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                    data-testid="signin-diagnostics"
                  >
                    {store.details.join("\n")}
                  </pre>
                  <button
                    type="button"
                    class="mt-2 text-xs underline"
                    onClick$={() =>
                      navigator.clipboard?.writeText(store.details.join("\n"))
                    }
                  >
                    Copy for support
                  </button>
                </details>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
});

export const head: DocumentHead = {
  title: "Completing Sign In · Twyne",
  meta: [
    {
      name: "description",
      content: "Completes Not Organic sign-in and returns you to Twyne.",
    },
  ],
};
