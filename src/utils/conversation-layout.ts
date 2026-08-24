import type { InterviewStyle } from "../types";

/**
 * Both dossier surfaces own exactly one viewport.
 *
 * This started as the conversation's contract alone: chrome and composer stay
 * fixed while the transcript consumes the remaining height and is the sole
 * scroll owner. The form was the exception — a `min-h-screen` document that
 * grew past the window, which pushed the folio's own footer nav below the fold
 * and made a ten-step form feel like a long page instead of a sheet on a desk.
 *
 * Now the form is filed into the same folio, so there is one rule for both:
 * the route is pinned to the dynamic viewport, and every scroll happens inside
 * a frame within it. Keeping the contract here makes an accidental
 * `min-height` regression straightforward to catch without a browser.
 */
export const DOSSIER_ROUTE_CLASS =
  "flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--color-paper)]";

/** @deprecated Prefer {@link DOSSIER_ROUTE_CLASS} — both surfaces share it. */
export const CONVERSATION_ROUTE_CLASS = DOSSIER_ROUTE_CLASS;

/**
 * A frame inside the folio that scrolls on its own. The folio's leaves and the
 * transcript all use it, which is what keeps the page itself from scrolling.
 */
export const FOLIO_COLUMN_CLASS = "folio-column min-h-0 flex-1";

/**
 * Kept as a function even though both surfaces now resolve to the same class:
 * the call sites read as "whatever this surface needs", and the day one of
 * them needs something different again, only this returns changes.
 */
export function dossierRouteClass(style: InterviewStyle): string {
  return style === "conversational" ? DOSSIER_ROUTE_CLASS : DOSSIER_ROUTE_CLASS;
}
