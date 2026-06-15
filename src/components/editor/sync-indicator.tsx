import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import {
  statusColor,
  statusLabel,
  lastSavedLabel,
} from "./sync-indicator-helpers";
import type { SyncStatus } from "../../utils/convex-sync";
import { subscribeSyncStatus } from "../../utils/convex-sync";

/**
 * The tiny dot in the editor toolbar that shows whether the
 * local draft is in sync with the server. The status is
 * pushed by `convex-sync` via the `twyne:sync-status` event;
 * this component just renders it.
 */
export const SyncDot = component$(() => {
  const status = useSignal<SyncStatus>({ kind: "local-only" });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const unsubscribe = subscribeSyncStatus((s) => {
      status.value = s;
    });
    cleanup(() => unsubscribe());
  });

  return (
    <span
      class="inline-block w-2 h-2 rounded-full"
      style={{
        backgroundColor: statusColor(status.value),
        boxShadow: "0 0 0 1px rgba(0,0,0,0.04)",
        transition: "background-color 200ms ease",
      }}
      aria-label={statusLabel(status.value)}
      title={statusLabel(status.value)}
    />
  );
});

/**
 * The "Saved Xs ago" line that lives in the editor colophon.
 * The Lix mirror (separate from Convex) writes the manuscript
 * to the local Lix store on a 1.2s debounce; this label ticks
 * to the most recent successful mirror. Until the first mirror
 * fires, the line reads "Not saved yet" so the writer always
 * knows where the cursor is.
 */
export const LastSavedLine = component$<{ savedAt: number | null }>(
  ({ savedAt }) => {
    // Re-evaluate the label every second so the age stays
    // current. The interval is a 1Hz tick — cheap, and the
    // label is short enough that the DOM diff is trivial.
    const label = useSignal(lastSavedLabel(savedAt));
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup, track }) => {
      track(() => savedAt);
      label.value = lastSavedLabel(savedAt);
      const tick = setInterval(() => {
        label.value = lastSavedLabel(savedAt);
      }, 1000);
      cleanup(() => clearInterval(tick));
    });
    return <span>{label.value}</span>;
  },
);
