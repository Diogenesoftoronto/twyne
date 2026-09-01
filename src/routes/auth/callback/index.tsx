import { component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link, type DocumentHead, useNavigate } from "@qwik.dev/router";
import { useAuth } from "../../../utils/auth-context";

interface CallbackStore {
  status: "checking" | "success" | "error";
}

/**
 * Signing in no longer decides where the writer goes. It used to read the
 * stored brief and fork between the editor and the dossier interview, which
 * meant an account action silently moved you somewhere you hadn't asked for.
 * Sign-in now returns to the front page and the writer picks from there.
 */
const DESTINATION = "/";

export default component$(() => {
  const auth = useAuth();
  const nav = useNavigate();
  const store = useStore<CallbackStore>({ status: "checking" });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup, track }) => {
    const loading = track(() => auth.value.loading);
    const userId = track(() => auth.value.user?.id);

    if (loading) return;

    if (!userId) {
      store.status = "error";
      return;
    }

    store.status = "success";

    const timeout = window.setTimeout(() => {
      void nav(DESTINATION);
    }, 1100);

    cleanup(() => window.clearTimeout(timeout));
  });

  const user = auth.value.user;
  const byline = user?.name || user?.email || "your Bluesky account";
  const providerName = auth.value.provider === "atproto" ? "Bluesky" : "Twyne";

  return (
    <main
      class="min-h-screen bg-[var(--color-paper)] px-5 py-10 text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <section class="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-xl items-center">
        <div class="folio w-full p-6 sm:p-8">
          <p class="dept-label">Editor's Office</p>

          {store.status === "checking" && (
            <>
              <h1
                class="mt-3 text-2xl text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
              >
                Confirming your sign-in
              </h1>
              <p class="mt-3 text-[0.95rem] leading-6 text-[var(--color-ink-light)]">
                Twyne is checking the Bluesky callback and restoring your
                session.
              </p>
            </>
          )}

          {store.status === "success" && (
            <>
              <p class="stamp mt-4">Signed in</p>
              <h1
                class="mt-5 text-2xl text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
              >
                {providerName} sign-in is complete.
              </h1>
              <p class="mt-3 text-[0.95rem] leading-6 text-[var(--color-ink-light)]">
                You are signed in as{" "}
                <span class="font-semibold text-[var(--color-ink)]">
                  {byline}
                </span>
                . Sending you back to the front page.
              </p>
              <Link href={DESTINATION} class="btn-press mt-6 inline-flex">
                Continue now
              </Link>
            </>
          )}

          {store.status === "error" && (
            <>
              <p class="error-slip mt-4" role="alert">
                Bluesky sign-in did not complete.
              </p>
              <h1
                class="mt-5 text-2xl text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
              >
                Try signing in again.
              </h1>
              <p class="mt-3 text-[0.95rem] leading-6 text-[var(--color-ink-light)]">
                The callback returned without an active session. Start from the
                sign-in panel so Twyne can create a fresh Bluesky request.
              </p>
              <Link href="/signin/" class="btn-press mt-6 inline-flex">
                Return to sign in
              </Link>
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
      content:
        "Completes Bluesky sign-in and returns the writer to the Twyne front page.",
    },
  ],
};
