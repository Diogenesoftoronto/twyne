# Instrument illustration and motion

The illustrations give each instrument a recognizable purpose at a glance. They belong beside an instrument title or inside its empty state. They do not enter the manuscript, replace a button label, or imply that a provider is available.

## Direction

The [original study](../public/assets/instruments/direction-study-v1.png) compares three treatments of the same composing tools: copperplate engraving, letterpress cutouts, and a paper miniature. Copperplate was selected after the parent agent's visual review because it belongs with Twyne's existing engraved editorial assets. This was an implementation choice under the art request, not an explicit user choice.

Four transparent vignettes share opaque ivory paper, warm-black engraved contours, and a small vermilion mark:

- **Sentence bench:** two wording slips, a composing stick, and a correction pencil.
- **Threads:** two passages joined by one visible thread.
- **Research:** a folder holding two marked source clippings.
- **Scene:** a compact paper stage with a doorway and window.

The pale paper interiors and fine edge highlights keep the silhouettes readable on Nightpress. Color is part of the artwork, not a status system. Original PNGs, exact prompts, provenance, hashes, dimensions, and export sizes are in [the asset directory](../public/assets/instruments/manifest.json). The built-in `image_gen` tool produced the artwork. WebP exports only resize and encode it; they retain the generated alpha and color.

## Components

```tsx
import {
  InstrumentArt,
  InstrumentRule,
} from "~/components/instruments/instrument-art";
import {
  InstrumentMotion,
  InstrumentMotionPart,
} from "~/components/instruments/instrument-motion";

<InstrumentMotion state="compare" quiet={isWriting || isZen || !isVisible}>
  <InstrumentArt kind="sentence-bench" size="compact" />
  <h2>Sentence bench</h2>
  <InstrumentMotionPart part="source">{currentSentence}</InstrumentMotionPart>
  <InstrumentMotionPart part="alternative">
    {completeAlternative}
  </InstrumentMotionPart>
  <InstrumentMotionPart part="result">
    <InstrumentRule />
    {explanation}
  </InstrumentMotionPart>
</InstrumentMotion>;
```

`kind` is `sentence-bench`, `threads`, `research`, or `scene`. The fixed sizes are 64, 128, and 192 CSS pixels for `compact`, `standard`, and `large`. Assets are 512px wide and 43–81KB apiece. Art is decorative by default with an empty alt and hidden wrapper. A `label` prop makes an illustration informative where necessary; omit it beside a heading that already explains the tool.

`InstrumentTexture` is an optional, static alpha-mask texture for an illustration's own positioned container. Its ink follows the current theme at 4.5% opacity. Keep it off prose and controls. `InstrumentRule` follows the theme's ink and needs an accompanying text result; it does not announce success by itself.

## Motion contract

| State     | What moves                                                          | Duration      |
| --------- | ------------------------------------------------------------------- | ------------- |
| `rest`    | Nothing, including on restored content                              | None          |
| `open`    | The tool illustration settles four pixels into place                | 220ms         |
| `compare` | The actual alternative wording settles six pixels into alignment    | 200ms         |
| `arrive`  | The actual result settles four pixels; its proof rule prints across | 240ms / 260ms |

Every transition is finite, uses opacity and transform, and returns to fully visible, untransformed content. Nothing waits for animation to become clickable. The component adds no timers, document scans, event listeners, or continuous loading animation. A host should set state for a real action and use `rest` for restored results; key a genuinely new result if the same arrival state must replay.

Pass `quiet` during typing and when the instrument is outside the viewport. CSS also respects existing `data-flow="flow"`, `data-flow="settling"`, `data-zen="true"`, and `.zen-mode` ancestors. `prefers-reduced-motion: reduce` disables animations and transitions while preserving the same content. No particles, floating idle art, pulse loops, or artificial wait times are used.

## Review and reproduction

Storybook contains **Instruments / Illustration family** with six size/theme/texture specimens and **Instruments / Meaningful motion** with seven interaction/quiet/theme specimens. Run:

```sh
rtk proxy bun run storybook
```

Open `/?path=/story/instruments-illustration-family--collection` or `/?path=/story/instruments-meaningful-motion--interactive`. Replay opening, comparison, and result arrival, then enable the quiet checkbox. The example wording and result are a labeled component specimen, not a generated recommendation.

Saved inspection files:

- [Editorial](../public/assets/instruments/review-editorial-v1.png), [Nightpress](../public/assets/instruments/review-nightpress-v1.png), and [390px compact](../public/assets/instruments/review-compact-v1.png) screenshots.
- [Short component recording](../public/assets/instruments/motion-study-v1.mp4), suitable as source material for a component demo. It shows a specimen, not a live model or manuscript workflow.
- [Machine-readable observations](../public/assets/instruments/verification.json).

