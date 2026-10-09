# The illustrated manual

The [writer’s manual](https://www.twyne.love/docs/) places the component being
explained beside a short sequence of actions. Each visual guide begins with a
real application view. Numbered controls change the image and instruction;
**Read all the steps** opens the full written sequence. A full-size image link
keeps small controls inspectable on narrow screens.

The manual contains 18 visual sequences with 65 illustrated steps, five original
editor portraits, and eight contextual films. The films complement the single,
locale-aware introduction already available at the end of the guide.

Films appear near the beginning of relevant chapters as optional **Watch** rows.
They introduce the room’s ideas or show a recorded path through the app. The
[film guide](launch-film.md) records their placement and language behavior.

## Where the guides live

| File                                        | Coverage                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `src/routes/docs/guide-at-the-desk.ts`      | Desk, dossier, House, collections and focus.                           |
| `src/routes/docs/guide-editorial-room.ts`   | Cast management, rubric, margin threads and bibliography.              |
| `src/routes/docs/guide-your-work.ts`        | Account, narration, Live, source/proof, folios, providers and privacy. |
| `src/routes/docs/guide-manuscript-craft.ts` | Outline/search, tables/images, page layout, notes and equations.       |
| `src/routes/docs/guide-living-desk.ts` | The piece, local patterns, previews, undo, exceptions and presence. |
| `src/routes/docs/manual-editors.tsx`        | Illustrated cast profiles, prompts and source-backed example lines.    |

`manual-guide-types.ts` defines the common data contract. The route owns chapter
order and placement; `manual-walkthrough.tsx` owns the shared interactions and
printable steps. `manual.css` uses the existing paper, ink and editorial font
tokens, including Nightpress. Keep chapter-specific captures out of the shared
renderer.

The selected illustration in each guide and the five cast portraits load eagerly
so a fresh print includes them. Other step images load only when selected; film
media waits for Play.

## Make the next capture useful

1. Open the current application in an isolated browser profile with a sample
   manuscript. Use a meaningful state: a selected passage, a filled dossier, a
   saved reference, or an open tool with its relevant controls visible.
2. Perform the real action. If editorial feedback or account responses are
   staged, identify that boundary in the guide’s note and capture manifest.
3. Crop to the component and enough surrounding context to explain its place.
   Keep text legible at the manual’s reading width. Save dimensions, descriptive
   alternative text, the exact action and the result to look for.
4. Inspect the image before publishing it. Exclude private email addresses,
   credentials, real account data, browser chrome, terminal output and developer
   diagnostics. A masked field still needs a deliberate privacy check.
5. Record the workflow as well as the stills. Keep the original, replay script
   and verification boundary with the footage for later video work.

Stills live under `public/assets/manual/{desk,editorial,work,craft}/`. Each
directory has a manifest describing its samples and source captures. Editor
illustrations live under `public/assets/manual/editors/`; original artwork,
alternatives and generation prompts are retained under `artifacts/manual-artwork/`.

The [capture index](../artifacts/qa-recordings/2026-09-30/manual-visual/README.md)
links the original workflows, final production reading walkthrough, replay,
stills and print proofs. Preserve the recordings when refreshing their public
illustrations so a later video can reuse the original actions.

The examples illustrate controls and decisions. A staged reading does not prove
model quality, a local save does not prove cross-device delivery, and an idle
voice desk does not prove a funded conversation. Keep those distinctions next to
the captures they qualify.

## Playback and reading

- The contents panel follows the visible chapter as you scroll, including the
  manuscript tools’ subtopics. Its progress bar shows your position in the guide;
  chapter links and browser back navigation update the same indicator.
- Native players have controls, inline playback, captions, a written description
  and a download fallback. They use `preload="none"` and never autoplay.
- Opening or selecting a guide does not call a model, change a manuscript or
  submit a publishing action.
- Only one manual video plays at a time. Closing its row, changing chapter,
  hiding the tab or leaving the route pauses playback.
- Step controls have keyboard focus and a selected state; the current
  instruction is announced politely. Every sequence also has a text version.
- Printing includes every written step and the selected illustration. Navigation,
  video players and step-switching controls are omitted.

## Check the rendered result

Run the repository’s typecheck, scoped lint and production build after integration.
Then inspect the production manual on desktop, at 390 and 320 pixels, in
Nightpress, with keyboard navigation and in print. Check every image and step,
native playback, caption loading, single-player behavior and byte-range seeking.
Keep the browser recording and result with the captures. Browser fixtures and
real authenticated provider checks remain separate evidence.

The [living desk visual review](living-desk-visual-review.md) adds repeatable
interaction and screenshot checks, saves passing videos and traces, and rechecks
the public manual after deployment. Its footage and stills use a fictional draft.
