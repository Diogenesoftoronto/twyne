# Local decisions with Liquid d1-2B

Settings → Judgement model → **Local decisions** selects `LiquidAI/d1-2B`
on this computer. **Download local decisions** installs the pinned runtime and
model. **Test** sends a sample question through the same route as editorial
judgements. No account or API key is required for that route.

This is a native helper, not browser inference. The Electrobun shell starts the
helper when Python is available; browser users can run it from a source checkout:

```sh
python3 desktop/decision/server.py
```

Install Python 3.11–3.13 and [uv](https://docs.astral.sh/uv/) first. The download
button requires internet, approximately 3.85 GB for model files, additional space
for Python dependencies, and at least 10 GB free on the model drive. Linux and
Windows use CPU PyTorch wheels; macOS can use MPS. CPU checks can be slow. No
hardware performance or editorial-quality benchmark has been established here.

The model revision is `652f920e544ea37f81e4b0ce89b81d4ed0da90b1`. Every model
file has a pinned size and SHA-256 in `desktop/decision/model.json`. The model's
Python implementation is downloaded at that revision and executed locally under
the [LFM Open License](https://huggingface.co/LiquidAI/d1-2B/blob/652f920e544ea37f81e4b0ce89b81d4ed0da90b1/LICENSE).
Python packages and artifact hashes are locked in `worker.py.lock`.

## Offline operation

After the download finishes, keep the helper running, select Local decisions,
disconnect the network and use **Test**. Restarting the helper also works offline
provided its uv environment, model files and Python interpreter remain installed.
Inference launches with `uv run --frozen --offline`, `HF_HUB_OFFLINE=1`,
`TRANSFORMERS_OFFLINE=1`, telemetry disabled and `local_files_only=True`.
The worker verifies downloaded files before loading. There is no hosted fallback.

Only typed decisions use this route: Noul, Choice and Score. Prose generation,
web research, speech, sync and initial loading of the hosted app have separate
requirements. This does not make the Electrobun shell's hosted frontend available
on a fresh offline launch. An already loaded/offline-cached editor is needed to
use the UI without internet.

The helper binds `127.0.0.1:8010`. It accepts JSON only from `https://twyne.love`
and explicitly configured origins, checks the Host header, and does not log
manuscripts or requests. For local development, add the exact frontend origin:

```sh
python3 desktop/decision/server.py --origin http://127.0.0.1:5173
```

Models live under `$XDG_CACHE_HOME/twyne/decisions` or
`~/.cache/twyne/decisions`. `--cache /another/drive/twyne-decisions` changes the
model location; uv maintains its own dependency cache (`UV_CACHE_DIR` can move
that too). `TWYNE_PYTHON` and `TWYNE_DECISION_SERVER` override the desktop's
interpreter and helper script paths. If port 8010 is already in use, stop the
other service first. Settings validates the service's model identity.

Downloads can be retried after interruption; incomplete files are never treated
as installed. A single download or inference runs at a time; overlapping requests
receive an unavailable result. Inference has a bounded timeout and reports local
failure instead of switching providers. Quit the helper to stop inference. To
remove the model, stop the helper and delete only its model directory. Removing
uv's cached environment makes another online runtime installation necessary.

## Verification

```sh
python3 -m unittest discover -s desktop/decision -p 'test_*.py' -v
bun test src/utils/local-decisions.test.ts
```

These tests cover transport, offline launch flags, typed response validation,
download guards, origin restrictions and local failure behavior using synthetic
IPC responses. They do not establish actual model quality or real offline d1
inference. A real model download and disconnected inference test still need a
machine with sufficient free disk space.

## Local quotation extraction

Configure LFM3, Gemma 4 E4B, or Gemma 4 E2B as an OpenAI-compatible chat
provider on this device in **Settings → AI** and enable your own providers.
Twyne prefers LFM3, then E4B, then E2B, for quotation extraction in editorial
reads. It uses the model's configured loopback URL and accepts only exact,
unambiguous quotations. Estimates and forecasts keep their existing routes.

## Local sentence and paragraph alternatives

In **Settings → AI**, choose a local provider for **Alternatives**. The desktop
Gemma 4 provider can fill this role when installed. DiffusionGemma can be selected
as a custom OpenAI-compatible model if your local runtime serves its chat API.
Google’s reference build uses the experimental 26B-A4B model.
