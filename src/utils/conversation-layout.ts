import type { InterviewStyle } from "../types";

/**
 * The conversation owns one viewport: chrome and composer stay fixed while
 * the history consumes the remaining height and is the sole scroll owner.
 * Keeping these contracts together makes accidental `min-height` regressions
 * straightforward to catch without a browser-specific test.
 */
export const CONVERSATION_ROUTE_CLASS =
  "flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--color-paper)]";

export const CONVERSATION_SHELL_CLASS =
  "flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-paper)] text-[var(--color-ink)]";

export const CONVERSATION_HISTORY_CLASS =
  "min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 py-6 space-y-4";

export const CONVERSATION_COMPOSER_CLASS =
  "shrink-0 border-t border-[var(--color-paper-3)] bg-[var(--color-paper-2)] px-4 pt-3";

export function dossierRouteClass(style: InterviewStyle): string {
  return style === "conversational"
    ? CONVERSATION_ROUTE_CLASS
    : "min-h-screen bg-[var(--color-paper)]";
}
