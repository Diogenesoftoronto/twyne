/**
 * The platen behind <HoldToConfirm>: tracks a press-and-hold on one element
 * and writes its progress to `--press-progress`, so the ink fill is driven by
 * a single custom property rather than a re-render per frame.
 */

interface ActiveHold {
  frame: number;
  started: number;
}

const holds = new WeakMap<HTMLElement, ActiveHold>();

export interface HoldOptions {
  /** How long the press must be held. */
  durationMs: number;
  /** Called once, when the platen reaches the bed. */
  onCommit: () => void;
}

/** Start a hold on `element`. A second call while one runs is ignored. */
export function beginHold(element: HTMLElement, options: HoldOptions): void {
  if (holds.has(element)) return;
  const hold: ActiveHold = { frame: 0, started: performance.now() };
  holds.set(element, hold);
  element.setAttribute("data-holding", "");
  element.removeAttribute("data-committed");

  const tick = (now: number) => {
    if (holds.get(element) !== hold) return;
    const progress = Math.min(1, (now - hold.started) / options.durationMs);
    // Ease-in: the platen is slow to start and quick to land, so an
    // accidental tap barely marks the paper.
    element.style.setProperty("--press-progress", String(progress ** 1.6));
    if (progress >= 1) {
      holds.delete(element);
      element.removeAttribute("data-holding");
      element.setAttribute("data-committed", "");
      options.onCommit();
      // Most confirmed controls leave with what they removed; one that
      // stays drains back to rest once the impression has been seen.
      setTimeout(() => {
        if (holds.has(element)) return;
        element.removeAttribute("data-committed");
        element.style.setProperty("--press-progress", "0");
      }, 700);
      return;
    }
    hold.frame = requestAnimationFrame(tick);
  };
  hold.frame = requestAnimationFrame(tick);
}

const nudges = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * Release early: nothing happens, and the ink drains back. A release that
 * barely started (a click, really) also nudges the hint into view for a
 * moment, so someone who clicked learns the control wants a hold.
 */
export function cancelHold(element: HTMLElement): void {
  const hold = holds.get(element);
  if (!hold) return;
  cancelAnimationFrame(hold.frame);
  holds.delete(element);
  element.removeAttribute("data-holding");
  element.style.setProperty("--press-progress", "0");
  if (performance.now() - hold.started < 350) {
    element.setAttribute("data-nudged", "");
    const previous = nudges.get(element);
    if (previous !== undefined) clearTimeout(previous);
    nudges.set(
      element,
      setTimeout(() => {
        nudges.delete(element);
        element.removeAttribute("data-nudged");
      }, 1800),
    );
  }
}

export function isHolding(element: HTMLElement): boolean {
  return holds.has(element);
}
