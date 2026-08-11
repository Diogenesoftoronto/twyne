/**
 * On-device model files — download, keep, and evict.
 *
 * The download-and-evict capability that both the Supertonic voice pack and
 * any future local model share. Files land in the IndexedDB `models` store
 * keyed by their remote URL, which lets the transformers.js fetcher be
 * redirected to them (see `supertonic-tts.ts`) so inference keeps working
 * offline after the first download — and lets the writer reclaim the space
 * with one action.
 *
 * Everything is browser-only and degrades to safe defaults (no-ops / null)
 * outside one, matching the rest of the IndexedDB layer.
 */

import {
  deleteModelFileFromIdb,
  listModelFilesFromIdb,
  loadModelFileFromIdb,
  saveModelFileToIdb,
} from "./idb";

export interface ModelFileManifest {
  /** Remote URL the model actually loads from. */
  url: string;
  /** Expected size in bytes, shown to the writer before downloading. */
  size: number;
}

export type ModelDownloadPhase =
  | "not-downloaded"
  | "downloading"
  | "ready"
  | "error";

export interface ModelDownloadState {
  /** Capability id, e.g. "supertonic-tts". */
  id: string;
  phase: ModelDownloadPhase;
  /** Bytes on disk across all files of the bundle. */
  downloadedBytes: number;
  /** Bytes to fetch across all files of the bundle. */
  totalBytes: number;
  /** 0-1 across the whole bundle, for a single progress bar. */
  progress: number;
  /** The file being fetched, when any. */
  activeFile?: string;
  error?: string;
}

export type ModelDownloadListener = (state: ModelDownloadState) => void;

/** Every listener registered for a bundle id. */
const listeners = new Map<string, Set<ModelDownloadListener>>();

export function onModelDownload(
  id: string,
  listener: ModelDownloadListener,
): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

function emit(id: string, state: ModelDownloadState): void {
  const set = listeners.get(id);
  if (!set) return;
  for (const listener of set) listener(state);
}

/** Browser capability signal: the `models` store only exists in a browser. */
function canPersist(): boolean {
  return typeof indexedDB !== "undefined" && typeof window !== "undefined";
}

