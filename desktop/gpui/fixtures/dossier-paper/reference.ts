// Source-only extraction and SVG geometry diagnostic. No browser/native proof.
import postcss from "postcss";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const root = resolve(import.meta.dir, "../../../..");
export const fixture = import.meta.dir;
const selectors = [".paper-sheet", ".paper-foxed::after"] as const;
export const sha256 = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");

export function splitComma(value: string): string[] {
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    if (value[i] === ")") depth--;
    if (value[i] === "," && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
    if (depth < 0) throw new Error("Unbalanced CSS expression");
  }
  if (depth) throw new Error("Unbalanced CSS expression");
  parts.push(value.slice(start).trim());
  return parts;
}

function colorStop(value: string) {
  const normalized = value.replace(/\s+/g, " ");
  const mix =
    /^color-mix\(in srgb, var\((--[\w-]+)\) ([\d.]+)%, transparent\) (.+)$/.exec(
      normalized,
    );
  if (mix)
    return {
      token: mix[1]!,
      alpha: Number(mix[2]) / 100,
      stops: mix[3]!.split(" "),
    };
  const clear = /^transparent (.+)$/.exec(normalized);
  if (clear) return { token: null, alpha: 0, stops: clear[1]!.split(" ") };
  throw new Error(`Unsupported retained color-stop syntax: ${normalized}`);
}

function gradient(raw: string, size: string) {
  const outer =
    /^(radial-gradient|repeating-linear-gradient)\(([\s\S]*)\)$/.exec(raw);
  if (!outer) throw new Error("Unexpected Source paper gradient function");
  const [geometry, colored, transparent, ...extra] = splitComma(outer[2]!);
  if (extra.length || !geometry || !colored || !transparent)
    throw new Error("Unexpected Source paper stop count");
  const center = /^circle at ([\d.]+)% ([\d.]+)%$/.exec(geometry);
  const angle = /^([\d.]+)deg$/.exec(geometry);
  const tile = /^([\d.]+)px ([\d.]+)px$/.exec(size);
  return {
    raw,
    kind: outer[1]!,
    center: center ? [Number(center[1]) / 100, Number(center[2]) / 100] : null,
    angle: angle ? Number(angle[1]) : null,
    colored: colorStop(colored),
    transparent: colorStop(transparent),
    size,
    tile: tile ? [Number(tile[1]), Number(tile[2])] : null,
  };
}

export async function sourceContract() {
  const css = await Bun.file(resolve(root, "src/global.css")).text();
  const ast = postcss.parse(css);
  const rules = selectors.map((selector) => {
    const found: postcss.Rule[] = [];
    ast.walkRules(selector, (rule) => {
      found.push(rule);
    });
    if (found.length !== 1)
      throw new Error(`Expected one exact ${selector} rule`);
    const rule = found[0]!;
    const start = rule.source!.start!;
    const end = rule.source!.end!;
    const raw = css.slice(start.offset!, end.offset! + 1);
    const declarations: Record<string, string> = {};
    rule.walkDecls((decl) => {
      declarations[decl.prop] = decl.value;
    });
    return {
      selector,
      startLine: start.line,
      endLine: end.line,
      raw,
      sha256: sha256(raw),
      declarations,
    };
  });
  const [sheet, foxed] = rules;
  const sizes = splitComma(sheet!.declarations["background-size"]!);
  const backgrounds = splitComma(sheet!.declarations["background-image"]!).map(
    (raw, i) => gradient(raw, sizes[i]!),
  );
  const foxing = splitComma(foxed!.declarations["background-image"]!).map(
    (raw) => gradient(raw, "auto"),
  );
  const defaults: Record<string, string> = {};
  ast.walkAtRules("theme", (at) => {
    at.walkDecls((decl) => {
      defaults[decl.prop] = decl.value;
    });
  });
  ast.walkRules(":root", (rule) => {
    rule.walkDecls((decl) => {
      if (decl.prop === "--foxing-base" || decl.prop === "--shade")
        defaults[decl.prop] = decl.value;
    });
  });
  const presets = Object.fromEntries(
    ["editorial", "foolscap", "broadsheet", "nightpress"].map((preset) => {
      const values = { ...defaults };
      ast.walkRules(`[data-theme="${preset}"]`, (rule) => {
        rule.walkDecls((decl) => {
          values[decl.prop] = decl.value;
        });
      });
      const colors = Object.fromEntries(
        [
          "--color-paper",
          "--color-paper-soft",
          "--color-ink",
          "--foxing-base",
          "--shade",
        ].map((token) => {
          const value = values[token]!;
          const ref = /^var\((--[\w-]+)\)$/.exec(value);
          return [token, ref ? values[ref[1]!]! : value];
        }),
      );
      return [preset, colors];
    }),
  );
  return {
    schema: 1,
    source: { path: "src/global.css", sha256: sha256(css) },
    rules,
    backgrounds,
    shadows: splitComma(sheet!.declarations["box-shadow"]!),
    foxing,
    groupOpacity: Number(foxed!.declarations.opacity),
    blend: foxed!.declarations["mix-blend-mode"],
    presets,
    proof:
      "Exact retained Source layer extraction; no browser/native raster parity claim",
  };
}

