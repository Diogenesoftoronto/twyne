# Optimizing prompts with `prompt-learning`

`evals/optimize_prompts.py` runs the
[vendored `prompt-learning` SDK](../tools/prompt-learning/TOOLS_PATCHES.md)
against one of our `.md` prompt files. Three things make it usable where
the upstream SDK was not: the SDK is locally patched to accept modern
models (`gpt-5`, `claude-sonnet-5`, `gemini-3.1-pro`, …) and to route
through our Portkey gateway.

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
    --csv evals/datasets/integrity-judge.csv --model gpt-5

# real run (needs OPENAI_API_KEY + OPENAI_BASE_URL in env, or Portkey creds)
export OPENAI_API_KEY="$(skate get portkey_twyne_api_key)"
export OPENAI_BASE_URL="https://api.portkey.ai/v1"
export PORTKEY_PROVIDER="openai"
export PORTKEY_VIRTUAL_KEY="<from Portkey dashboard>"
bun run prompts:optimize -- --prompt integrity-judge-system \
    --csv evals/datasets/integrity-judge.csv --model gpt-5 --budget 2.00
```

The driver writes `prompts/integrity-judge-system.md.new` (not in place)
so you read the diff before swapping:

```bash
diff -u prompts/integrity-judge-system.md prompts/integrity-judge-system.md.new
mv prompts/integrity-judge-system.md.new prompts/integrity-judge-system.md
bun test  # verify regression tests still pass
```

## Cost guardrails

`--budget` is a USD ceiling for the optimizer's own LLM calls. The SDK
aborts gracefully when the budget runs out, returning whatever candidate
it had at that point. A typical run on 50 rows with `gpt-5` lands around
**$0.30–$1.00** depending on prompt length; start with `--budget 2.00`.

## Inspecting candidate quality

The optimizer returns the candidate it liked best under its internal
Agent → Evaluator → Meta-Prompt loop. It's not always an improvement; it
is *always* a candidate. The decision to take it is yours, in the diff
review. Treat the output as "a colleague proposed this", not "the system
decided this".

## When the patches are no longer needed

If/when upstream lands (a) the modern-model allowlist natively and
(b) gateway support, drop the three patches in
`tools/prompt-learning/optimizer_sdk/{constants,prompt_learning_optimizer,tiktoken_splitter}.py`
and delete `TOOLS_PATCHES.md`. See that file for the upgrade recipe.
