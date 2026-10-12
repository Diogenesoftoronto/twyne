# Twyne decision desk: source audit

Snapshot: 2026-10-05. Base HEAD: 5d3f7552ca17715dc2fe968c2db720e1295988a5. Includes dirty working-tree changes.

This private review site adds no production behavior. Card and relationship demonstrations are illustrative. Feedback is stored only in the browser and exported on request.

---

# Twyne current attention and card decisions

Read-only source audit, 2026-10-05. This describes the current local checkout, including uncommitted code. It is not proof of the deployed application or a real model round trip. No application files changed and no tests were run for this audit.

## Main conclusion

There is no single model deciding the whole experience. Local code first decides the writer's attention state and candidate pool. A configurable typed-judgement model optionally supplies semantic checks and a small number of choices. Local code then applies thresholds, a fixed scoring formula, caps, and CSS. Separate in-flow tool / quick-review producers run alongside this conductor and need to be shown as separate branches in the site.

Manual Zen is currently distinct from automatic flow. Both use a `twyne:zen-mode` event, but the editor and route deliberately ignore `source: "flow"` for the persisted Zen preference and panel layout. Automatic flow sets `html[data-flow]`, dims chrome, and suppresses cards without moving the page. Evidence: `src/components/editor/twyne-editor.tsx:3557`, `src/routes/editor/index.tsx:639`, `src/global.css:7208`.

## Entry and switches

The editor starts quick review, in-flow tools, and the flow conductor together only when an active folio exists and the editor is editable (`src/components/editor/twyne-editor.tsx:935`). This is parallel wiring, not one sequential agent pipeline.

All switches default on when storage has no value (`src/components/writing-tools/review-controls.tsx:52`).

| Switch           | Stored key              | Actual conductor effect                                                                                            |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Automatic review | `live-review-enabled`   | Master gate; false disables conductor                                                                              |
| Automatic focus  | `flow-reading-enabled`  | False disables the ENTIRE conductor, including its generated cards / surfaced comments, not just automatic dimming |
| Margin tools     | `in-flow-tools-enabled` | Read by the separate struggle/in-flow tools branch, not conductor                                                  |
| Cover lookups    | `flow-cover-lookups`    | Gates external cover metadata fetching, not Jev title classification or creation of title-only work cards          |

Conductor enable rule: `flow !== false && inFlow !== false`, where `inFlow` misleadingly refers to `live-review-enabled` (`flow-conductor.ts:1188`). Disabled state clears mode to working, auto focus, and surface output. Its key-transaction listener still collects samples/profile data while disabled; only the periodic `tick` is gated (`flow-conductor.ts:378`, `408`).

## Exact local state tree

Evaluated once per second, only while enabled, active, and document visible (`flow-conductor.ts:113`, `408`). Edits count when document changed and editor has focus, excluding y-sync transactions and `addToHistory:false` changes. Insertions/deletions are ProseMirror mapped position lengths, not semantic word edits (`flow-conductor.ts:378`). Last ten minutes of samples retained (`flow-state.ts:82`).

Default thresholds (`src/utils/flow-state.ts:48`):

| Quantity                                        | Default                   |
| ----------------------------------------------- | ------------------------- |
| Max inter-edit gap within one run               | 4 seconds                 |
| Settling                                        | 30 seconds of steady run  |
| Flow                                            | 90 seconds of steady run  |
| Stuck pause                                     | 18 seconds                |
| Exit-flow pause                                 | 25 seconds                |
| Away                                            | 180 seconds without edits |
| Maximum deleted share for steady run            | 0.30                      |
| Minimum share of run seconds containing an edit | 0.45                      |

Compute a contiguous run backwards from latest edit while gaps <=4s. `deleteRatio = deleted / max(1, inserted+deleted)`. `activeRatio = distinct edited seconds / ceil(runMs/1000)` capped at 1 (1 for subsecond runs). `recentChurn` is deletion share across edits in the minute before the last edit. WPM assumes 5 inserted characters per word and is used in Jev evidence, not a local state threshold (`flow-state.ts:105`).

Precedence in `readFlow` (`flow-state.ts:93`):

1. No samples -> **working**, pause Infinity.
2. Pause >=180s -> **away**.
3. Reaching for room -> **working**.
4. Previous state flow -> remain **flow** unless pause >=25s, then **working**. Churn does not eject established flow.
5. Pause >=18s AND (recentChurn >=0.40 OR supplied struggle >=0.50) -> **stuck**.
6. Previously stuck AND pause >=4s -> remain **stuck**.
7. Pause <=4s AND deletion share <=0.30 AND active-second share >=0.45 -> **flow** after90s, otherwise **settling** after30s.
8. Previously settling, pause <=4s, run >=30s -> remain **settling**, even if the steady test now fails.
9. Otherwise **working**.

Important wiring discrepancy: conductor supplies only `reaching` to this function. It does NOT pass the struggle score. In actual conductor use, stuck therefore comes from churn >=0.4 plus pause, not from the separate paragraph struggle detector (`flow-conductor.ts:413`).

