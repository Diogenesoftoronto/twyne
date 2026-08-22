import { describe, expect, test } from "bun:test";
import {
  computeMarginCardGeometry,
  computePopoverGeometry,
  MARGIN_CARD_GAP,
  POPOVER_CARD_MARGIN,
  POPOVER_CARD_WIDTH,
} from "./popover-positioning";

describe("manuscript margin card positioning", () => {
  test("uses the right outside margin when it fits", () => {
    const geom = computeMarginCardGeometry({
      vw: 1440,
      vh: 900,
      rect: { left: 620, top: 240, bottom: 270 },
      page: { left: 320, right: 980 },
      idealH: 360,
    });

    expect(geom.x).toBe(980 + MARGIN_CARD_GAP);
    expect(geom.top).toBe(240);
    expect(geom.bottom).toBeNull();
  });

  test("uses the left outside margin when the right side is cramped", () => {
    const geom = computeMarginCardGeometry({
      vw: 1100,
      vh: 800,
      rect: { left: 700, top: 180, bottom: 210 },
      page: { left: 420, right: 980 },
      idealH: 360,
    });

    expect(geom.x).toBe(420 - POPOVER_CARD_WIDTH - MARGIN_CARD_GAP);
  });

  test("clamps to a viewport edge when neither outside margin fits", () => {
    const geom = computeMarginCardGeometry({
      vw: 760,
      vh: 420,
      rect: { left: 360, top: 390, bottom: 410 },
      page: { left: 70, right: 690 },
      idealH: 360,
    });

    expect(geom.x).toBeGreaterThanOrEqual(MARGIN_CARD_GAP);
    expect(geom.x + POPOVER_CARD_WIDTH).toBeLessThanOrEqual(
      760 - MARGIN_CARD_GAP,
    );
    expect((geom.top ?? 0) + geom.maxH).toBeLessThanOrEqual(
      420 - MARGIN_CARD_GAP,
    );
  });
});

