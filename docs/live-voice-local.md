# Local Live voice feasibility: preliminary hardware check

Status: TTS and one complete short voice-chat turn pass a model-ASR check with
ORT Web 1.23.2. The initial experiment below used a different runtime and is
not a valid speed benchmark. Phase 2 is in progress.

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

| File                      |         Bytes |
| ------------------------- | ------------: |
| `decoder_q4f16.onnx`      |       274,325 |
| `decoder_q4f16.onnx_data` | 1,413,388,288 |
| `audio_encoder.onnx`      |       162,507 |
| `audio_encoder.onnx_data` |   510,351,360 |
| `depth_decoder.onnx`      |        34,498 |
| `depth_decoder.onnx_data` |   335,597,568 |
| `codec_decoder.onnx`      |        94,000 |
| `codec_decoder.onnx_data` |   179,046,408 |
| Total                     | 2,438,948,954 |

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

| Measurement                                       | Result                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Downloaded graph and external-data bytes          | 2,438,948,954                                                                                                                                                                        |
| Session load, local files, one measured run       | 8.194 s                                                                                                                                                                              |
| Audio encoder including WAV fetch and log-mel     | 0.571 s                                                                                                                                                                              |
| Prefill complete, from turn start                 | 1.097 s                                                                                                                                                                              |
| First generated audio-code frame, from turn start | 2.065 s                                                                                                                                                                              |
| First playable audio                              | Not measured incrementally; this harness batch-decodes. Full WAV ready at 9.171 s                                                                                                    |
| Speech generation speed                           | 0.319 audio seconds / wall second, 18 intervals of 80 ms over 4.514 s between first and nineteenth frame                                                                             |
| Decoder slots per second                          | 4.08 slots/s: 19 frames plus 5 text tokens over 5.878 s from prefill completion to generation completion                                                                             |
| Output                                            | 19 frames, 1.52 s, 24 kHz WAV; nonzero signal, intelligibility unverified                                                                                                            |
| Peak system memory                                | Not measured. One non-peak process RSS snapshot during a run showed renderer 1,677,516 KiB and GPU process 898,972 KiB; these are not a combined peak and can include shared memory. |
| Peak GPU memory                                   | Not available from the tools checked; not measured                                                                                                                                   |

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
performance figure. This initial run did not validate correctness; see the follow-up below.

## Correctness follow-up: 2026-10-29

The initial results above used ORT Web `1.26.0-dev.20260416-b7804b056c` and
should **not** be used to select a speech path. For an identical TTS prefix
and one audio frame, its cached vs full-prefix decoder logits differed by up
to 10.988; native CPU ORT 1.23.2 differed by 0.031. Cached ORT Web 1.23.2
reduced the maximum difference to 0.271 (the two WebGPU values of the first
logit were 0.507 and 0.449). This isolates a substantial runtime-dependent
mismatch, but does not identify the responsible operator or driver.

With ORT Web 1.23.2, the reference TTS prompt and sentence “The quick brown fox
jumps over the lazy dog.” produced a 24 kHz WAV that the model transcribed
back to exactly that sentence using “Perform ASR in English.” With the
interleaved prompt, an `espeak-ng` 16 kHz question “What is two plus two?”
produced text “The answer is four.” and audio that the model's English ASR
transcribed as the same sentence. These are model-based checks, not a human
listening assessment. Outputs are in the local cache as `tts123.wav` and
`chatshort.wav`.

The worker was checked against LiquidONNX's Python implementation: audio and
output placeholder tokens, assistant mode markers, 16 kHz Slaney log-mel,
position advancement, cache names, three passes revealing four of 12 codes per
pass, and the 1,280-point periodic Hann inverse STFT with 320-sample hop. The
experimental chat mode also needed a transition to text after an audio EOS.
There is no validated multi-chunk prefill test, tool-calling test, interruption
test, or independent human listening assessment yet.

### Measurements on this laptop

These are one-run, local-file experiments, not a first-use device benchmark.
The speech path's rate includes generation from prefill completion through the
last slot; it excludes batch codec and inverse STFT. First playable audio was
not measured incrementally. The short complete turn used GPU-resident decoder
cache outputs and finished its 24 speech frames in 5.104 s after prefill: 1.92 s
of audio, **0.376 audio seconds/wall second**. Encoder including WAV fetch and
mel was 0.464 s; prefill finished at 0.817 s from turn start; batch codec took
0.123 s; the full batch WAV was ready at 8.518 s. Decoder steps took 0.496 s
for six text steps and 2.063 s for 25 audio steps (including the EOS step);
the depth decoder took 2.141 s over its three passes per frame. Thus neither
component alone accounts for the whole cost.

For the longer question, an 80-slot capped run produced 30 text tokens and 50
speech frames. Its speech rate was 0.315 with GPU-resident caches versus 0.201
with CPU-returned caches, measured over the interval from prefill completion
to generation completion. ASR matched the first spoken sentence, but the
response was truncated, so this is not a whole-turn validation. A separate
text-only reply reached 80 tokens in 14.801 s after prefill (**5.41 tokens/s**)
and was also capped. Supertonic speed has not yet been measured in combination.

Enabling graph capture with the experiment's CPU-returned logits and hidden
states failed with `Not supported preferred output location: cpu. Only
'gpu-buffer' location is supported when enableGraphCapture is true.` This is
not a test of an all-GPU fixed-shape graph. The local offline Python environment
did not contain `onnxconverter-common`, so no fp16 depth graph was exported.
The published recipe specifies three MaskGIT passes; fewer passes were not
claimed as supported or tested. The current slow laptop no longer gates phase
2: routing must benchmark each adapter and choose LFM speech, Supertonic, or
lagging local speech according to the writer's requested policy.


### Incremental codec probe

A follow-up on 2026-10-29 used the same short question and ORT Web 1.23.2,
with GPU-resident decoder caches. After the first generated speech frame, the
worker ran the codec on that frame and computed the first 1,440 PCM samples
(60 ms) of the inverse STFT. Those samples were computed **1.773 s after turn
start**, excluding the 8.651 s session load. This is a PCM-computation time,
not a measurement of delivery to the audio device or audible playback; the
probe did not post or play the samples. The first-frame codec output differed
from the corresponding prefix of the final 25-frame decode by at most
0.00000954 in STFT features. That provides a numerical check for this one
input, not proof that a streaming implementation handles all boundaries,
overlap, cancellation or longer conversations correctly.
