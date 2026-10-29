import type * as Ort from "onnxruntime-web/webgpu";
import { LocalLiveInverseStft } from "./live-voice-local-codec";
import type { LocalLiveGraph } from "./live-voice-local-sessions";

type Runtime = typeof import("onnxruntime-web/webgpu");
type Sessions = Record<LocalLiveGraph, Ort.InferenceSession>;
type OnOutput = (
  output:
    | { type: "token"; token: number }
    | { type: "audio"; samples: Float32Array },
) => void;
const AUDIO = 125031,
  AUDIO_OUT = 125032,
  AUDIO_START = 125012,
  TEXT_END = 125014,
  MIXED = 125015,
  END = 124900;

/** Reference Slaney log-mel frontend: 16 kHz, periodic Hann, 400 FFT / 160 hop. */
export function localLiveLogMel(wave: Float32Array): {
  data: Float32Array;
  frames: number;
} {
  const fft = 400,
    hop = 160,
    bins = 201;
  const frames = 1 + Math.ceil((Math.max(fft, wave.length) - fft) / hop);
  const result = new Float32Array(128 * frames);
  const logStep = Math.log(6.4) / 27;
  const maximum = 15 + Math.log(8) / logStep;
  const hz = (mel: number) =>
    mel < 15 ? (mel * 200) / 3 : 1000 * Math.exp((mel - 15) * logStep);
  const edges = Array.from({ length: 130 }, (_, i) => hz((maximum * i) / 129));
  const filters = Array.from({ length: 128 }, (_, m) =>
    Float64Array.from(
      { length: bins },
      (_, k) =>
        (Math.max(
          0,
          Math.min(
            (k * 40 - edges[m]) / (edges[m + 1] - edges[m]),
            (edges[m + 2] - k * 40) / (edges[m + 2] - edges[m + 1]),
          ),
        ) *
          2) /
        (edges[m + 2] - edges[m]),
    ),
  );
  const cos: Float64Array[] = [],
    sin: Float64Array[] = [];
  for (let k = 0; k < bins; k++) {
    cos[k] = new Float64Array(fft);
    sin[k] = new Float64Array(fft);
    for (let j = 0; j < fft; j++) {
      const a = (2 * Math.PI * k * j) / fft,
        win = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / fft);
      cos[k][j] = Math.cos(a) * win;
      sin[k][j] = Math.sin(a) * win;
    }
  }
  for (let t = 0; t < frames; t++) {
    const power = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      let re = 0,
        im = 0;
      for (let j = 0; j < fft; j++) {
        const x = wave[t * hop + j] ?? 0;
        re += x * cos[k][j];
        im += x * sin[k][j];
      }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < 128; m++) {
      let v = 0;
      for (let k = 0; k < bins; k++) v += power[k] * filters[m][k];
      result[m * frames + t] = (Math.max(-12, Math.log10(v)) + 4) / 4;
    }
  }
  return { data: result, frames };
}

function sample(
  logits: Float32Array,
  offset: number,
  book: number,
  history: number[][],
): number {
  const scores: Array<[number, number]> = [];
  for (let i = 0; i < 2017; i++) {
    let x = logits[offset + i];
    if (history.some((frame) => frame[book] === i))
      x = x < 0 ? x * 1.1 : x / 1.1;
    scores.push([x, i]);
  }
  scores.sort((a, b) => b[0] - a[0]);
  const top = scores.slice(0, 128),
    weights = top.map(([x]) => Math.exp(x - top[0][0]));
  let random = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++)
    if ((random -= weights[i]) <= 0) return top[i][1];
  return top[0][1];
}

