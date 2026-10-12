/** Browser-free KaTeX vector groundwork. Current Source CSS compatibility is
 * deliberately separate from the engine-matched diagnostic. No MathJax,
 * document conversion, network, browser, formula templates or raster capture. */
import katex from "katex";
import { createHash } from "node:crypto";
import postcss from "postcss";
import sourceCss from "../../../src/components/editor/math/katex.min.css" with { type: "text" };
import engineCss from "../../../node_modules/katex/dist/katex.css" with { type: "text" };
import { renderLatex } from "../../../src/components/editor/math/math-renderer";
import { mathCssConsumers } from "./math-css-provenance";
import ams from "../../../src/components/editor/math/fonts/KaTeX_AMS-Regular.ttf" with { type: "file" };
import cal from "../../../src/components/editor/math/fonts/KaTeX_Caligraphic-Regular.ttf" with { type: "file" };
import calBold from "../../../src/components/editor/math/fonts/KaTeX_Caligraphic-Bold.ttf" with { type: "file" };
import frak from "../../../src/components/editor/math/fonts/KaTeX_Fraktur-Regular.ttf" with { type: "file" };
import frakBold from "../../../src/components/editor/math/fonts/KaTeX_Fraktur-Bold.ttf" with { type: "file" };
import main from "../../../src/components/editor/math/fonts/KaTeX_Main-Regular.ttf" with { type: "file" };
import mainBold from "../../../src/components/editor/math/fonts/KaTeX_Main-Bold.ttf" with { type: "file" };
import mainItalic from "../../../src/components/editor/math/fonts/KaTeX_Main-Italic.ttf" with { type: "file" };
import mainBoldItalic from "../../../src/components/editor/math/fonts/KaTeX_Main-BoldItalic.ttf" with { type: "file" };
import math from "../../../src/components/editor/math/fonts/KaTeX_Math-Italic.ttf" with { type: "file" };
import mathBold from "../../../src/components/editor/math/fonts/KaTeX_Math-BoldItalic.ttf" with { type: "file" };
import sans from "../../../src/components/editor/math/fonts/KaTeX_SansSerif-Regular.ttf" with { type: "file" };
import sansBold from "../../../src/components/editor/math/fonts/KaTeX_SansSerif-Bold.ttf" with { type: "file" };
import sansItalic from "../../../src/components/editor/math/fonts/KaTeX_SansSerif-Italic.ttf" with { type: "file" };
import script from "../../../src/components/editor/math/fonts/KaTeX_Script-Regular.ttf" with { type: "file" };
import typewriter from "../../../src/components/editor/math/fonts/KaTeX_Typewriter-Regular.ttf" with { type: "file" };
import size1 from "../../../src/components/editor/math/fonts/KaTeX_Size1-Regular.ttf" with { type: "file" };
import size2 from "../../../src/components/editor/math/fonts/KaTeX_Size2-Regular.ttf" with { type: "file" };
import size3 from "../../../src/components/editor/math/fonts/KaTeX_Size3-Regular.ttf" with { type: "file" };
import size4 from "../../../src/components/editor/math/fonts/KaTeX_Size4-Regular.ttf" with { type: "file" };

export const MATH_WRITE_SCHEMA = 1;
export type MathWriteProfile =
  | "currentSource"
  | "engineMatchedDiagnostic"
  | "currentSourceCssDiagnostic";
export interface MathWriteInput {
  source: string;
  display: "inline" | "block";
  fontSizePx: number;
  color: number;
  widthPx: number;
  profile?: MathWriteProfile;
}
export interface MathWriteIssue {
  kind: string;
  message: string;
  path?: string;
}
export interface MathWriteOutput {
  schema: number;
  source: string;
  display: "inline" | "block";
  profile: MathWriteProfile;
  fontSizePx: number;
  color: number;
  widthPx: number;
  engineVersion: string;
  sourceCssVersion: string;
  sourceCssSha256: string;
  engineCssSha256: string;
  originalHtml: string;
  originalError: string | null;
  fidelity:
    | "refused"
    | "engineDerivedDiagnostic"
    | "currentSourceCssDerivedDiagnostic";
  issues: MathWriteIssue[];
  /** Only the natural inline KaTeX span is measured. This is deliberately not
   * the Source inline-flex wrapper, surrounding paragraph, or display line. */
  cssGeometry?: CurrentCssGeometry;
  vector?: {
    svg: string;
    widthPx: number;
    heightPx: number;
    baselinePx: number;
    ascentPx: number;
    descentPx: number;
    paintWidthPx: number;
    paintHeightPx: number;
    paintOffsetXPx: number;
    paintOffsetYPx: number;
    paintBaselinePx: number;
    glyphs: GlyphRecord[];
    fonts: { name: string; sha256: string; unitsPerEm: number }[];
    nodeCount: number;
  };
}
export interface CurrentCssGeometry {
  scope: "katexBaseInlineSpan";
  layoutModel: "blink150Linux64ths";
  cssFontSizePx: number;
  platformFontSizePx: number;
  lineHeightPx: number;
  fontBoxAscentPx: number;
  fontBoxDescentPx: number;
  ignoredInlineStruts: {
    path: string;
    authoredHeightPx: number;
    verticalAlignPx: number;
  }[];
  tables: {
    path: string;
    firstRowHeightPx: number;
    secondRowHeightPx: number;
  }[];
}
export interface GlyphRecord {
  text: string;
  codepoint: number;
  glyphId: number;
  font: string;
  x: number;
  baseline: number;
  fontSize: number;
  advance: number;
}
const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const sourceCssProfiles = mathCssConsumers(sourceCss);
export const sourceCssVersion = sourceCssProfiles.equation;
export const provenance = {
  engineVersion: katex.version,
  sourceCssVersion,
  sourceCssSha256: sha(sourceCss),
  engineCssSha256: sha(engineCss),
};
const LIMITS = {
  source: 64 * 1024,
  nodes: 20000,
  glyphs: 12000,
  svg: 8 * 1024 * 1024,
  dimension: 4096,
};
const assets: Record<string, string> = {
  "AMS-Regular": ams,
  "Caligraphic-Regular": cal,
  "Caligraphic-Bold": calBold,
  "Fraktur-Regular": frak,
  "Fraktur-Bold": frakBold,
  "Main-Regular": main,
  "Main-Bold": mainBold,
  "Main-Italic": mainItalic,
  "Main-BoldItalic": mainBoldItalic,
  "Math-Italic": math,
  "Math-BoldItalic": mathBold,
  "SansSerif-Regular": sans,
  "SansSerif-Bold": sansBold,
  "SansSerif-Italic": sansItalic,
  "Script-Regular": script,
  "Typewriter-Regular": typewriter,
  "Size1-Regular": size1,
  "Size2-Regular": size2,
  "Size3-Regular": size3,
  "Size4-Regular": size4,
};
class Refusal extends Error {
  constructor(
    public kind: string,
    message: string,
    public path?: string,
  ) {
    super(message);
  }
}
type Point = { x: number; y: number; on: boolean };
/** The bundled KaTeX fonts are unhinted-outline compatible TrueType glyf fonts,
 * with no GSUB/GPOS/kern tables. No browser/system fallback is substituted. */
