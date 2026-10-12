import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import {
  renderMathWrite,
  provenance,
  type MathWriteInput,
  type MathWriteOutput,
} from "../../../tools/math-write";
import { compareGlyphs } from "./compare";
const own = import.meta.dir,
  root = resolve(own, "../../../../..");
const observed = await Bun.file(`${own}/browser-glyphs.json`).json();
const fixture: ({ id: string } & MathWriteOutput)[] = await Bun.file(
  `${own}/results.json`,
).json();
const request = (
  row: any,
  patch: Partial<MathWriteInput> = {},
): MathWriteInput => ({
  source: row.source,
  display: row.display,
  fontSizePx: row.fontSizePx ?? 18,
  color: 0x302922,
  widthPx: 910,
  profile: "currentSourceCssDiagnostic",
  ...patch,
});

test("current vendor CSS, original NodeViews and served fonts match immutable browser provenance", async () => {
  const reference = await Bun.file(`${own}/browser-provenance.json`).json();
  for (const [file, hash] of Object.entries(reference.sourceHashes))
    expect(
      createHash("sha256")
        .update(await Bun.file(join(root, file)).bytes())
        .digest("hex"),
    ).toBe(hash);
  expect(provenance.sourceCssSha256).toBe(
    "1d0be692cde606a132f39e5150d8c81d83649ab0e6825329e93c2a6dcffcbe0d",
  );
  expect(provenance.engineVersion).toBe("0.18.1");
  expect(provenance.sourceCssVersion).toBe("0.16.47");
  expect(observed.rows).toHaveLength(15);
  expect(observed.logs).toEqual([]);
  expect(observed.blocked).toEqual([]);
  expect(
    observed.requests.every((request: { url: string }) =>
      request.url.startsWith("http://127.0.0.1:5197/"),
    ),
  ).toBe(true);
  for (const row of observed.rows)
    for (const leaf of row.glyphs) {
      expect(leaf.fonts.fonts).toHaveLength(1);
      expect(leaf.fonts.fonts[0].isCustomFont).toBe(true);
      expect(leaf.fonts.fonts[0].postScriptName).toStartWith("KaTeX_");
    }
  const mathNodes = (node: any): any[] => [
    ...(["inlineMath", "blockMath"].includes(node.type) ? [node] : []),
    ...(node.content ?? []).flatMap(mathNodes),
  ];
  for (const row of observed.rows) {
    expect(mathNodes(row.json)).toHaveLength(1);
    expect(mathNodes(row.json)[0].attrs.source).toBe(row.source);
  }
});

test("all Source TTF and published WOFF2 bytes are pinned, including the inline Size3 font", async () => {
  const proof = await Bun.file(`${own}/fonts-and-css.json`).json();
  expect(proof.sourceTtf).toHaveLength(20);
  expect(proof.publishedWoff2).toHaveLength(19);
  expect(proof.embeddedWoff2).toHaveLength(1);
  for (const row of [...proof.sourceTtf, ...proof.publishedWoff2])
    expect(
      createHash("sha256")
        .update(await Bun.file(join(root, row.file)).bytes())
        .digest("hex"),
    ).toBe(row.sha256);
  for (const row of [...proof.publishedWoff2, ...proof.embeddedWoff2]) {
    expect(
      createHash("sha256")
        .update(await Bun.file(join(root, row.original)).bytes())
        .digest("hex"),
    ).toBe(row.sha256);
    expect(row.installedEngineSameBytes).toBe(true);
  }
  expect(proof.embeddedWoff2[0].family).toBe("KaTeX_Size3");
  expect(proof.embeddedWoff2[0].bytes).toBe(3624);
  expect(
    createHash("sha256")
      .update(await Bun.file(`${own}/../nodeview/original.css`).bytes())
      .digest("hex"),
  ).toBe(proof.stylesheetSha256);
});

