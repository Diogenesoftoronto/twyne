# Writing instruments: evaluation and review

The checks are deliberately separate. A rule passing does not establish model quality;
a model returning text does not establish a good edit; a scheduled job test does not
establish a live provider task surviving a closed browser tab.

## Reproduce the local corpus and benchmark

```sh
rtk proxy bun run eval:instruments
rtk proxy bun run eval:instruments --case scene --no-benchmark
rtk proxy bun run bench:instruments --strict-performance --max-p95-ms 250
```

`evals/instruments/corpus.ts` contains authored, fictional fixtures with expected
findings and protected names, numbers and negation. The runner checks complete
rewrites, exact source offsets, settled history, duplicates versus semantic claims,
scene evidence versus proposed details, bounded paragraph/entity requests, explicit
instruction constraints, pinned local model manifests, and cancellation/source
contracts with fake transports. No account or model call occurs in this suite.

JSON and Markdown reports under `artifacts/instrument-evals/` contain the revision,
dirty state, corpus hash, runtime/CPU, per-case failures, all timing samples and flags.
`--output <directory>` chooses a stable result directory. An unknown `--case` fails.
The benchmark measures segmentation, analysis and score calculation at 500, 5,000
and 10,000 words. It separates first pass from six warmups and 50 samples, reporting
p50/p95/p99. These are analysis times, **not typing latency**. The default 250ms p95
flag is a broad regression threshold; use the same machine for useful comparisons.

## Which editor should weigh in?

```sh
rtk proxy bun run eval:room-routing
rtk proxy bun run eval:room-routing --case sentence-smallest-cut
```

`evals/instruments/room-routing-corpus.ts` contains ten authored, fictional Sentence,
Threads and Scene questions. Each names an acceptable set of editor IDs, including
one question where `none` is required. These are inspectable reference judgments,
not an objective measure of good writing. The default command validates the corpus
and builds the exact application requests with **zero network calls**, even when
an endpoint is configured. It reports model quality as `not-run`.

To measure actual model routing, explicitly opt in and supply a System One endpoint:

```sh
rtk proxy bun run eval:room-routing --run-model --endpoint https://your-endpoint.example --model jev-latest
```

The runner also accepts `TWYNE_ROOM_ROUTING_ENDPOINT` and `TWYNE_ROOM_ROUTING_MODEL`;
credentials are accepted only through `TWYNE_ROOM_ROUTING_API_KEY`, never a command
argument. Live execution sends only the authored fictional cases and can incur
provider charges. JSON and Markdown retain revision, dirty state, corpus and request
hashes, selected IDs, full distributions, confidence, request timing and failures.
Malformed distributions and choices outside the authored acceptable sets are flagged.
An unknown case or live run without an endpoint fails before any request. This
evaluates editor selection; it does not score the resulting editor's prose.

## Real downloaded model packs

```sh
rtk proxy env TWYNE_MODEL_DOWNLOADS=1 bun run test:models
```

This explicitly permits roughly 136MB of pinned model downloads plus the runtime.
Without the environment flag the test skips. A separate Vite cache and disabled
live reload keep development edits from corrupting the measurement. The test runs
MiniLM embeddings, DistilBERT word completion, and Whisper tiny English transcription
in the actual browser worker, then disables browser networking and repeats them.
The offline phase uses an already-loaded application and worker; it does not prove
an application can be installed or reopened without a network connection.

`model-report.json` retains exact manifests, cold download/load durations, six
embedding samples, full word choices, the actual transcript and word error rate.
The authored eSpeak fixture checks the audio path. It is not a representative
accent/noise/microphone benchmark. The transcription is editable and never inserted
automatically. A probability from a masked-word model is word likelihood, not a
meaning-preservation score. Cosine similarity is not proof of a relation.

