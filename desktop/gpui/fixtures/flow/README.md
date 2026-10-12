Run `bun generate-reference.ts` to execute the current original
`src/utils/flow-state.ts`, `flow-profile.ts`, and `flow-session.ts`. The reference
contains 174 classifier traces, exact boundary/sticky-mode cases, trimming,
profile normalization and updates, learned thresholds, smoothed kind weights,
hour ordering, quantiles, and session qualification/deduplication. JSON represents
the original empty reading's infinite pause as null; native runtime keeps infinity.
No manuscript words, provider calls, clock globals, or network enter the classifier.

Run `bun capture-ribbon.ts` to reproduce the 40 browser style fixtures and five
small spool rasters. The script extracts the actual SVG and label/title dictionaries
from the original component and applies actual global/workspace CSS in local
Chrome, blocking every network request. It loads the original bundled font bytes.
The fixture establishes settled markup/style geometry, rather than Qwik event
lifecycle or byte identity with hosted Google Fonts. The 4× spool rasters compare
against GPUI's actual SVG renderer with mean channel differences of 0.17–0.33%.
Chromium and resvg antialiasing differ; they are not byte-identical images.

The current WritingWorkspace ribbon inherits DM Sans 11px with 16.5px line height
and 1.1px tracking. The older Manuscript host uses Special Elite 11.52px (12px on
mobile). Both retain the original 40×10 spool, 6.4px gap, vermilion flow state,
half/full lift, slack curve, away opacity, exact labels/title, and status name.
Shared CSS hides the label at widths up to 640px; WritingWorkspace additionally
hides the complete ribbon up to 639px. Native cached SVG layers preserve overflow
above the spool during its original 1.6s lift and 1.2s fade with CSS ease. GPUI's
system reduced-motion setting and the view's explicit option remove animation.
Native status has no live-announcement request, matching original aria-live off.

The application must connect an actual loaded record and focused edit transaction
deltas before enabling the view. FlowSampler accepts only counts/timestamps, trims
the original ten-minute prefix on samples, and classifies on the one-second tick.
Its additional 65,536-sample native bound reports saturation instead of silently
changing a run. Local classification follows the web's fallback when Jev is absent;
it does not pretend to confirm anything with a provider. Current web automatic flow
only dims chrome, preserving page size and panels; manual Zen owns layout. Input
gating, pointer dwell, Escape/override, chrome focus/hover, and session word counts
belong to the application coordinator.

FlowStore is a separate 1 MiB local `flow.json` envelope. It stores optional exact
`flow-reading-enabled`, `live-review-enabled`, and `in-flow-tools-enabled` keys,
normalized version-1 profile, and newest 30 session slips. Flow enables only when
the first two keys are not false; missing values default true after successful
load. The independent tools key does not change that gate. Compatible envelope,
setting, profile/kind, and slip fields survive saves. Timing data contains no
authored text.

A candidate is a request, not a saved record. Under a cross-handle advisory lock,
saves compare the complete base and generation plus exact loaded primary/recovery
bytes, then sync the atomic backup and primary writes. Damaged primary bytes are
quarantined during recovery; a valid future format/version cannot be overwritten
using an old backup. Actual I/O failures leave errors available for retry.
`expected_value(now)` computes the full normalized intent; `acknowledge_request`
joins a pending save only after loading an exact healthy primary match including
timestamp, generation, profile, preferences, slips, and compatible fields. A backup
or generation-only match cannot acknowledge it. These operations run at explicit
save/session boundaries, never per key.
