// Executable arithmetic/reference fixture, NOT native GPU or browser proof.
// The reference equation and proposed fixed blend are deliberately separate.
import postcss from "postcss";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const repo = resolve(import.meta.dir, "../../../..");
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export type RGB = [number, number, number];
export type Pixel = { p: RGB; a: number };
export type Spot = { x: number; y: number; alpha: number; solid: number; clear: number };

export async function sourceContract() {
  const css = await Bun.file(resolve(repo, "src/global.css")).text();
  const tree = postcss.parse(css);
  let raw = "";
  const declarations: Record<string, string> = {};
  tree.walkRules(".paper-foxed::after", rule => {
    if (raw) throw new Error("Duplicate foxing rule");
    raw = rule.toString() + "\n";
    rule.walkDecls(decl => { declarations[decl.prop] = decl.value; });
  });
  if (!raw) throw new Error("Missing exact Source rule");
  const backgrounds = declarations["background-image"]!;
  const expression = /radial-gradient\(\s*circle at ([\d.]+)% ([\d.]+)%,\s*color-mix\(in srgb, var\(--foxing-base\) ([\d.]+)%, transparent\) 0 ([\d.]+)px,\s*transparent ([\d.]+)px\s*\)/g;
  const matches = [...backgrounds.matchAll(expression)];
  if (matches.length !== 5 || backgrounds.replace(expression, "").replace(/[\s,]/g, "")) {
    throw new Error("Unsupported changed Source gradient syntax");
  }
  const spots = matches.map(match => ({ x: Number(match[1]) / 100, y: Number(match[2]) / 100,
    alpha: Number(match[3]) / 100, solid: Number(match[4]), clear: Number(match[5]) }));
  const opacity = Number(declarations.opacity);
  if (opacity !== .7 || declarations["mix-blend-mode"] !== "multiply" || declarations.inset !== "0") {
    throw new Error("Changed Source opacity/blend/placement contract");
  }
  return { cssSha256: sha256(css), ruleSha256: sha256(raw), raw, declarations, spots, opacity };
}

export function rgb(hex: number): RGB { return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; }
export function premultiply(color: RGB, a: number): Pixel { return { p: color.map(c => c * a) as RGB, a }; }
export function over(source: Pixel, destination: Pixel): Pixel {
  return { p: source.p.map((channel, index) => channel + destination.p[index]! * (1 - source.a)) as RGB,
    a: source.a + destination.a * (1 - source.a) };
}

// Independent standard blend+source-over equation, valid for transparent alpha.
// Unlike the proposed fixed-function lane, it changes alpha on translucent D.
export function cssMultiply(source: Pixel, destination: Pixel, g: number): Pixel {
  const a = source.a * g;
  const color = source.a ? source.p.map(c => c / source.a) : [0, 0, 0];
  const backdrop = destination.a ? destination.p.map(c => c / destination.a) : [0, 0, 0];
  const blended = color.map((c, i) => (1 - destination.a) * c + destination.a * c * backdrop[i]!);
  return { p: blended.map((c, i) => a * c + (1 - a) * destination.p[i]!) as RGB,
    a: a + destination.a * (1 - a) };
}

export function factor(source: Pixel, g: number): RGB {
  if (![source.a, g, ...source.p].every(Number.isFinite) || source.a < 0 || source.a > 1 || g < 0 || g > 1 || source.p.some(c => c < 0 || c > source.a)) {
    throw new Error("Invalid premultiplied group/opacity");
  }
  return source.p.map(p => 1 - g * source.a + g * p) as RGB;
}
export function fixedMultiply(source: Pixel, destination: Pixel, g: number): Pixel {
  const f = factor(source, g);
  return { p: destination.p.map((c, i) => c * f[i]!) as RGB, a: destination.a };
}

export function groupAt(spots: Spot[], color: RGB, paletteAlpha: number, width: number, height: number, x: number, y: number): Pixel {
  let group: Pixel = { p: [0, 0, 0], a: 0 };
  // Source CSS backgrounds: first is topmost; no opacity until AFTER the group.
  for (const spot of [...spots].reverse()) {
    const d = Math.hypot(x - spot.x * width, y - spot.y * height);
    const ramp = d <= spot.solid ? 1 : d >= spot.clear ? 0 : (spot.clear - d) / (spot.clear - spot.solid);
    group = over(premultiply(color, spot.alpha * paletteAlpha * ramp), group);
  }
  return group;
}

export function interpolate(a: Pixel, b: Pixel, t: number): Pixel {
  return { p: a.p.map((c, i) => c * (1 - t) + b.p[i]! * t) as RGB, a: a.a * (1 - t) + b.a * t };
}

export function groupSvg(spots: Spot[], color: number, paletteAlpha: number, width: number, height: number) {
  const hex = color.toString(16).padStart(6, "0");
  const defs = spots.map((spot, i) => `<radialGradient id="fox-${i}" gradientUnits="userSpaceOnUse" cx="${spot.x * width}" cy="${spot.y * height}" r="${spot.clear}"><stop offset="0" stop-color="#${hex}" stop-opacity="${spot.alpha * paletteAlpha}"/><stop offset="${spot.solid / spot.clear}" stop-color="#${hex}" stop-opacity="${spot.alpha * paletteAlpha}"/><stop offset="1" stop-color="#${hex}" stop-opacity="0"/></radialGradient>`).join("");
  const rects = spots.map((_, i) => `<rect width="${width}" height="${height}" fill="url(#fox-${i})"/>`).reverse().join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" color-interpolation="sRGB"><defs>${defs}</defs><g>${rects}</g></svg>`;
}
