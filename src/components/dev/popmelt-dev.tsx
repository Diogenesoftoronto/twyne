import { component$, useVisibleTask$ } from "@qwik.dev/core";
import { useNavigate } from "@qwik.dev/router";

/** Development-only DOM integration; Qwik continues to own the application. */
export const PopmeltDev = component$(() => {
  const navigate = useNavigate();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      if (!import.meta.env.DEV) return;
      let disposed = false;
      const pending = Promise.all([
        import("@popmelt.com/core/browser"),
        import("virtual:popmelt/bridge"),
      ]).then(([{ mountPopmelt }, { bridgeUrl, projectId }]) => {
        if (disposed || !bridgeUrl || !projectId) return;
        return mountPopmelt({ enabled: true, bridgeUrl, projectId, navigate });
      });
      void pending.catch((error) =>
        console.error("Popmelt could not start", error),
      );
      const unmount = () => {
        if (disposed) return;
        disposed = true;
        void pending.then((handle) => handle?.unmount()).catch(() => {});
      };
      cleanup(unmount);
      import.meta.hot?.dispose(unmount);
    },
    { strategy: "document-ready" },
  );
  return null;
});
