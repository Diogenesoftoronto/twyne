import type { TypstDocument } from "./serialize";
import type { TypstCompileRequest } from "./protocol";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;

export async function loadAssets(
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
