import { describe, test, expect } from "bun:test";
import { cssMultiply, factor, fixedMultiply, groupAt, groupSvg, interpolate, over, premultiply, rgb, sourceContract, type Pixel } from "./kernel";

const source = await sourceContract();
const closePixel = (actual: Pixel, expected: Pixel) => {
  expect(actual.a).toBeCloseTo(expected.a, 13);
  actual.p.forEach((value, i) => expect(value).toBeCloseTo(expected.p[i]!, 13));
};

describe("actual Source foxing contract", () => {
  test("retains exact five layers, opacity and multiply rule", () => {
    expect(source.ruleSha256).toBe("43538cf7cf54783547f0b07e1520bc64e04975d93ceb09864024998795f54d8c");
    expect(source.spots).toEqual([
      { x: .12, y: .18, alpha: .18, solid: 1.2, clear: 2.5 },
      { x: .88, y: .32, alpha: .16, solid: .9, clear: 2 },
      { x: .24, y: .78, alpha: .14, solid: 1.4, clear: 2.8 },
      { x: .76, y: .88, alpha: .18, solid: 1, clear: 2.2 },
      { x: .5, y: .5, alpha: .12, solid: .8, clear: 2 },
    ]);
    expect(source.declarations["pointer-events"]).toBe("none");
  });
  test("prepared SVG paints Source backgrounds in reverse order without flattening opacity", () => {
    const svg = groupSvg(source.spots, 0x7a5426, 1, 1280, 860);
    expect(svg.indexOf('fill="url(#fox-4)"')).toBeLessThan(svg.indexOf('fill="url(#fox-0)"'));
    expect(svg).not.toContain('<g opacity=');
    expect(svg).not.toContain('mix-blend-mode');
    expect(svg.match(/<radialGradient/g)).toHaveLength(5);
  });
});

describe("CSS equation versus proposed destination multiplication", () => {
  test("opaque black stays black: no ordinary-alpha replacement", () => {
    const group = premultiply(rgb(0x7a5426), .18);
    const black = premultiply([0, 0, 0], 1);
    closePixel(fixedMultiply(group, black, .7), cssMultiply(group, black, .7));
    expect(fixedMultiply(group, black, .7).p).toEqual([0, 0, 0]);
    expect(over({ p: group.p.map(p => p * .7) as [number, number, number], a: .18 * .7 }, black).p[0]).toBeGreaterThan(0);
  });
  test("mixed channels and all-opaque arbitrary descendants match the independent CSS equation", () => {
    const group = { p: [.1, .2, .3] as [number, number, number], a: .5 };
    expect(factor(group, .7)).toEqual([.72, .79, .86]);
    for (const color of [[1, 1, 1], [0, 0, 0], [1, 0, .5], [.02, .37, .91], rgb(0xf4ecd8)] as [number, number, number][]) {
      closePixel(fixedMultiply(group, premultiply(color, 1), .7), cssMultiply(group, premultiply(color, 1), .7));
    }
  });
  test("opaque paper with translucent live child remains exact and paints after that child", () => {
    const paper = premultiply(rgb(0xf4ecd8), 1);
    const child = premultiply([.05, .1, .9], .4);
    const group = premultiply(rgb(0x7a5426), .18);
    const composed = over(child, paper);
    const last = fixedMultiply(group, composed, .7);
    closePixel(last, cssMultiply(group, composed, .7));
    // Baking beneath an opaque live field loses the effect completely.
    const field = premultiply([.2, .3, .8], 1);
    const baked = over(field, fixedMultiply(group, paper, .7));
    expect(baked.p[2]).toBeGreaterThan(fixedMultiply(group, over(field, paper), .7).p[2]);
  });
  test("transparency and empty alpha produce an identity factor", () => {
    expect(factor({ p: [0, 0, 0], a: 0 }, .7)).toEqual([1, 1, 1]);
    expect(factor(premultiply([.2, .4, .8], .3), 0)).toEqual([1, 1, 1]);
    closePixel(fixedMultiply({ p: [0, 0, 0], a: 0 }, premultiply([.2, .4, .8], 1), .7), premultiply([.2, .4, .8], 1));
  });
  test("preserving nonopaque destination alpha is not general CSS compositing", () => {
    const group = premultiply([.8, .4, .1], .5);
    const destination = premultiply([.2, .5, .8], .25);
    const proposed = fixedMultiply(group, destination, .7);
    const css = cssMultiply(group, destination, .7);
    expect(proposed.a).toBe(.25);
    expect(css.a).toBeCloseTo(.5125, 13);
    expect(css.p[0]).toBeGreaterThan(proposed.p[0]);
  });
  test("overlap must compose the group before applying its .7 opacity", () => {
    const color = rgb(0x7a5426);
    // A small diagnostic root makes actual Source spots overlap.
    const group = groupAt(source.spots, color, 1, 4, 4, 2, 2);
    const backdrop = premultiply([.7, .8, .9], 1);
    closePixel(fixedMultiply(group, backdrop, .7), cssMultiply(group, backdrop, .7));
    let incorrectlyMultiplied = backdrop;
    for (const spot of source.spots) {
      const layer = groupAt([spot], color, 1, 4, 4, 2, 2);
      incorrectlyMultiplied = fixedMultiply(layer, incorrectlyMultiplied, .7);
    }
    expect(group.a).toBeGreaterThan(.18);
    expect(Math.abs(incorrectlyMultiplied.p[0] - cssMultiply(group, backdrop, .7).p[0])).toBeGreaterThan(.001);
  });
  test("premultiplied sampling interpolates factors without transparent-edge halo", () => {
    const inside = premultiply([.1, .4, .9], .18);
    const outside: Pixel = { p: [0, 0, 0], a: 0 };
    const interpolated = factor(interpolate(inside, outside, .5), .7);
    const a = factor(inside, .7), b = factor(outside, .7);
    a.forEach((f, i) => expect(interpolated[i]).toBeCloseTo(.5 * f + .5 * b[i]!, 13));
  });
  test("changed color channels, opacity and invalid premultiplication refuse", () => {
    expect(() => factor({ p: [.4, 0, 0], a: .2 }, .7)).toThrow();
    expect(() => factor({ p: [NaN, 0, 0], a: .2 }, .7)).toThrow();
    expect(() => factor({ p: [0, 0, 0], a: .2 }, Infinity)).toThrow();
    expect(() => factor({ p: [0, 0, 0], a: -.2 }, .7)).toThrow();
  });
  test("Source Broadsheet zero foxing alpha has no effect", () => {
    const group = groupAt(source.spots, rgb(0), 0, 4, 4, 2, 2);
    expect(group).toEqual({ p: [0, 0, 0], a: 0 });
    expect(factor(group, source.opacity)).toEqual([1, 1, 1]);
  });
});