Reaching is keyboard focus in comments/rails/tools/sidebar/dialogs OR a 600ms pointer dwell over margins, masthead, toolbar, sidebar, comment cards, or top48px of viewport. Escape or clicking held-post releases flow immediately (`flow-conductor.ts:403`, `527`, `541`; `flow-surface.tsx:933`). New edits reset reaching.

## Jev gate for flow

When local tree first requests flow, conductor temporarily retains settling and asks one `noul` question: is this steady forward composition that would be interrupted by cards, excluding list-making, pasting, mechanical edits? Evidence is final1500 characters of cursor paragraph, run minutes, WPM, deletion share, active-second share (`flow-conductor.ts:475`).

| Response                                                      | Result                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| `composing >=0.40`                                            | Enter flow; judgement cached for10 minutes                     |
| No answer: no client, budget, provider failure, malformed/etc | Enter flow from local reading; also cached10 minutes           |
| `composing <0.40`                                             | Decline flow for3 minutes; local flow requests become settling |

No model is needed for manual Zen. The automatic-flow model is a second opinion, with local acceptance as fallback (`flow-conductor.ts:503`).

Manual focus-off while `autoFocus` true increments an override counter and suppresses `setFocus(true)` for10 minutes (`flow-conductor.ts:343`). Caveat: that does not prevent `mode="flow"`, `data-flow` CSS, or flow-based card suppression; it only skips the `setFocus` call. This is narrower than the log saying automatic focus rests10 minutes (`flow-conductor.ts:457`).

## Personalization is arithmetic, not a trained decision model

Device-local IndexedDB `flow-profile`, with most recent240 pause/run/flow samples (`flow-profile.ts:42`, conductor `111`, `1183`).

- At least12 recorded pauses: stuck threshold = clamp(2 x pause75th percentile,12s,60s); flow-exit threshold = clamp(1.5 x pause90th percentile,15s,45s).
- At least5 flow entries: flow threshold = clamp(median entry run length,60s,240s); settling = rounded flow/3.
- Kind preference = clamp(2 x (engaged+1)/(engaged+dismissed+2),0.2,1.8). Starts1. Opens/clicks increase it, dismissals reduce it. `shown` does not affect this formula.
- Writing-hour totals and hand-override count are recorded for inspector but do not affect thresholds/ranking.
- Pauses eligible in profile helper are1.5s..10min, but conductor only calls it for inter-edit gaps >4s. Runs under5s ignored.

Evidence: `src/utils/flow-profile.ts:81`, `136`, `151`; `flow-conductor.ts:391`, `1234`.

## Gathering candidates

During working/stuck (not flow, settling, away), pause >=1.5s calls gather; transition to stuck forces a gather. Need current paragraph >=60 characters. Same first200 characters plus same mode is skipped indefinitely; otherwise calls in same mode spaced >=20s. Mode changes bypass20s (`flow-conductor.ts:445`, `472`, `607`).

Because no samples yields working with pause Infinity, a loaded paragraph can be gathered on the first tick without any new typing.

Jev requests share max12 calls per60s across pause-driven callers; failure backs off all callers30s (`src/utils/system-one-budget.ts:8`). Conductor skips a call with no Convex client, zero questions, or budget unavailable (`flow-conductor.ts:558`). All questions for one gather are batched. They are separate from flow-confirm and drift requests.

| Item                                 | Local candidate selection                                                                                                                                 | Model gate                                                                 | Fallback / content                                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Echo / You wrote                     | Local TF-IDF cosine over current draft + up to first40 folios, first200 paragraphs each; paragraphs >=80 chars; at least2 shared tokens; top3 score>=0.12 | Relevant `noul >=0.55`                                                     | With no answer, TF-IDF >=0.30 accepted; at most1 unconfirmed same-draft echo per gather. Body is literal earlier passage, not new helpful advice                                 |
| Work / named book, album, song, film | Max4 quoted or italic title candidates; capital/title regex                                                                                               | Choice classifies medium AND helpful-cover `noul >=0.50`                   | No model answer -> no card. Successful classification but lookup disabled/fails -> title-only card. Films always title-only                                                      |
| Shelf / dossier reference            | TF-IDF over brief attachments + first80 saved bibliography entries; top2 >=0.15                                                                           | Relevant `noul >=0.55`                                                     | No answer -> local similarity >=0.35 accepted. Body is stored source/reference text                                                                                              |
| Charter                              | First6 undismissed charter standards                                                                                                                      | Breach `noul >=0.70`                                                       | No answer -> no card. Body is original standard                                                                                                                                  |
| Way in                               | Only local stuck, exact current paragraph, not dismissed                                                                                                  | Unresolved-passage `noul >=0.60`, plus choice among fixed coaching prompts | If NO Convex client: may fallback only with churn>=0.60 and pause>=stuck threshold. Configured but failed/budget-skipped client does NOT fallback. Body is a hard-coded template |
| Amendment                            | After approximately300 net-added words since last drift check; enough recent prose >=600 chars; goal/audience/tone exist                                  | Same field serves-dossier `noul <0.30` on2 successive drift judgements     | No answer -> no proposal. Template explains current field. Writer may explicitly ask configured text model to draft amendment wording; filing is explicit                        |

