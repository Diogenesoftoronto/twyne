# Editor typing performance

Typing responsiveness is a product requirement. Run `bun run test:typing` for the dedicated browser benchmark. It also runs on every pull request and main-branch push in **Editor typing performance** CI, with retries disabled so a slow run stays visible.

The benchmark uses native Chromium keyboard input in 80- and 800-paragraph manuscripts with a comment on every paragraph and headings throughout. Each scenario records 621 characters across three repetitions, sustained typing, 550/1100 ms pauses, and real background autosave under 4× CPU throttling. It checks immediate source freshness and persistence across reload.

Each scenario produces JSON with every sample, standalone HTML, percentile bar charts and a histogram in SVG, and a PNG chart image under `test-results/`. CI uploads these as **editor-typing-performance** for 30 days; the Playwright HTML report also embeds them.

Compare matching runs with `bun scripts/compare-typing.ts BEFORE.json AFTER.json [output-directory]`. It checks workload, browser and machine metadata before generating before/after bar charts in HTML/SVG and a JSON comparison.

## Measurements

- **Input to next frame:** browser `beforeinput` timestamp to the next animation-frame callback. This includes input queue delay and editor processing. It is a visible-latency proxy ending before paint, not a measurement of pixels appearing on a physical display.
- **Editor transaction:** synchronous ProseMirror dispatch duration. This isolates handler cost but misses background blocking and painting.
- **Input queue delay:** browser event timestamp to our capture listener.
- **Long tasks:** all main-thread tasks of at least 50 ms, including work during pauses. Their count and largest duration expose background stalls independently of typing percentiles.

We report p50, p95, p99 and maximum for each metric. Each scenario contains enough samples for p99 to represent several keystrokes rather than one. Native typing via Playwright is sequential; it does not recreate an operating-system keyboard queue under an arbitrarily blocked renderer. Long-task observations supplement that limitation. Paste, IME composition, collaborative saves and physical-device latency need separate coverage.

## Regression budgets

At 4× CPU throttling, transaction p95 must stay below 50 ms and p99 below 100 ms; input-to-frame p95 must stay below 100 ms and p99 below 150 ms. These are regression ceilings for shared CI hardware, not desirable interaction targets. The charts expose improvements and remaining outliers beneath those ceilings. The ordinary typing regression additionally checks the 800-paragraph keystroke handler at normal CPU speed.

Keep machine, browser, build and throttling metadata together when comparing results. The current harness uses a Vite development build to seed real IndexedDB state without exposing a production test endpoint. Do not compare its absolute timings directly against an optimized production build or infer phone performance from a CPU-throttling multiplier.

## Current performance work

Write view cancels proof compilation; opening Source or Proof compiles the current source, and applying source still validates it. Proof splitting serializes shared SVG definitions once and clones only the selected page, avoiding full-document cloning once per page. Autosave preparation is always scheduled outside typing dispatch, while explicit navigation/lifecycle flushes preserve the latest text. Local save acknowledgements leave newer pending typing to the idle reconciler.