class TrueType {
  data: DataView;
  bytes: Uint8Array;
  tables = new Map<string, number>();
  unitsPerEm: number;
  metrics: number;
  longLoca: boolean;
  hash: string;
  constructor(
    bytes: Uint8Array,
    public name: string,
  ) {
    this.bytes = bytes;
    this.data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (this.u32(0) !== 0x00010000)
      throw new Refusal("font", `Unsupported font container ${name}`);
    for (let i = 0; i < this.u16(4); i++) {
      const off = 12 + 16 * i;
      this.tables.set(
        String.fromCharCode(...bytes.slice(off, off + 4)),
        this.u32(off + 8),
      );
    }
    for (const tag of ["GSUB", "GPOS", "kern"])
      if (this.tables.has(tag))
        throw new Refusal("font-shaping", `Font ${name} needs ${tag} shaping.`);
    this.unitsPerEm = this.u16(this.table("head") + 18);
    this.longLoca = this.i16(this.table("head") + 50) !== 0;
    this.metrics = this.u16(this.table("hhea") + 34);
    this.hash = sha(bytes);
  }
  table(tag: string) {
    const off = this.tables.get(tag);
    if (off === undefined)
      throw new Refusal("font", `${this.name}: missing ${tag}`);
    return off;
  }
  u16(off: number) {
    return this.data.getUint16(off);
  }
  i16(off: number) {
    return this.data.getInt16(off);
  }
  u32(off: number) {
    return this.data.getUint32(off);
  }
  glyph(cp: number): number {
    const cmap = this.table("cmap");
    let best = 0;
    let priority = -1;
    for (let i = 0; i < this.u16(cmap + 2); i++) {
      const entry = cmap + 4 + 8 * i;
      const sub = cmap + this.u32(entry + 4);
      const format = this.u16(sub);
      const platform = this.u16(entry);
      const encoding = this.u16(entry + 2);
      const rank = format === 12 ? 4 : format === 4 ? 2 : -1;
      if (
        (platform === 0 || (platform === 3 && [1, 10].includes(encoding))) &&
        rank > priority
      ) {
        best = sub;
        priority = rank;
      }
    }
    if (this.u16(best) === 12) {
      const count = this.u32(best + 12);
      for (let i = 0; i < count; i++) {
        const p = best + 16 + i * 12;
        const start = this.u32(p);
        const end = this.u32(p + 4);
        if (cp >= start && cp <= end) return this.u32(p + 8) + cp - start;
      }
      return 0;
    }
    const count = this.u16(best + 6) / 2;
    const ends = best + 14;
    const starts = ends + 2 * count + 2;
    const deltas = starts + 2 * count;
    const ranges = deltas + 2 * count;
    for (let i = 0; i < count; i++)
      if (cp >= this.u16(starts + 2 * i) && cp <= this.u16(ends + 2 * i)) {
        const range = this.u16(ranges + 2 * i);
        const delta = this.i16(deltas + 2 * i);
        if (!range) return (cp + delta) & 0xffff;
        const gid = this.u16(
          ranges + 2 * i + range + 2 * (cp - this.u16(starts + 2 * i)),
        );
        return gid ? (gid + delta) & 0xffff : 0;
      }
    return 0;
  }
  advance(glyph: number) {
    return this.u16(this.table("hmtx") + Math.min(glyph, this.metrics - 1) * 4);
  }
  fontBox(size: number) {
    const hhea = this.table("hhea");
    return {
      height: Math.round((this.i16(hhea + 4) * size) / this.unitsPerEm),
      depth: Math.round((-this.i16(hhea + 6) * size) / this.unitsPerEm),
    };
  }
  bounds(glyph: number) {
    const loc = this.table("loca");
    const offset = (i: number) =>
      this.longLoca ? this.u32(loc + 4 * i) : this.u16(loc + 2 * i) * 2;
    const start = offset(glyph);
    if (start === offset(glyph + 1))
      return { left: 0, top: 0, right: 0, bottom: 0 };
    const base = this.table("glyf") + start;
    // Exact glyf outline bounds, including compound/accented glyphs. KaTeX
    // height/depth/advance metrics may intentionally exclude visible overhang.
    return {
      left: this.i16(base + 2),
      bottom: this.i16(base + 4),
      right: this.i16(base + 6),
      top: this.i16(base + 8),
    };
  }
  contours(glyph: number, depth = 0): Point[][] {
    if (depth > 16)
      throw new Refusal("font", "Compound font outline recursion limit.");
    const loc = this.table("loca");
    const offset = (i: number) =>
      this.longLoca ? this.u32(loc + 4 * i) : this.u16(loc + 2 * i) * 2;
    const start = offset(glyph);
    if (start === offset(glyph + 1)) return [];
    const base = this.table("glyf") + start;
    const count = this.i16(base);
    if (count < 0) {
      let p = base + 10;
      const contours: Point[][] = [];
      let flags: number;
      do {
        flags = this.u16(p);
        const part = this.u16(p + 2);
        p += 4;
        if (!(flags & 2))
          throw new Refusal(
            "font",
            "Point-attached compound outlines are unsupported.",
          );
        let x: number, y: number;
        if (flags & 1) {
          x = this.i16(p);
          y = this.i16(p + 2);
          p += 4;
        } else {
          x = this.data.getInt8(p);
          y = this.data.getInt8(p + 1);
          p += 2;
        }
        let a = 1,
          b = 0,
          c = 0,
          d = 1;
        const f2 = () => {
          const n = this.i16(p) / 16384;
          p += 2;
          return n;
        };
        if (flags & 8) a = d = f2();
        else if (flags & 64) {
          a = f2();
          d = f2();
        } else if (flags & 128) {
          a = f2();
          b = f2();
          c = f2();
          d = f2();
        }
        if (flags & 0x0800) [x, y] = [a * x + c * y, b * x + d * y];
        for (const contour of this.contours(part, depth + 1))
          contours.push(
            contour.map((q) => ({
              x: a * q.x + c * q.y + x,
              y: b * q.x + d * q.y + y,
              on: q.on,
            })),
          );
      } while (flags & 32);
      return contours;
    }
    if (!count) return [];
    const ends = Array.from({ length: count }, (_, i) =>
      this.u16(base + 10 + 2 * i),
    );
    let p = base + 10 + 2 * count;
    const instructions = this.u16(p);
    p += 2 + instructions;
    const total = ends.at(-1)! + 1;
    const flags: number[] = [];
    while (flags.length < total) {
      const flag = this.data.getUint8(p++);
      flags.push(flag);
      if (flag & 8) {
        const repeat = this.data.getUint8(p++);
        for (let i = 0; i < repeat; i++) flags.push(flag);
      }
    }
    if (flags.length !== total)
      throw new Refusal("font", "Invalid glyph flags.");
    const xs: number[] = [],
      ys: number[] = [];
    let value = 0;
    for (const flag of flags) {
      if (flag & 2) {
        const v = this.data.getUint8(p++);
        value += flag & 16 ? v : -v;
      } else if (!(flag & 16)) {
        value += this.i16(p);
        p += 2;
      }
      xs.push(value);
    }
    value = 0;
    for (const flag of flags) {
      if (flag & 4) {
        const v = this.data.getUint8(p++);
        value += flag & 32 ? v : -v;
      } else if (!(flag & 32)) {
        value += this.i16(p);
        p += 2;
      }
      ys.push(value);
    }
    let first = 0;
    return ends.map((end) => {
      const contour = [];
      for (let i = first; i <= end; i++)
        contour.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
      first = end + 1;
      return contour;
    });
  }
  outline(glyph: number) {
    const midpoint = (a: Point, b: Point): Point => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      on: true,
    });
    return this.contours(glyph)
      .map((points) => {
        const start = points[0].on
          ? points[0]
          : points.at(-1)!.on
            ? points.at(-1)!
            : midpoint(points.at(-1)!, points[0]);
        const sequence = points[0].on
          ? points.slice(1)
          : points.at(-1)!.on
            ? points.slice(0, -1)
            : points;
        const ring = [...sequence, start];
        let out = `M${start.x} ${start.y}`;
        for (let i = 0; i < ring.length; i++) {
          const q = ring[i];
          if (q.on) out += `L${q.x} ${q.y}`;
          else {
            const next = ring[i + 1];
            if (!next) throw new Refusal("font", "Unclosed glyph contour.");
            const end = next.on ? next : midpoint(q, next);
            out += `Q${q.x} ${q.y} ${end.x} ${end.y}`;
            if (next.on) i++;
          }
        }
        return out + "Z";
      })
      .join("");
  }
}
const fontCache = new Map<string, TrueType>();
async function font(name: string) {
  if (!fontCache.has(name)) {
    const path = assets[name];
    if (!path) throw new Refusal("font", `No exact bundled face: ${name}`);
    fontCache.set(name, new TrueType(await Bun.file(path).bytes(), name));
  }
  return fontCache.get(name)!;
}

