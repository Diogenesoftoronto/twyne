import type { ExportPayload } from "../exchange";
import { serializeTypst, typstString } from "./serialize";
import { compileRequest, loadAssets, applyTypstPageSetup } from "./client";
import { prepareTypstAssets } from "./render-assets";
import { typstDecorations } from "./decorative-assets";

export interface TypstExportOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
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
    const document =
      payload.typstSource !== undefined
        ? {
            source: applyTypstPageSetup(payload.typstSource, payload),
            assets: typstDecorations(payload, payload.typstSource).assets,
          }
        : serializeTypst(payload);
    document.source = await prepareTypstAssets(
      document.source,
      controller.signal,
    );
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
    return (
      await compileRequest(
        { source: document.source, assets },
        { ...options, signal: controller.signal },
      )
    ).pdf;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
