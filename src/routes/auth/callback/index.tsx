import { component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link, type DocumentHead, useNavigate } from "@qwik.dev/router";
import { useAuth } from "../../../utils/auth-context";

interface CallbackStore {
  status: "checking" | "success" | "error";
}

/**
 * ATProto OAuth return for PDS publishing. This is not a Twyne sign-in (that
 * is Not Organic, via /auth/notorganic/); it only restores the publishing
 * session for the writer's repository, then returns them to the editor.
 */
const DESTINATION = "/editor/";

export default component$(() => {
  const auth = useAuth();
  const nav = useNavigate();
  const store = useStore<CallbackStore>({ status: "checking" });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup, track }) => {
    const loading = track(() => auth.value.loading);
    const did = track(() => auth.value.atproto?.did);

    if (loading) return;

    if (!did) {
      store.status = "error";
      return;
    }

    store.status = "success";

    const timeout = window.setTimeout(() => {
      void nav(DESTINATION);
    }, 1100);

    cleanup(() => window.clearTimeout(timeout));
  });

  const atproto = auth.value.atproto;
  const byline = atproto?.handle || atproto?.did || "your repository";

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
                Connecting your PDS
              </h1>
              <p class="mt-3 text-[0.95rem] leading-6 text-[var(--color-ink-light)]">
                Twyne is checking the approval from your PDS.
              </p>
            </>
          )}

          {store.status === "success" && (
            <>
              <p class="stamp mt-4">Connected</p>
              <h1
                class="mt-5 text-2xl text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
              >
                Your PDS is connected for publishing.
              </h1>
              <p class="mt-3 text-[0.95rem] leading-6 text-[var(--color-ink-light)]">
                Publishing as{" "}
                <span class="font-semibold text-[var(--color-ink)]">
                  {byline}
                </span>
                . Sending you back to the editor.
              </p>
              <Link href={DESTINATION} class="btn-press mt-6 inline-flex">
                Continue now
              </Link>
            </>
          )}

          {store.status === "error" && (
            <>
              <p class="error-slip mt-4" role="alert">
                The PDS connection did not complete.
              </p>
              <h1
                class="mt-5 text-2xl text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
              >
                Try connecting again.
              </h1>
              <p class="mt-3 text-[0.95rem] leading-6 text-[var(--color-ink-light)]">
                The callback returned without an active session. Start again
                from File → Share → Your own repo in the editor.
              </p>
              <Link href={DESTINATION} class="btn-press mt-6 inline-flex">
                Return to the editor
              </Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
});

export const head: DocumentHead = {
  title: "Connecting your PDS · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Completes the ATProto connection used to publish to your own PDS.",
    },
  ],
};