Sources: `flow-conductor.ts:607`, `637`, `653`, `683`, `696`, `704`, `732`, `738`, `770`, `813`, `836`, `856`, `891`, `934`, `969`; `flow-connections.ts:87`, `131`, `143`; `flow-media.ts:26`.

Way-in choices: Say it plainly first; Start from the thing itself; Who is this for?; Pick up an earlier thread (only if echo candidate exists); Leave a mark and move on. Their bodies interpolate audience, goal, and a passage fragment into fixed prose. This branch does not generate alternative sentences or words (`flow-conductor.ts:709`, `781`). A way-in can link one highest-relevance echo. Choosing invalid/absent model choice defaults to Say it plainly first.

Existing user comments, persona notes and completed background source arrivals are ingested without another Jev judgement. Comments come from unresolved anchored folio comments; persona notes from document marks; sources from latest matching bibliography entry after `twyne:background-sources`. They then receive ordinary ranking (`flow-conductor.ts:1025`, `1053`, `1128`). Streaming persona reply gives that item relevance1 and fresh timestamp (`1082`).

## Which card wins

This is a fixed score, not a model selection among final cards (`src/utils/flow-items.ts:149`):

`score = baseKindPriority × learnedKindWeight × freshness × (0.5 + relevance) × (1 + anchorOverlap + onScreenBonus)`

- Freshness = `0.6 + 0.4 * exp(-ageMinutes/20)`; old cards retain a60% floor.
- Relevance defaults0.60 where no producer supplied one.
- Anchor overlap is normalized substring/word overlap with cursor paragraph, max1. It is lexical, not semantic.
- Optional on-screen bonus0.15 is NEVER supplied by the conductor, so currently0 (`flow-conductor.ts:269`).

Base priorities (`flow-items.ts:58`): way-in0.95; comment0.90; persona-note0.75; charter0.70; amendment0.65; source0.55; echo0.55; work0.50; shelf0.45.

Suppression tree (`flow-items.ts:166`):

1. Exclude dismissed IDs.
2. Exclude way-in unless currently stuck and anchor overlap >0.30.
3. Sort remaining descending fixed score.
4. **Flow:** zero visible cards.
5. **Settling / away:** only IDs in `shown` set retained.
6. **Stuck:** choose highest-ranked way-in first, otherwise highest-ranked card with anchor overlap >0.30, otherwise highest-ranked card of any relevance; include linked items too. There is no minimum score for that last fallback.
7. **Working:** top3 cards. No general minimum score.

`shown` is cumulative for the conductor lifetime, not just the previous visible set, so settling/away can restore an old once-shown card that was no longer among the immediately previous top3. This differs from comments promising nothing changes (`flow-conductor.ts:218`, `279`; `flow-items.ts:203`). Dismissed IDs are session-local, not persisted; kind dismissal totals ARE persisted. Reload/remount may bring a dismissed item back.

## Final UI can override the nominal top3 / one-card policy

FlowSurface's "more in the margin" displays all live items outside full flow; hover-peek and an explicitly opened comment can append cards beyond policy output (`flow-surface.tsx:222`, `567`, `1154`). Explicit opening recalls a dismissed card (`594`). These are deterministic direct-intent paths, not additional model calls.

Manual Zen hides FlowSurface entirely when not autoFocus; read-only does too (`flow-surface.tsx:691`). Automatic flow CSS hides rail/cards at opacity0 and pointer-events:none, preserving held-post desk; masthead/toolbar/sidebar remain laid out at opacity0.12. Settling dims to0.4; hover/focus restores chrome (`global.css:7208`).

Room geometry: requires304px to right of page (268+28+8) for full rail;248px to left for archive (212+28+8). No left room -> echo/shelf cards move right. No right room -> dock renders only first room card and a count of others. This is layout logic, not model relevance (`flow-surface.tsx:61`, `273`, `1169`).

## Concrete scenarios for site simulator

| Inputs                                                               | Current result                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Loaded paragraph >60 chars; no edits yet                             | working; can gather immediately at first1s tick                        |
| 35s run, max gap2s, churn10%, active seconds70%                      | settling; no new ordinary cards; chrome dims                           |
| 95s same run; composing0.8                                           | flow; ordinary cards hidden; chrome dims; no panel resizing            |
| 95s same run; no model/client/budget                                 | same flow result from local fallback                                   |
| 95s same run; composing0.2                                           | settling; flow declined3min                                            |
| Working; churn45%; pause20s; model says stuck0.2                     | local state still stuck; no way-in; best existing candidate may appear |
| Working; churn65%; pause20s; no Convex client                        | local stuck + templated Say it plainly first can appear                |
| Working; churn65%; pause20s; client present but unavailable/budgeted | local stuck, no way-in fallback                                        |
| Already flow; churn80%; pause20s                                     | remains flow despite heavy rewriting                                   |
| Already flow; churn80%; pause26s                                     | first tick working; next tick can become stuck                         |
| Source card high relevance but manual Zen on                         | hidden regardless of model score                                       |
| Top3 selected but <304px right gutter                                | dock can show only one of those cards                                  |

