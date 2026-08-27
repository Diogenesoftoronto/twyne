import type { AppError } from "../types/application-errors";

export const APPLICATION_ERROR_TOAST_EVENT = "twyne:application-error-toast";

export interface ApplicationErrorToastDetail {
  error: AppError;
  title?: string;
  variant?: "error" | "warning";
  dedupeKey?: string;
}

let connectedHosts = 0;
let pendingToasts: ApplicationErrorToastDetail[] = [];

export function connectApplicationErrorToastHost(): {
  pending: ApplicationErrorToastDetail[];
  disconnect: () => void;
} {
  connectedHosts += 1;
  const pending = pendingToasts;
  pendingToasts = [];
  return {
    pending,
    disconnect: () => {
      connectedHosts = Math.max(0, connectedHosts - 1);
    },
  };
}

export function showApplicationErrorToast(
  error: AppError,
  options: Omit<ApplicationErrorToastDetail, "error"> = {},
  eventTarget?: Pick<EventTarget, "dispatchEvent">,
): void {
  const detail = { error, ...options };
  if (!eventTarget && typeof window === "undefined") return;
  const target = eventTarget ?? window;
  if (!target || connectedHosts === 0) {
    pendingToasts = [...pendingToasts, detail].slice(-2);
    return;
  }
  target.dispatchEvent(
    new CustomEvent<ApplicationErrorToastDetail>(
      APPLICATION_ERROR_TOAST_EVENT,
      {
        detail,
      },
    ),
  );
}
