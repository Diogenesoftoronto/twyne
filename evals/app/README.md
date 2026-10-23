# App evals

The other scripts in `evals/` replay Twyne's prompts straight at a model. These
drive the app itself, through the surfaces an outside agent would use: the
`twyne-mcp` tools and the `twyne` CLI, talking to `/api/integrations/v1` with a
personal access token. A score here moves when anything on the production path
moves: the prompt, the `quote_passage` tool loop, adaptive drafting, the
parsers, the rubric arithmetic, the integration route, or the model.

```
run.ts ──MCP──▶ twyne-mcp ──▶ /api/integrations/v1 ──▶ convex/ (same actions the browser runs)
       ──CLI──▶ twyne     ──┘                                    │
                                                                 ▼
                                        mock │ any OpenAI-compatible model │ Not Organic
```

The operations behind the tools are documented in `docs/app-harness.md`.

## Running

```sh
bun run eval:app                                  # every suite, scripted model, no judge
bun run eval:app -- --suite room --limit 2        # one suite, two cases
bun test evals/app                                # the harness's own test (mock model, ~5s)
```

By default the app runs **in-process**: `local-app.ts` loads every module in
`convex/` with `convex-test`, serves the real HTTP router on a local port, and
gives each case its own writer and token, because rate limits are per writer.
Nothing is deployed and no account is touched. The token path runs the same
editorial pipeline as a signed-in writer: provider choice, the research tools,
the System One review gate and its redraft loop, rate limits and usage capture.

