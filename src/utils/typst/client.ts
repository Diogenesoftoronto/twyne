import { serializeTypst } from "./serialize";
import { typstPageSetup, TYPST_MANUSCRIPT_STYLES } from "./theme";
import { TYPST_DOCUMENT_PREAMBLE } from "./document";
import type { ExportPayload } from "../exchange";
import { loadAssets } from "./assets";
export { loadAssets } from "./assets";
import { prepareTypstAssets } from "./render-assets";
import type { TypstCompileRequest, TypstCompileResponse } from "./protocol";
import { typstDecorations } from "./decorative-assets";
export interface TypstCompileOptions {
  payload?: ExportPayload;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  assets?: { path: string; url: string }[];
}
type TypstExportOptions = TypstCompileOptions;
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
      if (data.type === "error") reject(new Error(data.message));
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
    return await compileRequest(
      { source, assets },
      { ...options, signal: controller.signal },
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function applyTypstPageSetup(
  source: string,
  payload?: ExportPayload,
): string {
  if (!payload) return source;
  const originalSource = source;
  if (source.startsWith(TYPST_DOCUMENT_PREAMBLE)) {
    source =
      TYPST_DOCUMENT_PREAMBLE +
      "\n" +
      TYPST_MANUSCRIPT_STYLES +
      "\n" +
      source.slice(TYPST_DOCUMENT_PREAMBLE.length);
  } else {
    source = `#show heading: it => { show par: it => it; it }
#show quote: it => { show par: it => it; it }
#show list: it => { show par: it => it; it }
#show enum: it => { show par: it => it; it }
#show table: it => { show par: it => it; it }
#show par: it => {
  show par: it => it
  // Layout probes and the two parts of an already wrapped opening must not
  // re-enter the automatic paragraph rule during contextual measurement.
  if it.has("label") and it.label == <twyne-opening-line> { it }
  else { block(twyne-opening(it.body)) }
}
${source}`;
  }
  const settings = typstPageSetup(payload, originalSource);
  const appendices = serializeTypst({ ...payload, title: "", html: "" }).source;
  const notesAt = appendices.indexOf("#heading(level: 2)");
  return (
    settings +
    "\n" +
    source +
    (notesAt >= 0 ? "\n" + appendices.slice(notesAt) : "")
  );
}
