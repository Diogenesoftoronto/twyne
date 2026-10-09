# Living desk: design guidance

Companion to `docs/writing-instruments.md`. This governs how the living desk looks, moves, and speaks. The contract is `src/utils/living-desk-contract.ts`.

## What it should feel like

A copyeditor's style sheet and a proofreader's pencil, not a dashboard. The writer should feel the piece being *watched over*, never *graded at*. Three tests decide every detail:

1. **Cause and effect are visible.** Every fix produces three linked reactions at once: the span in the manuscript, the card's count, and the score. If any one of the three is missing, the moment feels fake.
2. **The manuscript stays the hero.** The desk recolours the page; it never covers it. Nothing animates while the writer types.
3. **Nothing is claimed that wasn't measured.** Estimates carry ≈. Model classifications carry their probability. Rule findings say "by rule".

## Spatial logic

- **Left is the piece; right is the passage.** The right margin already holds passage notes (flow rail, in-flow tools). The desk and the spine sit on the left, beside the outline, because they are about the whole document.
- **Panel:** a 20rem aside on the left, below the visible workspace controls. Opening it reserves space beside the manuscript; it must not cover the first words of a line. Opening the outline closes the desk, and opening the desk closes the outline. Narrow viewports use a bottom sheet capped at 55vh, with enough manuscript scroll space to reach the passage being edited.
- **Spine:** a 6px strip hugging the page's left edge for the full height of the manuscript. It widens to 12px on hover or focus. Section boundaries are hairlines; occurrences of the active lens are ticks; the focused finding's ticks are full strength and the rest are 35%. The top of the spine carries a small score cap (the estimate, tabular figures) that opens the panel.
- **Hidden when quiet:** no spine in manual Zen, in automatic flow (`html[data-flow]`), or in read-only mode without findings. The desk never reveals itself while the writer types: it can update counts, but it only *opens* on request.

## Visual language

Use the existing tokens only; every theme (foolscap, broadsheet, nightpress) must work without overrides.

| Element | Treatment |
| --- | --- |
| Panel | `--color-paper` background, 1px `--color-paper-3` border, `border-radius: 2px`, the same shadow as `.in-flow-card`. No rounded SaaS corners, no gradients. |
| Section heads in the panel | `.dept-label` (typewriter, uppercase, 0.32em tracking, `--color-ink-muted`). |
| Card | Like `.in-flow-card`: 2px radius, `--color-paper` on a `--color-paper-2` panel, 3px left rule coloured by lens. Kicker = level in `.dept-label` style. Title in `--font-display` 600, 0.9375rem. Metric in `--font-serif` italic 0.8125rem `--color-ink-light`. Impact right-aligned in `--font-sans` 0.75rem tabular, `--color-accent-green`. |
| Score | Estimate in `--font-display` 2rem, tabular. Show "≈" whenever there is no confirmed read or the draft has changed since that read. Keep Consistency and the latest change visible; put the other criteria behind "Score details" so findings stay within reach. Confirmed letter appears beside the estimate with its source. Criteria use hairline bars, tabular values, and explicit "by rule" or "by review" labels. |
| Occurrence rows | Manuscript serif at 0.875rem. Removed text `--color-accent-red` with line-through at 70% opacity; inserted text `--color-accent-green` on `--color-highlight-mint`. Provenance chips in sans 0.6875rem, 1px `--color-paper-3` border, pill radius allowed only here. |

**Lens colours (flagged / context):**

| Lens | Flagged | Context |
| --- | --- | --- |
| Stance | `--color-vermilion` underline 2px + `--color-highlight-rose` wash | `--color-cobalt` text weight 600 for "I" |
| Naming | `--color-mustard` wavy underline | `--color-highlight-sky` wash on canonical spelling |
| Style | `--color-text-periwinkle` dotted underline | none |
| Presence | per-entity wash from the persona palette (cobalt, sage, periwinkle, mustard, blush) at 35% | none |

Colour is never the only signal: flagged spans always carry an underline style, and cards say what the colour means in words.

Small explanatory text needs at least 4.5:1 contrast on its actual surface. The existing muted-ink and green accents do not meet that threshold on every light surface; use secondary ink or a local mix with ink. Lens underlines need at least 3:1 contrast. Check the rendered colours in each theme instead of assuming a token name guarantees contrast.

## Manuscript decorations

