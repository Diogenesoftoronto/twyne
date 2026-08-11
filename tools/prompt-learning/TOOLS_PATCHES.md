# Patches applied to the vendored `prompt-learning` SDK

The upstream SDK pinned to `main` only accepts `["o1", "o3", "gpt-4o", "gpt-4",
"gpt-3.5-turbo", "gpt-3.5"]` in its `SUPPORTED_MODELS` allowlist, hardcodes an
OpenAI client with no `base_url` threading, and falls back to `tiktoken` for
cost budgeting (which has no encoders for Claude/Gemini or for any GPT-5.x
variant). Together those three things blocked us from using modern models
through our Portkey gateway.

We bake the three patches locally so the next upgrade from upstream is a
visible diff. Each patch is wrapped in a `# twyne extension (see
TOOLS_PATCHES.md):` comment so `git grep "twyne extension"` finds it later.

## Patches

### `optimizer_sdk/constants.py` — extend `SUPPORTED_MODELS`

Append the modern OpenAI, Anthropic, and Google model names that we want
to be able to call via Portkey. The SDK's allowlist was the only thing
keeping us from naming e.g. `gpt-5` or `claude-sonnet-5`.

### `optimizer_sdk/prompt_learning_optimizer.py` — read `OPENAI_BASE_URL`

The OpenAI fallback path constructs `OpenAI(api_key=...)` with no way to
route through a gateway. We add three env-var hooks:

- `OPENAI_BASE_URL` — sets the gateway URL.
- `PORTKEY_PROVIDER` — sets the `x-portkey-provider` header (e.g. `openai`,
  `anthropic`, `google`).
- `PORTKEY_VIRTUAL_KEY` — sets the `x-portkey-api-key` header for a virtual
  key configured in the Portkey dashboard.

Net change: three short lines when env vars are unset (the SDK still calls
raw OpenAI as before), and a route through Portkey when they are set.

### `optimizer_sdk/tiktoken_splitter.py` — modern-model fallback

`gpt-5.6-*`, `claude-*`, and `gemini-*` have no `tiktoken` encoders. The
SDK uses `tiktoken` to estimate tokens for cost budgeting and batch sizing
only, not for any correctness, so falling through to the `gpt-4` encoder
for these is an adequate length proxy.

## How to upgrade from upstream

```bash
# from the repo root
git clone --depth 1 https://github.com/Arize-ai/prompt-learning.git /tmp/upstream-pl
diff -ru tools/prompt-learning/optimizer_sdk/ /tmp/upstream-pl/optimizer_sdk/
# apply the same three local patches, in the same files
```

The intent is that when upstream accepts modern models natively (or grows
its own gateway support), we delete this file and undo the patches.
