/**
 * Conversions between the three units the page geometry has to speak.
 *
 * The writer drags margins in **rem**, because that is what the editor's
 * type scale is built on and what every stored `LayoutSettings` holds. The
 * sheet they print on is measured in **inches**, because paper is physical.
 * Layout happens in **CSS pixels**. Everything crosses between the three
 * here rather than in a dozen call sites, so a change to the bridge is a
 * change in one place.
 *
 * `CSS_PX_PER_IN` is fixed by the CSS spec at 96, and it is the same number
 * Chrome's print engine uses when laying out `@page`. That is what makes
 * screen and print agree — but only when the root font size is what we
 * think it is, which is why the export pins `html { font-size: 16px }`
 * while the screen deliberately does not (see `resolvePageSetup`).
 */
import { CSS_PX_PER_IN } from "../types";

/** The browser default, and the value every export is pinned to. */
export const DEFAULT_ROOT_FONT_PX = 16;

/**
 * Current root font size in CSS pixels.
 *
 * On the server, or if the computed value is nonsense, fall back to the
 * browser default rather than propagating a NaN into every page height.
 */
export function rootFontSize(): number {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return DEFAULT_ROOT_FONT_PX;
  }
  const size = parseFloat(
    getComputedStyle(document.documentElement).fontSize || "16",
  );
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_ROOT_FONT_PX;
}

/** rem → CSS px, against an explicit root size so callers stay testable. */
export function remToPx(rem: number, rootPx: number = DEFAULT_ROOT_FONT_PX) {
  return rem * rootPx;
}

/** CSS px → rem. */
export function pxToRem(px: number, rootPx: number = DEFAULT_ROOT_FONT_PX) {
  return px / rootPx;
}

/** CSS px → inches. Spec-fixed, no root font size involved. */
export function pxToIn(px: number): number {
  return px / CSS_PX_PER_IN;
}

/** Inches → CSS px. */
export function inToPx(inches: number): number {
  return inches * CSS_PX_PER_IN;
}

/** Inches → millimetres, for the ruler's readout. */
export function inToMm(inches: number): number {
  return inches * 25.4;
}

/**
 * Format a rem margin for display in the writer's chosen unit.
 *
 * Used by the ruler readout, which shows both the stored value and the
 * physical one so "3 rem" and "half an inch" stop being different languages.
 */
export function formatMargin(
  rem: number,
  unit: "rem" | "in" | "mm",
  rootPx: number = DEFAULT_ROOT_FONT_PX,
): string {
  if (unit === "rem") return `${rem.toFixed(2)} rem`;
  const inches = pxToIn(remToPx(rem, rootPx));
  if (unit === "in") return `${inches.toFixed(2)} in`;
  return `${inToMm(inches).toFixed(1)} mm`;
}
