import { allowsMotion, onMotionLevelChange } from "../../utils/motion";

/**
 * The desk lamp: a soft pool of light on the paper behind the manuscript.
 *
 * It sits where the hour puts it (low and warm early and late, high and
 * paler at midday) and, while the writer is not typing, leans a little
 * toward the pointer, as if they had nudged the lamp. It never lights the
 * page itself: the gradient is painted on the scroller's background, behind
 * the sheet, so text contrast is untouched.
 *
 * Cost: two registered custom properties (`--lamp-x`, `--lamp-y`) and a
 * warmth value, written at most once per animation frame while the pointer
 * moves, and once a minute for the hour. No canvas, no loop. CSS transitions
 * on the registered properties do the easing. Below the `full` motion level,
 * or while typing, the lamp holds still where the hour put it.
 */

/** Where the hour sets the lamp: x across the desk, y down it, warmth 0–1. */
export function lampForHour(hour: number): {
  x: number;
  y: number;
  warmth: number;
} {
  // The light swings across the desk over the day, like sun through a window:
  // from the left in the morning to the right in the evening.
  const day = Math.min(1, Math.max(0, (hour - 6) / 14));
  const x = 22 + day * 56;
  // High at midday, low at the ends of the day.
  const height = Math.sin(Math.PI * day);
  const y = 4 + (1 - height) * 18;
  // Warm at the edges of the day and at night, cool and pale at noon.
  const warmth = hour < 6 || hour >= 20 ? 1 : 1 - height * 0.7;
  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    warmth: Math.round(warmth * 100) / 100,
  };
}

/** How far the pointer may lean the lamp from where the hour put it. */
const LEAN = 9;

/**
 * Light `surface` (the manuscript scroller). Returns a cleanup function.
 * The CSS lives in src/styles/press-editor.css under `.desk-lamp`.
 */
export function mountDeskLamp(surface: HTMLElement): () => void {
  let frame = 0;
  let pending: { x: number; y: number } | null = null;
  let base = lampForHour(new Date().getHours());

  const place = (x: number, y: number) => {
    surface.style.setProperty("--lamp-x", `${x}%`);
    surface.style.setProperty("--lamp-y", `${y}%`);
  };
  const settle = () => {
    base = lampForHour(new Date().getHours());
    surface.style.setProperty("--lamp-warmth", String(base.warmth));
    place(base.x, base.y);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !allowsMotion("ambient")) return;
    const rect = surface.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Lean toward the pointer, in proportion to how far off-centre it is.
    const dx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const dy = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    pending = {
      x: base.x + dx * LEAN,
      y: Math.max(0, base.y + dy * (LEAN * 0.6)),
    };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (pending) place(pending.x, pending.y);
      pending = null;
    });
  };
  const onPointerLeave = () => place(base.x, base.y);

  settle();
  surface.classList.add("desk-lamp");
  surface.setAttribute("data-ambient", "");
  surface.addEventListener("pointermove", onPointerMove, { passive: true });
  surface.addEventListener("pointerleave", onPointerLeave);
  const hourly = window.setInterval(settle, 60_000);
  // Typing or a lower level: back to where the hour put it.
  const stopLevel = onMotionLevelChange(() => settle());
  const typingObserver = new MutationObserver(() => {
    if (document.documentElement.hasAttribute("data-typing")) settle();
  });
  typingObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-typing"],
  });

  return () => {
    if (frame) cancelAnimationFrame(frame);
    window.clearInterval(hourly);
    stopLevel();
    typingObserver.disconnect();
    surface.removeEventListener("pointermove", onPointerMove);
    surface.removeEventListener("pointerleave", onPointerLeave);
    surface.classList.remove("desk-lamp");
    surface.removeAttribute("data-ambient");
  };
}