The engine adds these classes; the interface styles them globally (decorations live inside ProseMirror's DOM).

- `.ld-occ` on every decorated span, with `data-ld-lens` and `data-ld-label`.
- `.ld-occ--flagged`, `.ld-occ--context`, `.ld-occ--focused` (the focused finding), `.ld-occ--previewing` (original text shown struck through during a preview).
- `.ld-ghost` widget immediately after a previewed span: the replacement in italic `--color-accent-green`, with a 1px dashed left rule. It must not shift line breaks more than the replacement itself would.
- `.ld-flash` for 1.2s after a fix lands: `--color-highlight-mint` fading to transparent.
- The editor root gets `data-ld-lens="<lens>"` while a lens is on and `data-ld-focus` while a finding is focused. **Only `data-ld-focus` dims** the rest of the text (to `--color-ink-light`, not lighter); a lens alone just marks occurrences. The dim lifts the moment the caret enters the manuscript and a key is pressed.

## Motion

- Score number: tween 600ms, ease-out cubic. Criterion bar width: 700ms `cubic-bezier(.2,.8,.2,1)`; the fill turns `--color-accent-green` for 2.4s after a rise, `--color-accent-amber` after a fall.
- Delta flag: a small pill beside the criterion (`+0.3 · ¶6`) that fades in over 200ms, holds 2.4s, then fades out.
- **No reordering under the pointer.** When a finding resolves or its impact changes, keep the list order until the pointer leaves the list (or 1.5s with no pointer), then reflow with a 200ms FLIP. A card the writer is working in never moves.
- Resolved cards drop to 60% opacity with a ✓ and move to the end on the next reflow.
- `prefers-reduced-motion: reduce`: no tweens, flashes or FLIP; values change instantly and the delta pill stays static for the same duration.

## Copy

- Name observable things: "3 editorial “we” · 41 “I”", "“Hollis” once in ¶6, “Hollins” 14 times". Never "you seem unsure", never "AI suggests".
- Buttons name the action: "Make it I", "Make all 3 I", "Use “Hollins”", "The mix is deliberate", "Hollis is a different place". Not "Apply", "Accept", "OK".
- Put bulk fixes and deliberate choices directly below the finding header, then the flagged passages. Unflagged context belongs in collapsed disclosures. A writer should not have to scroll past every "I" to fix three instances of "we".
- Impact: "≈ +0.27". Below 0.05 show "small". Null impact shows the criterion name instead.
- Provenance: "rule", "Jev .88", "model". When judgement is unreachable, a single "rule-only" chip at the top of the panel, with the tooltip "No judgement model reachable, so classifications are by rule."
- Empty: "Nothing across the piece needs you right now." followed by one muted line listing what is watched: "Watching stance, names and the style sheet."
- Short drafts (under about 150 words): "Write about 150 words for an overall estimate." Local findings can still appear before that threshold.
- Above the Phase 1 analysis limit of 80,000 characters, explain that the whole-piece checks are paused. Keep the outline available. Never present a size limit as an empty successful review.
- Deliberate: "Kept on purpose. Twyne will flag only new drift."
- A requested full read shows its actual status or prerequisite in the desk, including paused review, a short draft, or an unavailable model.

## States each card must handle

open · improving (some fixed) · resolved · deliberate · stale (the span moved; show "This changed since it was found" and disable its fix) · read-only (no fix buttons; jump only) · judgement pending (a quiet "reading…" in the metric line, never a spinner).

## Accessibility

- Panel: `<aside aria-label="The piece">`. Each card header is a `<button aria-expanded>`. Fix buttons are real buttons with text labels.
- One polite live region announces score changes: "Consistency up 0.3 after the fix in paragraph 6."
- Keyboard: Escape clears focus and the lens, then closes the panel. Enter on an occurrence row jumps to it. Focus returns to the card after a fix, never to the manuscript.
- Spine ticks are decorative (`aria-hidden`); the same jumps are reachable from the cards.

## Anti-patterns

- Rounded, glossy cards, coloured gradients, emoji, or icons where a word fits.
- Toasts for routine fixes. The reaction belongs where the change happened.
- A score that moves while the writer types prose. Rule criteria may recompute on every edit, but the estimate's *animation* runs only after a fix or a 2s pause.
- A grade shown without saying whether it is confirmed or estimated.
- Opening the panel automatically.
- Measuring every occurrence's screen position on each keystroke or scroll event. The spine uses settled engine snapshots and layout changes, and skips hidden views.

## Acceptance checks

1. Open the desk on a draft with a mixed I/we stance. Fix one occurrence. Within 300ms: the span flashes, the count drops by one, the consistency bar rises with a delta pill naming the paragraph, and the estimate tweens with ≈.
2. Press Undo. Everything returns, including the count and the estimate.
3. Mark the stance finding deliberate, reload: it stays deliberate.
4. Switch theme to nightpress: every lens colour is legible (WCAG AA against the page for text, 3:1 for underlines).
5. Type a paragraph with the panel open: nothing animates, nothing reorders, typing latency is unchanged.
