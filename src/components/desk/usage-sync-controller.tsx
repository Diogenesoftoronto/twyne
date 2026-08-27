import { component$, useVisibleTask$ } from "@builder.io/qwik";
import type { ConvexClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import {
  syncLocalUsageHistory,
  type UsageBatchUploader,
  type UsageSyncResult,
} from "../../utils/usage-sync";

export const USAGE_SYNC_REQUEST_EVENT = "twyne:usage-sync-requested";
export const USAGE_SYNC_STATE_EVENT = "twyne:usage-sync-state";

export function createConvexUsageUploader(
  client: Pick<ConvexClient, "mutation">,
): UsageBatchUploader {
  return {
    async upload({ events }) {
      await client.mutation(api.usage.syncClientEvents, {
        events: [...events],
      });
      // The mutation is atomic and treats an existing event key as success, so
      // every offered row is safe to mark as present after it resolves.
      return {
        acknowledgedEventKeys: events.map((event) => event.eventKey),
      };
    },
  };
}

function announceUsageSync(result: UsageSyncResult): void {
  window.dispatchEvent(
    new CustomEvent<UsageSyncResult>(USAGE_SYNC_STATE_EVENT, {
      detail: result,
    }),
  );
}

/**
 * Consent-aware background uploader for the separate usage ledger. It never
 * enables synchronization, chooses an account, or joins the folio snapshot
 * loop; those decisions remain explicit Desk controls.
 */
export const UsageSyncController = component$(() => {
  const auth = useAuth();
  const clientSignal = useConvexClient();

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup, track }) => {
    const client = track(() => clientSignal.value);
    const provider = track(() => auth.value.provider);
    const accountId = track(() => auth.value.user?.analyticsId);
    if (!client || provider !== "convex" || !accountId) return;

    let disposed = false;
    let running = false;
    const synchronize = async () => {
      if (disposed || running || !navigator.onLine) return;
      running = true;
      try {
        const result = await syncLocalUsageHistory({
          accountId,
          uploader: createConvexUsageUploader(client),
        });
        if (!disposed) announceUsageSync(result);
      } catch {
        // Usage telemetry is an enhancement and must never interrupt writing.
        if (!disposed) {
          announceUsageSync({
            status: "partial",
            uploaded: 0,
            batches: 0,
          });
        }
      } finally {
        running = false;
      }
    };

    void synchronize();
    window.addEventListener("online", synchronize);
    window.addEventListener(USAGE_SYNC_REQUEST_EVENT, synchronize);
    cleanup(() => {
      disposed = true;
      window.removeEventListener("online", synchronize);
      window.removeEventListener(USAGE_SYNC_REQUEST_EVENT, synchronize);
    });
  });

  return null;
});
