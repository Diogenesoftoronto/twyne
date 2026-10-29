# Local Live voice feasibility: preliminary hardware check

Status: **not ready for phase 2**. A WebGPU worker produced audio-code frames
slower than real time and a 24 kHz WAV, but the output has not passed a speech
sanitation check. The timings below are experimental, not a validated voice-chat
benchmark.

On 2026-10-29, Playwright's cached Chromium was launched on this Linux machine
with `LD_LIBRARY_PATH` unset, `--enable-unsafe-webgpu`, and
`--enable-features=Vulkan`. On a localhost secure context, headed Chromium
reported a WebGPU adapter with vendor `intel`, architecture `gen-12lp`,
`isFallbackAdapter: false`, and `shader-f16` support. With the same flags,
headless Chromium instead selected the Google SwiftShader fallback and did not
expose `shader-f16`. Use headed Chromium for the actual experiment, and verify
the adapter rather than relying on `navigator.gpu` alone.

The model repository API at revision
`df2b3ed2ea10824030b3ff29ee46705754e72b99` reports these sizes for the
requested WebGPU combination. The ONNX graphs use separate external data files:

| File | Bytes |
| --- | ---: |
| `decoder_q4f16.onnx` | 274,325 |
| `decoder_q4f16.onnx_data` | 1,413,388,288 |
| `audio_encoder.onnx` | 162,507 |
| `audio_encoder.onnx_data` | 510,351,360 |
| `depth_decoder.onnx` | 34,498 |
| `depth_decoder.onnx_data` | 335,597,568 |
| `codec_decoder.onnx` | 94,000 |
| `codec_decoder.onnx_data` | 179,046,408 |
| Total | 2,438,948,954 |

The eight files were downloaded into `~/.cache/twyne-lfm3/` and their sizes
matched this table. Tokenizer assets were downloaded separately. Sessions read
from a local HTTP server and used explicit external-data URLs; the application
model cache was not used. No files were fetched through the hosted gateway.

## Worker experiment

Playwright Chromium headless with `--headless=new --enable-unsafe-webgpu
--enable-features=Vulkan --use-angle=vulkan --enable-gpu` selected Intel
`gen-12lp`, non-fallback, with `shader-f16`. No window was opened. The worker
used the existing main checkout's `onnxruntime-web`
`1.26.0-dev.20260416-b7804b056c`; no dependency was added to this worktree.
The input was LiquidONNX's `samples/audio/woodworks_question.wav`, mono PCM16,
16 kHz, 78,463 samples. The worker performed log-mel, audio encoding, decoder
prefill (one 83-token chunk), interleaved decoder steps, three depth passes per
speech frame, codec decoding and inverse STFT. It used greedy text and the
model-card speech sampling settings. The experimental worker is in
`tools/live-voice-local-spike/worker.mjs`; it is not production code.

| Measurement | Result |
| --- | --- |
| Downloaded graph and external-data bytes | 2,438,948,954 |
| Session load, local files, one measured run | 8.194 s |
| Audio encoder including WAV fetch and log-mel | 0.571 s |
| Prefill complete, from turn start | 1.097 s |
| First generated audio-code frame, from turn start | 2.065 s |
| First playable audio | Not measured incrementally; this harness batch-decodes. Full WAV ready at 9.171 s |
| Speech generation speed | 0.319 audio seconds / wall second, 18 intervals of 80 ms over 4.514 s between first and nineteenth frame |
| Decoder slots per second | 4.08 slots/s: 19 frames plus 5 text tokens over 5.878 s from prefill completion to generation completion |
| Output | 19 frames, 1.52 s, 24 kHz WAV; nonzero signal, intelligibility unverified |
| Peak system memory | Not measured. One non-peak process RSS snapshot during a run showed renderer 1,677,516 KiB and GPU process 898,972 KiB; these are not a combined peak and can include shared memory. |
| Peak GPU memory | Not available from the tools checked; not measured |

The generation emitted text tokens decoded as `<|mixed_start|><|mixed_start|>Each<|text_end|><|im_end|>`.
A separate attempt to transcribe the generated WAV with the same model and
`Perform ASR.` produced repeated `The` tokens until the 80-slot limit. This is
not evidence that the output is intelligible speech; the experimental prompt,
preprocessing, sampling, cache handling and inverse STFT still need validation
against a reference implementation. The WAV is at
`~/.cache/twyne-lfm3/answer.wav`. One prior run generated 76 frames at roughly
0.25–0.29 s per frame, but was capped at 80 slots and did not save its output.

The measured code-frame rate is below the 12.5 frames/s needed for 24 kHz
real-time audio, even before incremental codec decoding. Because correctness
is unverified, this does not establish an optimal or production-quality
performance figure. Do not integrate the desk until a correct implementation
passes an audible or independent transcription check and meets the speed gate.
