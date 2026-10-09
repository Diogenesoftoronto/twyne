# Living desk: visual checks and reusable footage

The writer-facing walkthrough lives at `/docs/#the-piece`. It shows the actual
local panel, manuscript highlights, previews, fixes and deliberate exceptions.
`src/routes/docs/guide-living-desk.ts` owns the five written steps. The shared
manual player provides optional playback, captions, a description and download.

## Run and inspect

```sh
rtk proxy bun run test:visual
```

The suite exercises real controls with the fictional manuscript in
`e2e/fixtures/living-desk.ts`, in a fresh signed-out browser context. It checks
preview, individual and batch fixes, Undo, persistence, presence, keyboard focus,
four themes and two narrow widths. The manual tests check each image and step,
printable instructions, video playback, captions and byte-range seeking.

Every run keeps **successful** videos, stills and traces as well as failures under
`artifacts/qa-recordings/living-desk/<timestamp>/`. Open its `report/index.html`
with Playwright's report viewer to inspect the steps and any visual differences:

```sh
rtk proxy bunx playwright show-report artifacts/qa-recordings/living-desk/<timestamp>/report
```

The separate visual configuration leaves the normal test suite's retention
settings unchanged. `TWYNE_VISUAL_OUTPUT` can select a stable output directory for
a particular review; otherwise each run has its own directory. Keep a selected
recording's complete directory when filing it for a demo or commercial.

The GitHub **Living desk visual review** workflow retains its downloadable review
bundle for 30 days, including passing footage. Archive selected masters before
that expiry; CI retention is not a permanent media library.

## Review a visual change

Expected images are in `e2e/visual-baselines/`. A normal test run compares with
them and produces expected, actual and diff images in the report. Investigate a
failure before changing the baseline. After inspecting an intended design change:

```sh
rtk proxy bun run test:visual --update-snapshots
rtk proxy bun run test:visual
```

Use the pinned Chromium version and Linux environment when comparing baselines.
The initial baselines record this implementation; they are available for the
writer's design review, not a claim that the writer has approved them.

## Refresh the manual

1. Complete a passing walkthrough and inspect each full-size capture.
2. Keep the original recording, stills and trace together with their test run.
3. Copy only the selected, non-personal stills to
   `public/assets/manual/living-desk/`. Record their source run and hashes in its
   manifest. A clean recording can also provide `living-desk.mp4`, its poster and
   descriptive WebVTT captions under `public/assets/manual/`.
   `scripts/prepare-living-desk-media.ts <passing-walkthrough-directory>
   <passing-demo-directory>` prepares the five lossless stills, a continuous
   clip after loading finishes, poster, captions and source/hash manifest. It
   leaves the full source recordings in place and refuses failed test runs.
4. Update the written instructions when controls or behavior change. Inspect the
   actual manual at desktop, 390px and 320px, in a dark theme, and in print.
5. Verify the built manual locally, deploy the scoped app change, then repeat the
   read-only manual checks on the public origin:

```sh
rtk proxy env TWYNE_VISUAL_BASE_URL=https://www.twyne.love bun run test:visual
```

With an explicit origin, the suite runs **only** the manual tests. It does not
seed a manuscript or invoke models on that origin. This makes the same checks
useful against a local production server, a preview deployment or the live docs.

## Evidence boundaries

The sample contains intentional problems; its manuscript and rule results are
real, while its events and people are fictional. No model answers are fabricated.
Local findings, highlights and Undo do not establish live Jev quality or account
sync. The overall score retains its estimate marker. Long pieces above 80,000
characters show the explicit analysis limit.

Browser recordings are source footage for future videos. The clean manual clip
is a silent walkthrough, without added narration, music or retimed actions.
Screenshots, test videos and traces remain separate from edited promotional films.
