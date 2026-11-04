import { LOCAL_LIVE_BASE } from "./live-voice-local-model";
import { readModelBlob } from "./models-cache";

export const LOCAL_LIVE_GRAPHS = [
  "decoder_q4f16",
  "audio_encoder",
  "depth_decoder",
  "codec_decoder",
] as const;
export type LocalLiveGraph = (typeof LOCAL_LIVE_GRAPHS)[number];

type SessionFactory<T> = (
  graph: Blob,
  options: {
    executionProviders: string[];
    externalData: Array<{ path: string; data: Blob }>;
    preferredOutputLocation?: Record<string, "gpu-buffer">;
  },
) => Promise<T>;

/** Load only the pinned local bundle. A missing file must never fall back to the network. */
export async function loadLocalLiveSessions<
  T extends { release(): Promise<void> },
>(
  create: SessionFactory<T>,
  read: (url: string) => Promise<Blob | null> = readModelBlob,
): Promise<Record<LocalLiveGraph, T>> {
  const sessions = {} as Record<LocalLiveGraph, T>;
  try {
    for (const name of LOCAL_LIVE_GRAPHS) {
      const graph = await read(`${LOCAL_LIVE_BASE}onnx/${name}.onnx`);
      const data = await read(`${LOCAL_LIVE_BASE}onnx/${name}.onnx_data`);
      if (!graph || !data)
        throw new Error(`Local Live model file is missing: ${name}.`);
      const preferredOutputLocation: Record<string, "gpu-buffer"> = {};
      if (name === "decoder_q4f16") {
        for (let i = 0; i < 24; i++) {
          if (i < 2 || i % 2 === 1)
            preferredOutputLocation[`present_conv.${i}`] = "gpu-buffer";
          else {
            preferredOutputLocation[`present.${i}.key`] = "gpu-buffer";
            preferredOutputLocation[`present.${i}.value`] = "gpu-buffer";
          }
        }
      }
      sessions[name] = await create(graph, {
        executionProviders: ["webgpu"],
        externalData: [{ path: `${name}.onnx_data`, data }],
        ...(name === "decoder_q4f16" ? { preferredOutputLocation } : {}),
      });
    }
    return sessions;
  } catch (error) {
    await Promise.allSettled(
      Object.values(sessions).map((session) => session.release()),
    );
    throw error;
  }
}