The worker accepts only manifest URLs (including a pinned alias for Transformers.js
4's `main` config probe). Manuscript text is sent only to its local Worker.
Whisper uses basic graph optimization to avoid the quantized graph fusion regression
reported in [ONNX Runtime #28306](https://github.com/microsoft/onnxruntime/issues/28306)
and [Transformers.js #1707](https://github.com/huggingface/transformers.js/issues/1707).
Model provenance: [MiniLM](https://huggingface.co/Xenova/all-MiniLM-L6-v2),
[DistilBERT](https://huggingface.co/Xenova/distilbert-base-uncased),
[Whisper tiny English](https://huggingface.co/onnx-community/whisper-tiny.en).

## Browser missions and human review

```sh
rtk proxy bun run test:visual
rtk proxy bun run test:visual --grep @demo
rtk proxy bun run test:manual
```

These retain successful screenshots, videos and traces for later demos. Read
[living-desk-visual-review.md](living-desk-visual-review.md) for baseline review,
media preparation and deployment checks. New instrument regressions use a fresh,
signed-out fictional manuscript and real Harper WASM. They exercise visible
selection actions, complete rewrites, ghost preview, apply/Undo, words, placement,
Threads and narrow layouts. Run the normal comparison after inspecting any new
baseline; do not accept differences merely to make a run green.

`instrument-room.e2e.ts` exercises the real editor-to-Marginalia path with two
explicit fixture transports: a closed judgement response and a writing-model
stream. It checks attributed replies for Sentence, Threads and Scene, no room
selection or critique calls on opening, `none` without a critique call, changed-source rejection, custom-editor
initials and narrow layouts. Those fixtures test application routing and source
preservation, not Jev's editor-selection quality or a live provider account.
The pure `instrument-room.test.ts` cases reject malformed distributions, unknown
choices, oversized inputs and stale context. Keep those verdicts separate from
live editorial-quality evaluation.

After a passing room browser run, inspect its invitation and reply frames, then
prepare the public manual's lossless images from that run's results directory:

```sh
rtk proxy bun scripts/prepare-instrument-room-media.ts artifacts/qa-recordings/living-desk/<run>/results
```

The script requires the actual 1440 × 900 screenshots and retains their hashes in
`public/assets/manual/instrument-room-media.json`. It does not crop or fabricate
UI. The manual labels the model responses as examples using simulated transports.

The browser fixture also checks that provider requests contain the actual persona,
question and passage. Canonical templates live in `prompts/**/*.md`; run
`bun run prompts:compile` after editing them. The checked-in catalog packages the
same text for the browser and Convex. `bun run prompts:check` and the prompt tests
reject stale generated content, while missing or empty templates fail before a
provider request can be sent. Vite development reloads Markdown directly.

`test:manual` builds the app and runs both public walkthroughs against `server.js`,
including captions, seeking, HEAD, suffix ranges and invalid ranges. Vite's dev
asset server is not the production media handler. Use `TWYNE_MANUAL_PREBUILT=1`
only after building the current source. To recheck a deployment, set
`TWYNE_VISUAL_BASE_URL=https://twyne.love`; remote checks visit the manual only.

`missions` in the corpus is a reusable agent exploration brief. For each mission,
record a verdict (`passed`, `failed`, `blocked`, or `not-run`), tested revision,
steps, evidence paths, the observed issue and its reproducible trigger. Check:

- Offline revision: complete wording, marks preserved, no edit before Apply, one Undo.
- Deliberate drift: only reviewed occurrences suppressed; a new occurrence returns.
- Position: exact sentence moved; its styling and usable history survive.
- Threads: every endpoint is real text; unknown relationships remain uncertain.
- Scene: source and proposed detail stay separate; source jump rejects stale text.
- Background task: explicitly queue against selected account resources, close the
  browser tab, reopen, inspect returned source excerpts and record feedback.

A closed-tab **live** mission needs a real signed-in account, enabled provider and
selected resource. Do not replace it with a fabricated browser result. The separate
Convex tests cover ownership, queued scheduling, immutable snapshots, fresh session
checks, cancellation, deletion and late-result rejection using test transports.
The Task desk runs account-resource reads, not autonomous open-web browsing. Failed
or unknown provider outcomes are not automatically replayed and charged again.

The `Writing instrument evaluations` CI workflow runs deterministic checks and
hosted ownership/scheduler contracts on PRs and pushes to `main`,
and offers real pack tests through its explicit `real_models` switch. The visual
workflow saves review evidence for 30 days. Archive chosen masters before expiry.
Neither workflow updates baselines or deploys the app. Railway's existing main
autodeploy remains separate, so run the checks before pushing a release and repeat
the read-only manual checks against the deployed origin afterward.
