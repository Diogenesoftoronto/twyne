import * as ort from "onnxruntime-web/webgpu";
import { Tokenizer } from "@huggingface/tokenizers";
import { LOCAL_LIVE_BASE } from "../utils/live-voice-local-model";
import { readModelBlob } from "../utils/models-cache";
import { generateLocalLive } from "../utils/live-voice-local-inference";
import {
  loadLocalLiveSessions,
  type LocalLiveGraph,
} from "../utils/live-voice-local-sessions";

ort.env.wasm.numThreads = 1;

type Command =
  | { type: "load"; id: number }
  | { type: "close" | "cancel"; id: number }
  | {
      type: "turn";
      id: number;
      audio: Float32Array;
      instructions: string;
      mode: "text" | "interleaved" | "asr";
    };
let sessions: Record<LocalLiveGraph, ort.InferenceSession> | null = null;
let tokenizer: Tokenizer | null = null;
let generation = 0;
let loading = false;
let running = false;
let activeTurn: Promise<void> | null = null;
let queuedTurn: Extract<Command, { type: "turn" }> | null = null;

self.onmessage = ({ data }: MessageEvent<Command>) => {
  if (data.type === "cancel") {
    generation++;
    queuedTurn = null;
    self.postMessage({ type: "cancelled", id: data.id });
    return;
  }
  if (data.type === "close") {
    generation++;
    queuedTurn = null;
    const old = sessions;
    sessions = null;
    tokenizer = null;
    void (activeTurn ?? Promise.resolve())
      .then(() =>
        Promise.allSettled(
          Object.values(old ?? {}).map((session) => session.release()),
        ),
      )
      .then(() => {
        self.postMessage({ type: "closed", id: data.id });
      });
    return;
  }
  if (data.type === "turn") {
    if (running) {
      generation++;
      queuedTurn = data;
      return;
    }
    if (!sessions || !tokenizer) {
      self.postMessage({
        type: "error",
        id: data.id,
        message: "Local Live is not loaded.",
      });
      return;
    }
    const current = ++generation;
    const currentSessions = sessions;
    const currentTokenizer = tokenizer;
    running = true;
    activeTurn = (async () => {
      try {
        const system =
          data.mode === "asr" ? "Perform ASR in English." : data.instructions;
        const marker =
          data.mode === "interleaved"
            ? "<|mixed_start|>"
            : data.mode === "text"
              ? "<think></think>"
              : "";
        const prompt = `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n<|audio|><|im_end|>\n<|im_start|>assistant\n${marker}`;
        const tokens: number[] = [];
        let previous = "";
        await generateLocalLive({
          ort,
          sessions: currentSessions,
          audio: data.audio,
          prompt: currentTokenizer.encode(prompt, { add_special_tokens: false })
            .ids,
          mode: data.mode === "interleaved" ? "interleaved" : "text",
          cancelled: () => generation !== current,
          onOutput: (output) => {
            if (generation !== current) return;
            if (output.type === "audio") {
              self.postMessage(
                { type: "audio", id: data.id, samples: output.samples },
                { transfer: [output.samples.buffer as ArrayBuffer] },
              );
            } else {
              tokens.push(output.token);
              const text = currentTokenizer.decode(tokens, {
                skip_special_tokens: true,
              });
              if (text.startsWith(previous) && text.length > previous.length)
                self.postMessage({
                  type: "text",
                  id: data.id,
                  delta: text.slice(previous.length),
                });
              previous = text;
            }
          },
        });
        if (generation === current)
          self.postMessage({ type: "done", id: data.id });
      } catch (error) {
        if (generation === current)
          self.postMessage({
            type: "error",
            id: data.id,
            message:
              error instanceof Error
                ? error.message
                : "Local Live generation failed.",
          });
      } finally {
        running = false;
        activeTurn = null;
        if (queuedTurn && sessions) {
          const next = queuedTurn;
          queuedTurn = null;
          self.dispatchEvent(new MessageEvent("message", { data: next }));
        }
      }
    })();
    return;
  }
  if (data.type !== "load") return;
  if (loading || running) {
    self.postMessage({
      type: "error",
      id: data.id,
      message: "Local Live is busy.",
    });
    return;
  }
  const current = ++generation;
  loading = true;
  void (async () => {
    try {
      if (!sessions) {
        const tokenBlob = await readModelBlob(
          `${LOCAL_LIVE_BASE}tokenizer.json`,
        );
        const configBlob = await readModelBlob(
          `${LOCAL_LIVE_BASE}tokenizer_config.json`,
        );
        if (!tokenBlob || !configBlob)
          throw new Error("Local Live tokenizer is missing.");
        const nextTokenizer = new Tokenizer(
          JSON.parse(await tokenBlob.text()),
          JSON.parse(await configBlob.text()),
        );
        const loaded = await loadLocalLiveSessions(async (graph, options) =>
          ort.InferenceSession.create(await graph.arrayBuffer(), options),
        );
        if (generation !== current) {
          await Promise.allSettled(
            Object.values(loaded).map((session) => session.release()),
          );
          return;
        }
        sessions = loaded;
        tokenizer = nextTokenizer;
      }
      self.postMessage({ type: "loaded", id: data.id });
    } catch (error) {
      if (generation === current)
        self.postMessage({
          type: "error",
          id: data.id,
          message:
            error instanceof Error
              ? error.message
              : "Local Live model could not be loaded.",
        });
    } finally {
      loading = false;
    }
  })();
};