export type Contract = Awaited<ReturnType<typeof sourceContract>>;
type Layer = Contract["backgrounds"][number];
export function radialGeometry(layer: Layer, width: number, height: number) {
  if (!layer.center) throw new Error("Expected a circle gradient");
  const x = layer.center[0]! * width;
  const y = layer.center[1]! * height;
  const end = layer.transparent.stops[0]!;
  const radius = end.endsWith("%")
    ? (Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) *
        parseFloat(end)) /
      100
    : parseFloat(end);
  const solid = layer.colored.stops.at(-1)!;
  return {
    x,
    y,
    radius,
    solidFraction: solid.endsWith("px") ? parseFloat(solid) / radius : 0,
  };
}

export function referenceSvg(
  contract: Contract,
  width: number,
  height: number,
  preset: string,
) {
  const palette = contract.presets[preset];
  if (!palette) throw new Error(`Unknown Source theme ${preset}`);
  const rect = (fill: string, w = width, h = height) =>
    `<rect width="${w}" height="${h}" fill="${fill}"/>`;
  const defs = contract.backgrounds
    .map((layer, index) => {
      const rawColor = palette[layer.colored.token!]!;
      const color = rawColor === "transparent" ? "#000000" : rawColor;
      const alpha = rawColor === "transparent" ? 0 : layer.colored.alpha;
      if (layer.kind === "repeating-linear-gradient") {
        if (layer.angle !== 135)
          throw new Error("Diagnostic only supports retained135deg projection");
        const solid = parseFloat(layer.colored.stops[1]!);
        const period = parseFloat(layer.transparent.stops[1]!);
        return `<pattern id="layer-${index}" patternUnits="userSpaceOnUse" width="${period}" height="1" patternTransform="rotate(45)"><rect width="${solid}" height="1" fill="${color}" fill-opacity="${alpha}"/></pattern>`;
      }
      const [w, h] = layer.tile ?? [width, height];
      const { x, y, radius, solidFraction } = radialGeometry(layer, w!, h!);
      const id = layer.tile ? `dot-${index}` : `layer-${index}`;
      const radial = `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${x}" cy="${y}" r="${radius}"><stop offset="0" stop-color="${color}" stop-opacity="${alpha}"/><stop offset="${solidFraction}" stop-color="${color}" stop-opacity="${alpha}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
      return layer.tile
        ? radial +
            `<pattern id="layer-${index}" patternUnits="userSpaceOnUse" width="${w}" height="${h}">${rect(`url(#${id})`, w, h)}</pattern>`
        : radial;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" color-interpolation="sRGB"><defs>${defs}</defs>${rect(palette["--color-paper"]!)}${contract.backgrounds
    .map((_, i) => rect(`url(#layer-${i})`))
    .reverse()
    .join("")}</svg>`;
}

if (import.meta.main) {
  const contract = await sourceContract();
  await Bun.write(
    resolve(fixture, "source.json"),
    JSON.stringify(contract, null, 2) + "\n",
  );
  for (const [width, height] of [
    [1280, 860],
    [620, 860],
  ]) {
    for (const preset of Object.keys(contract.presets)) {
      await Bun.write(
        resolve(fixture, `${preset}-${width}.svg`),
        referenceSvg(contract, width!, height!, preset),
      );
    }
  }
  console.log(
    JSON.stringify({
      backgrounds: contract.backgrounds.length,
      foxing: contract.foxing.length,
      rules: contract.rules.map(({ selector, sha256 }) => ({
        selector,
        sha256,
      })),
      svgs: 8,
    }),
  );
}