The local browser loaded all four alpha assets, with no horizontal overflow at 390px or 1200px. Result and proof-rule animations ended at 240ms and 260ms. Quiet mode produced `animation-name: none` with result opacity 1. The initial reduced-motion check activated the authored media block through CSSOM. A later isolated Playwright pass emulated the browser's `prefers-reduced-motion: reduce` preference and exercised Open, Compare and Receive a result: all had zero active animations, `animation-name: none`, and fully visible content. No operating-system settings were changed. These are behavior and visual checks, not a frame-rate benchmark.

Rebuild compact assets with:

```sh
rtk proxy bun public/assets/instruments/export-assets.mjs
```

The exporter verifies retained alpha and a 150KB limit per runtime asset. On a bare Nix shell, Sharp may need the GCC runtime from the project development environment. It does not regenerate images or call a provider.

## Integration boundary

The reusable components and Storybook examples are complete. Instrument owners choose their placement and wire actual interaction states. Art never starts a model request, sends manuscript text, manages focus, or changes document contents. New illustration requests should reuse the saved prompts and generated family reference, preserving the tool's specific metaphor rather than adding unrelated decoration.

## Scene bench implementation

`SceneBench` in `src/components/instruments/scene-bench.tsx` is an independently mountable instrument. Its `passage` prop is `{ id, text, sourceOffset }`. `sourceOffset` is a UTF-16 offset in the host's **plain text**, not a ProseMirror position. The editor owner must map and revalidate that selection when implementing `onLocate$(span, passage)`. Quotes are copied verbatim from the selected text; repeated sentences retain distinct offsets.

`createSceneInventory()` in `src/utils/scene-bench.ts` finds literal English word cues for place, time, light, sound, movement, and pressure. These are cues, not semantic findings. Figurative uses can match, and non-English details can be unrecognized. The UI names the actual cue and says “No cue identified locally” where none matched. It does not declare a detail absent or require writers to fill every dimension. Selection limits are explicit: 12,000 characters and 64 sentences, with no silently sampled complete inventory.

Optional model reading requires both `onJudge$(request)` and a `judgement` capability with `{ available, destination, costLabel, unavailableReason? }`. Pass the actual configured destination and either known cost/budget information or an honest unknown-price statement. `createSceneJudgementRequest()` builds six bounded span choices with a `none` option and one scene-pressure choice. `resolveSceneJudgement()` rejects unknown IDs, missing or invalid distributions, mismatched quotes, and replies for an edited, moved, or different selection. A maximum option probability below 0.6 remains uncertain. This is an explicit starting policy, not an evaluated universal threshold. Provenance includes the returned model and transport. No result changes the manuscript.

The model design follows the current TypeSafe [Choice contract](https://docs.typesafe.ai/primitives/choice) and [pre-parsed value selection pattern](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook). Existing `askJudgement` remains the transport boundary; this instrument adds no credentials or alternate endpoint.

Narration similarly requires `narration` capability information and `onRead$(passage)`. The supplied `startSceneNarration(passage, { client, signedIn })` helper delegates to Twyne's existing selected voice provider, cache, progressive playback, and global speech transport. The instrument shares pause/resume/stop controls with that manager. Provider availability and price are supplied by the host; no operating-system speech fallback or new voice API is introduced.

Writer-proposed details save in IndexedDB for the exact passage snapshot. They survive reload and stay separate from source evidence. Removal can be undone. Image, sound, and motion buttons **prepare a text brief locally**. The brief contains the exact excerpt and separately labels proposed additions. It does not generate media or send a provider request, and the UI says media generation is not connected to this instrument. Preparing the brief incurs no generation charge; a later external generator can have its own price and data destination.

### Scene checks

Thirteen tests (67 assertions) cover exact and repeated spans, Unicode offsets, local uncertainty, selection limits, corrupted candidates, invalid model results, stale responses, and proposal separation. Run:

```sh
rtk proxy bun test --conditions=production --preload ./tests/qwik-test-preload.ts src/utils/scene-bench.test.ts
rtk proxy bun src/utils/scene-bench.benchmark.ts --budget-ms=20
```

The benchmark warms up 30 times and records 200 samples per synthetic fixture. `--budget-ms` makes it fail when p95 exceeds the supplied budget. One local Bun 1.4.2 run measured p95 0.0493ms for 121 characters and 0.3356ms for 11,031 characters. It measures inventory plus request construction, excluding browser painting, editor typing, storage, model requests, and narration. Hardware and concurrent work affect timings.

Eight **Instruments / Scene bench** stories cover offline, unclassified, empty, long, dark, quiet, unavailable-provider, and explicitly labeled model-specimen states. Browser checks exercised saving, reload, removal, undo, and local sound-brief preparation. The generated brief preserved the source and placed the extra bell sound only under writer-proposed additions. Nightpress at 390px had no horizontal overflow and retained 16px form text. The model specimen is a local fixture, not a live Jev evaluation; no live narration or media generation was verified in this slice.
