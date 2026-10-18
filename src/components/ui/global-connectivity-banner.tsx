import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import { createAppError } from "../../utils/application-errors";
import { ApplicationNotice } from "./application-notice";

/**
 * Dismissible connectivity card in the shared application toast stack.
 * Inline notices remain the default for
 * a single failed operation; this is reserved for the browser losing its
 * network connection entirely, where every operation would fail. Local editing
 * keeps working and unsynced work stays safe, so the copy reassures rather
 * than blocks.
 */
export const GlobalConnectivityBanner = component$(() => {
  const offline = useSignal(false);
  const dismissed = useSignal(false);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      if (typeof navigator === "undefined") return;
      const sync = () => {
        const nextOffline = navigator.onLine === false;
        if (!nextOffline) dismissed.value = false;
        offline.value = nextOffline;
      };
      sync();
      window.addEventListener("online", sync);
      window.addEventListener("offline", sync);
      cleanup(() => {
        window.removeEventListener("online", sync);
        window.removeEventListener("offline", sync);
      });
    },
    { strategy: "document-ready" },
  );

  if (!offline.value || dismissed.value) return null;

  return (
    <div class="application-toast">
      <ApplicationNotice
        variant="warning"
        title="You are offline"
        compact
        showReference={false}
        onDismiss$={() => {
          dismissed.value = true;
        }}
        error={{
          ...createAppError("NETWORK_UNAVAILABLE", {
            source: "fetch",
            recovery: { action: "check-connection", canRetry: false },
            metadata: { operation: "connectivity" },
          }),
          message:
            "You can keep writing on this device. Sync will resume when your connection returns.",
        }}
      />
    </div>
  );
});
