# Twyne integration of the vendored prompt-learning SDK

Twyne invokes this SDK from `evals/optimize_prompts.py` with a dedicated
`NotOrganicOptimizerProvider`. It starts `evals/notorganic-chat.ts` as a Bun
subprocess and exchanges prompts/results over stdin/stdout. No local HTTP
listener is exposed. The TypeScript client reuses the application assertion
exchange, DPoP signing, approved generation ceiling, and retry idempotency.

Live runs require an explicitly selected account DID, assertion signing
configuration, a per-call ceiling, and `--budget`. The Python provider reserves
the full per-call ceiling before dispatch, conservatively bounding the run.
The wrapper refuses to write a candidate when the SDK catches a provider error.
See `evals/README.notorganic.md` for setup and offline checks.

The local model allowlist includes the hosted text aliases `fast`, `balanced`,
and `reasoning`. The SDK's approximate token counter is selected for this custom
provider. Modern direct-model names remain in the vendored allowlist for
upstream compatibility; the Twyne wrapper accepts only hosted aliases.

When upgrading the vendored SDK, preserve the provider injection interface and
rerun Twyne's client and optimizer contract tests. Do not reintroduce upstream
credential routing in the Twyne wrapper.

The wrapper imports the actual vendored optimizer module. The SDK no longer
imports an unused removed Phoenix class. This snapshot lacked the two default
meta-prompt constants required at import time; explicit local revision templates
now preserve task constraints and placeholders. MetaPrompt no longer writes
raw prompt/dataset contents to an unsolicited `metaprompt.txt` file.
