import { $, component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import {
  useAuth,
  hasAuthenticatedConvexIdentity,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import {
  deskAcknowledgeRef,
  deskEnabledRef,
  deskPrepareRef,
  deskStatusRef,
  PUBLIC_DESK_SYNC_EVENT,
  type PublicDeskStatus,
} from "../../utils/public-desk-sync";

/** Refresh while Twyne is open; server-held pending intent survives reloads. */
export const PublicDeskSync = component$(() => {
  const auth = useAuth();
  const convex = useConvexClient();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const identity = track(() =>
      hasAuthenticatedConvexIdentity(auth.value) ? auth.value.user?.id : null,
    );
    const did = track(() => auth.value.atproto?.did);
    const client = track(() => convex.value);
    if (!identity || !client || !did) return;
    let disposed = false;
    let running = false;
    const active = () =>
      !disposed &&
      auth.value.user?.id === identity &&
      auth.value.atproto?.did === did;
    const sync = async () => {
      if (running || !active()) return;
      running = true;
      try {
        const { getAgent } = await import("../../utils/atproto");
        const { syncPublicDesk } = await import("../../utils/public-desk-sync");
        const run = async () => {
          if (!active()) return;
          await syncPublicDesk({
            agent: await getAgent(),
            prepare: async () => {
              const job = await client.mutation(deskPrepareRef, {});
              return job
                ? {
                    ...job,
                    record: job.recordJson ? JSON.parse(job.recordJson) : null,
                  }
                : null;
            },
            acknowledge: (revision) =>
              client.mutation(deskAcknowledgeRef, { revision }),
            active,
          });
        };
        // Serialize tabs sharing this OAuth session; remote CAS covers devices.
        if (navigator.locks)
          await navigator.locks.request(`twyne-public-desk:${did}`, run);
        else await run();
      } catch {
        // Keep durable pending status. Settings provides reconnect/retry controls.
      } finally {
        running = false;
      }
    };
    const unsubscribe = client.onUpdate(
      deskStatusRef,
      {},
      () => {
        void sync();
      },
      () => {},
    );
    const timer = setInterval(() => {
      void sync();
    }, 60_000);
    const wake = () => {
      void sync();
    };
    window.addEventListener("online", wake);
    window.addEventListener(PUBLIC_DESK_SYNC_EVENT, wake);
    void sync();
    cleanup(() => {
      disposed = true;
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("online", wake);
      window.removeEventListener(PUBLIC_DESK_SYNC_EVENT, wake);
    });
  });
  return null;
});

export const PublicDeskSettings = component$(() => {
  const auth = useAuth();
  const convex = useConvexClient();
  const state = useSignal<PublicDeskStatus | null>(null);
  const busy = useSignal(false);
  const error = useSignal("");
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const identity = track(() =>
      hasAuthenticatedConvexIdentity(auth.value) ? auth.value.user?.id : null,
    );
    const client = track(() => convex.value);
    state.value = null;
    if (!identity || !client) return;
    cleanup(
      client.onUpdate(
        deskStatusRef,
        {},
        (value) => {
          state.value = value;
        },
        () => {
          error.value =
            "Public desk settings could not load. Try again after reconnecting.";
        },
      ),
    );
  });
  const toggle = $(async (enabled: boolean) => {
    if (!convex.value || busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      await convex.value.mutation(deskEnabledRef, { enabled });
      window.dispatchEvent(new Event(PUBLIC_DESK_SYNC_EVENT));
    } catch (cause) {
      error.value =
        cause instanceof Error
          ? cause.message
          : "Your choice could not be saved.";
    } finally {
      busy.value = false;
    }
  });
  const connect = $(async () => {
    const did = state.value?.did ?? state.value?.linkedDid;
    if (!did) return;
    try {
      const { signInWithBluesky } = await import("../../utils/atproto");
      await signInWithBluesky(did);
    } catch {
      error.value = "The PDS connection could not start. Please try again.";
    }
  });
  return (
    <div class="mt-5 border-t border-dashed border-[var(--color-paper-3)] pt-4">
      <label class="flex items-center justify-between gap-4 text-sm">
        <span>Publish my desk to my PDS</span>
        <input
          type="checkbox"
          checked={state.value?.enabled ?? false}
          disabled={
            !state.value ||
            busy.value ||
            (!state.value.enabled && !state.value.linkedDid)
          }
          onChange$={(event) =>
            toggle((event.target as HTMLInputElement).checked)
          }
        />
      </label>
      <p class="mt-2 text-xs leading-relaxed text-[var(--color-ink-light)]">
        Let other apps read your Twyne profile and the statistics selected above
        from your own public data server. Draft titles, text, and private
        activity details stay private. Public records can be copied by other
        apps.
      </p>
      <p class="mt-2 text-xs" role="status">
        {!state.value
          ? "Loading desk publishing…"
          : state.value.pending
            ? state.value.enabled
              ? "Publication or update pending. Keep Twyne open with your PDS connected."
              : "Removal pending. The previous public snapshot may remain until your PDS reconnects."
            : state.value.enabled
              ? auth.value.atproto?.did === state.value.did
                ? "Public desk synchronized. It refreshes while Twyne is open."
                : "Desk publishing is on. Reconnect your PDS to refresh the public snapshot."
              : "Desk publication is off. A private marker replaces any previously published details."}
      </p>
      {!state.value?.linkedDid && (
        <p class="mt-2 text-xs">
          Sign in with Not Organic to verify the PDS for this account.
        </p>
      )}
      {state.value?.did && (
        <div class="mt-3 flex flex-wrap gap-4 text-xs">
          <button type="button" class="underline" onClick$={connect}>
            Connect or renew PDS permission
          </button>
          {state.value.pending && (
            <button
              type="button"
              class="underline"
              onClick$={() =>
                window.dispatchEvent(new Event(PUBLIC_DESK_SYNC_EVENT))
              }
            >
              Retry synchronization
            </button>
          )}
        </div>
      )}
      {error.value && (
        <p role="alert" class="mt-2 text-xs text-[var(--color-vermilion)]">
          {error.value}
        </p>
      )}
    </div>
  );
});
