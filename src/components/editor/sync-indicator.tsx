import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import { statusLabel } from "./sync-indicator-helpers";
import type { SyncStatus } from "../../utils/convex-sync";
import { subscribeSyncStatus } from "../../utils/convex-sync";

/** A single account of where the latest locally saved words are. */
export const LastSavedLine = component$<{ savedAt: number | null }>(
  ({ savedAt }) => {
    const status = useSignal<SyncStatus>({ kind: "local-only" });
    const filedTransition = useSignal(0);
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      let previous: SyncStatus["kind"] | undefined;
      const unsubscribe = subscribeSyncStatus((next) => {
        if (
          next.kind === "synced" &&
          previous !== undefined &&
          previous !== "synced"
        ) {
          filedTransition.value++;
        }
        previous = next.kind;
        status.value = next;
      });
      cleanup(unsubscribe);
    });
    const current = status.value;
    const filed =
      current.kind === "synced" &&
      savedAt != null &&
      current.lastSyncedAt >= savedAt;
    const text =
      savedAt == null
        ? "Not saved yet"
        : filed
          ? "filed"
          : current.kind === "syncing" || current.kind === "pending"
            ? "on the wire"
            : current.kind === "offline"
              ? "held on this device · offline"
              : current.kind === "error"
                ? `held on this device · ${current.message}`
                : current.kind === "local-only"
                  ? "held on this device · local only"
                  : "set";
    return (
      <span
        key={filed ? `filed-${filedTransition.value}` : current.kind}
        class={[
          "press-sync-status",
          filed && filedTransition.value > 0 && "press-sync-filed",
        ]}
        data-consequence={filed ? "synced" : "local"}
        title={statusLabel(current)}
        role="status"
      >
        <span class="press-sync-mark" aria-hidden="true" />
        {text}
      </span>
    );
  },
);
