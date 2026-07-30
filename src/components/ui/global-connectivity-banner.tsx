import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { createAppError } from "../../utils/application-errors";
import { ApplicationNotice } from "./application-notice";

/**
 * Application-wide connectivity banner. Inline notices remain the default for
 * a single failed operation; this is reserved for the browser losing its
 * network connection entirely, where every operation would fail. Local editing
 * keeps working and unsynced work stays safe, so the copy reassures rather
 * than blocks.
 */
export const GlobalConnectivityBanner = component$(() => {
  const offline = useSignal(false);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    if (typeof navigator === "undefined") return;
    const sync = () => {
      offline.value = navigator.onLine === false;
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    cleanup(() => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    });
  });

  if (!offline.value) return null;

  return (
    <div class="sticky top-0 z-50 w-full">
      <ApplicationNotice
        variant="outage"
        title="You are offline"
        error={createAppError("NETWORK_UNAVAILABLE", {
          source: "fetch",
          recovery: { action: "check-connection", canRetry: false },
          metadata: { operation: "connectivity" },
        })}
      />
    </div>
  );
});