## Gaps worth feedback, without changing behavior in this task

1. "Automatic focus" controls the whole conductor, not only focus; user-facing switch boundaries are misleading.
2. Repeated words can produce echo cards without semantic confirmation. Current code still includes the You wrote branch the user dislikes.
3. Way-in model selects from five generic coaching templates; it does not compose sentence alternatives, visualize an argument, or produce a specific revision.
4. Main stuck detector ignores the richer struggle detector's score, because that optional input is unwired.
5. Semantic candidates are marked `asked` before model success. Budget skip/failure can prevent rejudging those echoes/works/shelf references for the rest of session. Same paragraph's first200-character key also prevents retries without a mode change (`flow-conductor.ts:619`, `643`, `662`, `961`).
6. Archive is indexed only once per conductor/session, so newly written or edited earlier paragraphs are not refreshed (`flow-conductor.ts:891`).
7. Opens/clicks are treated as positive preference, not evidence a card improved the writing. Repeated engagements can count repeatedly; recorded shown counts are unused by scoring (`flow-profile.ts:151`, conductor `1246`).
8. Conductor requires Convex client before calling `askJudgement`, even though the endpoint transport itself supports no Convex client (`flow-conductor.ts:565`; `judgement-client.ts:162`). This can make locally configured judgement behave as unavailable inside this branch.
9. Deliberate Zen and automatic quiet have diverged from some old comments naming both "zen"; explanatory site should teach their actual separate behavior.

## Follow-up: connections inside the same document

The existing implementation has useful drawing plumbing, but it does not yet implement arbitrary sentence-hover semantic relationships or missing-structure suggestions.

- **One card can anchor several passages.** `FlowItem.anchors` is a string array (`flow-items.ts:84`). The same-draft echo producer sets two anchors: `[current paragraph, matched earlier/later paragraph]`; cross-folio echo only anchors the current paragraph (`flow-conductor.ts:756`). This is the concrete current multi-passage case.
- **Matching is paragraph-based.** The index uses text blocks / paragraphs >=80 chars and TF-IDF lexical candidates; Jev can confirm relevance >=0.55, but fallback >=0.30 still emits an echo without Jev. The semantic question asks whether subject/argument/image/thread bears on current passage. It supplies a relevance scalar only, not relationship type, rationale, synthesis, or proposed edit (`flow-conductor.ts:637`, `646`, `738`; `flow-connections.ts:87`).
- **Hover a card, not any sentence.** Card mouseenter/focus handlers activate drawing (`flow-surface.tsx:722`). Manuscript pointerover/focusin recognizes only existing comment IDs, persona-note IDs, and comment/note anchor chips (`flow-surface.tsx:569`). Arbitrary unmarked sentence hover has no connection lookup.
- **Drawn edges are card-to-passage.** The selected card's anchors receive line-level highlights, gutter brackets, and cubic curves from card to bracket. Related cards get dashed curves. There are no direct sentence-to-sentence graph edges or typed arrow labels (`flow-surface.tsx:447–519`).
- **Related cards are literal or explicitly linked.** A card is related if it is the active card, either card links to the other ID, or it shares an EXACT anchor string. Only currently placed cards are considered (`flow-surface.tsx:463`). This relation test performs no model call. Only explicit link constructed by conductor is way-in to one best echo (`flow-conductor.ts:806`).
- **Anchoring is fragile text search.** Each anchor locates its first14 words with exact case-sensitive regex/whitespace matching in the first matching text block. Longer anchors extend to the block's end. It is not a stable sentence/node identity or semantic locator. One anchor cannot span blocks; repeated lead-ins select first occurrence; edits can lose it (`flow-conductor.ts:1208`).
- **Navigation prefers first anchor.** `focusAnchor` jumps to first locatable anchor. Echo first anchor is current paragraph; even way-in's Pick up the thread delegates to that echo's first anchor, so it can focus current paragraph instead of earlier supporting passage (`flow-conductor.ts:1281`; `flow-surface.tsx:834`).
- **Visibility limits relationships.** Hidden/non-placed cards are not related-drawing candidates. Narrow dock intentionally suppresses connecting lines; full flow CSS suppresses overlays. This cannot serve as a comprehensive document relationship map (`flow-surface.tsx:464`, `503`; `global.css:7216`).

For the review-site concept demo, present the new behavior as proposed: selecting/hovering any sentence reveals 2–3 source-grounded passages with a named relation (supports, contrasts, repeats, anticipates), explains a missing bridge or structural gap, and offers a specific writer-controlled next action. Keep cited passage ranges visible in the demo and distinguish them from generated suggestions. The production implementation currently stops at semantic relevance filtering plus literal multi-anchor rendering.

