import { describe, expect, test } from "bun:test";
import {
  computePopoverGeometry,
  POPOVER_CARD_MARGIN,
  POPOVER_CARD_WIDTH,
} from "./popover-positioning";

describe("popover positioning", () => {
  test("places the card just below the sentence in a tall viewport", () => {
    const geom = computePopoverGeometry({
      vw: 1280,
      vh: 800,
      rect: { left: 200, bottom: 300 },
    });
    expect(geom.x).toBe(200);
    // Just below the sentence, with the standard margin.
    expect(geom.y).toBe(300 + POPOVER_CARD_MARGIN);
  });

  test("clamps x to the left edge when the sentence starts off-screen", () => {
    const geom = computePopoverGeometry({
      vw: 800,
      vh: 800,
      rect: { left: -100, bottom: 200 },
    });
    expect(geom.x).toBe(POPOVER_CARD_MARGIN);
  });

  test("clamps x to the right edge when the sentence would overflow", () => {
    // The card has CARD_WIDTH + a margin on each side; if the
    // sentence starts far to the right, the card slides left
    // until its right edge is on the viewport.
    const geom = computePopoverGeometry({
      vw: 800,
      vh: 800,
      rect: { left: 700, bottom: 200 },
    });
    const expectedMaxX = 800 - POPOVER_CARD_WIDTH - POPOVER_CARD_MARGIN;
    expect(geom.x).toBe(expectedMaxX);
  });

  test("shifts the card up when the bottom would clip the viewport", () => {
    // Sentence near the bottom of a short viewport — the card
    // would clip if it sat at rect.bottom + MARGIN, so it shifts
    // up to fit.
    const geom = computePopoverGeometry({
      vw: 1280,
      vh: 600,
      rect: { left: 100, bottom: 580 },
    });
    // cardH = min(600 * 0.6, 520) = 360
    // maxTop = 600 - 8 - 360 = 232
    // initial y = 580 + 8 = 588, which is > maxTop, so y = 232
    expect(geom.cardH).toBe(360);
    expect(geom.y).toBe(232);
  });

  test("clamps y to the top when even shifting up wouldn't fit the card", () => {
    // Pathological viewport (e.g. a tiny iframe). cardH = min(40, 520)
    // = 40; maxTop = 40 - 8 - 40 = -8, so the formula's outer max
    // pulls y back up to the margin so the card stays in view.
    const geom = computePopoverGeometry({
      vw: 1280,
      vh: 40,
      rect: { left: 100, bottom: 35 },
    });
    expect(geom.y).toBe(POPOVER_CARD_MARGIN);
  });

  test("uses the maximum card height for very tall viewports", () => {
    const geom = computePopoverGeometry({
      vw: 1280,
      vh: 1200,
      rect: { left: 100, bottom: 50 },
    });
    // 60% of 1200 = 720, capped at 520.
    expect(geom.cardH).toBe(520);
  });
});
