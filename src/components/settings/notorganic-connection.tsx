import { component$, useStore, useVisibleTask$, $ } from "@qwik.dev/core";
import { makeFunctionReference } from "convex/server";
import {
  useAuth,
  hasAuthenticatedConvexIdentity,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import {
  beginProviderConnection,
  readProviderCallback,
  PROVIDER_LINK_ATTEMPT,
  type ProviderLinkAttempt,
} from "../../utils/notorganic-connect";

const getIdentity = makeFunctionReference<
  "query",
  Record<string, never>,
  { did: string } | null
>("providerIdentity:getMyProviderIdentity");
const completeLink = makeFunctionReference<
  "action",
  { code: string; verifier: string },
  { did: string }
>("providerIdentity:completeProviderLink");

export const NotOrganicConnection = component$(() => {
  const auth = useAuth();
  const client = useConvexClient();
  const state = useStore({
    busy: false,
    did: "",
    message: "",
    handled: false,
    userId: "",
    checking: true,
    retry: 0,
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    async ({ track, cleanup }) => {
      const ready = track(() => hasAuthenticatedConvexIdentity(auth.value));
      const userId = track(() => auth.value.user?.id);
      const convex = track(() => client.value);
      track(() => state.retry);
      if (state.userId !== (userId ?? "")) {
        state.userId = userId ?? "";
        state.did = "";
        state.message = "";
        state.busy = false;
      }
      if (!ready || !userId || !convex) {
        state.checking = true;
        return;
      }
      let disposed = false;
      const unsubscribe = convex.onUpdate(
        getIdentity,
        {},
        (link) => {
          if (disposed) return;
          state.did = link?.did ?? "";
          state.checking = false;
        },
        () => {
          if (disposed) return;
          state.checking = false;
          state.message = "Could not check the connection. Please try again.";
        },
      );
      cleanup(() => {
        disposed = true;
        unsubscribe();
      });
      const url = new URL(location.href);
      if (
        !state.handled &&
        (url.searchParams.has("code") || url.searchParams.has("error"))
      ) {
        state.handled = true;
        state.busy = true;
        const saved = sessionStorage.getItem(PROVIDER_LINK_ATTEMPT);
        sessionStorage.removeItem(PROVIDER_LINK_ATTEMPT);
        history.replaceState(null, "", "/settings/");
        try {
          if (!saved)
            throw new Error("Start the connection again from Settings.");
          const args = readProviderCallback(
            JSON.parse(saved) as ProviderLinkAttempt,
            userId,
            url,
          );
          const link = await convex.action(completeLink, args);
          if (disposed) return;
          state.did = link.did;
          state.message =
            "Connected. Automatic reviews can use your Not Organic credit.";
        } catch {
          if (disposed) return;
          state.message =
            "The connection could not be verified. Please connect again.";
        } finally {
          state.busy = false;
        }
      }
    },
    { strategy: "document-ready" },
  );
  const connect = $(async () => {
    const userId = auth.value.user?.id;
    if (!userId || !hasAuthenticatedConvexIdentity(auth.value)) return;
    state.busy = true;
    try {
      const result = await beginProviderConnection(userId, location.origin);
      sessionStorage.setItem(
        PROVIDER_LINK_ATTEMPT,
        JSON.stringify(result.attempt),
      );
      location.assign(result.url);
    } catch {
      state.busy = false;
      state.message = "Could not start the connection. Please try again.";
    }
  });
  return (
    <section class="folio p-5">
      <h2
        class="text-base font-semibold"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Automatic editorial feedback
      </h2>
      <p class="text-sm text-[var(--color-ink-light)] mt-2">
        Connect Not Organic to use your credit for Jev reviews and hosted
        editorial help. Reviews send writing for analysis as you pause and save.
        You can pause them above the manuscript.
      </p>
      {state.did && (
        <p class="panel-meta mt-3 break-all">Connected · {state.did}</p>
      )}
      <button
        class="btn-paper mt-3"
        disabled={
          state.busy ||
          state.checking ||
          !hasAuthenticatedConvexIdentity(auth.value)
        }
        onClick$={connect}
      >
        {state.busy
          ? "Connecting…"
          : state.checking && hasAuthenticatedConvexIdentity(auth.value)
            ? "Checking connection…"
            : state.did
              ? "Reconnect Not Organic"
              : "Connect Not Organic"}
      </button>
      {!hasAuthenticatedConvexIdentity(auth.value) && (
        <p class="panel-meta mt-2">
          {auth.value.loading || auth.value.provider === "convex"
            ? "Waiting for your Twyne connection…"
            : "Sign in to Twyne to connect your account."}
        </p>
      )}
      {state.message && (
        <p class="panel-meta mt-2" role="status">
          {state.message}
          <button
            class="underline ml-2"
            onClick$={() => {
              state.retry++;
              state.message = "";
            }}
          >
            Check again
          </button>
        </p>
      )}
    </section>
  );
});