---

# Twyne current model and card producer audit — 2026-10-05

Read-only source audit of the current local worktree. This verifies installed call sites and code paths, not the active browser's saved settings, the concrete live Not Organic model alias resolution, or a successful paid model request. Parent attention audit owns the detailed conductor/Zen branches.

## Main finding

The experience currently combines several separate pipelines. Ordinary code decides when to ask, seeds tools, provides fallback copy, ranks items, and renders cards. A typed judgement model (normally Jev) decides some semantic questions. A separately selected prose model writes alternatives, persona feedback, and research targets. Jev is not the prose generator. Not every visible card passed through Jev, and a failed judgement sometimes falls back to a local card. There is no single universal learned card selector.

Three independent editor services are actually installed together: Quick Review, In-flow tools/struggle tracker, and Flow Conductor (`src/components/editor/twyne-editor.tsx:937`). Whole-draft live review starts at `src/routes/editor/index.tsx:877`. The struggle and quick-review producers do not consult conductor FlowMode in their run functions.

## Model routing, with evidence

- Typed questions: `src/utils/system-one.ts:1` defines Noul (yes probability), Choice (fixed alternatives + distribution), Score (ordered levels + weighted score). The comment's historical cost/latency figures were not revalidated and should not be advertised as current facts.
- Judgement setting: `src/utils/judgement-client.ts:172` routes `endpoint` directly to `${base}/v1/systemone`; default endpoint model is `kev-latest` at line 43. `typesafe` uses the writer's key relayed through Convex and defaults `jev-latest` at line 44. Default `twyne` goes through `api.systemOne.ask`; no silent switch from writer's custom endpoint to hosted Jev.
- Hosted judgement: `convex/systemOne.ts:94` prioritizes Not Organic when enabled, else explicit local-development direct-key fallback, else unavailable. `convex/systemOne.ts:313` sends no default explicit model on the gateway path: gateway `judgement` resolves a concrete version. Direct/TypeSafe default is `jev-latest` (`:46`). Return carries actual response model (`:338`), but that live response was not observed here.
- Important mismatch: the router itself permits a custom endpoint with no Convex client, but quick-review (`src/components/editor/extensions/quick-review.ts:203`), struggle (`src/components/editor/extensions/struggle-tracker.ts:353`), and whole-draft live review (`src/utils/live-review.ts:161`) return before the router when their Convex client is missing. Parent audit found same for conductor. Thus the settings capability is broader than these actual callers support.
- Prose generation: `src/utils/ai-client.ts:381` resolves eligible feature provider override first, else eligible global default, else first eligible provider. Per-feature `model` override wins; otherwise provider.defaultModel (`:422`, `:510`). Persona feedback can override provider/model/temperature again (`:434`). No universal hardcoded GPT/Claude model selects all cards.
- Sentence variants and passage-specific reader questions use feature `in-flow-tool` (`src/utils/ai-client.ts:3713`); they require a configured client prose provider (`struggle-tracker.ts:515`). This path has no hosted generation fallback. A working hosted Jev does not by itself create fresh alternatives.
- Background persona prose chooses configured client provider first (`src/utils/background-room.ts:495`), otherwise hosted `api.agents.conveneRoom` (`:553`). Hosted `convex/agents.ts:322` resolves Not Organic alias `balanced` by default, not a concrete model ID in this repository. Legacy provider order if Not Organic disabled: Rivet default anthropic/claude-sonnet-4-6 (`:259`), Portkey @neuralwatt/qwen3.5-397b-fast (`:277`), Anthropic claude-sonnet-4-6 (`:296`), OpenAI gpt-5.5 (`:305`), each environment-overridable. These are fallback defaults, not evidence those models ran.
- `passage-triage.ts:204` supplies offline enum adapter helpers mentioning Needle. Current repository searches find the helper only in its own module/tests, not a live Needle inference caller. Do not show Needle as an active production card model.

## Actual producer trees

### Quick Review: model-selected category, fixed explanation

Editor update → 650 ms pause (`quick-review.ts:183`) → enabled, editable, visible, not composing, online, Convex client → cursor in paragraph with >=80 characters → effective dossier + first 3,000 chars passage + preceding 2,000 chars + goal/audience → cache/shared judgement budget → one Jev Choice.

Options at `quick-review.ts:22`: No clear issue / Needs context / Check evidence / Possible repetition / Meaning is unclear. No clear issue produces no mark. Other choices show a question-mark marker and fixed explanatory prose from COPY (`:33`), with “Possibly” if confidence <0.5 OR selected probability <0.65 (`:286`). User opens/dismisses the popover; no generated rewrite or bespoke explanation. Unavailable Jev produces status only, no heuristic issue. Stale model replies are dropped by generation + document checks (`:262`).

### Struggle tools: local effort signal → optional Jev decision → deterministic seed → optional prose fill

