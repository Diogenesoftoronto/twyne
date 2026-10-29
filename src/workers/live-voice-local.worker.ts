import * as ort from "onnxruntime-web/webgpu";
import {
  loadLocalLiveSessions,
  type LocalLiveGraph,
} from "../utils/live-voice-local-sessions";

ort.env.wasm.numThreads = 1;

type Command = { type: "load"; id: number } | { type: "close"; id: number };
let sessions: Record<LocalLiveGraph, ort.InferenceSession> | null = null;
let generation = 0;
let loading = false;

self.onmessage = ({ data }: MessageEvent<Command>) => {
  if (data.type === "close") {
    generation++;
    const old = sessions;
    sessions = null;
    void Promise.allSettled(
      Object.values(old ?? {}).map((session) => session.release()),
    ).then(() => {
      self.postMessage({ type: "closed", id: data.id });
    });
    return;
  }
  if (data.type !== "load") return;
  if (loading) {
    self.postMessage({
      type: "error",
      id: data.id,
      message: "Local Live is already loading.",
    });
    return;
  }
  const current = ++generation;
  loading = true;
  void (async () => {
    try {
      if (!sessions) {
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
