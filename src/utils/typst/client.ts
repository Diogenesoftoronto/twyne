import { serializeTypst } from "./serialize";
import { typstPageSetup, TYPST_MANUSCRIPT_STYLES } from "./theme";
import {
  TYPST_HELPERS,
  migrateTypstSource,
  prepareNativeParagraphs,
  TYPST_PARAGRAPH_PREFIX,
} from "./document";
import type { ExportPayload } from "../exchange";
import { loadAssets } from "./assets";
export { loadAssets } from "./assets";
import { prepareTypstAssets } from "./render-assets";
import type {
  TypstCompileRequest,
  TypstCompileResponse,
  TypstDiagnostic,
} from "./protocol";
import { prefetchTypstPackages } from "./packages";
import { typstDecorations } from "./decorative-assets";
export interface TypstCompileOptions {
  payload?: ExportPayload;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  assets?: { path: string; url: string }[];
}
type TypstExportOptions = TypstCompileOptions;

/** A compiler error placed in the author's file: one-based lines and columns. */
export interface TypstSourceError {
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}
export class TypstCompileError extends Error {
  constructor(
    message: string,
    readonly errors: TypstSourceError[],
  ) {
    super(message);
  }
}

/**
 * Translate compiler ranges into the author's file, which starts on the line
 * after the marker. Errors inside packages or Twyne's helpers stay unplaced.
 */
export function sourceErrors(
  compiled: string,
  diagnostics: TypstDiagnostic[],
): TypstSourceError[] {
  const marker = compiled.indexOf(`\n${TYPST_SOURCE_MARKER}\n`);
  const offset =
    marker < 0 ? 0 : compiled.slice(0, marker).split("\n").length + 1;
  const lines = compiled.split("\n");
  const authorColumn = (line: number, column: number) => {
    const text = lines[line] ?? "";
    const prefix = text.indexOf(TYPST_PARAGRAPH_PREFIX);
    return (
      column +
      1 -
      (prefix >= 0 && column >= prefix + TYPST_PARAGRAPH_PREFIX.length
        ? TYPST_PARAGRAPH_PREFIX.length
        : 0)
    );
  };
  return diagnostics.flatMap((d) => {
    const range = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(d.range);
    if (d.package || d.path !== "/main.typ" || !range) return [];
    const [line, column, endLine, endColumn] = range.slice(1).map(Number);
    if (line < offset) return [];
    return [
      {
        message: d.message,
        line: line - offset + 1,
        column: authorColumn(line, column),
        endLine: endLine - offset + 1,
        endColumn: authorColumn(endLine, endColumn),
      },
    ];
  });
}
export interface TypstCompilation {
  pdf: Blob;
  pages: string[];
  pageCount: number;
}