Editor transactions track per-block insertions/deletions, undo count, committed versions, sentence rewrite counts, prior attempts, sentence-count changes, hedge flips, growth/last-edit times. Versions commit on pause, not each keystroke (`src/utils/struggle-signals.ts:182`). Evaluate after 1,200 ms or a 42,000 ms stall check (`struggle-tracker.ts:85`). If hidden, composing, noneditable, disabled, already showing an active tool, no tracked cursor block, or score <0.5, stop (`:381`).

Local hints (`struggle-signals.ts:252`):

| Local observation                                                                  | Candidate and strength                                            |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Same sentence reworded >=3 times                                                   | Sentence Lab; 0.6 +0.1 per extra rewrite, capped 1                |
| >=3 sentences and >=2 split/join changes OR churn>=4 and >=80 words                | Rhythm Strip; 0.5 +0.1/count-change +0.02/excess-churn, capped .9 |
| >=2 qualifier/hedge flips, >=10 words                                              | Claim Check; .5 +.15 per additional flip, capped .9               |
| Cursor at paragraph end; >=25 words; >=40 deleted chars; no growth 40s; no edit 8s | Reader Questions; .5                                              |

Jev `classify` (`in-flow-tools.ts:116`) receives passage, last three versions, local reasons, goal/audience; picks Leave the writer alone or one of four tools. It may choose a different tool from the local top candidate. Claim identification/support-slot checks are only included when the local hints include Claim Check (`:130`). Confidence <.5 or selected probability <.6 merely marks tentative, it does not reject (`:155`). Leave causes two-minute paragraph cooldown (`struggle-tracker.ts:427`). A failed/unavailable/budget-blocked call falls back to strongest local hint ONLY if strength>=.6 (`in-flow-tools.ts:175`), marked tentative. This means three sentence rewrites can open Sentence Lab with no decision model. Reader Questions' .5 local hint alone cannot pass fallback.

Seed and fill (`in-flow-tools.ts:185`, `:274`):

- Sentence Lab: actual sentence + last five different earlier attempts, plus <=3 model-generated alternative wordings. No prose provider → earlier attempts only + setup notice. Variants instruction asks different solutions (reorder, cut, make concrete), but UI labels all generically as Other ways. `tool-renderer.ts:65` lets the writer choose/edit a working copy and explicitly Use this; Undo restores original. Stale source text is checked before replacement (`struggle-tracker.ts:557`).
- Rhythm Strip: sentence texts/word counts and default 8–28 word adjustable band. Pure arithmetic; no prose generation. Updates 120 ms after editing (`struggle-tracker.ts:265`).
- Claim Check: Jev main claim/support detection if available; otherwise first assertive sentence matching regex (`in-flow-tools.ts:359`) or first sentence. Three fixed support slots A source / An example / A number. No generated advice. A source Find button triggers research (`tool-renderer.ts:286`); manual checkboxes and custom slots exist. When fallback lacks slot evidence, all default false: the UI's “support missing” can reflect lack of semantic assessment, not verified absence.
- Reader Questions: <=3 passage-specific prose-model questions using goal/audience/preceding paragraph. No prose provider → first three generic questions from fixed bank (`in-flow-tools.ts:281`), explicitly labeled general. Saved/openKind tools can be opened deliberately with no struggle signal or Jev classification (`struggle-tracker.ts:640`).

### Background room: selective full feedback

500 net new words then 120 seconds idle; >=500 total words, minimum 5 minutes between passes, cap 8 per session (`background-room.ts:61`, `:286`; `draft-thresholds.ts:5`). Diff determines new paragraphs. If a current live-review fingerprint exactly covers all added paragraphs, reuse Jev triage and choose <=3 with priority>=.25 (`background-room.ts:344`; `passage-triage.ts:191`). Otherwise process the new material without that triage gate. Selected prose model generates persona notes with full draft, new material, dossier, writer profile, trajectory digest. Jev can review generated notes against passage, constraints, persona, preferences and policy (`background-room.ts:394`, `editorial-note-review.ts:41`). Definite vetoes withheld; unavailable verdict is null and does not invent a pass. Client prose generation with reviewer can adapt/repair drafts (`ai-client.ts:1316`; `adaptive-editorial-draft.ts:144`).

### Whole-draft live review: Jev findings, assembled presentation

Saved-draft events, min 2.5 second pause and 30 seconds since last start (`live-review.ts:130`), enabled/online/client and >=500 words. Fetch effective dossier, criteria, notebook, revisions, notes (`:171`). Jev rubric + up to 12 passage triages within opening 40k characters (`:241`), then dossier assessment, writing lenses, note review. Long drafts get excerpt findings without a whole-draft grade. Typed findings are assembled; no generated essay (`:439`). Need label, confidence and argument-criticality are Jev; triage priority is hand-coded multiplication, not another model (`passage-triage.ts:156`).

### Research: prose extraction, search provider, arithmetic ranking

