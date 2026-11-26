/**
 * Enter or leave zen mode as one motion rather than a snap.
 *
 * Everything that reacts to `twyne:zen-mode` (panels closing, the masthead
 * folding away, the page widening, marks going quiet) changes inside a single
 * View Transition, so the desk clears in one movement. Browsers without the
 * API, reduced-motion readers, and restored preferences get the plain event.
 */
export const ZEN_MODE_EVENT = "twyne:zen-mode";

type ZenDetail = { on: boolean; source?: string };
type TransitionDoc = Document & {
  startViewTransition?: (update: () => Promise<void>) => {
    finished: Promise<void>;
  };
};

/** Long enough for Qwik to flush the store change into the DOM. */
const RENDER_SETTLE_MS = 48;

export function setZenMode(detail: ZenDetail): void {
  const fire = () =>
    window.dispatchEvent(new CustomEvent(ZEN_MODE_EVENT, { detail }));
  const doc = document as TransitionDoc;
  const reduced = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (
    !doc.startViewTransition ||
    reduced ||
    detail.source === "preference" ||
    detail.source === "flow"
  ) {
    fire();
    return;
  }
  const root = document.documentElement;
  root.dataset.zenTransition = detail.on ? "in" : "out";
  try {
    const transition = doc.startViewTransition(async () => {
      fire();
      await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));
    });
    void transition.finished.finally(() => {
      delete root.dataset.zenTransition;
    });
  } catch {
    delete root.dataset.zenTransition;
    fire();
  }
}