type Node = {
  classes?: string[];
  style?: Record<string, string>;
  children?: Node[];
  text?: string;
  italic?: number;
  height?: number;
  depth?: number;
  attributes?: Record<string, string>;
  toMarkup?: () => string;
  constructor: { name: string };
  src?: string;
};
type Style = {
  em: number;
  family: string;
  weight: string;
  shape: string;
  align: string;
  color: string;
  css: Record<string, string>;
};
type Paint = {
  body: string;
  x: number;
  y: number;
  glyph?: GlyphRecord;
  bounds: { left: number; top: number; right: number; bottom: number };
};
type Box = { width: number; height: number; depth: number; paints: Paint[] };
const cssRules = [
  ...engineCss
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g),
].flatMap((match) => {
  if (match[1].trim().startsWith("@")) return [];
  const declarations: Record<string, string> = {};
  for (const declaration of match[2].split(";")) {
    const index = declaration.indexOf(":");
    if (index > 0)
      declarations[declaration.slice(0, index).trim()] = declaration
        .slice(index + 1)
        .trim();
  }
  return match[1]
    .split(",")
    .map((selector) => ({ selector: selector.trim(), declarations }));
});
function matchesSimple(node: Node, selector: string): boolean {
  if (selector.includes("::")) return false;
  const not = [...selector.matchAll(/:not\(\.([\w-]+)\)/g)].map((m) => m[1]);
  selector = selector.replace(/:not\([^)]*\)/g, "");
  if (selector.includes(":")) return false;
  if (not.some((c) => node.classes?.includes(c))) return false;
  const tag = selector.match(/^[a-z]+/)?.[0];
  if (
    tag &&
    { svg: "SvgNode", path: "PathNode", img: "Img", span: "Span" }[tag] !==
      node.constructor.name
  )
    return false;
  return [...selector.matchAll(/\.([\w-]+)/g)].every((m) =>
    node.classes?.includes(m[1]),
  );
}
function matches(
  node: Node,
  parents: Node[],
  selector: string,
  simple = matchesSimple,
) {
  const pieces = selector.replace(/>/g, " > ").trim().split(/\s+/);
  let i = pieces.length - 1;
  if (!simple(node, pieces[i--])) return false;
  let p = parents.length - 1;
  while (i >= 0) {
    if (pieces[i] === ">") {
      i--;
      if (p < 0 || !simple(parents[p--], pieces[i--])) return false;
    } else {
      while (p >= 0 && !simple(parents[p], pieces[i])) p--;
      if (p-- < 0) return false;
      i--;
    }
  }
  return true;
}
function length(value: string | undefined, em: number, basis?: number): number {
  if (!value || value === "auto" || value === "min-content") return 0;
  if (value === "100%" && basis !== undefined) return basis;
  const m = value.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))(em|px)?$/);
  if (!m) throw new Refusal("css-length", `Unsupported CSS length: ${value}`);
  return Number(m[1]) * (m[2] === "em" ? em : 1);
}
function styled(node: Node, parents: Node[], inherited: Style): Style {
  const css: Record<string, string> = {};
  for (const rule of cssRules)
    if (matches(node, parents, rule.selector))
      Object.assign(css, rule.declarations);
  for (const [key, value] of Object.entries(node.style ?? {}))
    css[key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())] = value;
  let em = inherited.em,
    family = inherited.family,
    weight = inherited.weight,
    shape = inherited.shape;
  if (css.font) {
    const m = css.font.match(/^normal ([\d.]+)em ([^,]+)/);
    if (!m)
      throw new Refusal("css-font", `Unsupported font shorthand ${css.font}`);
    em *= Number(m[1]);
    family = m[2];
    weight = "400";
    shape = "normal";
  }
  if (css["font-size"]) em *= length(css["font-size"], 1);
  if (css["font-family"]) family = css["font-family"];
  weight = css["font-weight"] ?? weight;
  shape = css["font-style"] ?? shape;
  const color = css.color ?? inherited.color;
  if (!/^(#[\da-f]{3,8}|[a-z]+)$/i.test(color) || color === "url")
    throw new Refusal("css-color", "Unsupported authored color.");
  return {
    em,
    family,
    weight,
    shape,
    color,
    align: css["text-align"] ?? inherited.align,
    css,
  };
}
function face(style: Style) {
  const family = style.family.replace(/^KaTeX_/, "");
  const bold = ["bold", "700"].includes(style.weight);
  const italic = style.shape === "italic";
  return `${family}-${bold && italic ? "BoldItalic" : bold ? "Bold" : italic ? "Italic" : "Regular"}`;
}
const classes = new Set(
  "katex katex-display katex-html katex-base katex-strut mord mbin mrel mopen mclose mop minner mpunct mtight mspace nobreak allowbreak text textbf textit textrm textsf texttt mathnormal mathit mathrm mathbf boldsymbol amsrm mathbb textbb mathcal mathfrak textfrak mathboldfrak textboldfrak mathtt mathscr textscr mathsf textsf mathboldsf textboldsf mathsfit mathitsf textitsf mainrm vlist-t vlist-t2 vlist-r vlist vlist-s pstrut msupsub mfrac frac-line sqrt katex-root katex-sizing fontsize-ensurer delimsizing mult delim-size1 delim-size4 nulldelimiter delimcenter op-symbol small-op large-op op-limits katex-accent accent-body accent-full svg-align hide-tail katex-stretchy mtable col-align-c col-align-l col-align-r arraycolsep katex-overline overline-line katex-underline underline-line katex-rule".split(
    " ",
  ),
);
function allowed(node: Node, path: string) {
  if (node.src || node.attributes?.href)
    throw new Refusal(
      "external-object",
      "No external objects in native math.",
      path,
    );
  for (const c of node.classes ?? [])
    if (c && !classes.has(c) && !/^(reset-size|size)([1-9]|10|11)$/.test(c))
      throw new Refusal(
        "unsupported-structure",
        `Unimplemented KaTeX class: ${c}`,
        path,
      );
  if (node.style?.textShadow || node.style?.position === "absolute")
    throw new Refusal(
      "unsupported-structure",
      "Authored shadow/absolute object needs a dedicated CSS implementation.",
      path,
    );
}
function moved(paints: Paint[], x: number, y: number): Paint[] {
  return paints.map((p) => ({
    ...p,
    x: p.x + x,
    y: p.y + y,
    bounds: {
      left: p.bounds.left + x,
      top: p.bounds.top + y,
      right: p.bounds.right + x,
      bottom: p.bounds.bottom + y,
    },
    glyph: p.glyph
      ? { ...p.glyph, x: p.glyph.x + x, baseline: p.glyph.baseline + y }
      : undefined,
  }));
}
function encode(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}

class Layout {
  count = 0;
  glyphs = 0;
  used = new Map<string, TrueType>();
  async box(
    node: Node,
    parents: Node[],
    inherited: Style,
    path: string,
    basis?: number,
  ): Promise<Box> {
    if (++this.count > LIMITS.nodes)
      throw new Refusal("budget", "Math tree node budget exceeded.", path);
    allowed(node, path);
    const style = styled(node, parents, inherited);
    const css = style.css;
    const children = node.children ?? [],
      chain = [...parents, node];
    const left = length(css["margin-left"], style.em),
      right =
        length(css["margin-right"], style.em) + (node.italic ?? 0) * style.em;
    const padding = length(css["padding-left"], style.em);
    const ox = length(css.left, style.em),
      oy = length(css.top, style.em);
    let box: Box;
    if (node.text !== undefined) {
      const f = await font(face(style));
      this.used.set(f.name, f);
      let x = 0;
      const paints: Paint[] = [];
      for (const char of node.text) {
        if (char === "\u200b") continue;
        if (++this.glyphs > LIMITS.glyphs)
          throw new Refusal("budget", "Math glyph budget exceeded.", path);
        const cp = char.codePointAt(0)!;
        const gid = f.glyph(cp);
        if (!gid)
          throw new Refusal(
            "glyph",
            `No exact ${f.name} glyph for U+${cp.toString(16)}.`,
            path,
          );
        const advance = (f.advance(gid) / f.unitsPerEm) * style.em;
        const outline = f.outline(gid),
          rawBounds = f.bounds(gid),
          scale = style.em / f.unitsPerEm;
        const glyph: GlyphRecord = {
          text: char,
          codepoint: cp,
          glyphId: gid,
          font: f.name,
          x,
          baseline: 0,
          fontSize: style.em,
          advance,
        };
        paints.push({
          x,
          y: 0,
          glyph,
          bounds: {
            left: x + rawBounds.left * scale,
            top: -rawBounds.top * scale,
            right: x + rawBounds.right * scale,
            bottom: -rawBounds.bottom * scale,
          },
          body: `<path fill="${encode(style.color)}" transform="scale(${scale} ${-scale})" d="${outline}"/>`,
        });
        x += advance;
      }
      box = {
        width: x,
        height: (node.height ?? 0) * style.em,
        depth: (node.depth ?? 0) * style.em,
        paints,
      };
    } else if (node.constructor.name === "SvgNode") {
      if (basis === undefined || !node.toMarkup)
        throw new Refusal(
          "svg-geometry",
          "SVG needs its real containing width.",
          path,
        );
      const height = length(node.attributes?.height, style.em);
      const markup = node.toMarkup();
      if (/foreignObject|<image|href=|url\(/i.test(markup))
        throw new Refusal(
          "svg-external",
          "Math SVG is not self-contained.",
          path,
        );
      // Original engine CSS explicitly makes every SVG path stroke:none.
      // Preserve that paint rule when the HTML stylesheet is absent; inheriting
      // the parent SVG stroke would thicken radicals/stretchy paths by 1px.
      const inner = markup
        .slice(markup.indexOf(">") + 1, markup.lastIndexOf("</svg>"))
        .replace(/<path(?=[\s>])/g, '<path stroke="none"');
      const view = node.attributes?.viewBox;
      if (!view || !/^[-\d. ]+$/.test(view))
        throw new Refusal("svg-geometry", "Invalid engine SVG viewBox.", path);
      box = {
        width: basis,
        height,
        depth: 0,
        paints: [
          {
            x: 0,
            y: -height,
            bounds: { left: 0, top: -height, right: basis, bottom: 0 },
            body: `<svg width="${basis}" height="${height}" viewBox="${view}" preserveAspectRatio="${encode(node.attributes?.preserveAspectRatio ?? "xMinYMin meet")}" fill="${encode(style.color)}" stroke="${encode(style.color)}" overflow="hidden">${inner}</svg>`,
          },
        ],
      };
    } else if (node.classes?.includes("vlist-t")) {
      const rows = children;
      const vlist = rows[0]?.children?.[0];
      if (!vlist?.classes?.includes("vlist") || rows.length > 2)
        throw new Refusal("vlist", "Unknown KaTeX table anatomy.", path);
      const wraps = vlist.children ?? [];
      const provisional: {
        child: Node;
        style: Style;
        box: Box;
        pstrut: Node;
        wrap: Node;
        parents: Node[];
        path: string;
      }[] = [];
      let width = 0;
      const vparents = [...chain, rows[0], vlist];
      const vstyle = styled(vlist, [...chain, rows[0]], style);
      for (let i = 0; i < wraps.length; i++) {
        const wrap = wraps[i],
          pstrut = wrap.children?.[0],
          child = wrap.children?.[1];
        if (
          !pstrut?.classes?.includes("pstrut") ||
          !child ||
          wrap.children?.length !== 2
        )
          throw new Refusal("vlist", "Unimplemented vertical wrapper.", path);
        const wstyle = styled(wrap, vparents, vstyle),
          cparents = [...vparents, wrap],
          cpath = `${path}/vlist/${i}`;
        const cb = await this.box(child, cparents, wstyle, cpath, 0);
        width = Math.max(
          width,
          cb.width +
            length(wstyle.css["margin-left"], wstyle.em) +
            length(wstyle.css["margin-right"], wstyle.em),
        );
        provisional.push({
          child,
          style: wstyle,
          box: cb,
          pstrut,
          wrap,
          parents: cparents,
          path: cpath,
        });
      }
      const paints: Paint[] = [];
      for (const item of provisional) {
        // Percent-width rules/SVG use the table's measured content width, never
        // a formula-specific numerator/radical approximation.
        const cb = await this.box(
          item.child,
          item.parents,
          item.style,
          item.path,
          width,
        );
        const ml = length(item.style.css["margin-left"], item.style.em),
          mr = length(item.style.css["margin-right"], item.style.em);
        const align = item.style.align;
        const offset =
          ml +
          (align === "center"
            ? (width - ml - mr - cb.width) / 2
            : align === "right"
              ? width - ml - mr - cb.width
              : 0);
        const baseline =
          length(item.wrap.style?.top, item.style.em) +
          length(item.pstrut.style?.height, item.style.em);
        paints.push(...moved(cb.paints, offset, baseline));
      }
      // The browser table contains a real 2px vlist-s column. vlist-t2's -2px
      // outer margin cancels it; omitting one while keeping the other loses
      // width for every fraction/matrix column.
      const side = rows[0]?.children?.[1];
      const sideWidth = side?.classes?.includes("vlist-s")
        ? length(styled(side, [...chain, rows[0]], style).css.width, style.em)
        : 0;
      box = {
        width: width + sideWidth,
        height: (node.height ?? 0) * inherited.em,
        depth: (node.depth ?? 0) * inherited.em,
        paints,
      };
    } else if (
      node.classes?.includes("katex-strut") ||
      node.classes?.includes("pstrut") ||
      node.classes?.includes("vlist-s")
    ) {
      box = { width: 0, height: 0, depth: 0, paints: [] };
    } else if (css["border-bottom-width"] || css["border-top-width"]) {
      if (
        children.length ||
        (css["border-bottom-style"] && css["border-bottom-style"] !== "solid")
      )
        throw new Refusal("rule", "Unsupported math border structure.", path);
      const thickness = Math.max(
        1,
        length(css["border-bottom-width"] ?? css["border-top-width"], style.em),
      );
      const width =
        css.width === "100%"
          ? (basis ?? 0)
          : length(css.width, style.em, basis);
      box = {
        width,
        height: thickness,
        depth: 0,
        paints: width
          ? [
              {
                x: 0,
                y: -thickness,
                bounds: { left: 0, top: -thickness, right: width, bottom: 0 },
                body: `<rect width="${width}" height="${thickness}" fill="${encode(style.color)}"/>`,
              },
            ]
          : [],
      };
    } else {
      const isSvg = children.some(
        (child) => child.constructor.name === "SvgNode",
      );
      if (isSvg && children.length !== 1)
        throw new Refusal(
          "svg-geometry",
          "Multipart SVG layout is not implemented.",
          path,
        );
      let width = padding,
        height = 0,
        depth = 0;
      const paints: Paint[] = [];
      const allocated =
        css.width === "100%"
          ? (basis ?? 0)
          : Math.max(
              length(css.width, style.em, basis),
              length(css["min-width"], style.em, basis),
              isSvg ? (basis ?? 0) : 0,
            );
      for (let i = 0; i < children.length; i++) {
        const cb = await this.box(
          children[i],
          chain,
          style,
          `${path}/${i}`,
          isSvg ? allocated : basis,
        );
        paints.push(...moved(cb.paints, width, 0));
        width += cb.width;
        height = Math.max(height, cb.height);
        depth = Math.max(depth, cb.depth);
      }
      width = Math.max(width, allocated);
      if (css.width === "0" || css.width === "0px") width = 0;
      if (css.height) {
        height = length(css.height, style.em);
        depth = 0;
      }
      box = { width, height, depth, paints };
    }
    return {
      width: box.width + left + right,
      height: box.height - oy,
      depth: box.depth + oy,
      paints: moved(box.paints, left + ox, oy),
    };
  }
}

/** Exact frozen vendor cascade, not the engine-matched stylesheet. Only the
 * selector grammar actually present in this file is admitted. Font-face URLs
 * never execute: glyphs come from the separately embedded, hashed TTF bytes. */
const CURRENT_CSS_SHA256 =
  "1d0be692cde606a132f39e5150d8c81d83649ab0e6825329e93c2a6dcffcbe0d";
const CURRENT_CSS_LIMITS = {
  bytes: 65536,
  rules: 512,
  selectors: 1024,
  declarations: 4096,
  selectorBytes: 256,
};
type CurrentRule = {
  selector: string;
  declarations: { key: string; value: string; important: boolean }[];
  specificity: number;
  order: number;
};
let currentRules: CurrentRule[] | undefined;
function currentCssRules(): CurrentRule[] {
  if (currentRules) return currentRules;
  if (
    sha(sourceCss) !== CURRENT_CSS_SHA256 ||
    Buffer.byteLength(sourceCss) > CURRENT_CSS_LIMITS.bytes
  )
    throw new Refusal(
      "current-css-provenance",
      "The current-CSS diagnostic requires the exact retained vendor 0.16.47 stylesheet.",
    );
  const root = postcss.parse(sourceCss);
  const result: CurrentRule[] = [];
  let declarations = 0,
    rules = 0;
  for (const item of root.nodes) {
    if (item.type === "comment") continue;
    if (item.type === "atrule" && item.name === "font-face") continue;
    if (item.type !== "rule")
      throw new Refusal(
        "current-css-cascade",
        "Unimplemented stylesheet at-rule or nested cascade.",
      );
    if (++rules > CURRENT_CSS_LIMITS.rules)
      throw new Refusal("budget", "Current-CSS rule budget exceeded.");
    const values: CurrentRule["declarations"] = [];
    for (const entry of item.nodes) {
      if (entry.type === "comment") continue;
      if (entry.type !== "decl")
        throw new Refusal(
          "current-css-cascade",
          "Nested current-CSS rule is unsupported.",
        );
      if (++declarations > CURRENT_CSS_LIMITS.declarations)
        throw new Refusal("budget", "Current-CSS declaration budget exceeded.");
      values.push({
        key: entry.prop,
        value: entry.value,
        important: entry.important,
      });
    }
    for (const selector of item.selectors) {
      if (
        selector.length > CURRENT_CSS_LIMITS.selectorBytes ||
        result.length >= CURRENT_CSS_LIMITS.selectors
      )
        throw new Refusal("budget", "Current-CSS selector budget exceeded.");
      // Pseudo-elements are intentionally not painted. Their corresponding
      // structures are refused before layout; none occurs in admitted trees.
      const ordinary = selector
        .replace(/:not\(\.[\w-]+\)/g, "")
        .replace(/::?(before|after)$/, "");
      if (!/^[\w.*\s>-]+$/.test(ordinary))
        throw new Refusal(
          "current-css-cascade",
          `Unimplemented selector: ${selector}`,
        );
      const specificity =
        [...selector.matchAll(/\.[\w-]+/g)].length * 100 +
        [...ordinary.matchAll(/(?:^|[\s>])([a-z][\w-]*)/g)].length;
      result.push({
        selector,
        declarations: values,
        specificity,
        order: result.length,
      });
    }
  }
  currentRules = result;
  return result;
}
function currentSimple(node: Node, selector: string): boolean {
  if (/::?(before|after)$/.test(selector)) return false;
  const not = [...selector.matchAll(/:not\(\.([\w-]+)\)/g)].map(
    (match) => match[1],
  );
  selector = selector.replace(/:not\([^)]*\)/g, "");
  if (not.some((value) => node.classes?.includes(value))) return false;
  const tag = selector.match(/^[a-z]+/)?.[0];
  if (
    tag &&
    !{
      span: ["Span", "SymbolNode"],
      svg: ["SvgNode"],
      path: ["PathNode"],
      img: ["Img"],
    }[tag]?.includes(node.constructor.name)
  )
    return false;
  return [...selector.matchAll(/\.([\w-]+)/g)].every((match) =>
    node.classes?.includes(match[1]),
  );
}
type CurrentStyle = Style & { lineHeightFactor: number };
function currentStyled(
  node: Node,
  parents: Node[],
  inherited: CurrentStyle,
): CurrentStyle {
  const winners = new Map<
    string,
    { value: string; important: boolean; specificity: number; order: number }
  >();
  const apply = (
    key: string,
    value: string,
    important: boolean,
    specificity: number,
    order: number,
  ) => {
    const previous = winners.get(key);
    if (
      !previous ||
      (important !== previous.important
        ? important
        : specificity !== previous.specificity
          ? specificity > previous.specificity
          : order >= previous.order)
    )
      winners.set(key, { value, important, specificity, order });
  };
  for (const rule of currentCssRules())
    if (matches(node, parents, rule.selector, currentSimple))
      for (const declaration of rule.declarations)
        apply(
          declaration.key,
          declaration.value,
          declaration.important,
          rule.specificity,
          rule.order,
        );
  // SymbolNode.toMarkup writes makeEm(italic) before its own inline styles.
  if ((node.italic ?? 0) > 0)
    apply(
      "margin-right",
      `${Number(node.italic!.toFixed(4))}em`,
      false,
      10000,
      -1,
    );
  for (const [key, value] of Object.entries(node.style ?? {}))
    apply(
      key.replace(/[A-Z]/g, (char) => "-" + char.toLowerCase()),
      value,
      false,
      10000,
      10000,
    );
  const css = Object.fromEntries(
    [...winners].map(([key, item]) => [key, item.value]),
  );
  let { em, family, weight, shape, lineHeightFactor } = inherited;
  if (css.font) {
    const match = css.font.match(/^normal ([\d.]+)em ([^,]+)/);
    if (!match)
      throw new Refusal(
        "css-font",
        `Unsupported current-CSS font shorthand ${css.font}`,
      );
    em *= Number(match[1]);
    family = match[2];
    weight = "400";
    shape = "normal";
  }
  if (css["font-size"]) {
    const value = css["font-size"].match(/^([\d.]+)(em|px)$/);
    if (!value)
      throw new Refusal(
        "css-font",
        `Unsupported current-CSS font-size ${css["font-size"]}`,
      );
    em = Number(value[1]) * (value[2] === "em" ? em : 1);
  }
  if (css["line-height"]) {
    if (!/^\d+(?:\.\d+)?$/.test(css["line-height"]))
      throw new Refusal(
        "current-css-flow",
        "Only the retained unitless KaTeX line-height is implemented.",
      );
    lineHeightFactor = Number(css["line-height"]);
  }
  family = (css["font-family"] ?? family)
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
  weight = css["font-weight"] ?? weight;
  shape = css["font-style"] ?? shape;
  const color = css.color ?? inherited.color;
  if (!/^(#[\da-f]{3,8}|[a-z]+)$/i.test(color) || color === "url")
    throw new Refusal("css-color", "Unsupported authored color.");
  return {
    em,
    family,
    weight,
    shape,
    lineHeightFactor,
    color,
    align: css["text-align"] ?? inherited.align,
    css,
  };
}
// The retained Chrome/Linux probe uses LayoutUnit 1/64px. CSS lengths truncate
// towards zero; platform font sizes truncate before font shaping; individual
// inline text runs round their occupied advance up. This is an explicit
// browser-derived diagnostic model, not a native text/raster claim.
const cssUnit = (value: number) => Math.trunc(value * 64) / 64;
const runUnit = (value: number) => Math.ceil(value * 64) / 64;
const currentLength = (value: string | undefined, em: number, basis?: number) =>
  cssUnit(length(value, em, basis));
const currentClasses = new Set(
  "katex katex-html katex-base katex-strut mord mbin mrel mopen mclose mop minner mpunct mtight mspace nobreak allowbreak text textbf textit textrm textsf texttt mathnormal mathit mathrm mathbf boldsymbol amsrm mathbb textbb mathcal mathfrak textfrak mathboldfrak textboldfrak mathtt mathscr textscr mathsf mathboldsf textboldsf mathsfit mathitsf mainrm vlist-t vlist-t2 vlist-r vlist vlist-s pstrut msupsub mfrac frac-line sqrt katex-sizing fontsize-ensurer delimsizing mult delim-size1 delim-size4 nulldelimiter delimcenter svg-align hide-tail mtable col-align-c col-align-l col-align-r arraycolsep".split(
    " ",
  ),
);
class CurrentCssLayout {
  count = 0;
  glyphs = 0;
  used = new Map<string, TrueType>();
  struts: CurrentCssGeometry["ignoredInlineStruts"] = [];
  tables: CurrentCssGeometry["tables"] = [];
  async box(
    node: Node,
    parents: Node[],
    inherited: CurrentStyle,
    path: string,
    basis?: number,
    measuring = false,
  ): Promise<Box> {
    if (++this.count > LIMITS.nodes)
      throw new Refusal("budget", "Math tree node budget exceeded.", path);
    allowed(node, path);
    for (const value of node.classes ?? [])
      if (
        value &&
        !currentClasses.has(value) &&
        !/^(reset-size|size)([1-9]|10|11)$/.test(value)
      )
        throw new Refusal(
          "current-css-structure",
          `Current-CSS overlap, delimiter, operator or decoration not implemented: ${value}`,
          path,
        );
    const style = currentStyled(node, parents, inherited),
      css = style.css,
      chain = [...parents, node],
      children = node.children ?? [];
    const left = currentLength(css["margin-left"], style.em),
      right = currentLength(css["margin-right"], style.em);
    const ox =
      css.position === "relative" ? currentLength(css.left, style.em) : 0;
    const oy =
      css.position === "relative" ? currentLength(css.top, style.em) : 0;
    let box: Box;
    const display = css.display ?? "inline";
    if (node.text !== undefined) {
      const f = await font(face(style));
      this.used.set(f.name, f);
      let x = 0;
      const paints: Paint[] = [],
        size = cssUnit(style.em);
      for (const char of node.text) {
        if (char === "\u200b") continue;
        if (++this.glyphs > LIMITS.glyphs)
          throw new Refusal("budget", "Math glyph budget exceeded.", path);
        const cp = char.codePointAt(0)!,
          gid = f.glyph(cp);
        if (!gid)
          throw new Refusal(
            "glyph",
            `No exact ${f.name} glyph for U+${cp.toString(16)}.`,
            path,
          );
        const advance = (f.advance(gid) / f.unitsPerEm) * size,
          scale = size / f.unitsPerEm,
          raw = f.bounds(gid);
        paints.push({
          x,
          y: 0,
          glyph: {
            text: char,
            codepoint: cp,
            glyphId: gid,
            font: f.name,
            x,
            baseline: 0,
            fontSize: size,
            advance,
          },
          bounds: {
            left: x + raw.left * scale,
            top: -raw.top * scale,
            right: x + raw.right * scale,
            bottom: -raw.bottom * scale,
          },
          body: `<path fill="${encode(style.color)}" transform="scale(${scale} ${-scale})" d="${f.outline(gid)}"/>`,
        });
        x += advance;
      }
      box = { width: runUnit(x), ...f.fontBox(size), paints };
    } else if (node.classes?.includes("vlist-t")) {
      if (
        display !== "inline-table" ||
        css["table-layout"] !== "fixed" ||
        css["border-collapse"] !== "collapse"
      )
        throw new Refusal(
          "current-css-vlist",
          "Unsupported current-CSS table cascade.",
          path,
        );
      const rows = children,
        vlist = rows[0]?.children?.[0];
      if (
        !vlist?.classes?.includes("vlist") ||
        rows.length < 1 ||
        rows.length > 2
      )
        throw new Refusal(
          "current-css-vlist",
          "Unsupported current-CSS table anatomy.",
          path,
        );
      const rowStyle = currentStyled(rows[0], chain, style),
        vparents = [...chain, rows[0]],
        cellStyle = currentStyled(vlist, vparents, rowStyle);
      if (
        rowStyle.css.display !== "table-row" ||
        cellStyle.css.display !== "table-cell" ||
        cellStyle.css["vertical-align"] !== "bottom"
      )
        throw new Refusal(
          "current-css-vlist",
          "Unsupported current-CSS table row/cell.",
          path,
        );
      const wraps = vlist.children ?? [],
        prepared: {
          child: Node;
          wrap: Node;
          strut: Node;
          style: CurrentStyle;
          parents: Node[];
          path: string;
          width: number;
        }[] = [];
      let width = 0;
      for (let i = 0; i < wraps.length; i++) {
        const wrap = wraps[i],
          strut = wrap.children?.[0],
          child = wrap.children?.[1],
          wparents = [...vparents, vlist];
        if (
          !strut?.classes?.includes("pstrut") ||
          !child ||
          wrap.children?.length !== 2
        )
          throw new Refusal(
            "current-css-vlist",
            "Unsupported current-CSS vertical wrapper.",
            path,
          );
        const wstyle = currentStyled(wrap, wparents, cellStyle);
        if (
          wstyle.css.display !== "block" ||
          wstyle.css.height !== "0" ||
          wstyle.css.position !== "relative"
        )
          throw new Refusal(
            "current-css-vlist",
            "Vertical wrapper lacks the retained zero-height block rules.",
            path,
          );
        const cparents = [...wparents, wrap],
          cpath = `${path}/vlist/${i}`,
          cb = await this.box(child, cparents, wstyle, cpath, 0, true);
        width = Math.max(
          width,
          cb.width +
            currentLength(wstyle.css["margin-left"], wstyle.em) +
            currentLength(wstyle.css["margin-right"], wstyle.em),
        );
        prepared.push({
          child,
          wrap,
          strut,
          style: wstyle,
          parents: cparents,
          path: cpath,
          width: cb.width,
        });
      }
      const paints: Paint[] = [];
      for (const item of prepared) {
        const cb = await this.box(
          item.child,
          item.parents,
          item.style,
          item.path,
          width,
          measuring,
        );
        const ml = currentLength(item.style.css["margin-left"], item.style.em),
          mr = currentLength(item.style.css["margin-right"], item.style.em);
        const offset =
          ml +
          cssUnit(
            item.style.align === "center"
              ? (width - ml - mr - cb.width) / 2
              : item.style.align === "right"
                ? width - ml - mr - cb.width
                : 0,
          );
        const pstyle = currentStyled(item.strut, item.parents, item.style);
        if (
          pstyle.css.display !== "inline-block" ||
          pstyle.css.width !== "0" ||
          pstyle.css.overflow !== "hidden"
        )
          throw new Refusal(
            "current-css-vlist",
            "Vertical baseline strut lacks the retained inline-block rules.",
            path,
          );
        const baseline =
          currentLength(item.style.css.top, item.style.em) +
          currentLength(pstyle.css.height, pstyle.em);
        paints.push(...moved(cb.paints, offset, baseline));
      }
      const first = currentLength(cellStyle.css.height, cellStyle.em);
      let second = 0;
      if (rows.length === 2) {
        const cell = rows[1]?.children?.[0];
        if (
          rows[1].children?.length !== 1 ||
          !cell?.classes?.includes("vlist") ||
          cell.children?.length !== 1 ||
          cell.children[0].children?.length
        )
          throw new Refusal(
            "current-css-vlist",
            "Unsupported second table row.",
            path,
          );
        const secondStyle = currentStyled(
          cell,
          [...chain, rows[1]],
          currentStyled(rows[1], chain, style),
        );
        second = currentLength(secondStyle.css.height, secondStyle.em);
      }
      if (!measuring)
        this.tables.push({
          path,
          firstRowHeightPx: first,
          secondRowHeightPx: second,
        });
      const side = rows[0]?.children?.[1];
      if (
        rows[0].children!.length > 2 ||
        (side && !side.classes?.includes("vlist-s"))
      )
        throw new Refusal(
          "current-css-vlist",
          "Unsupported table side cell.",
          path,
        );
      const sideWidth = side
        ? currentLength(
            currentStyled(side, [...chain, rows[0]], rowStyle).css.width,
            style.em,
          )
        : 0;
      box = { width: width + sideWidth, height: first, depth: second, paints };
    } else if (node.classes?.includes("katex-strut")) {
      if (display !== "inline")
        throw new Refusal(
          "current-css-strut",
          "Current-CSS inline strut changed display.",
          path,
        );
      if (!measuring)
        this.struts.push({
          path,
          authoredHeightPx: length(css.height, style.em),
          verticalAlignPx: currentLength(css["vertical-align"], style.em),
        });
      // Inline non-replaced spans ignore authored height; retain the actual
      // font box separately and keep vertical-align out of their advance.
      const f = await font(face(style));
      this.used.set(f.name, f);
      box = { width: 0, ...f.fontBox(cssUnit(style.em)), paints: [] };
    } else if (node.constructor.name === "SvgNode") {
      if (
        parents.at(-1)?.classes?.includes("hide-tail") !== true ||
        basis === undefined ||
        !node.toMarkup
      )
        throw new Refusal(
          "current-css-svg",
          "Only an original sqrt hide-tail SVG with measured container is implemented.",
          path,
        );
      const height = currentLength(node.attributes?.height, style.em),
        markup = node.toMarkup(),
        view = node.attributes?.viewBox;
      if (
        !view ||
        !/^[-\d. ]+$/.test(view) ||
        /foreignObject|<image|href=|url\(/i.test(markup)
      )
        throw new Refusal(
          "svg-external",
          "Invalid or external current-CSS SVG.",
          path,
        );
      const inner = markup
        .slice(markup.indexOf(">") + 1, markup.lastIndexOf("</svg>"))
        .replace(/<path(?=[\s>])/g, '<path stroke="none"');
      // Absolutely positioned svg top:auto uses its zero static line position
      // inside hide-tail; the parent places its height relative to baseline.
      box = {
        width: basis,
        height,
        depth: 0,
        paints: [
          {
            x: 0,
            y: -height,
            bounds: { left: 0, top: -height, right: basis, bottom: 0 },
            body: `<svg width="${basis}" height="${height}" viewBox="${view}" preserveAspectRatio="${encode(node.attributes?.preserveAspectRatio ?? "xMinYMin meet")}" fill="${encode(style.color)}" stroke="${encode(style.color)}" overflow="hidden">${inner}</svg>`,
          },
        ],
      };
    } else if (css["border-bottom-width"] || css["border-top-width"]) {
      if (
        children.length ||
        css["border-bottom-style"] !== "solid" ||
        display !== "inline-block"
      )
        throw new Refusal(
          "current-css-rule",
          "Unsupported current-CSS border rule.",
          path,
        );
      const thickness = Math.max(
        1,
        Math.floor(length(css["border-bottom-width"], style.em)),
      );
      const width =
        css.width === "100%"
          ? (basis ?? 0)
          : currentLength(css.width, style.em, basis);
      box = {
        width,
        height: thickness,
        depth: 0,
        paints: width
          ? [
              {
                x: 0,
                y: -thickness,
                bounds: { left: 0, top: -thickness, right: width, bottom: 0 },
                body: `<rect width="${width}" height="${thickness}" fill="${encode(style.color)}"/>`,
              },
            ]
          : [],
      };
    } else {
      if (
        !["inline", "inline-block"].includes(display) ||
        (css["vertical-align"] && css["vertical-align"] !== "baseline")
      )
        throw new Refusal(
          "current-css-flow",
          `Unsupported current-CSS flow: ${display}/${css["vertical-align"] ?? "baseline"}`,
          path,
        );
      const f = await font(face(style));
      this.used.set(f.name, f);
      let width = currentLength(css["padding-left"], style.em),
        height = 0,
        depth = 0;
      const paints: Paint[] = [];
      const isSvg = children.some(
        (child) => child.constructor.name === "SvgNode",
      );
      if (
        isSvg &&
        (children.length !== 1 || !node.classes?.includes("hide-tail"))
      )
        throw new Refusal(
          "current-css-svg",
          "Unsupported current-CSS SVG container.",
          path,
        );
      const allocated =
        css.width === "100%"
          ? (basis ?? 0)
          : Math.max(
              currentLength(css.width, style.em, basis),
              currentLength(css["min-width"], style.em),
              isSvg ? (basis ?? 0) : 0,
            );
      for (let i = 0; i < children.length; i++) {
        const cb = await this.box(
          children[i],
          chain,
          style,
          `${path}/${i}`,
          isSvg ? allocated : basis,
          measuring,
        );
        paints.push(...moved(cb.paints, width, 0));
        width += cb.width;
        height = Math.max(height, cb.height);
        depth = Math.max(depth, cb.depth);
      }
      if (display === "inline-block") {
        width = Math.max(width, allocated);
        if (css.width === "0" || css.width === "0px") width = 0;
        if (css.height) {
          height = currentLength(css.height, style.em);
          depth = 0;
        }
      } else {
        ({ height, depth } = f.fontBox(cssUnit(style.em)));
      }
      box = { width, height, depth, paints };
    }
    return {
      width: box.width + left + right,
      height: box.height - oy,
      depth: box.depth + oy,
      paints: moved(box.paints, left + ox, oy),
    };
  }
}

export async function renderMathWrite(
  input: MathWriteInput,
): Promise<MathWriteOutput> {
  const profile = input.profile ?? "currentSource";
  const output: MathWriteOutput = {
    schema: MATH_WRITE_SCHEMA,
    source: input.source,
    display: input.display,
    profile,
    fontSizePx: input.fontSizePx,
    color: input.color,
    widthPx: input.widthPx,
    ...provenance,
    originalHtml: "",
    originalError: null,
    fidelity: "refused",
    issues: [],
  };
  try {
    if (
      typeof input.source !== "string" ||
      Buffer.byteLength(input.source) > LIMITS.source
    )
      throw new Refusal("budget", "Math source exceeds 64 KiB.");
    if (
      !["inline", "block"].includes(input.display) ||
      ![
        "currentSource",
        "engineMatchedDiagnostic",
        "currentSourceCssDiagnostic",
      ].includes(profile)
    )
      throw new Refusal("input", "Invalid math display/profile.");
    if (
      !Number.isFinite(input.fontSizePx) ||
      input.fontSizePx < 4 ||
      input.fontSizePx > 192 ||
      !Number.isFinite(input.widthPx) ||
      input.widthPx < 1 ||
      input.widthPx > LIMITS.dimension ||
      !Number.isInteger(input.color) ||
      input.color < 0 ||
      input.color > 0xffffff
    )
      throw new Refusal("input", "Invalid math font size/width/color.");
    const original = await renderLatex(input.source, input.display);
    output.originalHtml = original.html;
    output.originalError = original.error;
    if (original.error) throw new Refusal("source", original.error);
    if (profile === "currentSource") {
      if (sourceCssVersion !== katex.version)
        throw new Refusal(
          "css-version-mismatch",
          `Current Twyne CSS ${sourceCssVersion} does not match KaTeX ${katex.version}; current Write geometry is not certified.`,
        );
      // A future Source CSS correction must not silently promote this
      // diagnostic groundwork to editor/paragraph/raster parity.
      throw new Refusal(
        "current-source-unverified",
        "Matching Source CSS alone does not certify the native Write wrapper, paragraph baseline or raster behavior.",
      );
    }
    if (katex.version !== "0.18.1")
      throw new Refusal(
        "engine-version",
        "This DOM adapter is pinned to KaTeX 0.18.1.",
      );
    if (profile === "currentSourceCssDiagnostic" && input.display === "block")
      throw new Refusal(
        "current-css-display-flow",
        "Current Source block/display line flow is not implemented; the inline natural-span diagnostic cannot stand in for it.",
      );
    const tree = (
      katex as unknown as {
        __renderToHTMLTree: (source: string, options: object) => Node;
      }
    ).__renderToHTMLTree(input.source.trim(), {
      displayMode: input.display === "block",
      output: "htmlAndMathml",
      strict: "error",
      throwOnError: true,
      trust: false,
    });
    const layout =
      profile === "currentSourceCssDiagnostic"
        ? new CurrentCssLayout()
        : new Layout();
    const initial: CurrentStyle = {
      em: input.fontSizePx,
      family: "KaTeX_Main",
      weight: "400",
      shape: "normal",
      align: "left",
      color: `#${input.color.toString(16).padStart(6, "0")}`,
      css: {},
      lineHeightFactor: 1.8,
    };
    const box = await layout.box(tree, [], initial, "root");
    let html = tree;
    if (tree.classes?.includes("katex-display")) html = tree.children![0];
    const rootEm = input.fontSizePx * 1.21;
    let ascent = (html.height ?? 0) * rootEm,
      descent = Math.max(0, (html.depth ?? 0) * rootEm);
    if (layout instanceof CurrentCssLayout) {
      const rootStyle = currentStyled(tree, [], initial),
        rootFont = await font(face(rootStyle));
      const metrics = rootFont.fontBox(cssUnit(rootStyle.em));
      ascent = metrics.height;
      descent = metrics.depth;
      if (box.width > input.widthPx)
        throw new Refusal(
          "current-css-inline-wrap",
          "Current Source wrapping between inline fragments is not implemented for this available width.",
        );
      output.cssGeometry = {
        scope: "katexBaseInlineSpan",
        layoutModel: "blink150Linux64ths",
        cssFontSizePx: rootStyle.em,
        platformFontSizePx: cssUnit(rootStyle.em),
        lineHeightPx: rootStyle.em * rootStyle.lineHeightFactor,
        fontBoxAscentPx: ascent,
        fontBoxDescentPx: descent,
        ignoredInlineStruts: layout.struts,
        tables: layout.tables,
      };
      if (
        layout.struts.some(
          (strut) =>
            !Number.isFinite(strut.authoredHeightPx + strut.verticalAlignPx) ||
            strut.authoredHeightPx < 0 ||
            strut.authoredHeightPx > LIMITS.dimension ||
            Math.abs(strut.verticalAlignPx) > LIMITS.dimension,
        ) ||
        layout.tables.some(
          (table) =>
            ![table.firstRowHeightPx, table.secondRowHeightPx].every(
              (height) =>
                Number.isFinite(height) &&
                height >= 0 &&
                height <= LIMITS.dimension,
            ),
        )
      )
        throw new Refusal(
          "budget",
          "Current-CSS strut/table metadata exceeds bounded dimensions.",
        );
    }
    const height = Math.max(ascent + descent, 1),
      width = Math.max(box.width, 1);
    if (
      !Number.isFinite(width + height + ascent) ||
      width > LIMITS.dimension ||
      height > LIMITS.dimension
    )
      throw new Refusal("budget", "Math vector exceeds bounded dimensions.");
    let paintLeft = 0,
      paintTop = -ascent,
      paintRight = width,
      paintBottom = height - ascent;
    for (const p of box.paints) {
      paintLeft = Math.min(paintLeft, p.bounds.left);
      paintTop = Math.min(paintTop, p.bounds.top);
      paintRight = Math.max(paintRight, p.bounds.right);
      paintBottom = Math.max(paintBottom, p.bounds.bottom);
    }
    const paintWidth = paintRight - paintLeft,
      paintHeight = paintBottom - paintTop;
    if (
      !Number.isFinite(paintWidth + paintHeight) ||
      paintWidth > LIMITS.dimension ||
      paintHeight > LIMITS.dimension
    )
      throw new Refusal(
        "budget",
        "Math paint frame exceeds bounded dimensions.",
      );
    const paths = box.paints
      .map(
        (p) =>
          `<g transform="translate(${p.x - paintLeft} ${p.y - paintTop})">${p.body}</g>`,
      )
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${paintWidth}" height="${paintHeight}" viewBox="0 0 ${paintWidth} ${paintHeight}" role="img"><title>${encode(input.source)}</title>${paths}</svg>`;
    if (Buffer.byteLength(svg) > LIMITS.svg)
      throw new Refusal("budget", "Math vector exceeds 8 MiB.");
    output.fidelity =
      layout instanceof CurrentCssLayout
        ? "currentSourceCssDerivedDiagnostic"
        : "engineDerivedDiagnostic";
    output.vector = {
      svg,
      widthPx: width,
      heightPx: height,
      baselinePx: ascent,
      ascentPx: ascent,
      descentPx: descent,
      paintWidthPx: paintWidth,
      paintHeightPx: paintHeight,
      paintOffsetXPx: paintLeft,
      paintOffsetYPx: paintTop + ascent,
      paintBaselinePx: -paintTop,
      glyphs: box.paints.flatMap((p) => (p.glyph ? [p.glyph] : [])),
      fonts: [...layout.used.values()].map((f) => ({
        name: f.name,
        sha256: f.hash,
        unitsPerEm: f.unitsPerEm,
      })),
      nodeCount: layout.count,
    };
  } catch (error) {
    delete output.cssGeometry;
    output.issues.push(
      error instanceof Refusal
        ? { kind: error.kind, message: error.message, path: error.path }
        : {
            kind: "adapter",
            message: error instanceof Error ? error.message : String(error),
          },
    );
  }
  return output;
}

if (import.meta.main) {
  try {
    const raw = await Bun.stdin.text();
    if (Buffer.byteLength(raw) > 128 * 1024)
      throw new Error("Math request exceeds 128 KiB.");
    const output = await renderMathWrite(JSON.parse(raw));
    process.stdout.write(JSON.stringify(output) + "\n");
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        schema: MATH_WRITE_SCHEMA,
        fatal: error instanceof Error ? error.message : String(error),
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
