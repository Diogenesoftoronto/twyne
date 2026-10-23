# Hosted evaluation and prompt optimization

Twyne's hosted evaluations use Not Organic. They do not hold upstream model
credentials. Not Organic remains responsible for authorization, wallet funds,
model routing, reservations and settlement.

Load these server-only settings from a protected secret store without printing
values into chat, logs, command arguments, or committed files:

- `NOTORGANIC_ENABLED=true`
- `NOTORGANIC_ASSERTION_PRIVATE_KEY`: Twyne's registered Ed25519 signing key
- `NOTORGANIC_ASSERTION_KEY_ID`: its registered key ID, when configured
- `NOTORGANIC_AUDIENCE=notorganic`
- `NOTORGANIC_ISSUER`: an HTTPS origin; defaults to `https://api.notorganic.info`
- `TWYNE_EVAL_DID`: explicitly select the account paying for these calls
- `TWYNE_EVAL_MAX_COST_MICROUSD`: an approved positive integer per-call ceiling

The selected account must already have valid product access and sufficient
wallet funds. The harness does not grant access or create credit. The gateway
may tighten the ceiling based on its token or model-alias limits.

`TWYNE_EVAL_MODEL` defaults to `balanced`; `JUDGE_MODEL` defaults to `reasoning`.
Hosted text models accept only `fast`, `balanced`, or `reasoning`. Each logical
generation receives its own idempotency identity; transient retries reuse it
while creating fresh DPoP proofs. Requests do not fall back to direct providers.

Run the existing `bun run eval`, `eval:judge`, `eval:rubric`, `eval:apparatus`,
`eval:interview`, or `eval:robustness` command after loading the settings. These
suites can make many paid calls; approve the per-call ceiling and suite size
before starting. Extraction's free mode-only check is explicit:

```bash
bun run eval:extract --mode-only
```

Prompt optimization uses a stdin/stdout Bun subprocess, without a network
listener. The Python wrapper requires the SDK dependencies and Bun on PATH:

```bash
python evals/optimize_prompts.py --prompt integrity-judge-system \
  --csv evals/datasets/integrity-judge.csv --model reasoning --budget 2.00
```

The USD run ceiling is explicit. The provider reserves the entire per-call
ceiling for each logical request, including uncertain failures; it does not
estimate provider prices or refund uncertain requests. This can stop a run
early. No candidate is written after provider failure or budget exhaustion.
`--dry-run` loads the dataset without contacting a provider.

Offline contract tests do not spend funds:

```bash
bun test evals/llm-client.test.ts tests/notorganic-provider.test.ts
python -m unittest discover -s evals -p 'test_notorganic_optimizer.py'
# With SDK dependencies installed, test the full offline subprocess pipeline:
python -m unittest discover -s evals -p 'test_optimize_prompts_integration.py'
```

On deployment, remove the retired direct-gateway environment entries from
Convex, Railway, local dotenv files, and secret-store entries. Enable Not Organic
and configure the existing generation ceiling before testing hosted AI with a
linked account. Revoke retired credentials after the replacement path is
verified. Source changes alone do not remove deployed credentials.