test("ordinary, fraction, radical, scripts, matrix, text and Greek match Source glyph positions at12/18/32px", async () => {
  let accepted = 0,
    runs = 0;
  for (const row of observed.rows) {
    const output = await renderMathWrite(request(row));
    expect(output).toEqual(
      Object.fromEntries(
        Object.entries(fixture.find((value) => value.id === row.id)!).filter(
          ([key]) => key !== "id",
        ),
      ),
    );
    if (!output.vector) continue;
    accepted++;
    const comparison = compareGlyphs(row, output);
    expect(comparison.widthError).toBe(0);
    expect(comparison.ascentError).toBe(0);
    expect(comparison.descentError).toBe(0);
    expect(comparison.spanHeightError).toBe(0);
    for (const run of comparison.glyphRuns) {
      runs++;
      expect(run.actual.text).toBe(run.expected.text);
      expect(run.actual.font).toBe(run.expected.font);
      expect(run.xError).toBe(0);
      expect(run.baselineError).toBe(0);
      expect(run.maxInternalBaselineError).toBe(0);
      expect(Math.abs(run.advanceError)).toBeLessThan(0.001);
      // CSS size and actual font-path scale are deliberately distinct.
      expect(run.actual.fontSize).toBe(
        Math.trunc(run.expected.cssFontSize * 64) / 64,
      );
      expect(Math.ceil(run.actual.advance * 64) / 64).toBeCloseTo(
        run.expected.occupiedWidth,
        6,
      );
    }
  }
  expect(accepted).toBe(11);
  expect(runs).toBe(59);
});

test("ignored inline struts and real vlist cell heights stay distinct from engine TeX extents", () => {
  for (const output of fixture.filter((output) => output.vector)) {
    const row = observed.rows.find((row: any) => row.id === output.id),
      geometry = output.cssGeometry!;
    expect(geometry.scope).toBe("katexBaseInlineSpan");
    expect(geometry.layoutModel).toBe("blink150Linux64ths");
    expect(geometry.lineHeightPx).toBeCloseTo(
      Number.parseFloat(row.nodes[".katex-base"].styles["line-height"]),
      4,
    );
    const struts = row.flowNodes.filter(
      (node: any) => node.attrs.class === "katex-strut",
    );
    expect(geometry.ignoredInlineStruts).toHaveLength(struts.length);
    struts.forEach((strut: any, i: number) => {
      expect(strut.styles.display).toBe("inline");
      expect(geometry.ignoredInlineStruts[i].authoredHeightPx).toBeCloseTo(
        Number.parseFloat(strut.styles.height),
        3,
      );
      expect(geometry.ignoredInlineStruts[i].verticalAlignPx).toBeCloseTo(
        -(strut.box.y - row.nodes[".katex-base"].box.y),
        6,
      );
      expect(strut.box.height).toBe(
        geometry.fontBoxAscentPx + geometry.fontBoxDescentPx,
      );
    });
    const cellHeights = row.flowNodes
      .filter((node: any) => node.attrs.class === "vlist")
      .map((node: any) => node.box.height)
      .sort((a: number, b: number) => a - b);
    const measuredHeights = geometry.tables
      .flatMap((table) => [
        table.firstRowHeightPx,
        ...(table.secondRowHeightPx ? [table.secondRowHeightPx] : []),
      ])
      .sort((a, b) => a - b);
    expect(measuredHeights).toEqual(cellHeights);
  }
  const fraction = fixture.find((row) => row.id === "fraction")!;
  expect(fraction.vector!.heightPx).toBe(26);
  expect(
    fraction.cssGeometry!.ignoredInlineStruts[0].authoredHeightPx,
  ).toBeGreaterThan(27);
});

