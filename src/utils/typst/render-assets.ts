import { typstString } from "./serialize";
import { loadAssets } from "./assets";
import { typstCodeMatches } from "./syntax";

function decodeString(value: string): string {
  return value
    .slice(1, -1)
    .replace(/\\u\{([\da-f]+)\}|\\([\\"nrt])/gi, (_, hex, escape) =>
      hex
        ? String.fromCodePoint(parseInt(hex, 16))
        : ({ n: "\n", r: "\r", t: "\t" }[escape as string] ?? escape),
    );
}
let equationEngine:
  | Promise<(latex: string, block: boolean) => string>
  | undefined;
async function equationSvg(latex: string, block: boolean): Promise<string> {
  equationEngine ??= Promise.all([
    import("mathjax-full/js/mathjax.js"),
    import("mathjax-full/js/input/tex.js"),
    import("mathjax-full/js/output/svg.js"),
    import("mathjax-full/js/adaptors/liteAdaptor.js"),
    import("mathjax-full/js/handlers/html.js"),
    import("mathjax-full/js/input/tex/AllPackages.js"),
  ]).then(
    ([
      { mathjax },
      { TeX },
      { SVG },
      { liteAdaptor },
      { RegisterHTMLHandler },
      { AllPackages },
    ]) => {
      const adaptor = liteAdaptor();
      RegisterHTMLHandler(adaptor);
      const document = mathjax.document("", {
        InputJax: new TeX({
          packages: AllPackages.filter(
            (name) => !["require", "autoload"].includes(name),
          ),
        }),
        OutputJax: new SVG({ fontCache: "none" }),
      });
      return (source, display) => {
        const output = adaptor.outerHTML(document.convert(source, { display }));
        const svg = output.match(/<svg[\s\S]*<\/svg>/)?.[0];
        if (!svg || output.includes("data-mjx-error"))
          throw new Error(
            "An equation could not be rendered. Check its LaTeX source.",
          );
        // MathJax uses currentColor; explicit black keeps the SVG self-contained.
        return svg.replaceAll("currentColor", "#181818");
      };
    },
  );
  return (await equationEngine)(latex, block);
}
let diagramId = 0;
let diagramQueue: Promise<unknown> = Promise.resolve();
async function diagramSvg(source: string): Promise<string> {
  const run = diagramQueue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    const { initializeTwyneMermaid } = await import(
      "../../components/editor/mermaid-theme"
    );
    await initializeTwyneMermaid();
    const configuration = mermaid.mermaidAPI.getConfig();
    mermaid.initialize({
      ...configuration,
      startOnLoad: false,
      securityLevel: "strict",
      // Typst's SVG renderer needs actual SVG labels, not browser-only foreignObject.
      htmlLabels: false,
      flowchart: { ...configuration.flowchart, htmlLabels: false },
    });
    try {
      return (
        await mermaid.render(`twyne-typst-diagram-${++diagramId}`, source)
      ).svg;
    } finally {
      mermaid.initialize(configuration);
    }
  });
  diagramQueue = run.catch(() => {});
  return run;
}

/** Only explicit Twyne atom helpers are evaluated; arbitrary Typst remains untouched. */
export async function prepareTypstAssets(
  source: string,
  signal?: AbortSignal,
): Promise<string> {
  const pattern =
    /#twyne-(math|mermaid)\(("(?:[^"\\]|\\.)*")(?:,\s*block:\s*(true|false))?\)/g;
  const matches = typstCodeMatches(source, pattern);
  for (const match of matches.reverse()) {
    signal?.throwIfAborted();
    const block = match[3] === "true";
    const svg =
      match[1] === "math"
        ? await equationSvg(decodeString(match[2]), block)
        : await diagramSvg(decodeString(match[2]));
    signal?.throwIfAborted();
    const bytes = new TextEncoder().encode(svg);
    const alt = typstString(decodeString(match[2]));
    const mathHeight = Math.max(
      0.1,
      Number(/\bheight="([\d.]+)ex"/.exec(svg)?.[1] ?? 2.4) / 2,
    );
    const expr = `image(bytes((${bytes.join(",")},)), format: "svg", alt: ${alt}${match[1] === "mermaid" ? ", width: 100%" : ", height: " + `${mathHeight}em`})`;
    const replacement =
      block || match[1] === "mermaid"
        ? `#block[#align(center)[#${expr}]]`
        : `#box(baseline: 20%)[#${expr}]`;
    source =
      source.slice(0, match.index) +
      replacement +
      source.slice(match.index! + match[0].length);
  }
  const imagePattern =
    /#twyne-image\(("(?:[^"\\]|\\.)*"),\s*width:\s*([\d.]+)%,\s*alt:\s*("(?:[^"\\]|\\.)*")\)/g;
  const images = typstCodeMatches(source, imagePattern);
  const assets = await loadAssets(
    {
      source,
      assets: images.map((m, i) => ({
        path: `/native-image-${i}`,
        url: decodeString(m[1]),
      })),
    },
    signal ?? new AbortController().signal,
  );
  for (let i = images.length - 1; i >= 0; i--) {
    const match = images[i];
    const replacement = `#image(bytes((${assets[i].bytes.join(",")},)), width: ${Math.min(100, Math.max(1, Number(match[2])))}%, alt: ${match[3]})`;
    source =
      source.slice(0, match.index) +
      replacement +
      source.slice(match.index! + match[0].length);
  }
  return source;
}