/** The renderer returns one SVG with independent page groups and shared glyph definitions. */
export function splitProofPages(
  svg?: string,
  sizes?: { width: number; height: number }[],
): string[] {
  if (!svg || !sizes?.length) return [];
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const groups = Array.from(root.querySelectorAll(".typst-page"));
  // Serialize shared definitions once. Deep-cloning the complete document for
  // every page makes proof construction quadratic in manuscript length.
  const separate =
    groups.length === sizes.length &&
    groups.every((group) => group.parentElement === root);
  const shell = root.cloneNode(false) as Element;
  let shared = "";
  if (separate) {
    for (const child of Array.from(root.childNodes)) {
      if (
        child.nodeType === 1 &&
        (child as Element).classList.contains("typst-page")
      )
        continue;
      const holder = root.cloneNode(false) as Element;
      holder.appendChild(child.cloneNode(true));
      const markup = holder.outerHTML;
      shared += markup.slice(markup.indexOf(">") + 1, markup.lastIndexOf("</"));
    }
  }
  let top = 0;
  return sizes.map((size, index) => {
    const page = shell.cloneNode(false) as Element;
    page.setAttribute(
      "viewBox",
      separate
        ? `0 0 ${size.width} ${size.height}`
        : `0 ${top} ${size.width} ${size.height}`,
    );
    top += size.height;
    page.setAttribute("width", String(size.width));
    page.setAttribute("height", String(size.height));
    page.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!separate) {
      // Preserve compatibility with renderer layouts that nest page groups.
      for (const child of Array.from(root.childNodes))
        page.appendChild(child.cloneNode(true));
      if (groups.length === sizes.length) {
        Array.from(page.querySelectorAll(".typst-page")).forEach((group, i) => {
          if (i !== index) group.remove();
          else group.removeAttribute("transform");
        });
        page.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
      }
      return page.outerHTML;
    }
    const group = groups[index].cloneNode(true) as Element;
    group.removeAttribute("transform");
    page.appendChild(group);
    const markup = page.outerHTML;
    const boundary = markup.indexOf(">") + 1;
    return markup.slice(0, boundary) + shared + markup.slice(boundary);
  });
}
/** Exports are cancellable even while Rust is synchronously compiling in WASM. */
export function compileRequest(
  request: TypstCompileRequest,
  options: TypstExportOptions,
): Promise<TypstCompilation> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./compiler.worker.ts", import.meta.url),
      { type: "module" },
    );
    let settled = false;
    const cleanup = () => {
      settled = true;
      worker.terminate();
      options.signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(
        options.signal?.reason ??
          new DOMException("Export cancelled", "AbortError"),
      );
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    worker.onerror = () => {
      cleanup();
      reject(
        new Error(
          "The typesetter could not load. Try again, or use PDF… to print this folio.",
        ),
      );
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(
        new Error(
          "The typesetter returned an unreadable result. Please try again.",
        ),
      );
    };
    worker.onmessage = ({ data }: MessageEvent<TypstCompileResponse>) => {
      if (settled) return;
      if (data.type === "progress") {
        options.onProgress?.(data.message);
        return;
      }
      cleanup();
      if (data.type === "error")
        reject(
          new TypstCompileError(
            data.message,
            sourceErrors(request.source, data.diagnostics ?? []),
          ),
        );
      else
        resolve({
          pdf: new Blob([data.bytes], { type: "application/pdf" }),
          pages: splitProofPages(data.svg, data.pageSizes),
          pageCount: data.pageSizes?.length ?? 0,
        });
    };
    // Repeated images share buffers; clone instead of transferring a buffer twice.
    try {
      worker.postMessage(request);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** A worker owns each snapshot: aborting it also stops synchronous WASM compilation. */
export async function compileTypstSource(
  source: string,
  options: TypstCompileOptions = {},
): Promise<TypstCompilation> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error("Typesetting took too long. Try a smaller folio."),
      ),
    120_000,
  );
  try {
    controller.signal.throwIfAborted();
    const decorations = options.payload
      ? typstDecorations(options.payload, source).assets
      : [];
    source = applyTypstPageSetup(source, options.payload);
    source = await prepareTypstAssets(source, controller.signal);
    const assets = await loadAssets(
      { source, assets: [...(options.assets ?? []), ...decorations] },
      controller.signal,
    );
    const packages = await prefetchTypstPackages(source, options.onProgress);
    controller.signal.throwIfAborted();
    return await compileRequest(
      { source, assets, packages: [...packages] },
      { ...options, signal: controller.signal },
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

/** The line just before the author's file in every typeset document. */
export const TYPST_SOURCE_MARKER = "// twyne:source";

/**
 * Typesetting rules for the author's markup. Native paragraphs take the
 * opening initial and manuscript spacing; helper-wrapped paragraphs already
 * did, so they are never measured twice.
 */
const TYPST_NATIVE_STYLES = `#show heading: it => { show par: it => it; it }
#show quote: it => { show par: it => it; it }
#show list: it => { show par: it => it; it }
#show enum: it => { show par: it => it; it }
#show table: it => { show par: it => it; it }
#show footnote.entry: it => { show par: it => it; it }
${[
  "subtitle",
  "kicker",
  "standfirst",
  "abstract",
  "epigraph",
  "scene-break",
  "cue",
  "direction",
]
  .map(
    (role) =>
      `#let twyne-plain-${role} = twyne-${role}\n#let twyne-${role}(..args) = { show par: it => it; twyne-plain-${role}(..args) }`,
  )
  .join("\n")}
#show par: it => {
  show par: it => it
  // Layout probes and the two parts of an already wrapped opening must not
  // re-enter the automatic paragraph rule during contextual measurement.
  if it.has("label") and it.label == <twyne-opening-line> { it }
  else { context block(above: 0pt, below: if twyne-opening-depth.get() == 0 { 16.2pt } else { 6.075pt }, twyne-opening(it.body)) }
}`;

export function applyTypstPageSetup(
  source: string,
  payload?: ExportPayload,
): string {
  if (!payload) return source;
  source = migrateTypstSource(source);
  const settings = typstPageSetup(payload, source);
  const appendices = serializeTypst({ ...payload, title: "", html: "" }).source;
  const notesAt = appendices.indexOf("#heading(level: 2)");
  return [
    settings,
    TYPST_HELPERS,
    TYPST_MANUSCRIPT_STYLES,
    TYPST_NATIVE_STYLES,
    TYPST_SOURCE_MARKER,
    prepareNativeParagraphs(source) +
      (notesAt >= 0 ? "\n" + appendices.slice(notesAt) : ""),
  ].join("\n");
}
