import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import {
  lastSavedLabel,
  saveRouteLabel,
  statusLabel,
} from "./sync-indicator-helpers";
import type { SyncStatus } from "../../utils/convex-sync";
import { subscribeSyncStatus } from "../../utils/convex-sync";

/**
 * The status bar's one account of the latest words: how long ago they were
 * set on this device, then where they are now, as a word in the matching
 * consequence ink ("filed" in the account's green, "held here" hollow).
 *
 * The age re-renders once a second; the route only changes when
 * `convex-sync` reports a new state. Arriving at "filed" flashes once in the
 * account's ink; nothing pulses while the wire is busy.
 */
export const LastSavedLine = component$<{ savedAt: number | null }>(
  ({ savedAt }) => {
    const status = useSignal<SyncStatus>({ kind: "local-only" });
    const age = useSignal(lastSavedLabel(savedAt));
    const filings = useSignal(0);

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      let previous: SyncStatus["kind"] | undefined;
      const unsubscribe = subscribeSyncStatus((next) => {
        if (
          next.kind === "synced" &&
          previous !== undefined &&
          previous !== "synced"
        ) {
          filings.value++;
        }
        previous = next.kind;
        status.value = next;
      });
      cleanup(unsubscribe);
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup, track }) => {
      track(() => savedAt);
      age.value = lastSavedLabel(savedAt);
      const tick = setInterval(() => {
        age.value = lastSavedLabel(savedAt);
      }, 1000);
      cleanup(() => clearInterval(tick));
    });

    const route = saveRouteLabel(status.value, savedAt);
    return (
      <span class="press-sync-status" title={statusLabel(status.value)}>
        <span>{age.value}</span>
        {route && (
          <span
            key={route.consequence === "synced" ? `filed-${filings.value}` : route.word}
            class={[
              "press-sync-route",
              route.consequence === "synced" &&
                filings.value > 0 &&
                "press-sync-filed",
            ]}
            data-consequence={route.consequence}
          >
            <span class="press-sync-mark" aria-hidden="true" />
            {route.word}
          </span>
        )}
      </span>
    );
  },
);
