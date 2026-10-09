import {
  LOCAL_WRITING_PACKS,
  localPackId,
  localWordInput,
  type LocalWritingPack,
} from "./local-writing-manifest";
import {
  downloadModelBundle,
  evictModelBundle,
  isModelBundleDownloaded,
  modelDownloadState,
  readModelBytes,
  type ModelDownloadState,
} from "./models-cache";
let worker: Worker | null = null;
let serial = 0;
const ready = new Set<LocalWritingPack>();
const loads = new Map<LocalWritingPack, Promise<void>>();
const pending = new Map<
  number,
  {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export const localWritingSupported = () =>
  typeof Worker !== "undefined" &&
  typeof indexedDB !== "undefined" &&
  typeof WebAssembly !== "undefined";
export const localWritingStatus = (pack: LocalWritingPack) =>
  modelDownloadState(localPackId(pack), LOCAL_WRITING_PACKS[pack].files);
export function stopLocalWriting(): void {
  worker?.terminate();
  worker = null;
  ready.clear();
  loads.clear();
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("On-device work stopped."));
  }
  pending.clear();
}
function request(
  message: Record<string, unknown>,
  transfer: Transferable[] = [],
): Promise<unknown> {
  if (!worker) {
    worker = new Worker(new URL("./local-writing.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (
      event: MessageEvent<{ id: number; result?: unknown; error?: string }>,
    ) => {
      const item = pending.get(event.data.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(event.data.id);
      if (event.data.error) item.reject(new Error(event.data.error));
      else item.resolve(event.data.result);
    };
    worker.onerror = () => stopLocalWriting();
  }
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stopLocalWriting();
      reject(new Error("On-device work took too long. Try a shorter passage."));
    }, 180000);
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage({ ...message, id }, transfer);
  });
}
async function load(pack: LocalWritingPack): Promise<void> {
  if (!localWritingSupported())
    throw new Error("This browser cannot run the writing pack.");
  if (ready.has(pack)) return;
  if (loads.has(pack)) return loads.get(pack)!;
  const loading = (async () => {
    if (
      !(await isModelBundleDownloaded(
        localPackId(pack),
        LOCAL_WRITING_PACKS[pack].files,
      ))
    )
      throw new Error("Download this writing pack from On-device tools first.");
    const files = await Promise.all(
      LOCAL_WRITING_PACKS[pack].files.map(async (file) => {
        const bytes = await readModelBytes(file.url);
        if (!bytes || bytes.byteLength !== file.size)
          throw new Error(
            "This writing pack is incomplete. Download it again.",
          );
        return { url: file.url, bytes };
      }),
    );
    await request(
      { operation: "load", pack, files },
      files.map((file) => file.bytes),
    );
    ready.add(pack);
  })();
  loads.set(pack, loading);
  try {
    await loading;
  } finally {
    loads.delete(pack);
  }
}
/** Only this explicit entry point downloads model weights. */
export async function downloadLocalWriting(
  pack: LocalWritingPack,
  options: {
    signal?: AbortSignal;
    onProgress?: (state: ModelDownloadState) => void;
  } = {},
): Promise<void> {
  await downloadModelBundle(
    localPackId(pack),
    LOCAL_WRITING_PACKS[pack].files,
    options,
  );
  if (options.signal?.aborted)
    throw new DOMException("Download stopped.", "AbortError");
  await load(pack); // Compile and warm shared runtime while online.
}
export async function removeLocalWriting(
  pack: LocalWritingPack,
): Promise<void> {
  stopLocalWriting();
  await evictModelBundle(localPackId(pack), LOCAL_WRITING_PACKS[pack].files);
}
export async function embedWritingPassages(
  texts: string[],
): Promise<number[][]> {
  if (!texts.length || texts.length > 32 || texts.some((t) => t.length > 2000))
    throw new Error(
      "Compare up to 32 passages, each no longer than 2,000 characters.",
    );
  await load("embeddings");
  return (await request({
    operation: "embed",
    pack: "embeddings",
    texts,
  })) as number[][];
}
export interface LocalWordChoice {
  text: string;
  word: string;
  probability: number;
  model: string;
}
export async function localWritingWords(
  sentence: string,
  from: number,
  to: number,
): Promise<LocalWordChoice[]> {
  const text = localWordInput(sentence, from, to);
  await load("words");
  const output = (await request({
    operation: "words",
    pack: "words",
    text,
  })) as Array<{ token_str: string; score: number }>;
  const original = sentence.slice(from, to);
  return output
    .filter(
      (item) =>
        /^\p{L}+$/u.test(item.token_str.trim()) && Number.isFinite(item.score),
    )
    .map((item) => {
      let word = item.token_str.trim();
      if (original === original.toUpperCase()) word = word.toUpperCase();
      else if (/^[A-Z]/.test(original))
        word = word[0].toUpperCase() + word.slice(1);
      return {
        text: sentence.slice(0, from) + word + sentence.slice(to),
        word,
        probability: item.score,
        model: LOCAL_WRITING_PACKS.words.repo,
      };
    })
    .filter((item) => item.word !== original);
}
export async function transcribeWritingAudio(
  audio: Float32Array,
): Promise<string> {
  if (
    !audio.length ||
    audio.length > 16000 * 60 ||
    audio.some((n) => !Number.isFinite(n))
  )
    throw new Error("Use a recording of at most one minute.");
  await load("speech");
  const result = (await request({
    operation: "speech",
    pack: "speech",
    audio,
  })) as { text: string };
  if (typeof result.text !== "string" || !result.text.trim())
    throw new Error("No speech was transcribed.");
  return result.text.trim();
}
export async function decodeWritingAudio(blob: Blob): Promise<Float32Array> {
  if (blob.size > 20_000_000)
    throw new Error("Choose an audio file smaller than 20 MB.");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 60)
      throw new Error("Use a recording of at most one minute.");
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * 16000),
      16000,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    await context.close();
  }
}
