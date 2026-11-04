import { expect, test } from "bun:test";
import { loadLocalLiveSessions } from "./live-voice-local-sessions";

test("uses cached graph and external data for every session", async () => {
  const paths: string[] = [];
  const sessions = await loadLocalLiveSessions(
    async (_graph, options) => {
      paths.push(options.externalData[0].path);
      return { release: async () => {} };
    },
    async () => new Blob(["cached"]),
  );
  expect(Object.keys(sessions)).toHaveLength(4);
  expect(paths).toEqual([
    "decoder_q4f16.onnx_data",
    "audio_encoder.onnx_data",
    "depth_decoder.onnx_data",
    "codec_decoder.onnx_data",
  ]);
});

test("releases loaded sessions if a later file is missing", async () => {
  let released = 0;
  await expect(
    loadLocalLiveSessions(
      async () => ({
        release: async () => {
          released++;
        },
      }),
      async (url) =>
        url.includes("depth_decoder") ? null : new Blob(["cached"]),
    ),
  ).rejects.toThrow("depth_decoder");
  expect(released).toBe(2);
});
