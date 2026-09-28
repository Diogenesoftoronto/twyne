import type { ExportPayload } from "../exchange";
import { serializeTypst, typstString, type TypstDocument } from "./serialize";
import type { TypstCompileRequest, TypstCompileResponse } from "./protocol";

export interface TypstExportOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;

async function loadAssets(
  document: TypstDocument,
  signal: AbortSignal,
): Promise<TypstCompileRequest["assets"]> {
  const assets: TypstCompileRequest["assets"] = [];
  const cache = new Map<string, Uint8Array>();
  let total = 0;
  for (const asset of document.assets) {
    signal.throwIfAborted();
    const url = new URL(asset.url, window.location.href);
    if (!["https:", "http:", "blob:", "data:"].includes(url.protocol)) {
      throw new Error(
        "An image uses a source that cannot be exported. Save it in the folio first.",
      );
    }
    let bytes = cache.get(url.href);
    if (!bytes) {
      const response = await fetch(url, { signal, credentials: "same-origin" });
      if (!response.ok || !response.body)
        throw new Error(
          "An image could not be loaded. Check your connection and try again.",
        );
      if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
        await response.body.cancel();
        throw new Error(
          "An image is larger than 8 MB. Use a smaller image for Typst export.",
        );
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (
            length > MAX_IMAGE_BYTES ||
            total + length > MAX_TOTAL_IMAGE_BYTES
          ) {
            await reader.cancel();
            throw new Error(
              "This folio has too much image data for Typst export. Use PDF… or reduce the image sizes.",
            );
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      if (!length)
        throw new Error("An image is empty. Replace it before exporting.");
      bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      cache.set(url.href, bytes);
      total += length;
    }
    assets.push({ path: asset.path, bytes });
  }
  return assets;
}

/** Exports are cancellable even while Rust is synchronously compiling in WASM. */
function compilePdf(
  request: TypstCompileRequest,
  options: TypstExportOptions,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./compiler.worker.ts", import.meta.url),
      { type: "module" },
    );
    const cleanup = () => {
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
      if (data.type === "progress") {
        options.onProgress?.(data.message);
        return;
      }
      cleanup();
      if (data.type === "error") reject(new Error(data.message));
      else resolve(new Blob([data.bytes], { type: "application/pdf" }));
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

export async function exportTypst(
  payload: ExportPayload,
  format: "pdf" | "source",
  options: TypstExportOptions = {},
): Promise<Blob> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error(
          "Typesetting took too long. Try a smaller folio or use PDF….",
        ),
      ),
    120_000,
  );
  try {
    controller.signal.throwIfAborted();
    options.onProgress?.("Preparing your manuscript…");
    const document = serializeTypst(payload);
    if (document.assets.length) options.onProgress?.("Preparing images…");
    const assets = await loadAssets(document, controller.signal);
    controller.signal.throwIfAborted();
    if (format === "source") {
      // A standalone .typ file: image bytes travel inside it, with no broken local paths.
      let source = document.source;
      const definitions = assets.map((asset, index) => {
        const name = `twyne-image-${index + 1}`;
        source = source.replaceAll(
          `image(${typstString(asset.path)},`,
          `image(${name},`,
        );
        return `#let ${name} = bytes((${asset.bytes.join(",")},))\n`;
      });
      return new Blob([...definitions, source], {
        type: "text/plain;charset=utf-8",
      });
    }
    return await compilePdf(
      { source: document.source, assets },
      { ...options, signal: controller.signal },
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
