# Local Live voice feasibility: preliminary hardware check

Status: **incomplete; real-time feasibility is unknown**. No model was
downloaded or run, and no spoken turn was generated. Do not use this check as
approval to integrate the local transport.

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

This is a repository-reported size, not a measured download; tokenizer and
configuration files add to it. The checkout had no `node_modules`; the
hardware check used Playwright from the main Twyne checkout. Free disk at the
time was approximately 16 GiB.

| Requested measurement | Result |
| --- | --- |
| Actual downloaded bytes | Not measured |
| Load time | Not measured |
| Time to first audio | Not measured |
| Speech generation real-time factor | Not measured |
| Peak memory | Not measured |

The next experiment must download the pinned bundle through the Twyne model
cache, load it in a worker using the WebGPU ORT entry point and external data,
and run an actual WAV-to-speech turn. The cache currently requires `window` in
its availability check, so worker access needs explicit attention. Report
the measurements and any failure before proceeding to the desk UI.