test("actual Source sqrt SVG and fraction rule paint boxes match the generated vector positions", () => {
  for (const output of fixture.filter((output) => output.vector)) {
    const row = observed.rows.find((row: any) => row.id === output.id),
      vector = output.vector!;
    const paints = [
      ...vector.svg.matchAll(
        /<g transform="translate\(([-\d.]+) ([-\d.]+)\)"><(svg|rect) width="([-\d.]+)" height="([-\d.]+)"/g,
      ),
    ];
    const reference = row.vectorNodes.filter(
      (node: any) =>
        node.tag === "svg" ||
        node.attrs.class?.split(" ").includes("frac-line"),
    );
    expect(paints).toHaveLength(reference.length);
    reference.forEach((node: any, i: number) => {
      const paint = paints[i],
        baseline =
          row.nodes[".katex-base"].box.y +
          row.nodes[".katex-base"].fontMetrics.fontAscent;
      expect(paint[3]).toBe(node.tag === "svg" ? "svg" : "rect");
      expect(Number(paint[1]) + vector.paintOffsetXPx).toBeCloseTo(
        node.box.x - row.nodes[".katex-base"].box.x,
        6,
      );
      expect(Number(paint[2]) - vector.paintBaselinePx).toBeCloseTo(
        node.box.y - baseline,
        6,
      );
      expect(Number(paint[4])).toBeCloseTo(node.box.width, 6);
      expect(Number(paint[5])).toBeCloseTo(node.box.height, 6);
    });
    expect(vector.svg).not.toMatch(
      /<(?:text|image|script|foreignObject|use)(?:\s|>)|(?:href|src)=|url\(/i,
    );
    const image = new Resvg(vector.svg, {
      font: { loadSystemFonts: false },
    }).render();
    expect(
      image.pixels.some((byte, index) => index % 4 === 3 && byte > 16),
    ).toBe(true);
    expect(vector.paintHeightPx).toBeGreaterThanOrEqual(vector.heightPx);
  }
});

test("block line flow, accent overlap, indexed roots, operators and wrapping refuse explicitly", async () => {
  for (const [source, display, kind] of [
    [String.raw`\frac{x}{y}`, "block", "current-css-display-flow"],
    [String.raw`\text{Café}`, "inline", "current-css-structure"],
    [String.raw`\sqrt[3]{x}`, "inline", "current-css-structure"],
    [String.raw`\sum_{i=0}^{n}i`, "inline", "current-css-structure"],
  ] as const) {
    const output = await renderMathWrite(request({ source, display }));
    expect(output.originalError).toBeNull();
    expect(output.originalHtml.length).toBeGreaterThan(0);
    expect(output.vector).toBeUndefined();
    expect(output.cssGeometry).toBeUndefined();
    expect(output.fidelity).toBe("refused");
    expect(output.issues[0].kind).toBe(kind);
  }
  const wraps = await renderMathWrite(
    request({ source: "a+b+c", display: "inline" }, { widthPx: 10 }),
  );
  expect(wraps.issues[0].kind).toBe("current-css-inline-wrap");
  expect(wraps.vector).toBeUndefined();
  for (const id of ["invalid", "empty"]) {
    const output = fixture.find((row) => row.id === id)!;
    expect(output.issues[0].kind).toBe("source");
    expect(output.originalError).not.toBeNull();
  }
});

test("both old profiles retain every exact original result including SVG bytes", async () => {
  for (const [profile, file] of [
    ["currentSource", "current-source-results.json"],
    ["engineMatchedDiagnostic", "diagnostic-results.json"],
  ] as const) {
    const originals = await Bun.file(`${own}/../${file}`).json();
    for (const { id, ...output } of originals)
      expect(
        await renderMathWrite(
          request(output, {
            profile,
            widthPx: output.widthPx,
            fontSizePx: output.fontSizePx,
          }),
        ),
      ).toEqual(output);
  }
  const raw = "  x+1\n ";
  const output = await renderMathWrite(
    request({ source: raw, display: "inline" }),
  );
  expect(output.source).toBe(raw);
  expect(output.fidelity).toBe("currentSourceCssDerivedDiagnostic");
});

const scratch = await mkdtemp(join(tmpdir(), "twyne-current-css-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));
test("standalone packaged helper embeds the retained vendor cascade and original fonts without Source lookup", async () => {
  const executable = join(scratch, "twyne-math-write"),
    empty = join(scratch, "empty");
  await mkdir(empty);
  const build = Bun.spawn(
    [
      "rtk",
      "proxy",
      process.execPath,
      "build",
      join(root, "desktop/gpui/tools/math-write.ts"),
      "--compile",
      "--outfile",
      executable,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  if (code) throw new Error(`Build failed: ${stdout}\n${stderr}`);
  for (const id of [
    "nested-fraction",
    "inline-matrix",
    "ascii-text",
    "block",
    "unicode",
  ]) {
    const input = request(observed.rows.find((row: any) => row.id === id)),
      child = Bun.spawn([executable], {
        cwd: empty,
        env: { PATH: "" },
        stdin: Buffer.from(JSON.stringify(input)),
        stdout: "pipe",
        stderr: "pipe",
      });
    const [exit, raw, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (exit) throw new Error(error);
    expect(JSON.parse(raw)).toEqual(await renderMathWrite(input));
  }
}, 30_000);