/** One fresh turn. The caller supplies prompt tokens and handles text decoding. */
export async function generateLocalLive(options: {
  ort: Runtime;
  sessions: Sessions;
  prompt: number[];
  audio?: Float32Array;
  mode: "text" | "interleaved";
  cancelled: () => boolean;
  onOutput: OnOutput;
  maxSlots?: number;
}): Promise<void> {
  const { ort, sessions, cancelled, onOutput } = options;
  const I = (data: number[], dims: number[]) =>
    new ort.Tensor("int64", BigInt64Array.from(data, BigInt), dims);
  const F = (data: Float32Array, dims: number[]) =>
    new ort.Tensor("float32", data, dims);
  const check = () => {
    if (cancelled())
      throw new DOMException("Generation cancelled", "AbortError");
  };
  let features: Ort.Tensor | null = null;
  if (options.audio) {
    const mel = localLiveLogMel(options.audio);
    check();
    features = (
      await sessions.audio_encoder.run({
        input_features: F(mel.data, [1, 128, mel.frames]),
      })
    ).audio_features;
    check();
  }
  const prompt = options.prompt.flatMap((token) =>
    token === AUDIO
      ? (Array(features?.dims[0] ?? 0).fill(AUDIO) as number[])
      : [token],
  );
  if (!prompt.length) throw new Error("Local Live prompt is empty.");
  const cache: Record<string, Ort.Tensor> = {};
  for (const metadata of sessions.decoder_q4f16.inputMetadata) {
    if (!metadata.name.startsWith("past")) continue;
    if (!metadata.isTensor)
      throw new Error(`Invalid cache metadata: ${metadata.name}`);
    const dims = metadata.shape.map((value) =>
      typeof value === "number" ? value : value.includes("sequence") ? 0 : 1,
    );
    cache[metadata.name] = new ort.Tensor(
      "float16",
      new Uint16Array(dims.reduce((a, b) => a * b, 1)),
      dims,
    );
  }
  let past = 0;
  async function step(
    ids: number[],
    audio: Ort.Tensor | null,
    codes: number[],
  ): Promise<Record<string, Ort.Tensor>> {
    check();
    const n = ids.length;
    const result = await sessions.decoder_q4f16.run({
      input_ids: I(ids, [1, n]),
      attention_mask: I(Array(past + n).fill(1), [1, past + n]),
      position_ids: I(
        Array.from({ length: n }, (_, i) => past + i),
        [1, n],
      ),
      audio_features: audio ?? F(new Float32Array(0), [0, 2048]),
      audio_out_codes: I(codes, [codes.length / 12, 12]),
      logits_to_keep: I([1], [1]),
      ...cache,
    });
    for (const [key, value] of Object.entries(result)) {
      const input = key.startsWith("present_conv.")
        ? key.replace("present_conv.", "past_conv.")
        : key.startsWith("present.")
          ? key.replace("present.", "past_key_values.")
          : null;
      if (input) {
        cache[input]?.dispose();
        cache[input] = value;
      }
    }
    past += n;
    check();
    return result;
  }
  let result: Record<string, Ort.Tensor> | undefined,
    featureIndex = 0;
  for (let start = 0; start < prompt.length; start += 1024) {
    const ids = prompt.slice(start, start + 1024),
      count = ids.filter((x) => x === AUDIO).length;
    const rows =
      count && features
        ? F(
            (features.data as Float32Array).slice(
              featureIndex * 2048,
              (featureIndex + count) * 2048,
            ),
            [count, 2048],
          )
        : null;
    featureIndex += count;
    result = await step(ids, rows, []);
  }
  if (!result) throw new Error("Local Live prefill failed.");
  let speaking = false,
    textDone = false,
    slots = 6,
    mode = options.mode;
  const history: number[][] = [],
    frames: number[][] = [];
  const inverse = new LocalLiveInverseStft();
  let emittedRows = 0;
  let complete = false;
  try {
    for (let index = 0; index < (options.maxSlots ?? 512); index++) {
      check();
      let ids: number[],
        codes: number[] = [];
      if (speaking) {
        const frame = Array(12).fill(0) as number[],
          masked = Array(12).fill(1) as number[];
        const order = Array.from({ length: 12 }, (_, i) => i);
        for (let i = 11; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        for (let pass = 0; pass < 3; pass++) {
          check();
          const output = await sessions.depth_decoder.run({
            hidden_states: F(
              result.hidden_states.data as Float32Array,
              [1, 2048],
            ),
            codes: I(frame, [1, 12]),
            masked: new ort.Tensor("bool", Uint8Array.from(masked), [1, 12]),
          });
          for (const book of order.slice(pass * 4, pass * 4 + 4)) {
            frame[book] = sample(
              output.logits.data as Float32Array,
              book * 2017,
              book,
              history,
            );
            masked[book] = 0;
          }
          output.logits.dispose();
        }
        if (frame.includes(2016)) {
          frame.fill(2016);
          speaking = false;
          textDone = false;
          mode = "text";
        } else {
          frames.push(frame);
          history.push(frame);
          if (history.length > 4096) history.shift();
          const flattened = Array.from({ length: 12 }, (_, book) =>
            frames.map((f) => f[book]),
          ).flat();
          const codec = await sessions.codec_decoder.run({
            audio_codes: I(flattened, [1, 12, frames.length]),
          });
          check();
          const rows = codec.stft_features.dims[1];
          const chunk = inverse.append(
            (codec.stft_features.data as Float32Array).slice(
              emittedRows * 1282,
              rows * 1282,
            ),
          );
          emittedRows = rows;
          codec.stft_features.dispose();
          if (chunk.length) onOutput({ type: "audio", samples: chunk });
        }
        ids = [AUDIO_OUT];
        codes = frame;
      } else {
        const logits = result.logits.data as Float32Array;
        let best = -Infinity,
          token = 0;
        for (let i = 0; i < logits.length; i++) {
          if (
            i === AUDIO ||
            i === AUDIO_OUT ||
            (options.mode === "text" && (i === AUDIO_START || i === MIXED))
          )
            continue;
          if (logits[i] > best) {
            best = logits[i];
            token = i;
          }
        }
        onOutput({ type: "token", token });
        ids = [token];
        if (token === END) {
          complete = true;
          break;
        }
        if (token === TEXT_END) {
          if (mode === "interleaved") {
            textDone = true;
            speaking = true;
          } else {
            complete = true;
            break;
          }
        }
      }
      if (mode === "interleaved" && !textDone && --slots === 0) {
        speaking = !speaking;
        slots = speaking ? 12 : 6;
      }
      result = await step(ids, null, codes);
      // Let cancellation messages run between inference steps.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    check();
    if (!complete)
      throw new Error(
        "Local Live reached its response limit before finishing.",
      );
    const tail = inverse.finish();
    if (tail.length) onOutput({ type: "audio", samples: tail });
  } finally {
    for (const tensor of Object.values(cache)) tensor.dispose();
  }
}
