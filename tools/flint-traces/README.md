# Twyne model explorer

Read-only, loopback-only workbench for saved harness benchmarks and provider traces.

```sh
rtk proxy python3 tools/flint-traces/server.py --port 8879
rtk proxy python3 -m unittest discover -s tools/flint-traces -p 'test_*.py' -v
rtk proxy node --check tools/flint-traces/app.js
rtk proxy python3 tools/flint-traces/server.py --export reports/flint-trace-explorer/twyne-model-explorer.html
```

Open http://127.0.0.1:8879. The export directory must already exist. The standalone HTML embeds gzip-compressed evidence and works from disk without the server in current Chromium browsers. It includes case outputs, source paths and hashes, raw requests/responses, and captured native telemetry. JSON downloads remain available offline.

## Evidence boundaries

- Benchmarks are separate saved run/suite groups. No pooled model ranking or cross-suite overall score is calculated.
- Canonically identical report copies collapse. Repeated case IDs stay separate samples. Distinct reports can contain overlapping/reused executions; record counts are not independent-trial counts.
- Harness execution, quality scores, missing/error scores, and app-case latency remain separate. Numeric means omit missing values. Scales retain their saved meanings.
- Not Organic identities describe recorded routes; they do not identify an underlying GPT, Claude, or other upstream model. The older robustness artifact explicitly records `neuralwatt/qwen3.5-397b-fast` and appears in separate probe suites.
- Case ID equality alone does not prove prompt equivalence. Only saved input hashes, or first captured original-message hashes when available, support the displayed comparisons. The latter prove only the first provider context. Current fixtures are never substituted for historical inputs.
- Historical case outputs/trace IDs do not reconstruct missing HTTP conversations or provider-only timing. Evaluator versions are often unrecorded, even when judge settings match.
- Supplemental post-hoc Jev evaluations attach only when their source path and exact file SHA-256 match. They do not add model trials or replace original-run scores.
- The original timeout batch is labeled as a failed transport preflight near 360 seconds. Corrected/future `reports/flint-timeout-batch-*` directories are discovered independently. Raw captures update every five seconds in the viewer, subject to artifact arrival and the two-second server cache.
- Stock/native Flint use different inference protocols; their comparison is not a weight-only ablation. Small pilot results are not model-wide accuracy.

Only explicit viewer assets, the original pilot report, index/detail projections, and a snapshot endpoint are served. There are no generation, execution, filesystem-write, cloud, or deployment endpoints. The UI never silently substitutes a first case or trace for an unknown URL identity.
