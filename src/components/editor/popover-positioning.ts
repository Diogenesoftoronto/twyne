/**
 * Pure positioning math for the persona-note popover. Lives in its
 * own module so the editor can import it (no Qwik dependency) and
 * so the placement rules — "prefer below the sentence, flip fully
 * above when the bottom would clip (never overlap the marked text),
 * and clamp height to the available room on whichever side wins" —
 * are unit-testable without a Tiptap editor.
 */

export const POPOVER_CARD_WIDTH = 340;
export const POPOVER_CARD_MARGIN = 8;
export const MARGIN_CARD_GAP = 12;
/**
 * The popover's *content*-driven height. The CSS rule that the
 * card inflates to lives inside the JSX; this is the "ideal" we ask
 * for when there is room below the sentence. The renderer clamps the
 * final `maxH` to the available space on the chosen side.
 */
export const POPOVER_CARD_IDEAL_HEIGHT = 520;

export type PopoverPlacement = "below" | "above";

export interface PopoverGeometry {
  /** The card's top-left x in viewport coordinates. */
  x: number;
  /** Top offset in px (or null when the card is bottom-anchored above). */
  top: number | null;
  /** Bottom offset in px (or null when the card is top-anchored below). */
  bottom: number | null;
  /** Final max-height in px, clamped to the available space on the chosen side. */
  maxH: number;
  /** Which side of the anchor the card sits on. */
  placement: PopoverPlacement;
}

export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
}

export interface PopoverView {
  /** Viewport width. */
  vw: number;
  /** Viewport height. */
  vh: number;
  /** The marked span's bounding rect. */
  rect: AnchorRect;
  /** Ideal card height; defaults to POPOVER_CARD_IDEAL_HEIGHT. */
  idealH?: number;
}

export interface MarginCardView extends PopoverView {
  /** The visible manuscript page whose outside margins the card should use. */
  page: { left: number; right: number };
}

/**
 * Place an editorial conversation beside the manuscript, Google-Docs style.
 * The right margin is the stable default; the left margin is used when it is
 * the only side with room. Narrow viewports fall back to a clamped edge card,
 * with CSS turning that card into a bottom sheet on phones.
 */
export function computeMarginCardGeometry(
  view: MarginCardView,
): PopoverGeometry {
  const margin = MARGIN_CARD_GAP;
  const cardWidth = POPOVER_CARD_WIDTH;
  const idealH = view.idealH ?? POPOVER_CARD_IDEAL_HEIGHT;
  const rightX = view.page.right + margin;
  const leftX = view.page.left - cardWidth - margin;
  const rightFits = rightX + cardWidth <= view.vw - margin;
  const leftFits = leftX >= margin;

  let x: number;
  if (rightFits) x = rightX;
  else if (leftFits) x = leftX;
  else {
    const roomRight = view.vw - view.page.right;
    const roomLeft = view.page.left;
    x = roomRight >= roomLeft ? rightX : leftX;
    x = Math.max(margin, Math.min(x, view.vw - cardWidth - margin));
  }

  const maxH = Math.max(0, Math.min(idealH, view.vh - margin * 2));
  const top = Math.max(
    margin,
    Math.min(view.rect.top, view.vh - maxH - margin),
  );

  return { x, top, bottom: null, maxH, placement: "below" };
}

/**
 * Decide where the popover should sit relative to the marked passage.
 *
 * Rules:
 *  1. Prefer just below the sentence (`rect.bottom + margin`).
 *  2. If the ideal card would clip the viewport bottom and there is
 *     strictly *more* room above than below, flip above. The flipped
 *     card is bottom-anchored so it grows upward from `rect.top - margin` —
 *     this matters because the card's final height is content-dependent,
 *     so a top-anchored flip would jitter as content streams in.
 *  3. Whichever side wins, clamp `maxH` to the available space so the
 *     card never overlaps the anchor.
 */
export function computePopoverGeometry(view: PopoverView): PopoverGeometry {
  const margin = POPOVER_CARD_MARGIN;
  const idealH = view.idealH ?? POPOVER_CARD_IDEAL_HEIGHT;

  const x = Math.max(
    margin,
    Math.min(view.rect.left, view.vw - POPOVER_CARD_WIDTH - margin),
  );

  const belowTop = view.rect.bottom + margin;
  const aboveBottomCoord = view.rect.top - margin;

  const spaceBelow = Math.max(0, view.vh - margin - belowTop);
  const spaceAbove = Math.max(0, aboveBottomCoord - margin);

  // Default: below. Only flip above if below can't fit AND above is strictly
  // roomier. Equal falls through to below — keeps behavior stable when the
  // anchor is roughly mid-viewport.
  const flipAbove = spaceBelow < idealH && spaceAbove > spaceBelow;

  if (flipAbove) {
    const maxH = Math.max(0, Math.min(idealH, spaceAbove));
    // bottom offset relative to viewport: vh - rect.top + margin
    return {
      x,
      top: null,
      bottom: Math.max(0, view.vh - view.rect.top + margin),
      maxH,
      placement: "above",
    };
  }

  const maxH = Math.max(0, Math.min(idealH, spaceBelow));
  return {
    x,
    top: belowTop,
    bottom: null,
    maxH,
    placement: "below",
  };
}
