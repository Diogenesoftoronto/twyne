/**
 * Things that answer where the pointer is.
 *
 *   [data-tilt]  leans toward the pointer while it is over the element:
 *                `--tilt-x` and `--tilt-y` run from -1 (left, top) to 1.
 *   [data-lamp]  knows where over it the pointer is, as `--lamp-x` and
 *                `--lamp-y` percentages, and carries `data-lit` meanwhile.
 *
 * The stylesheet (`src/styles/cursors.css`) turns those into a lean and a
 * pool of light. Here: one delegated listener per root and one write per
 * frame. Nothing runs for touch, and nothing moves when the writer has asked
 * for stillness; it is feedback, so Calm keeps it.
 */
import { allowsMotion } from "./motion";

export interface Lean {
  x: number;
  y: number;
}

/** Where a point sits in a box, from -1 at one edge to 1 at the other. */
export function leanAt(
  box: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): Lean {
  const unit = (value: number, start: number, size: number) =>
    size > 0 ? Math.max(-1, Math.min(1, ((value - start) / size) * 2 - 1)) : 0;
  return {
    x: unit(x, box.left, box.width),
    y: unit(y, box.top, box.height),
  };
}

/** The same point as percentages of the box, for a gradient's centre. */
export function spotAt(
  box: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): { x: string; y: string } {
  const lean = leanAt(box, x, y);
  return {
    x: `${((lean.x + 1) * 50).toFixed(1)}%`,
    y: `${((lean.y + 1) * 50).toFixed(1)}%`,
  };
}

/** Follow the pointer inside `root`. Returns a function that stops. */
export function followPointer(root: HTMLElement): () => void {
  if (
    typeof window === "undefined" ||
    !window.matchMedia("(hover: hover) and (pointer: fine)").matches
  )
    return () => {};
  let frame = 0;
  let point: { target: EventTarget | null; x: number; y: number } | null = null;
  let leaning: HTMLElement | null = null;
  let lit: HTMLElement | null = null;

  const settle = () => {
    if (leaning) {
      leaning.style.removeProperty("--tilt-x");
      leaning.style.removeProperty("--tilt-y");
      leaning.removeAttribute("data-tilting");
      leaning = null;
    }
    if (lit) {
      lit.removeAttribute("data-lit");
      lit = null;
    }
  };

  const write = () => {
    frame = 0;
    if (!point) return;
    if (!allowsMotion("feedback")) return settle();
    const target = point.target instanceof Element ? point.target : null;
    const within = <T extends HTMLElement>(selector: string) => {
      const found = target?.closest<T>(selector) ?? null;
      return found && root.contains(found) ? found : null;
    };
    const tilt = within("[data-tilt]");
    if (tilt !== leaning) {
      if (leaning) {
        leaning.style.removeProperty("--tilt-x");
        leaning.style.removeProperty("--tilt-y");
        leaning.removeAttribute("data-tilting");
      }
      leaning = tilt;
    }
    if (leaning) {
      const lean = leanAt(leaning.getBoundingClientRect(), point.x, point.y);
      leaning.style.setProperty("--tilt-x", lean.x.toFixed(3));
      leaning.style.setProperty("--tilt-y", lean.y.toFixed(3));
      leaning.setAttribute("data-tilting", "");
    }
    const lamp = within("[data-lamp]");
    if (lamp !== lit) {
      lit?.removeAttribute("data-lit");
      lit = lamp;
    }
    if (lit) {
      const spot = spotAt(lit.getBoundingClientRect(), point.x, point.y);
      lit.style.setProperty("--lamp-x", spot.x);
      lit.style.setProperty("--lamp-y", spot.y);
      lit.setAttribute("data-lit", "");
    }
  };

  const move = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    point = { target: event.target, x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(write);
  };
  const leave = () => {
    point = null;
    settle();
  };
  root.addEventListener("pointermove", move, { passive: true });
  root.addEventListener("pointerleave", leave);
  return () => {
    cancelAnimationFrame(frame);
    root.removeEventListener("pointermove", move);
    root.removeEventListener("pointerleave", leave);
    settle();
  };
}

/**
 * How far something carried by the pointer swings, in degrees, for how fast
 * it is moving sideways: it trails the hand, and hangs level when held still.
 */
export function swingFor(pixelsPerFrame: number, limit = 9): number {
  return Math.max(-limit, Math.min(limit, pixelsPerFrame * 0.45));
}