| flag           | values                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--model`      | `mock` (default)                                    | scripted endpoint in `mock-model.ts`; tests the plumbing, not the writing                                                                                                                                                                                                                                                                                                                                                                                                   |
|                | `openai-compatible`                                 | `TWYNE_APP_MODEL_BASE_URL`, `TWYNE_APP_MODEL`, optional `TWYNE_APP_MODEL_API_KEY`                                                                                                                                                                                                                                                                                                                                                                                           |
|                | `notorganic`                                        | the app's own Not Organic routing; writers are linked to `TWYNE_EVAL_DID` and the per-call ceiling is `TWYNE_EVAL_MAX_COST_MICROUSD` (see `../README.notorganic.md`). Set `TWYNE_EVAL_SESSION_VERSION` to the account's Not Organic session version (`0` for a DID with no account row there, such as `twyne-evals.pds.notorganic.info`); a mismatch is refused as a revoked session                                                                                        |
| `--judge`      | `none` (default), `notorganic`, `openai-compatible` | `notorganic` uses `JUDGE_MODEL` (default `reasoning`); `openai-compatible` uses `TWYNE_JUDGE_BASE_URL`, `TWYNE_JUDGE_MODEL`, `TWYNE_JUDGE_API_KEY`                                                                                                                                                                                                                                                                                                                          |
| `--system-one` | `mock`, `direct`, `off`                             | the editorial review gate's judgements; default `mock` with the mock model, `direct` (`TYPESAFE_API_KEY`) when a key is set, and always Not Organic with `--model notorganic`                                                                                                                                                                                                                                                                                               |
| `--research`   | `mock`, `notorganic`, `keenable`, `custom`, `off`   | where auto-research searches; default `mock` with the mock model and `notorganic` (Not Organic's metered web search, billed to the eval account) with `--model notorganic`. `keenable` makes Not Organic's upstream search call locally with `KEENABLE_API_KEY` (`skate get keenable-api-key@secrets`), for while the gateway's own search is down. `custom` uses `TWYNE_APP_SEARCH_URL` and optional `TWYNE_APP_SEARCH_API_KEY`; `off` makes `research.sources` answer 503 |
| `--driver`     | `mcp` (default), `mcp-stdio`                        | `mcp-stdio` launches `twyne-mcp` as a child process, the way Claude Code or Codex would                                                                                                                                                                                                                                                                                                                                                                                     |
| `--target`     | `local` (default), `live`                           | `live` drives a deployment through `TWYNE_API_URL` and `TWYNE_ACCESS_TOKEN` (a token from Settings)                                                                                                                                                                                                                                                                                                                                                                         |
| `--jev`        |                                                     | adds the Jev and Clairic evaluators below, asked through the in-process app's own System One and extraction paths (local target only)                                                                                                                                                                                                                                                                                                                                       |
| `--repeat`     | `N`                                                 | runs each suite N times (experiments `…-r1` to `…-rN`) and reports run-to-run variance; costs N times as much                                                                                                                                                                                                                                                                                                                                                               |
| `--baseline`   | report files, directories or a path prefix          | compares this run with earlier reports, paired by case_id; see [Comparing runs](#comparing-runs)                                                                                                                                                                                                                                                                                                                                                                            |

Reports land in `reports/app-evals/<experiment>.json` with every case's raw
result, rendering and scores, each metric's mean with its 95% interval, and
evaluator agreement. `coverage` records scored, missing, errored and abstained
readings for each metric. `--strict` exits non-zero if a case or Arize upload
failed. An append-only `.cases.jsonl` checkpoint saves each actor output before
judging and each scored case afterward. Reports are saved before uploading;
`uploadError` preserves the failure
without discarding the model outputs or stopping the remaining suites.

To point the CLI or an MCP client at the in-process app by hand:

```sh
bun evals/app/local-app.ts --model mock --port 8788
# prints TWYNE_API_URL and TWYNE_ACCESS_TOKEN
twyne room convene --file draft.md --json
```

## Suites

| suite              | surface                     | corpus                 | deterministic scores                                                                                                                                            | judged scores                                                     |
| ------------------ | --------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `room`             | `twyne_convene_room`        | `cases/room.jsonl`     | `notes_complete`, `hosted`, `anchored`, `anchor_verbatim`, `plant_coverage`, `plant_coverage_visible`, `expected_editor`, `anchor_spread`, `voice_distinctness` | `note_value` (graded 1-5), `faithfulness`, `helpfulness` per note |
| `rubric`           | `twyne_grade_draft`         | `cases/rubric.jsonl`   | `contract`, `judged`, `hosted`, `review_present`, `pair_order`, `evidence_order`, `integrity_order`, `sufficiency_order`                                        | `review_grounded`, `weakness_recall`                              |
| `rewrite`          | `twyne_suggest_rewrite`     | `cases/rewrite.jsonl`  | `contract`, `hosted`, `preserves_facts`, `size_rule`, `changed`                                                                                                 | `improves`                                                        |
| `dossier`          | `twyne dossier check` (CLI) | `cases/dossier.jsonl`  | `contract`, `drift_recall`, `field_precision`, `hosted`                                                                                                         | —                                                                 |
| `interview`        | `twyne_interview_turn`      | `../interview.jsonl`   | `protocol`, `dossier_fields`, `one_question`, `hosted`                                                                                                          | —                                                                 |
| `research-targets` | `research.targets` (client) | `cases/research.jsonl` | `recall`, `restraint`, `precision`, `kind_accuracy`, `query_carries_claim`, `anchors_verbatim`, `mode`, `planted_error_flagged`                                 | —                                                                 |
| `research-sources` | `research.sources` (client) | `cases/research.jsonl` | `found`, `live`, `expected_source`, `expected_source_rank`                                                                                                      | `settles`                                                         |

Every case also gets `harness` (1 if it ran, 0 if it errored).

`drift_recall` and `field_precision` compare brief field names only: a drift
counts as found when an observation names one of its fields, and an
observation counts as on target when a planted drift names its field. On the
aligned dossier cases (no planted drifts) every observation is a false alarm.
The Jev readings below judge the substance.

The room corpus plants checkable features in each draft (an unsupported claim,
a strong passage, bloat) as verbatim passages. A plant counts as noticed when a
note's anchor overlaps it or the note quotes five consecutive words of it.
`plant_coverage_visible` counts only plants that reach the model: drafts longer
than `DRAFT_CONTEXT_CHARS` (48,000 characters, `convex/agentPrompts.ts`) keep
their opening, ending and evenly spaced middle excerpts. The gap between the
two coverage scores measures what that sampling costs.

Auto-research is two suites over the same 1,000-word drafts. Each draft names
the claims that need a source (`mustFlag`, with the true fact, a librarian's
query and the sources that settle it) and the passages that must be left alone
(`mustNotFlag`: opinion, the writer's experience, invented story, common
knowledge). `research-targets` runs every draft through both strategies the
product has, so they compare directly: `hosted` (the text rules propose,
System One confirms; what a hosted writer gets today) and `model` (the
research-extract prompts on the hosted model; what a bring-your-own-model
writer gets). Case ids end in `:hosted` or `:model`. `research-sources` takes
each gold claim as a target and asks whether search returns a source that
settles it: `expected_source` looks for an authority the corpus names, and the
judge's `settles` reads the snippets against the fact.

`hosted` is worth watching on every suite. The app falls back to deterministic
local text when a hosted call fails, so a run can look healthy while the model
was never reached.

The faithfulness and helpfulness rubrics are imported from `../judge.ts`, which
mirrors the Arize template evaluators `faithfulness-to-draft` and
`feedback-helpfulness`, so the three agree on what a score means. Both are
pass/fail and pass nearly every competent note, so they guard against generic
or off-topic output rather than rank rooms. `note_value` does the ranking: five
anchored levels, from generic (1) to the note a top editor would lead with (5),
with a competent note expected at 3, scaled to 0-1.

One convening yields one note per editor, so five notes can notice at most
about five planted problems; on drafts with six to eight plants, a perfect room
still scores below 1 on `plant_coverage`.

With `--model notorganic`, each suite reports account billing observed in its
time window, read through `providerIdentity.getHostedUsage`. Concurrent work on
the same DID can be included; `truncated` marks a limited ledger page. These
observations are not additive suite costs. Use the wallet change across the full
run to measure aggregate hosted spend.

## Jev and Clairic as evaluators (`--jev`)

Jev (TypeSafe's System One model) answers typed questions with calibrated
probabilities: a Noul is the probability of yes, a Score the expected level
over levels we describe (scaled here to 0..1). Clairic extracts typed values
(text spans, numbers) with `p_null`, the probability the value is not there.
Both go through the app's own paths (`LocalApp.judge`, `LocalApp.extract`),
so they need no credentials beyond the app's: with `--system-one direct` Jev
uses `TYPESAFE_API_KEY`, and Clairic goes through Not Organic. They share one
evaluator writer; a rate-limit refusal waits out the window instead of
becoming an error.

The questions are in `judges.ts`. Each case's questions go in one request,
except where a reading has to be blind: a question meant as an independent
check never shares a state with the app's verdicts or the corpus' answer key,
since Jev reads the whole state for every question.

| suite              | metric                                                               | what Jev or Clairic is asked                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `room`             | `jev_note_value`, `jev_grounded`                                     | per note: the `note_value` ladder as a Score; does the note make a claim about this draft (Noul)                                                                                                                                       |
| `rubric`           | `jev_sufficiency`, `jev_evidence`, `jev_integrity`, `jev_target_fit` | the rubric's four dimensions as Scores, on the draft and the commission only. The four levels follow the anchors the app's own judges get (1, 4, 7, 10 in `prompts/*-judge-user.md`), so level k lines up with an app score of 1 + 3k  |
|                    | `jev_quality`, `jev_pair_order`                                      | the four, equally weighted; strong vs weak ordered by it                                                                                                                                                                               |
|                    | `jev_weakness_recall`                                                | weak drafts, second request: per planted weakness, does the feedback point it out (Noul), the question `weakness_recall` puts to the LLM judge                                                                                         |
| `rewrite`          | `jev_fixes_problem`, `jev_keeps_meaning`                             | how much of the stated problem is left; how much of the original survives apart from the requested change (Scores)                                                                                                                     |
|                    | `jev_no_invention`, `jev_fits_context`                               | does the rewrite add a figure, date, name, event, study or source the draft does not mention (inverted Noul); could it stand in place of the original (Noul)                                                                           |
|                    | `jev_keeps_facts`, `jev_rewrite`                                     | per `mustPreserve` fact, still stated in any wording (Noul); 0.5 fixes + 0.3 meaning + 0.2 fit                                                                                                                                         |
| `dossier`          | `jev_obs_supported`                                                  | blind to the planted drifts: is each observation's complaint true of the draft, judged against the brief (Noul)                                                                                                                        |
|                    | `jev_drift_recall`                                                   | second request: does some observation describe each planted drift (Noul)                                                                                                                                                               |
|                    | `length_claims`                                                      | Clairic reads the word limits out of the brief, code counts the words, Jev reads whether an observation claims an overrun; 1 when the claim matches the count                                                                          |
| `interview`        | `clairic_field_recall`, `clairic_field_support`                      | Clairic reads each brief field out of the transcript, as a span or null. Of the fields the writer stated, the share the app filed; of the fields it filed, the share the writer stated. A span in an interviewer's line does not count |
|                    | `jev_field_recall`                                                   | blind to the filed dossier: per field, has the writer stated it (Noul), a second reading of what Clairic extracts                                                                                                                      |
|                    | `jev_question_value`, `jev_no_repeat`                                | question turns: how much the answer will shape the piece (Score); does it ask for something already answered (inverted Noul)                                                                                                           |
|                    | `jev_record_faithful`                                                | second request: is each newly filed field true to the conversation (and, in refine mode, the brief on file)                                                                                                                            |
| `research-sources` | `jev_settles`, `clairic_fact`                                        | see `suites/research.ts`                                                                                                                                                                                                               |

Probes on known cases, before these were settled: the observation Noul put
true complaints at 0.97-0.99 and planted false ones at 0.02-0.24 (AUC 1.00 on
ten), better than a stricter "point to a sentence" wording (0.96) or a Choice
(0.83); the invention Noul put grounded rewrites at 0.02-0.29 and copies with
a planted study, source or figure at 0.90-0.98, where an earlier wording read
a grounded paraphrase as an invention. Without "Null if the writer has not
said it", Clairic filled every interview field with the nearest span.

## Statistics

Every metric in a report and in the printed summary carries a 95% interval.
Scores live on 0..1 and many sit near an end, where a t interval on ten cases
is far too narrow, so the interval is Wilson's on an effective sample size:
p(1 − p) / se², with a cluster-robust standard error (Korn and Graubard's
interval for clustered proportions), and t on clusters − 1 degrees of freedom
as the critical value. Cases that are not independent share a cluster: a
rubric pair, the drafts of one research draft, the rewrites of one draft. A
score copied onto both drafts of a pair (`pair_order`) counts once per pair.
The cluster and the case's facets (quality, strategy, level, persona, mode)
are recorded on each case. A suite that runs two strategies (research-targets'
`hosted` and `model`) is also summarised per strategy, since the pooled mean
describes neither; `compare.ts --by FACET` splits any suite or comparison.

When several evaluators read the same thing (`agreement.ts`), the report
compares them on the cases where all of them scored: Pearson and Spearman,
agreement and Cohen's kappa after reading each value as pass or fail at 0.5,
and the mean difference. Where the corpus plants the answer (strong and weak
rubric drafts), each evaluator's AUC says how well it separates the two, the
most direct evidence of which to trust. Item-level constructs (per weakness,
fact, drift, field or note) give several readings per case; their n counts
items, which are not independent, so read their correlations as optimistic.

## Comparing runs

```sh
bun evals/app/compare.ts reports/app-evals/notorganic-full-20261023 reports/app-evals/notorganic-fixed-20261023
bun evals/app/compare.ts --stats reports/app-evals/research-20261023     # intervals and agreement
bun evals/app/compare.ts --stats --by quality reports/app-evals/notorganic-fixed-20261023-rubric.json
bun evals/app/compare.ts --repeat reports/app-evals/app-room-notorganic-<stamp>   # its -r1..-rN rounds
bun run eval:app -- --suite room --model notorganic --baseline reports/app-evals/notorganic-fixed-20261023
```

A report spec is a file, a directory, or a path prefix that picks up every
suite of a run. Cases are paired by case_id; cases in only one run are
counted and left out. For each metric the comparison gives both means over
the paired cases, the delta and its 95% interval (cluster-robust t), and a
sign-flip permutation p-value over clusters, which makes no normality
assumption and cannot call a handful of flipped cases significant (five
flipped pass/fail cases give p = 0.06). A metric is flagged ▲ or ▼ only when
the interval excludes zero and p < 0.05; with many metrics a few flags arise
by chance, so the line under the table also says how many survive
Benjamini-Hochberg at q < 0.05. Several runs on one side (`--repeat` rounds)
are averaged per case first, which makes a quieter baseline.

`--repeat N` reports, per metric, the run means, the standard deviation of
the suite mean between runs, the pooled within-case standard deviation, the
noise that alone puts on a suite mean, and ICC(1): the share of variance that
is real difference between cases rather than run-to-run noise.

Prefer graded readings when comparing runs. On three real runs of the same
three rewrites, one case's `improves` (pass/fail) moved by 0.33 from run to
run and `jev_rewrite` by 0.06, so the Jev composite resolves changes about
five times smaller at the same corpus size.

Reports written before intervals and clusters were recorded are read too:
the statistics are recomputed from their cases, with clusters read from
case_id conventions (`<draft>:<claim>`, `-strong`/`-weak`).

## Arize

```sh
export ARIZE_SPACE_ID=$(skate get arize_space_id)
export ARIZE_API_KEY=$(skate get arize_api_key)        # only for --trace
bun run eval:app -- --suite room --model notorganic --judge notorganic --arize --trace
```

`--arize` uploads each suite with the `ax` CLI, which uses your `ax` profile:

- **Dataset** `twyne-app-<suite>-<hash>`: one example per case. The hash covers
  the corpus, so editing cases starts a new dataset instead of rewriting the one
  older experiments point at.
- **Experiment** `app-<suite>-<model>-<time>` (or `--experiment PREFIX`): one run
  per case, `output` is the readable rendering, and every score is an
  `eval.<name>.score|label|explanation` column, so experiments compare
  side by side in the Arize UI. Runs also carry `case_id`, `app_model`,
  `driver`, `judge`, `latency_ms` and `trace_id`.

Arize needs a number in every row of a score column and reads labels as text,
so the upload is made rectangular. `harness` measures execution success; quality
is conditional on a successful run in both Arize and local statistics. A quality
metric with any unavailable reading goes up as labels, with its numeric value
preserved in the explanation and explicit error or unscored status elsewhere.
Fully observed metrics remain numeric. The local report keeps every score as
measured. A partial evaluator batch remains unscored rather than averaging only
the returned answers. A judge that fails marks its metric `judge-error` without
failing the case; Jev and Clairic failures are `jev-error` and
`clairic-error`. Per-item readings, intervals and agreement stay in the local
report; Arize gets the flat per-run columns.

`--trace` starts the in-process app with the Arize keys, so its own
OpenInference exporter (`convex/arizeTracing.ts`) sends every model call to the
`twyne-app-evals` project (`--project` to change). Each case runs inside a
CHAIN span carrying `twyne.eval.case_id`, `twyne.eval.suite` and
`twyne.eval.experiment`, and the experiment run's `trace_id` points at it. A
room case is one trace: the case span, five editor AGENT spans, and under each
the LLM calls and the `quote_passage` tool calls.
Content capture is on for these spans because the corpora are synthetic; the
production default stays redacted. With `--target live`, the deployment exports
its own spans to its own project.
