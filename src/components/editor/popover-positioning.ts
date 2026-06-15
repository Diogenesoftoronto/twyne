/**
 * Pure positioning math for the persona-note popover. Lives in its
 * own module so the editor can import it (no Qwik dependency) and
 * so the placement rules — "prefer below the sentence, flip above
 * when the bottom would clip, clamp to the viewport as a last
 * resort" — are unit-testable without a Tiptap editor.
 */

export const POPOVER_CARD_WIDTH = 340;
export const POPOVER_CARD_MARGIN = 8;

export interface PopoverGeometry {
  /** The card's top-left x in viewport coordinates. */
  x: number;
  /** The card's top-left y in viewport coordinates. */
  y: number;
  /** The card's intrinsic max-height in px (matches the CSS rule). */
  cardH: number;
}

export interface PopoverView {
  /** Viewport width. */
  vw: number;
  /** Viewport height. */
  vh: number;
  /** The marked span's bounding rect. */
  rect: { left: number; bottom: number };
}

/**
 * Compute where the popover should sit relative to the marked
 * passage. The card prefers to sit just below the sentence; if that
 * would clip the bottom, it shifts up only as much as needed (the
 * card overlaps the sentence rather than leaving a gap, which keeps
 * it reachable on hover).
 */
export function computePopoverGeometry(view: PopoverView): PopoverGeometry {
  const cardH = Math.min(view.vh * 0.6, 520);
  const x = Math.max(
    POPOVER_CARD_MARGIN,
    Math.min(view.rect.left, view.vw - POPOVER_CARD_WIDTH - POPOVER_CARD_MARGIN),
  );
  let y = view.rect.bottom + POPOVER_CARD_MARGIN;
  const maxTop = view.vh - POPOVER_CARD_MARGIN - cardH;
  if (y > maxTop) y = Math.max(POPOVER_CARD_MARGIN, maxTop);
  return { x, y, cardH };
}