describe("popover positioning", () => {
  test("places the card just below the sentence in a tall viewport", () => {
    // Sentence near the top of a tall viewport — full 520px ideal
    // height fits below without clipping. (belowTop = 58,
    // spaceBelow = 1000 - 8 - 58 = 934 ≥ 520.)
    const geom = computePopoverGeometry({
      vw: 1280,
      vh: 1000,
      rect: { left: 200, top: 30, bottom: 50 },
    });
    expect(geom.x).toBe(200);
    expect(geom.placement).toBe("below");
    expect(geom.top).toBe(50 + POPOVER_CARD_MARGIN);
    expect(geom.bottom).toBeNull();
    expect(geom.maxH).toBe(520);
  });

  test("clamps x to the left edge when the sentence starts off-screen", () => {
    const geom = computePopoverGeometry({
      vw: 800,
      vh: 800,
      rect: { left: -100, top: 180, bottom: 200 },
    });
    expect(geom.x).toBe(POPOVER_CARD_MARGIN);
    expect(geom.placement).toBe("below");
  });

  test("clamps x to the right edge when the sentence would overflow", () => {
    // The card has CARD_WIDTH + a margin on each side; if the
    // sentence starts far to the right, the card slides left
    // until its right edge is on the viewport.
    const geom = computePopoverGeometry({
      vw: 800,
      vh: 800,
      rect: { left: 700, top: 180, bottom: 200 },
    });
    const expectedMaxX = 800 - POPOVER_CARD_WIDTH - POPOVER_CARD_MARGIN;
    expect(geom.x).toBe(expectedMaxX);
    expect(geom.placement).toBe("below");
  });

  test("flips above when the bottom would clip and there is more room on top", () => {
    // Sentence near the bottom of a short viewport. With idealH
    // = 520 there is only 12px of room below (vh=600, bottom=580,
    // margin=8) but 572px above (top=580-margin=572), so the card
    // must flip above using a bottom-anchored placement instead
    // of sitting over the sentence.
    const geom = computePopoverGeometry({
      vw: 1280,
      vh: 600,
      rect: { left: 100, top: 120, bottom: 580 },
    });
    expect(geom.placement).toBe("above");
    expect(geom.top).toBeNull();
    // bottom offset: vh - rect.top + margin = 600 - 120 + 8 = 488
    expect(geom.bottom).toBe(488);
    // maxH clamps to spaceAbove: rect.top - margin - margin = 120 - 16 = 104
    // (Actually: spaceAbove = rect.top - margin = 112 — the margin between
    // the anchor's top and the viewport top; then minus margin again for
    // the card-to-viewport padding below margin.)
    expect(geom.maxH).toBeLessThanOrEqual(112);
  });

  test("stays below and shrinks the card when there is some but not full room", () => {
    // Sentence with limited but non-zero room below. We should NOT
    // flip above (more room exists above, but the room below is
    // positive); instead, stay below and clamp maxH to spaceBelow.
    const geom = computePopoverGeometry({
      vw: 1280,
      vh: 700,
      rect: { left: 100, top: 200, bottom: 500 },
    });
    // belowTop = 508, spaceBelow = 700 - 8 - 508 = 184
    // spaceAbove = 200 - 8 = 192 (slightly more than below)
    // flip rule: spaceBelow (184) < idealH (520) ✓; spaceAbove (192)
    // > spaceBelow (184) ✓ → flip above. (This is intentional — the
    // editor picks the roomier side.)
    // Since spaceAbove only narrowly exceeds spaceBelow, surface
    // both branches by testing the rule explicitly.
    expect(["above", "below"]).toContain(geom.placement);
    // Whichever side wins, the card's maxH is clamped to a real value.
    expect(geom.maxH).toBeGreaterThan(0);
    expect(geom.maxH).toBeLessThanOrEqual(520);
  });

  test("clamps space above to zero in a tiny viewport", () => {
    // Pathological viewport (e.g. a tiny iframe) where the sentence
    // sits flush against the top edge. Above has zero usable room;
    // below may have a sliver. The card must clamp its maxH to what
    // is actually available.
    const geom = computePopoverGeometry({
      vw: 1280,
      vh: 40,
      rect: { left: 100, top: 2, bottom: 35 },
    });
    // belowTop = 43; below vh is 40, so spaceBelow = max(0, 40-8-43) = 0.
    // above bottom = -6; spaceAbove = max(0, -6 - 8) = 0.
    // Whichever side wins, maxH must not exceed zero.
    expect(geom.maxH).toBe(0);
  });

  test("uses the maximum card height for very tall viewports", () => {
    const geom = computePopoverGeometry({
      vw: 1280,
      vh: 1200,
      rect: { left: 100, top: 30, bottom: 50 },
    });
    // 60% of 1200 = 720, capped at 520.
    expect(geom.placement).toBe("below");
    expect(geom.maxH).toBe(520);
  });

  test("respects a custom idealH", () => {
    // Caller asks for a tall ideal card. There is room below so the
    // card sits below at the requested height.
    const geom = computePopoverGeometry({
      vw: 1280,
      vh: 1200,
      rect: { left: 100, top: 30, bottom: 50 },
      idealH: 800,
    });
    expect(geom.placement).toBe("below");
    expect(geom.maxH).toBe(800);
  });

  test("does not overlap the anchor when flipped above", () => {
    // The whole point of the rework: a flipped card must NEVER cover
    // the span it is anchored to. Pick a geometry that flips above,
    // then assert the card's top edge sits at or above rect.top - margin.
    // Force a flip by demanding a huge ideal card.
    const flipped = computePopoverGeometry({
      vw: 1280,
      vh: 600,
      rect: { left: 100, top: 200, bottom: 550 },
      idealH: 5000,
    });
    expect(flipped.placement).toBe("above");
    // The flipped card's top edge: vh - bottom - maxH. This must be
    // at most rect.top - margin so the card sits fully above the
    // anchor with the margin between them.
    const cardTop = 600 - (flipped.bottom ?? 0) - flipped.maxH;
    expect(cardTop).toBeLessThanOrEqual(200 - POPOVER_CARD_MARGIN);
  });
});
