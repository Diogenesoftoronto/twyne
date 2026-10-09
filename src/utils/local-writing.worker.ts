import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
  type FillMaskPipeline,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import {
  LOCAL_WRITING_PACKS,
  pinnedLocalWritingUrl,
  type LocalWritingPack,
} from "./local-writing-manifest";

let embedding: FeatureExtractionPipeline | undefined;
let words: FillMaskPipeline | undefined;
let speech: AutomaticSpeechRecognitionPipeline | undefined;
const files = new Map<string, ArrayBuffer>();
const runtimeFetch = env.fetch.bind(env);
env.allowLocalModels = false;
env.useBrowserCache = false; // Model persistence is Twyne's existing IndexedDB store.
env.useWasmCache = true; // Shared runtime is cached by transformers.js.
env.backends.onnx.wasm!.numThreads = 1;
// Model loading cannot silently fetch missing weights or transmit manuscript text.
env.fetch = async (input: string | URL) => {
  const pinned = pinnedLocalWritingUrl(String(input));
  const bytes = pinned ? files.get(pinned) : undefined;
  if (
    /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@[\w.-]+\/dist\/ort-wasm-[\w.-]+\.(wasm|mjs)$/.test(
      String(input),
    )
  )
    return runtimeFetch(input);
  return bytes
    ? new Response(bytes.slice(0), { status: 200 })
    : new Response(null, { status: 404 });
};
type Request = {
  id: number;
  pack: LocalWritingPack;
  operation: "load" | "embed" | "words" | "speech";
  files?: Array<{ url: string; bytes: ArrayBuffer }>;
  texts?: string[];
  text?: string;
  audio?: Float32Array;
};
let queue: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<Request>) => {
  queue = queue.then(async () => {
    const request = event.data;
    try {
      for (const file of request.files ?? []) files.set(file.url, file.bytes);
      const model = LOCAL_WRITING_PACKS[request.pack];
      const options = {
        revision: model.revision,
        dtype: "q8" as const,
        device: "wasm" as const,
      };
      if (request.pack === "embeddings")
        embedding ??= await pipeline("feature-extraction", model.repo, options);
      if (request.pack === "words")
        words ??= await pipeline("fill-mask", model.repo, options);
      if (request.pack === "speech")
        // ORT extended QDQ fusion rejects this pinned Whisper export (#28306).
        // Basic optimizations avoid the faulty pass without downloading a fallback.
        speech ??= await pipeline("automatic-speech-recognition", model.repo, {
          ...options,
          session_options: { graphOptimizationLevel: "basic" },
        });
      if (request.operation === "load")
        for (const file of request.files ?? []) files.delete(file.url);
      let result: unknown = true;
      if (request.operation === "embed")
        result = (
          await embedding!(request.texts!, { pooling: "mean", normalize: true })
        ).tolist();
      if (request.operation === "words")
        result = await words!(request.text!, { top_k: 8 });
      if (request.operation === "speech")
        result = await speech!(request.audio!, {
          chunk_length_s: 30,
          stride_length_s: 5,
          max_new_tokens: 160,
        });
      self.postMessage({ id: request.id, result });
    } catch (error) {
      self.postMessage({
        id: request.id,
        error:
          error instanceof Error
            ? error.message
            : "On-device inference failed.",
      });
    }
  });
};
