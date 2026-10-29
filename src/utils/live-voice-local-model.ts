import {
  downloadModelBundle,
  evictModelBundle,
  isModelBundleDownloaded,
  modelDownloadState,
  type ModelFileManifest,
} from "./models-cache";

/** Pin the graphs and tokenizer together: their token and tensor contracts must match. */
export const LOCAL_LIVE_MODEL_ID = "lfm3-audio-2b";
export const LOCAL_LIVE_REVISION = "df2b3ed2ea10824030b3ff29ee46705754e72b99";
export const LOCAL_LIVE_BASE = `https://huggingface.co/LiquidAI/LFM3-Audio-2B-ONNX/resolve/${LOCAL_LIVE_REVISION}/`;
export const LOCAL_LIVE_MANIFEST: ModelFileManifest[] = [
  ["onnx/decoder_q4f16.onnx", 274325],
  ["onnx/decoder_q4f16.onnx_data", 1413388288],
  ["onnx/audio_encoder.onnx", 162507],
  ["onnx/audio_encoder.onnx_data", 510351360],
  ["onnx/depth_decoder.onnx", 34498],
  ["onnx/depth_decoder.onnx_data", 335597568],
  ["onnx/codec_decoder.onnx", 94000],
  ["onnx/codec_decoder.onnx_data", 179046408],
  ["tokenizer.json", 17908634],
  ["tokenizer_config.json", 674],
  ["config.json", 6243],
  ["processor_config.json", 773],
  ["audio_tokenizer/config.json", 801],
  ["chat_template.jinja", 9328],
  ["generation_config.json", 382],
  ["special_tokens_map.json", 92],
].map(([path, size]) => ({
  url: `${LOCAL_LIVE_BASE}${path}`,
  size: size as number,
}));

export const localLiveDownloadState = () =>
  modelDownloadState(LOCAL_LIVE_MODEL_ID, LOCAL_LIVE_MANIFEST);
export const isLocalLiveDownloaded = () =>
  isModelBundleDownloaded(LOCAL_LIVE_MODEL_ID, LOCAL_LIVE_MANIFEST);
export const downloadLocalLive = (signal?: AbortSignal) =>
  downloadModelBundle(LOCAL_LIVE_MODEL_ID, LOCAL_LIVE_MANIFEST, { signal });
export const evictLocalLive = () =>
  evictModelBundle(LOCAL_LIVE_MODEL_ID, LOCAL_LIVE_MANIFEST);