45s debounce, >=120 chars, max five targets/pass, up to 25 background bibliography entries (`background-research.ts:63`). Requires configured client prose provider (`:553`). Feature `research-extract` reads draft + dossier and chooses claim/quote/person/statistic/event/work targets (`ai-client.ts:2919`), then configured search API / model endpoint / MCP or hosted search (`background-research.ts:661`). Metadata ranking uses snippet length, author, publisher, title and input ordering (`research-targets.ts:373`), not semantic Jev support verification. A source appearing near a claim is not proof it supports it. Manual directed searches use the writer's chosen text without draft-wide extraction.

## Card inventory and current status

The flow inventory is `src/utils/flow-items.ts:18`: comment, persona-note, source, work, shelf, echo, charter, amendment, way-in. Labels at `:45` include echo = “You wrote”; this is live in the local code, and Sentence Lab is still present in catalog (`src/components/in-flow/catalog.ts:76`), renderer and installed struggle pipeline. No claim about Jolyne's unmerged work is possible from these files.

- Comments are writer/conversation material, not inherently new model generations.
- Persona note carries generated feedback above.
- Source cards carry bibliography/search results.
- Work covers use local title candidate extraction, Jev medium/relevance classification when available, then direct Open Library / MusicBrainz / Cover Art Archive lookup. `flow-media.ts:26` is an API lookup, not generation; films return null.
- Echo/You wrote uses local paragraph TF-IDF to propose up to a few earlier passages; two rare shared words minimum (`flow-connections.ts:97`). Jev semantic confirmation is separate; parent conductor audit covers fallback.
- Shelf is dossier reference material. Charter is relevant declared guidance. Amendment offers explicit dossier change. Way-in uses a finite set of suggestions; parent conductor audit covers rules and fallback.
- Four independent tools: Sentence Lab, Rhythm Strip, Claim Check, Reader Questions; separate Quick Review marker/popover; whole review panel and deliberate persona interactions.

## Available writer data

Already present: cursor paragraph/selection and document positions; nearby/full text; edit cadence/pauses; insertion/deletion/undo; per-paragraph versions and per-sentence prior attempts; split/join and hedge-change counts; visible anchors; word counts; current folio and earlier folios; saved revisions/trajectory; effective House→Collection→Folio dossier and charter; writer-authored goal/audience/tone/constraints/success signal; dossier attachments; bibliography/source metadata/snippets and some saved claim/source pairs; persona notes; notebook scraps, voice samples, intentional promises; shown/dismissed/engaged card history.

Context inheritance is deterministic (`house-model.ts:193`): nearest meaningful Folio value overrides Collection then House; stand-in interview defaults yield to explicit ancestor choices; provenance retained. `model-context.ts:8` builds a read-only effective brief and does not silently replace saved dossier.

These signals are not evidence of emotions or a guaranteed desire for help. Use observable wording such as “three revisions of this sentence” and give the writer control.

## Proposed cards for discussion (not implemented as proposed)

| Card                       | Why it could help / actual writer choice                                                                                                                                                                                              | Existing inputs and machinery                                                                              | New work needed                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three ways forward         | For repeated sentence revision: show 3 meaning-preserving choices labeled e.g. Shorter / More concrete / More conversational; each one-line reason; choose, edit, compare, or keep original. Replaces generic Sentence Lab framing.   | Sentence rewrites, attempts, goal, tone, nearby prose; current variant generation + guarded apply/undo.    | Useful semantic labels/reasons, per-variant meaning check, suggestion diff, feedback on why rejected.                                                                   |
| Find the exact word        | For a selected vague verb or repeatedly changed phrase: 3–5 alternatives with register and meaning differences, shown in the actual sentence. Replace one span only.                                                                  | Selection, versions, dossier tone/audience, model feature routing.                                         | Fine-grained stable phrase tracking and lemma/context checks; no automatic thesaurus substitutions.                                                                     |
| Evidence with limits       | Quote the draft claim beside an exact source excerpt; show Supports / Qualifies / Disagrees / Not enough evidence; writer chooses cite, narrow claim, or investigate.                                                                 | Research targets, bibliography, URLs/snippets, notebook claim/source pairs, Jev writing lens architecture. | Fetch/permission-aware full source grounding, exact excerpt validation and citation link, distinguish snippet from full-document check, explicit claim rewrite preview. |
| Show the shape             | A passage becomes a compact causal chain, timeline, comparison, or argument diagram; highlighted missing relationship; writer edits labels, adds the missing link, or inserts an explanation.                                         | Current paragraph, named events/claims, goal, research sources.                                            | Constrained diagram schema, writer-verifiable label anchors, suitability judgement, SVG/accessible text renderer. Do not pretend diagram proves the claims.             |
| One concrete example       | When an abstract claim lacks an instance: choose real sourced example, a writer-supplied memory, or a clearly marked hypothetical; preview one sentence after claim.                                                                  | Claim support checks, research search, dossier/audience, current passage and scraps.                       | Example generation contract distinguishing sourced facts from hypotheticals, evidence check, insertion location and preview.                                            |
| Bridge these two thoughts  | Highlight two neighboring paragraphs and show their missing relationship; choose contrast / consequence / example; preview 1–2 transitions without changing the argument.                                                             | Paragraphs, local repetition/context signals, whole-draft Jev triage, goal, model generation.              | Relationship selection/validation; neighboring stable anchors; transition alternatives and guarded insertion.                                                           |
| Recover the useful attempt | When a revision loses a specific strong detail, show the earlier wording and what disappeared; choose restore phrase, weave detail into current sentence, or leave it. This is a purposeful replacement for a generic You wrote echo. | Actual versions/attempts, earlier passages, local TF-IDF, Jev semantic checks, apply/undo machinery.       | Judge precisely what was lost and whether writer intentionally removed it; span-level comparison/merge; cross-folio provenance.                                         |
| A next step you choose     | After a genuine pause-with-revision pattern or explicit request: choose Answer this reader question / Add one observed detail / Skip ahead with a placeholder. Card completes one small action and disappears.                        | Current passage/goal/audience, saved questions, scraps, way-in hints, draft cursor.                        | Task-specific prompts/actions rather than generic encouragement; writer feedback that help was useful; fresh anchored insertion and snooze.                             |

