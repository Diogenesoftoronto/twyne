# Optimizing prompts with `prompt-learning`

`evals/optimize_prompts.py` runs the
[vendored `prompt-learning` SDK](../tools/prompt-learning/TOOLS_PATCHES.md)
against one of our `.md` prompt files. The wrapper supplies a Not Organic
provider and accepts the hosted text aliases `fast`, `balanced`, and `reasoning`.
The shared TypeScript client handles assertion exchange, DPoP, metering and
idempotency; the Python provider reserves the approved per-call ceiling.

## One-time setup

```bash
python -m venv .venv-prompt-learning
.venv-prompt-learning/bin/pip install -e tools/prompt-learning
```

## Selecting a target

The first prompt to optimize is the one whose failures you can actually
describe in plain words — `integrity-judge-system` and
`citation-format-system` are good first targets because each has a
specific failure surface and a single, attributable judge model in
`evals/judge.ts`. The room-of-editors `persona-system` is the
biggest-blast-radius target but also the slowest to converge because
its failures spread across all five personas.

## CSV shape

The driver expects a pandas-shaped CSV with at least:

- an `output` column: the model's previous output for that case
- a `feedback` column: free-form natural-language feedback for each row
  (why the output was wrong, what was missing, etc.)
- any other columns whose names appear as `{vars}` in the `.md` body

Twyne's existing eval JSONL files (`evals/rubric.jsonl`, etc.) get
reshaped into this format by hand or with a tiny TS pre-step that joins
the eval output with `rubric-scores.json` and emits a CSV.

## Run

```bash
# dry-run: load + parse everything, skip the optimizer (no API call)
bun run prompts:optimize:dry -- --prompt integrity-judge-system \
    --csv evals/datasets/integrity-judge.csv --model reasoning

# Real run: load Not Organic assertion settings, TWYNE_EVAL_DID, and an
# approved TWYNE_EVAL_MAX_COST_MICROUSD from your protected secret store.
# See README.notorganic.md. No upstream key belongs in this tool.
python evals/optimize_prompts.py --prompt integrity-judge-system \
    --csv evals/datasets/integrity-judge.csv --model reasoning --budget 2.00
```

The driver writes `prompts/integrity-judge-system.md.new` (not in place)
so you read the diff before swapping:

```bash
diff -u prompts/integrity-judge-system.md prompts/integrity-judge-system.md.new
mv prompts/integrity-judge-system.md.new prompts/integrity-judge-system.md
bun test  # verify regression tests still pass
```

## Cost guardrails

`--budget` is a required USD ceiling for a live run. The subprocess provider
reserves the entire `TWYNE_EVAL_MAX_COST_MICROUSD` before every logical call,
including uncertain failures. This conservative accounting may stop before
actual charges reach the run ceiling. The gateway separately enforces wallet
access and the per-call ceiling. Failed or incomplete runs do not stage a prompt.

## Inspecting candidate quality

The optimizer returns the candidate it liked best under its internal
Agent → Evaluator → Meta-Prompt loop. It's not always an improvement; it
is _always_ a candidate. The decision to take it is yours, in the diff
review. Treat the output as "a colleague proposed this", not "the system
decided this".

## Updating the SDK

Preserve the custom provider injection interface and run the offline contracts
when updating the vendored SDK. See `TOOLS_PATCHES.md` for the integration and
`README.notorganic.md` for server-only configuration.