/** Read a downloaded file as bytes. Returns null when absent or unavailable. */
export async function readModelBytes(url: string): Promise<ArrayBuffer | null> {
  if (!canPersist()) return null;
  const blob = await loadModelFileFromIdb(url);
  if (!blob) return null;
  try {
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * The URL prefix every file of a manifest shares. Files are stored under
 * their full remote URL (see `downloadModelBundle`), so bundle-wide reads and
 * evictions list the store by this prefix rather than by the bundle's
 * capability id, which never appears in a stored key.
 */
function bundleStoragePrefix(manifest: ModelFileManifest[]): string {
  if (manifest.length === 0) return "";
  let prefix = manifest[0].url;
  for (let i = 1; i < manifest.length; i++) {
    const a = prefix;
    const b = manifest[i].url;
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
    prefix = a.slice(0, n);
    if (!prefix) break;
  }
  return prefix;
}

/** True when every file of a manifest is already on disk. */
export async function isModelBundleDownloaded(
  id: string,
  manifest: ModelFileManifest[],
): Promise<boolean> {
  if (!canPersist() || manifest.length === 0) return false;
  const stored = new Map<string, number>();
  for (const rec of await listModelFilesFromIdb(bundleStoragePrefix(manifest))) {
    stored.set(rec.id, rec.bytes);
  }
  return manifest.every((file) => stored.get(file.url) === file.size);
}

/** Current bundle state from what is on disk, without touching the network. */
export async function modelDownloadState(
  id: string,
  manifest: ModelFileManifest[],
): Promise<ModelDownloadState> {
  if (!canPersist()) {
    return {
      id,
      phase: "not-downloaded",
      downloadedBytes: 0,
      totalBytes: 0,
      progress: 0,
    };
  }
  const stored = await listModelFilesFromIdb(bundleStoragePrefix(manifest));
  const known = new Map<string, number>();
  for (const rec of stored) {
    known.set(rec.id, rec.bytes);
  }
  const totalBytes = manifest.reduce((sum, f) => sum + f.size, 0);
  let downloadedBytes = 0;
  let completeFiles = 0;
  for (const file of manifest) {
    const bytes = known.get(file.url);
    if (bytes === undefined) continue;
    downloadedBytes += bytes;
    if (bytes === file.size) completeFiles += 1;
  }
  const phase: ModelDownloadPhase =
    completeFiles === manifest.length
      ? "ready"
      : downloadedBytes > 0
        ? "downloading"
        : "not-downloaded";
  return {
    id,
    phase,
    downloadedBytes,
    totalBytes,
    progress: totalBytes > 0 ? downloadedBytes / totalBytes : 0,
  };
}

/**
 * Download every file of a manifest into the store, reporting aggregate
 * progress. Sequential rather than parallel so a browser's connection pool is
 * never competing with the page's own traffic, and each file lands whole.
 *
 * Throws an AbortError when `signal` fires mid-download; partially fetched
 * files are kept out of the store.
 */
export async function downloadModelBundle(
  id: string,
  manifest: ModelFileManifest[],
  opts: { signal?: AbortSignal; onProgress?: ModelDownloadListener } = {},
): Promise<void> {
  const totalBytes = manifest.reduce((sum, f) => sum + f.size, 0);
  let downloadedBytes = 0;
  const report = (partial: Partial<ModelDownloadState>) => {
    emit(id, {
      id,
      phase: "downloading",
      downloadedBytes,
      totalBytes,
      progress: totalBytes > 0 ? downloadedBytes / totalBytes : 0,
      activeFile: partial.activeFile,
      error: undefined,
    });
    opts.onProgress?.({
      id,
      phase: "downloading",
      downloadedBytes,
      totalBytes,
      progress: totalBytes > 0 ? downloadedBytes / totalBytes : 0,
      activeFile: partial.activeFile,
    });
  };

  if (!canPersist()) {
    emit(id, {
      id,
      phase: "error",
      downloadedBytes: 0,
      totalBytes,
      progress: 0,
      error: "This browser cannot store the voice pack.",
    });
    throw new Error("IndexedDB unavailable — cannot store the voice pack.");
  }

  for (const file of manifest) {
    if (opts.signal?.aborted) throw createAbortError();
    report({ activeFile: file.url });
    const blob = await fetchFile(file, opts.signal, (chunkBytes) => {
      if (opts.signal?.aborted) return;
      downloadedBytes += chunkBytes;
      emit(id, {
        id,
        phase: "downloading",
        downloadedBytes,
        totalBytes,
        progress: totalBytes > 0 ? downloadedBytes / totalBytes : 0,
        activeFile: file.url,
      });
      opts.onProgress?.({
        id,
        phase: "downloading",
        downloadedBytes,
        totalBytes,
        progress: totalBytes > 0 ? downloadedBytes / totalBytes : 0,
        activeFile: file.url,
      });
    });
    await saveModelFileToIdb(file.url, blob);
  }

  emit(id, {
    id,
    phase: "ready",
    downloadedBytes: totalBytes,
    totalBytes,
    progress: 1,
  });
  opts.onProgress?.({
    id,
    phase: "ready",
    downloadedBytes: totalBytes,
    totalBytes,
    progress: 1,
  });
}

async function fetchFile(
  file: ModelFileManifest,
  signal: AbortSignal | undefined,
  onChunk: (bytes: number) => void,
): Promise<Blob> {
  const res = await fetch(file.url, { signal });
  if (!res.ok || !res.body) {
    throw new Error(
      `Downloading ${file.url} failed (${res.status ?? "no body"}).`,
    );
  }
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      throw createAbortError();
    }
    chunks.push(value);
    onChunk(value.byteLength);
  }
  return new Blob(chunks);
}

/** Remove every stored file of a bundle, freeing its disk space. */
export async function evictModelBundle(
  id: string,
  manifest: ModelFileManifest[],
): Promise<void> {
  if (!canPersist()) return;
  const stored = await listModelFilesFromIdb(bundleStoragePrefix(manifest));
  await Promise.all(stored.map((rec) => deleteModelFileFromIdb(rec.id)));
}

export function createAbortError(): Error {
  try {
    return new DOMException("The download was stopped.", "AbortError");
  } catch {
    const err = new Error("The download was stopped.");
    err.name = "AbortError";
    return err;
  }
}
