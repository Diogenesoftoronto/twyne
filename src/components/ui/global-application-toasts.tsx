import { component$, useStore, useVisibleTask$ } from "@builder.io/qwik";
import type { AppError } from "../../types/application-errors";
import {
  APPLICATION_ERROR_TOAST_EVENT,
  connectApplicationErrorToastHost,
  type ApplicationErrorToastDetail,
} from "../../utils/application-toast";
import { ApplicationNotice } from "./application-notice";

interface ToastEntry extends ApplicationErrorToastDetail {
  id: string;
  key: string;
}

function toastKey(detail: ApplicationErrorToastDetail): string {
  const operation = detail.error.metadata?.operation;
  return (
    detail.dedupeKey ??
    `${detail.error.code}:${detail.error.source}:${typeof operation === "string" ? operation : "general"}`
  );
}

function recoveryLink(
  error: AppError,
): { label: string; href: string } | undefined {
  switch (error.recovery.action) {
    case "sign-in":
      return { label: "Open sign-in", href: "/editor?auth=1" };
    case "check-configuration":
    case "choose-provider":
      return { label: "Open settings", href: "/settings/" };
    default:
      return undefined;
  }
}

export const GlobalApplicationToasts = component$(() => {
  const store = useStore<{ items: ToastEntry[] }>({ items: [] });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const dismiss = (id: string) => {
      store.items = store.items.filter((item) => item.id !== id);
      const timer = dismissTimers.get(id);
      if (timer) clearTimeout(timer);
      dismissTimers.delete(id);
    };
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ApplicationErrorToastDetail>).detail;
      if (!detail?.error) return;
      const key = toastKey(detail);
      const existing = store.items.find((item) => item.key === key);
      if (existing) {
        store.items = store.items.map((item) =>
          item.key === key ? { ...detail, id: existing.id, key } : item,
        );
        return;
      }
      const entry: ToastEntry = {
        ...detail,
        id: detail.error.referenceId,
        key,
      };
      store.items = [...store.items, entry].slice(-2);
      dismissTimers.set(
        entry.id,
        setTimeout(() => dismiss(entry.id), 12_000),
      );
    };

    window.addEventListener(APPLICATION_ERROR_TOAST_EVENT, onToast);
    const connection = connectApplicationErrorToastHost();
    for (const pending of connection.pending) {
      onToast(
        new CustomEvent(APPLICATION_ERROR_TOAST_EVENT, { detail: pending }),
      );
    }
    cleanup(() => {
      window.removeEventListener(APPLICATION_ERROR_TOAST_EVENT, onToast);
      connection.disconnect();
      for (const timer of dismissTimers.values()) clearTimeout(timer);
    });
  });

  if (store.items.length === 0) return null;

  return (
    <aside class="application-toast-region" aria-label="Application messages">
      {store.items.map((item) => {
        const recovery = recoveryLink(item.error);
        return (
          <div class="application-toast" key={item.id}>
            <ApplicationNotice
              error={item.error}
              title={item.title}
              variant={item.variant}
              compact
              recoveryLabel={recovery?.label}
              recoveryHref={recovery?.href}
              onDismiss$={() => {
                store.items = store.items.filter(
                  (candidate) => candidate.id !== item.id,
                );
              }}
            />
          </div>
        );
      })}
    </aside>
  );
});