Suggested discussion controls for the review site: Keep / Change / Drop per concept, “When should this appear?” choices (On request / Offer after pause / Never automatically), and a freeform note. Current mechanism labels should clearly distinguish rule, judgement model, text model and external lookup. Improvements should preserve whole-paragraph context while making every card lead to a specific writing action. Measure accepted edits + writer-reported helpfulness and return-to-writing, not merely card opens.

---

# Twyne history evidence — Entire search, 2026-10-05

Historical intent and recorded implementation reports only; not evidence of current runtime behavior.

## Strongest user evidence

- **Proactive feedback:** Claude Code, `claude-opus-5[1m]`, July 30. Session `c643d18d-360e-4869-9a89-a488d8eb6a13`, checkpoint `ddba339f9937`. User wanted editors to “seemlessly commented rather than only when you wanted a check over”, suggesting a new paragraph or two; models should get “regular context on the path of the edits, the trajectory”. Also sought varied generated interview questions and a less static rubric.
- **Writer-specific feedback:** August 1, session `019fb616-1fed-7211-badf-add714ace02f`, checkpoint `018ecd93f89b`: “AI's to respond to me as I draft directly”; room should “address me directly” and know personal facts and preferred feedback.
- **Research tied to text:** August 2, session `ses_03c0c037fffehXkOWEqjsNbkx8`, checkpoint `ee10437b180f`: research should find draft claims needing citation, quoted speakers, referenced films, and supply an “autobiblio”.
- **Stay with the manuscript:** session `01a02881-29e1-7900-8447-5503e0e64051`, checkpoint `4cc5de23a193` (Aug 24) and `d3c9d95111d8` (Aug 22). User wanted visible search progress, sources, retry and steering; selection-based “get sources”; comments anchored beside text and a bottom composer instead of a detached side panel. Exact intent: “users can hop in and dive in immediately with the text” so “they never really need to pull out of the text”. Preserve “typewriter-esque styling”.

## Historical implementation reports

- July 30 commit `ee7877dd3351986f5134a037905e5744e67d540d`: background editorial room ran on about 300 changed words plus two minutes of quiet, a five-minute floor and session cap; paragraph trajectory supplied to background and explicit reviews; quiet “in passing” cards. Target Fit judge capped shape-derived rubric scores. These are historical thresholds, not current verified ones.
- Sept 23 session `01a0c6d0-476b-7642-8dae-393ed1e4e8ad`, checkpoint `5d131aecc9b0`: assistant reported persona/voice split from protocol and seven Jev policy questions. Critical violations vetoed notes, major violations requested repair, uncertain responses neither passed nor vetoed automatically. Paths: `prompts/persona-system.md`, `prompts/editorial-protocol.md`, `convex/agentPrompts.ts:155`, `src/utils/editorial-policy.ts`, `convex/systemOne.ts:296`. Hosted Jev model selection delegated to Not Organic; snippet omitted direct fallback model name.
- Sept 30 commit `0cb77885757ccd9f2e34dd898d469f3fdc4f004c`: “bring context, conversations, and focus into the writing flow”. Commit `0a8865c629bc8e18d30e6403431fe064aafc8be9`: “complete the flow release checks and document changes”. No corresponding recent Opus session transcript recovered.

## Search boundaries

Only `entire search --json` used for history. Initial sandbox authentication failed; escalated search succeeded. Exact session `c3f82037-0972-4858-b875-c87b73e8ceba`, `goofy-enchanting-riddle`, `Jolyne`, `Jolyne`, and `pneumatic` returned no matches. Broader flow/card searches found older intent and Sept 30 commits, but did not establish recent removal of Sentence Lab or “you wrote this”. Supported date filters (`week`, `month`) unexpectedly returned June/July entries; do not interpret those outputs as a reliable recent-only inventory. No local transcript/plan files read and no repository files changed.
