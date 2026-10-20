# Autonomous editorial work — change summary

Responds to the Twyne UX improvement brief of 2026-10-19 and to
the product direction that followed it: **Twyne acts without being asked.**
Reviews, research and editors' readings run on their own; buttons remain as
shortcuts and overrides, not as the way work starts.

Released in 0.25.0.

## Principle

A feature that waits for a click before doing its core job is a defect. Each
automatic path has a trigger (folio open, draft change, idle pause, a fresh
quick grade) and spend guards (rate floors, session caps, dedupe by draft
fingerprint). Empty states say what Twyne is about to do, not what to press.
Hosted writers without their own model get the automatic path too.

## 1. Review and research arrive on their own

### Background room — `src/utils/background-room.ts`

| Before                                                                                          | After                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing prose counted as read on every open, so an unread draft was never read until Get notes | What the room last read is stored per folio (`background-room-read:<folioId>`). A folio with no record and no notes starts empty and is read on its own; one with notes from before the record existed counts as read |
| Triggered by 500 **net** new words and a 2-minute pause                                         | Triggered by 200 words in new or rewritten paragraphs (`diffParagraphs(...).added`) and a 1-minute pause                                                                                                              |
| `startBackgroundRoom` had no current draft                                                      | `currentText` arms the watcher straight away when the draft holds unread work                                                                                                                                         |

Guards unchanged: `MIN_INTERVAL_MS` (5 min), `MAX_PASSES_PER_SESSION` (8),
`MIN_EDITOR_WORDS` (500) before any reading. `src/routes/editor/index.tsx`
loads the stored baseline and existing notes when the folio opens.

### Rubric — `src/components/rubric/rubric-panel.tsx`

- `autoReadRoom` starts the editors' reading when a live-review quick grade
  arrives for a draft fingerprint the editors have not read, at most every
  `ROOM_READ_FLOOR_MS` (10 min, stored per folio), and only when a hosted
  client or BYOK provider exists.
- `runAnalysis(frontierOnly, quiet)` — a quiet run uses `isReviewing`, so the
  current grade stays on screen instead of the full-panel loader.
- The editors' notes survive later quick checks (`judges` carried forward);
  `judgesFingerprint` marks notes about an earlier version. A reading whose
  draft changed mid-run keeps its notes rather than discarding them.
- Automatic readings snapshot as `automatic` (5-minute spacing) so they cannot
  crowd manual checkpoints out of the 50-entry history; requested readings
  still force a `rubric` checkpoint.
- The Editors tab says `soon` / `reading…` instead of `0`.

### Research — `src/utils/background-research.ts`, `src/utils/research-candidates.ts` (new)

- Hosted writers without their own model: `claimCandidates` finds figures,
  attributed quotations, appeals to authority and dated events by rule;
  one batched Jev request (`candidateRequest`) confirms which need a source
  (Noul ≥ 0.6), with fiction instructed to ignore invented events.
- `ResearchIdleReason` (`waiting`, `too-short`, `no-provider`, `no-claims`,
  `covered`, `pass-done`) replaces the bare "Watching draft".
- Failed passes and failed claims retry on their own at 30 s, 2 min and
  10 min (`scheduleRetry`), then stop and leave the retry control.
- Each Deep trace row says what found / no match / failed means and offers
  Go to the claim.

## 2. Passage grounding and card meaning

- **Quotations** — `src/utils/quote-grounding.ts` (new). `extractQuotations`
  reads paired quotation marks and Markdown block quotes; `resolveQuotation`
  normalises typography, case and whitespace, follows `…` elisions within one
  paragraph, never crosses paragraphs, and breaks ties with the note's
  surrounding words (same paragraph only, stopwords removed). Ties stay
  `ambiguous`; missing text stays `unmatched`. `renderGroundedMarkdown` wraps
  resolved quotations as links after safe Markdown rendering. Links are
  re-resolved on `twyne:content` and again in the editor on click
  (`twyne:reveal-quote`, `findQuotationRange`). Used by the Cast panel notes
  and replies and the in-manuscript note card.
- **Relationship cards** — `flow-conductor.ts` asks a Choice alongside the echo
  Noul (`ECHO_RELATIONS`); shared vocabulary only suppresses the card. The card
  shows both passages and offers That's the connection / Not how I read it.
- **Settled notes** — `src/utils/note-decisions.ts` (new). Intentional / later
  per note, stored on this device (`note-decisions:<folioId>`). A decision
  stands while its anchor still resolves in the draft; `withoutSettled` drops
  repeat notes from the same editor in explicit and background passes, and
  `decisionsDigest` goes to the editors as context.

## 3. Versions — `src/utils/revision-history.ts`, `version-history-panel.tsx`

- `describeRevision` writes one sentence per comparison from the changes
  (rewrote / cut / added, and whose notes the rewrites reached).
- Changes are labelled Rewritten / Cut / New passage with Before and After.
- `notesTouchedBy` shows editor notes whose anchor was in the old passage and
  is gone from the new one — evidence the change reached the note, not proof
  it answered it.
- Optional intent on Save checkpoint (`RevisionSnapshot.intent`) names the
  checkpoint. Counts move under Size of the change.

## Answers to the brief's open questions

- **Cast cards / "further on as you read".** Cast cards are `PersonasPanel`
  notes (`personas-panel.tsx`); the "Further on in this piece" card is an
  `echo` flow item from `flow-conductor.ts`, rendered by `flow-surface.tsx`.
- **Editor review and the manual click.** The quick check never runs the
  editors; the click started their reading. It now starts on its own.
- **"Watching graph".** Research went idle silently when there was no
  provider, the draft was short, no claims were found or all were covered.
  Each is now a named state, and hosted writers have a provider path.
- **Jev's decisions.** Jev confirms echo relevance and relationship, hosted
  research claims, note quality gates, and the quick grade; the relationship
  label and the research claim rows surface those decisions.
- **Revision information.** Snapshots hold full HTML and Typst source, so
  passage-level before/after is exact; intent is now recorded when given, and
  note evidence is derived from stored editor notes.

## Not covered

- Unread markers for finished reviews.
- Rejected relationship readings are dismissed, not recorded as a rejected
  reading.
- Note decisions do not sync between devices.
- Manual screenshots for the Cast notes, echo card, Apparatus Deep trace and
  Version history predate these changes.

## Tests

`quote-grounding.test.ts`, `note-decisions.test.ts`,
`research-candidates.test.ts`, additions to `background-room.test.ts` and
`revision-history.test.ts`; `personas-markdown-wiring.test.ts` updated for the
grounded renderer.
