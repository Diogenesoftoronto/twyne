import * as ort from "onnxruntime-web/webgpu";
import { Tokenizer } from "@huggingface/tokenizers";
import { loadLocalLiveSessions } from "../utils/live-voice-local-sessions";
import { generateLocalLive } from "../utils/live-voice-local-inference";
ort.env.wasm.numThreads = 1;
const send = (value: unknown) => self.postMessage(value);
self.onmessage = () => {
  void (async () => {
    try {
      const read = async (url: string) => {
        const n = url.split("/").at(-1);
        const r = await fetch(`http://127.0.0.1:18743/${n}`, {
          cache: "no-store",
        });
        if (!r.ok) throw Error(`missing ${n}`);
        return await r.blob();
      };
      const t = new Tokenizer(
        JSON.parse(await (await read("tokenizer.json")).text()),
        JSON.parse(await (await read("tokenizer_config.json")).text()),
      );
      const start = performance.now();
      const sessions = await loadLocalLiveSessions(
        async (graph, opts) =>
          ort.InferenceSession.create(await graph.arrayBuffer(), opts),
        read,
      );
      send({ type: "loaded", ms: performance.now() - start });
      const b = await (
          await fetch("http://127.0.0.1:18743/short.wav", { cache: "no-store" })
        ).arrayBuffer(),
        dv = new DataView(b);
      let at = 12;
      while (String.fromCharCode(...new Uint8Array(b, at, 4)) !== "data")
        at += 8 + dv.getUint32(at + 4, true) + (dv.getUint32(at + 4, true) % 2);
      const len = dv.getUint32(at + 4, true) / 2,
        audio = Float32Array.from(
          { length: len },
          (_, i) => dv.getInt16(at + 8 + i * 2, true) / 32768,
        );
      const conv =
        "<|im_start|>system\nRespond with interleaved text and audio.<|im_end|>\n<|im_start|>user\n<|audio|><|im_end|>\n<|im_start|>assistant\n<|mixed_start|>";
      const chunks: Float32Array[] = [];
      let tokens: number[] = [],
        first = 0;
      const turn = performance.now();
      await generateLocalLive({
        ort,
        sessions,
        prompt: t.encode(conv, { add_special_tokens: false }).ids,
        audio,
        mode: "interleaved",
        cancelled: () => false,
        onOutput: (o) => {
          if (o.type === "audio") {
            if (!first) first = performance.now() - turn;
            chunks.push(o.samples);
          } else tokens.push(o.token);
        },
      });
      const elapsed = performance.now() - turn;
      const len2 = chunks.reduce((n, x) => n + x.length, 0),
        output = new Float32Array(len2);
      let p = 0;
      for (const c of chunks) {
        output.set(c, p);
        p += c.length;
      }
      const text = t.decode(tokens, { skip_special_tokens: true });
      send({
        type: "generated",
        text,
        first,
        ms: elapsed,
        duration: len2 / 24000,
        rtf: len2 / 24000 / (elapsed / 1000),
      });
      const asr =
        "<|im_start|>system\nPerform ASR in English.<|im_end|>\n<|im_start|>user\n<|audio|><|im_end|>\n<|im_start|>assistant\n";
      tokens = [];
      const input = Float32Array.from(
        { length: Math.floor((output.length * 2) / 3) },
        (_, i) => output[Math.floor(i * 1.5)],
      );
      await generateLocalLive({
        ort,
        sessions,
        prompt: t.encode(asr, { add_special_tokens: false }).ids,
        audio: input,
        mode: "text",
        cancelled: () => false,
        onOutput: (o) => {
          if (o.type === "token") tokens.push(o.token);
        },
      });
      send({
        type: "done",
        transcript: t.decode(tokens, { skip_special_tokens: true }),
      });
    } catch (e) {
      send({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : "",
      });
    }
  })();
};
