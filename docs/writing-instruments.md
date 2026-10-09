# From cards to instruments

Design proposal and implementation record, 2026-10-09. Responds to `audit.md` (2026-10-05) and its proposed cards.

## Implementation status

The first instrument slices now exist in the working tree: complete sentence comparisons and word choices, nearby placement, contextual narration, manuscript Threads, entity presence and bounded readings, paragraph readings and Charter exceptions, explicit local model packs, a durable Task desk, and a Scene bench with source inventory and separate writer ideas. The public manual now describes these controls under **Writing instruments**, beside **The piece**.

This is an implementation map, not a deployment or live-provider certification. The original proposal below remains intact as a design target; its future capabilities are not promises about the current interface. In particular, automatic semantic placement ranking, generated bridges and merges, cross-folio scene continuity, cast voices, tension-curve soundtracks, and image/video generation are not supplied by this implementation.

| Instrument | Current behavior | Implementation |
| --- | --- | --- |
| Sentence bench | Complete candidates with source labels, word diffs, editable working wording, side-by-side comparison, stale-span checks and undo. Bundled thesaurus choices and neighbouring placement work locally. Hear uses the existing narration player. | `src/components/in-flow/sentence-bench.tsx`, `src/utils/sentence-bench.ts`, `src/utils/sentence-ledger.ts`, `src/components/editor/extensions/struggle-tracker.ts` |
| Selection tools | A selected word opens alternatives; passages can open Sentence bench, Hear, Threads, Scene bench and Task desk. The existing source/comment/persona actions remain available. | `src/components/editor/selection-actions.tsx`, `src/components/editor/twyne-editor.tsx`, `src/components/instruments/instrument-dock.tsx` |
| Threads | Exact manuscript sentence pairs, local repeat/overlap/reference hypotheses, optional bounded relation judgements, passage highlighting and jumps, undoable removal of an exact repeat. Unverified relations remain labelled. | `src/utils/span-index.ts`, `src/utils/thread-instrument.ts`, `src/components/in-flow/thread-instrument.tsx` |
| Entities | Local name candidates, section presence and exact source jumps. Explicit model readings cover co-present relationships, a chosen attribute's continuity and blind dialogue attribution. Full distributions and source evidence remain inspectable; no character-quality or dialogue-distinctness score is claimed. | `src/utils/entity-instrument.ts`, `src/components/instruments/entity-instrument.tsx` |
| Paragraphs and Charter | Per-paragraph local cues and optional Jev score distributions remain distinct from the whole-piece estimate. Deliberate occurrence exceptions enter the folio Charter; new drift is still eligible for a finding. | `src/utils/living-desk/paragraphs.ts`, `src/utils/living-desk/charter.ts`, `src/components/editor/extensions/living-desk.ts`, `src/components/living-desk/living-desk-panel.tsx` |
| On-device packs and Say it | Explicit, separately removable English embedding, masked-word and speech packs. Nearby passage comparison, word prediction, and editable local transcription feed reviewable results. No automatic model download. First load needs model/runtime downloads and an open tab. | `src/utils/local-writing-manifest.ts`, `src/utils/local-writing-models.ts`, `src/utils/local-writing.worker.ts`, `src/components/instruments/local-writing-tools.tsx` |
| Task desk | Account-backed queue for passage reviews and research over up to three selected account resources, cancellation, saved source context, result provenance and feedback. Accepted server work can outlive the tab; browser-local work cannot. Uses hosted Not Organic inference and account credit. No open-web agent research is connected. | `src/components/instruments/task-desk.tsx`, `src/utils/instrument-tasks*.ts`, `convex/instrumentTasks.ts`, `convex/instrumentTasksRunner.ts` |
| Scene bench | Exact selected-passage inventory for six English cue dimensions; optional closed-option Jev span/tension reading; existing narration; writer-added ideas saved locally to the exact passage; copyable image/sound/motion briefs with additions separated. No media generation API is connected. | `src/utils/scene-bench.ts`, `src/components/instruments/scene-bench.tsx` |
| Art and motion | Generated copperplate proof slips for Sentence, Threads, Research and Scene; alpha textures and rule; brief open/compare/arrival states; quiet and reduced-motion behavior. Art belongs to the instrument, not the manuscript. | `src/components/instruments/instrument-art*`, `src/components/instruments/instrument-motion*`, `public/assets/instruments/`, `docs/instrument-art-direction.md` |
| Public guide and reusable evidence | Product instructions, actual component/manuscript captures, downloadable contextual films, tests and recorded proof boundaries. | `src/routes/docs/guide-writing-instruments.ts`, `src/routes/docs/manual-films.ts`, `e2e/instruments.e2e.ts`, `public/assets/instruments/scene-bench-verification.json` |

Scene verification currently includes 13 pure tests, exact-span and stale-context rejection checks, a reproducible local inventory benchmark (`bun src/utils/scene-bench.benchmark.ts --budget-ms=20`), actual Storybook interactions, local idea persistence after reload, mobile overflow inspection and an offline component recording. Its mock judgement specimen is explicitly labelled; no live Jev, narration or media generation success is inferred from it. Art verification records actual finite animation events, quiet behavior and browser reduced-motion preference emulation across open, compare and result-arrival controls. The public guide's two steps, image loading, print view and overflow checks passed at 1440, 390 and 320 pixels. See `docs/instrument-art-direction.md` and the verification manifests for the exact proof boundaries.

## Original design proposal

The critique and capability ladder below describe the starting point and intended direction. Read the implementation map above for present behavior.

## The problem in one paragraph

Twyne's help is shaped like notifications. Local rules decide that something might be worth saying, Jev decides whether to say it, and a card describes it in the margin. Most cards *describe* ("You wrote", "Possible repetition", "Say it plainly first") instead of *doing* something to the text. Without a prose model the tools have almost nothing to offer: they show the writer's own fragments back to them and suggest connecting a model. Jev, the cheapest and fastest model available, is used mostly as a yes/no gate in front of cards. It is rarely used to point at spans, choose a position, or rank candidates, which is what it does best.

## Why Sentence Lab feels broken (verified in code)

1. **The "earlier tries" are mid-edit snapshots, not attempts.** `struggle-tracker.ts:85` commits a version after every 1.2 s pause, and `commitVersion` (`struggle-signals.ts`) stores the previous wording whenever exactly one sentence changed. A pause in the middle of a word records something like `The river carr the town's memory.` as an attempt.
2. **Sentence identity depends on position.** When the paragraph's sentence count changes, `commitVersion` clears `rewrites` and `attempts`. Splitting, joining, or moving a sentence erases its history. Activity is keyed by block position, so moving a sentence elsewhere is not visible at all.
3. **Without a prose provider there is nothing to show.** `fillSpec` (`in-flow-tools.ts`) returns the seed and the notice "Your own attempts only — connect a model in Settings for fresh variants." The tool's main content then comes from item 1.
4. **The variants carry no reasons.** The prompt asks for three different approaches (reorder, cut, make concrete), but the UI labels them all "Other ways". Nothing checks whether a variant keeps the meaning.
5. **The tool covers only wording.** It has no word-level alternatives, no placement, no read-aloud, and no comparison in context.

## Critique of the proposed cards in `audit.md`

| Proposal | Keep | Problem | Change |
| --- | --- | --- | --- |
| Three ways forward | The core idea: complete alternatives you can choose, edit, compare, or keep original | The generator labels its own variants ("Shorter"); it needs a prose model; it is still a card | Code computes facts like word count and voice; Jev or embeddings check meaning; rule-based rewrites and on-device models fill it offline |
| Find the exact word | Yes | Assumes an LLM | Works offline: thesaurus candidates ranked by a small masked language model in context; Jev adds nuance tags |
| Evidence with limits | Yes, later | Large dependency on fetching sources | Leave in research; reuse the claim span from the Threads index |
| Show the shape | Yes | "Constrained schema" still lets a model invent nodes | Every node must be a span of the writer's text. Jev picks spans and edge types; code draws |
| One concrete example | Partly | Invented examples are a hallucination risk in nonfiction | Offer only sourced examples, the writer's own notebook scraps, or examples clearly labelled hypothetical |
| Bridge these two thoughts | Yes | No trigger defined | A drop in embedding similarity between neighbours is the trigger; Jev names the relation; the LLM drafts a transition |
| Recover the useful attempt | Yes | Depends on attempt history, which is currently corrupted (see above) | Fix capture first |
| A next step you choose | No | Still general coaching | Replace with **Say it**: the writer speaks what they mean and the transcript becomes a candidate sentence |

Gaps shared by every proposal:

- **They remain cards.** None of them changes where help appears. Everything still lives in a margin column, away from the words it concerns.
- **They don't cover the offline case.** Every useful proposal assumes a prose LLM, and that is the main complaint.
- **They use Jev only as a gate.** Jev can choose among up to 255 IDs in one question (the TypeSafe "line-by-line search" cookbook pattern). With sentence IDs as the options, Jev can point to *where*: which sentence this depends on, where this sentence fits, and which earlier line it repeats. None of the proposals use this.
- **They ignore other modalities.** Listening to prose read aloud is the oldest revision technique there is, and Twyne already includes a local TTS model.
- **They don't fix the foundation.** Positional identity, polluted attempts, fragile 14-word regex anchors, and the Convex-client gate in front of the writer's own judgement endpoint (`struggle-tracker.ts` `ask`: `if (!client) throw new Error("offline")`) would also undermine every new card.

What the audit gets right and should be kept: label each suggestion's provenance (rule, judgement model, text model, external lookup), give the writer control over when things appear, and measure applied edits instead of card opens.

## The reframe: three places help can live

Replace "cards" with **instruments**: tools that point at a span and change it, always with a preview and undo.

1. **In the line.** Underlines, ghost text, and small glyphs placed directly in the manuscript, like Grammarly but for a literary writer. Examples: grammar (Harper, already shipped), word alternatives, words a model finds unlikely in context, repetition. All of these run locally.
2. **Between lines (threads).** Typed links between spans: *repeats, sets up, pays off, supports, contradicts, answers, refers back to*. They appear when the writer selects or hovers with a modifier key, or when a "Threads" lens is turned on. The curve-drawing code in `flow-surface.tsx` already draws card-to-passage links; extend it to draw sentence-to-sentence links with labels.
3. **On the bench.** A focused workbench opened on one span: the Sentence bench, the Paragraph bench, and the Scene bench (described below).

**Surfacing rule.** Nothing appears automatically unless it carries a change ready to apply or opens a working instrument with one click. Pure information ("You wrote this earlier") is not allowed. The current echo card either becomes **Recover**, which offers a concrete merge, or a **thread**, which names the relationship.

## The capability ladder: what works without model access

Every instrument declares what it can do at each tier. The lowest tier must still be useful by itself. "Connect a model" is never the main content.

| Tier | What it is | Status in Twyne |
| --- | --- | --- |
| 0. Code | Harper grammar and spelling; rule-based transforms; the writer's own *settled* attempts; a bundled thesaurus; TF-IDF | Harper and TF-IDF are shipped |
| 1. On-device models (opt-in download) | transformers.js: sentence embeddings, a fill-mask model (word alternatives and surprise), Whisper (Say it); Supertonic TTS (Hear it); MiniCPM5-2B on desktop (full rewrites); browser built-in rewriter or proofreader APIs where the browser provides them (feature-detected) | `@huggingface/transformers` is already a dependency; Supertonic and the desktop LiteRT provider are shipped; the download-manifest pattern exists in `browser-inference.ts` |
| 2. Jev | Selects, ranks, labels, and verifies. Generates no text, so it can afford to run on every candidate set | Shipped, but used mainly as a gate |
| 3. Prose LLM | Rewrites, bridges, merges, examples | Shipped, but its absence leaves tools empty |
| 4. Media models | Image, music, video. Always explicit, never automatic; each use shows its cost and where the data goes | Not present |

**Generators propose; Jev decides.** Candidates come from rules, the masked model, an LLM, the writer's past attempts, and the writer's speech. Jev, or local embeddings as a fallback, judges them. Anything code can compute stays in code: word count, voice, sentence-initial verb, removed hedges. Jev is asked only for meaning, register, and fit.

## Instrument 1: the Sentence bench (replaces Sentence Lab)

Fix the data first:

- **Settled attempts only.** Record a wording only when the sentence is complete (ends in terminal punctuation), the cursor has left it or about 5 s have passed, Harper reports no spelling error touching the edited span (this catches `carr`), and it is not a prefix of a later wording. Collapse near-duplicates (fewer than 3 characters different).
- **A sentence ledger.** Give each sentence a stable ID that is mapped through transactions. Re-match by fuzzy similarity rather than index, so split, join, cut, and paste preserve history. Detect moves: text deleted and reinserted at least 90% similar, either in one transaction or by cut and then paste. Each entry keeps `wordings[]` and `placements[]`.

The bench has five sections. Every candidate is a complete sentence shown as a word-level diff against the current one. Hovering a candidate previews it as ghost text in place, between the real neighbouring sentences.

1. **Rewrite.** Three to five complete alternatives. Each shows facts computed in code (`−6 words`, `active`, `no hedge`) and verified tags (`keeps meaning 0.94`, `fits your register`), plus a provenance chip: *yours (4 min ago)*, *rule*, *on-device*, *Claude*, *spoken*. Offline sources are the best settled attempt plus rule transforms (front a trailing clause, cut intensifiers and hedges, turn a nominalisation back into a verb, split at a semicolon or conjunction, join with the next sentence), each checked by Harper. On desktop, MiniCPM fills in automatically.
2. **Words.** Click any word to see alternatives in context. Thesaurus candidates are ranked by the masked model's probability in the actual sentence. Jev adds nuance (`stronger`, `plainer`, `more formal`) and a `changes meaning` warning. Repeated words in the paragraph are underlined.
3. **Place.** Insertion carets in the manuscript mark the strongest slots, each with a reason. Some reasons are deterministic: a sentence starting with *This*, *These*, *It*, or *Such* needs its antecedent before it. Others come from embedding coherence with the neighbours on each side, or from a Jev Choice over slot IDs. Uses `placements[]`: "You've tried this in 3 places; read each one in context." One click moves it, with undo.
4. **Hear.** Supertonic reads the previous sentence followed by each candidate, entirely offline. Rhythm problems are easier to hear than to see.
5. **Say it.** The writer records themselves explaining what the sentence should say. Whisper transcribes it; rules or a model tidy it; the result becomes a candidate. This replaces the "Say it plainly first" template with an actual action.

The bench opens from a struggle signal (three *settled* rewrites), after a sentence has moved twice (opens on Place), or on request from the selection menu or a shortcut.

## Instrument 2: the contextual selection menu

Today the menu always offers the same three actions (Get sources, Add margin, Send to persona). Instead, classify the selection: its **shape** locally (word, phrase, sentence, several sentences, paragraph, two separate ranges) and its **kind** with one cached Jev Choice (claim, description, dialogue, transition, list, quotation). Then offer actions to match:

| Selection | Actions |
| --- | --- |
| A word | Alternatives in the line, every use in the draft |
| A sentence | Rewrite, Move, Hear, Threads |
| A claim | Find support, How strongly to state it, Strongest objection |
| Description | See it, What's missing, Hear it |
| Dialogue | Cast voices, Does each speaker sound distinct? |
| Two ranges (Alt+select) | Name the relation, Bridge, Merge, Which is stronger, Swap |

The existing three actions remain.

## Instrument 3: Threads

- Number the sentences of the current section (`S001`…). Jev Choice accepts at most 255 options, and state plus the longest question must fit in 32k tokens, so use section windows plus a second pass (the cookbook's two-pass approach).
- Local embeddings propose candidate pairs at no cost. One Jev request labels them: a Choice among *repeats / supports / contradicts / sets up / pays off / answers / no real relation*, plus a Noul for whether the link exists (Choice probabilities always sum to 1).
- Proactive threads that come with an action: a **setup with no payoff** ("'the ledger' is introduced in ¶2 and never comes back": choose a later sentence or add one); **two sentences doing the same job** (offer Merge with an actual merged sentence, or keep the stronger, chosen by Jev); a **dangling reference** (*this* with nothing before it to refer to: offer Move).
- Replace the 14-word regex anchors with ProseMirror decorations keyed to ledger IDs.

## Instrument 4: the Scene bench (where media models earn their place)

Images, music, and video help a writer only if they show the gap between what is on the page and what the writer imagines.

- **See it.** Jev runs a Noul for each scene dimension (place, time of day, light, weather, who is present, what they wear, spatial layout, sound, smell). The image prompt is built **only from spans of the writer's text**, which Jev selects rather than writes. The result is the image plus a list of **what it had to invent**. Each invented item links to the spot where the writer could specify it. That list is the useful output; the image is the hook.
- **Continuity** without images: extract attributes as text ("Mara's coat: red, ch. 2"; "blue, ch. 7") and flag contradictions as threads across folios.
- **Voices.** Assign TTS voices to speakers and play the dialogue back. If two characters sound the same aloud, they also read the same.
- **Tension curve.** Jev Scores per paragraph (tension, pace, warmth) plotted across a chapter cost almost nothing and show pacing. An optional generated music cue turns the curve into sound, a quick way to check whether a scene feels as tense as intended.
- **Blocking.** Positions and movements chosen from spans become a simple top-down SVG. Generated video ("animate the beat") stays a late opt-in for screenwriters; the diagram does more for the writing at a tiny fraction of the cost.

## Local language models as grammar and style checks

- **Surprise underline.** A masked model scores each word in context. Unlikely words catch real-word errors that Harper misses (*form/from*, wrong prepositions, malapropisms), and the model's top replacements become suggestions.
- **Redundancy.** Neighbouring sentences with very similar embeddings.
- **Cohesion gaps.** Similarity between neighbours falls below this draft's own baseline; this is the trigger for Bridge.
- **Voice match.** Distance from the centroid of the writer's voice samples in the notebook. Phrase it as an observation, never a verdict.
- **Clichés.** Phrase embeddings compared against a small bundled list.
- **Drift from the dossier.** Similarity to the stated goal, continuous across the draft, with Jev confirming only at the peaks.

## Jev question shapes (concrete)

| Need | Primitive | State | Options |
| --- | --- | --- | --- |
| Where should S go? | Choice | Section with `S###` IDs and `slot###` markers | slot IDs + `nowhere better` |
| What does S depend on? | Choice + Noul exists | Section with IDs | sentence IDs |
| Relation between A and B | Choice | Both spans + surrounding text | the 7 relation types |
| Does candidate keep meaning? | Noul (one per candidate) | Original, candidate, paragraph | — |
| Register fit | Score | Candidate + dossier tone + voice sample | 3 levels |
| Which word fits | Choice | Sentence with the word slot marked | candidates + `keep original` |
| Is scene dimension X specified? | Noul (one per dimension) | Passage | — |
| Which spans are visual detail? | Choice over span IDs (repeated with exclusions) or one Noul per span | Passage with span IDs | span IDs |

Batch every independent question for the same state into one request (`system-one.ts` already supports this).

## Levels: the whole piece, not just the sentence

Sentence work is one level of six. Help needs to reach every level, and the most useful findings often span the whole document. Examples: an essay that slides between "I" and an editorial "we", a character called Hollins in chapter 2 and Hollis in chapter 9, a section that disappears from the argument.

| Level | Examples of what to notice | Who finds it |
| --- | --- | --- |
| Word | Repeated words, near-synonyms, unlikely words | Code, fill-mask model |
| Sentence | Rewording, placement, rhythm | Sentence bench (above) |
| Paragraph | Missing support, cohesion, how much it carries | Jev passage scores, embeddings |
| Section / scene | Balance, order, tension, point of view | Jev, outline, embeddings |
| Piece | Stance, tense, naming, terminology, promises, arcs, the score | Ledgers (below) |
| Collection | Story bible, repeated anecdotes, voice over time | Cross-folio index |

### Consistency ledgers

A ledger tracks one property across the whole document. It always has the same shape:

1. **Code finds every occurrence**, instantly and offline: pronouns outside quotation marks, verb tenses (a local POS tagger such as `compromise` is worth evaluating), capitalised names, spelling variants by edit distance, number and date formats.
2. **Jev classifies only the ambiguous ones**, many per batched request (`passage-triage.ts` already chunks batches against the 64-question cap).
3. **Code totals them and keeps the count live** as the writer edits.
4. **Code offers a fix with a preview**, one occurrence at a time or all at once, plus a **Deliberate** option. Deliberate records the choice as a Charter rule, so the ledger stops nagging and future drift is flagged straight away.

**Stance (I / we) is the clearest case.** A regex can count "we", but it can't tell what the "we" means. For each "we/us/our" outside dialogue, Jev answers one Choice with the sentence before it as context:

- the author alone (editorial or royal we)
- the author and the reader ("as we'll see")
- a group the author belongs to (family, team, town)
- a character speaking
- people in general

Only an editorial "we" mixed with a mostly-"I" piece is a problem. Inclusive and group "we" are normal, and a regex alone would flag them. The fix is mostly deterministic: we→I, us→me, our→my, ourselves→myself, with verb agreement (we are→I am, we were→I was). Harper then checks the result. Each fix moves the count and the Voice criterion.

Other ledgers built the same way:

- **Narrating tense:** one Jev Choice per paragraph (past / present / deliberate shift such as a flashback / unintended mix), ignoring dialogue.
- **Point of view per scene:** whose thoughts we have access to, a Choice over the cast; flags switching heads mid-scene.
- **Naming:** Hollins and Hollis are caught by code alone. Whether *Dr Okafor*, *Ada* and *the doctor* are the same person is a Jev Noul for each candidate pair.
- **Terminology:** "participants", "subjects" and "respondents" drifting for one concept is found by embeddings and confirmed by Jev. A term used before it is defined is caught by code once the definition has been located.
- **Style sheet:** US or UK spelling, serial comma, *ten* or *10*, date formats, hyphenation. Pure code, majority rule, with the exceptions flagged. This is a copyeditor's style sheet the writer gets for free, and it suits Twyne.
- **Who "you" is:** the reader, or anyone in general.
- **Register:** one Score per paragraph, plotted as a curve.

### Characters and entities

- **Index:** code proposes candidates (capitalised runs not at the start of a sentence, repeated "the X" phrases); Jev confirms the type (person / place / organisation / object / idea / none).
- **Presence grid:** entities × sections, computed by code. It shows a character missing for eight chapters, or a place that turns up only once.
- **Relationship web:** for each pair that appears in the same paragraph, a Jev Choice over relationship types and a Score for tension, per chapter. That gives relationship *arcs*. Each edge links to the spans that establish it.
- **Continuity:** for each attribute (eyes, age, coat), Jev picks which candidate span states it, or none. Code compares the values across chapters and turns contradictions into threads.
- **Do the voices differ? (blind attribution):** remove the speaker tags and ask Jev who said each line, as a Choice over the cast. If Mara's lines are attributed to Tom 60% of the time, they sound alike. Accuracy per character becomes a distinctness score.
- **Nonfiction:** the same machinery makes a claim web (claim → support → objection) and a concept map (where each concept is introduced, used, and dropped).

### Structure

- **Outline health:** each heading in the existing outline (`document-outline.ts`) gets badges: its share of the words, its open findings, and a score heat for the selected criterion. Dragging sections to reorder them (`section-reorder.ts`) gets suggestions: an embedding similarity matrix shows sections that belong together, and a Jev Choice suggests which section should come before a given one.
- **Promises and payoffs:** the "promises" lens becomes a ledger with a status for each promise: kept / open / dropped. One Noul asks whether the ending answers the question the opening raises.
- **Pacing:** dialogue-to-narration ratio and section length (code), tension (a Jev Score per paragraph), drawn as curves along the outline.

## The living score

Today the rubric asks one Jev Score per criterion of the whole draft (`rubric-grade.ts` `buildRubricQuestions`). It runs after a save, at most once per 30 s, and only for drafts over 500 words. The score therefore cannot say *where* it comes from or move while you edit. `scoreStaticFeatures` is pure code that could run on every keystroke, but it is only called at review time.

**Three cadences:**

| Cadence | What updates | Engine |
| --- | --- | --- |
| Instant | Static features, ledger counts, style sheet, presence grid | Code |
| When a paragraph settles | That paragraph's scores for local criteria (evidence, integrity, pacing, voice); classification of new ledger occurrences | Jev, batched across dirty paragraphs |
| Periodically | Whole-piece criteria (thesis, target fit, structure, promises) | Jev, labelled "read 3 min ago" and marked stale once enough has changed |

**Attribution and honesty.** Paragraph scores show *where the grade comes from*: a heat map per criterion. Code combines them using the composite-scoring pattern (weighted, with a penalty for the weakest paragraph, because readers notice the worst one). The headline grade moves with these estimates, marked ≈, and settles on the confirmed whole-piece reading when it arrives. Paragraph scores averaged together have not been shown to agree with whole-draft judgements; validate that on real drafts before trusting the estimate.

**What matters most.** Every finding, at every level, carries an estimated impact: criterion weight × the distance to the next score level × how much of the piece it covers. It also carries an effort: the number of edits needed. Findings are sorted by impact, so the writer can see what is worth fixing.

**Cards at every level** share one shape:

- `level`: word / sentence / paragraph / section / piece / collection
- `scope`: anchored spans, from 1 up to dozens
- `metric`: a live count or score, with its trend
- `criterion`: which rubric criterion it feeds, used for impact
- `actions`: fix one / review all / make it a rule / open lens / dismiss with reason
- `provenance`: rule, Jev, or text model
- `state`: open / improving / resolved / deliberate

Collapsed, a card is one line with a live number. Expanded, it takes over the document: the manuscript switches to that card's **lens** (matches highlighted, everything else dimmed), and a **document spine** beside the page shows the whole piece as a strip with ticks where the finding occurs. Each fix previews as ghost text. Accepting it updates the count, the minimap tick, the criterion bar, and the headline grade together.

The document spine is the permanent view of the whole piece: sections, heat for the selected criterion, ticks for the open lens, character presence. Clicking any point jumps to that spot.

## Rich fields: plain text that understands itself

Bramus's [`<rich-input>`](https://rich-input.netlify.app/) is a single-line input that recognises `keyword:value` tokens as you type. It highlights them in place with the CSS Custom Highlight API (no DOM changes), completes them from a `<datalist>`, and returns a parsed value (`getParsedQuery()`). The field stays plain text, yet produces structure.

Its tokens depend on syntax. System One makes the same idea work for prose with no syntax. That gives every field two layers:

- **Hard tokens:** recognised by code. Syntax, numbers, dates, quoted strings, `@names`, and exact matches against known entities. They are instant and certain, shown with a solid underline.
- **Soft tokens:** recognised by Jev when typing pauses. They are probabilistic, shown with a dotted underline, and Tab or a click turns one into a hard token. A soft token is never converted silently.

**Code proposes spans; Jev labels them.** Jev returns no character offsets. Code splits the field into candidate spans (clauses, noun phrases, quoted runs, capitalised runs, known names). One batched request then asks a Choice for each span over the field's label set plus `none`, or a Choice over project IDs when the span refers to something. This is the cookbook's pre-parsed value extraction pattern. Responses are dropped if the text has changed since the request (quick review already does this). The parsed value, not the prose, is what downstream judges receive. That generalises dossier probes: instead of asking a separate typed question, read the structure out of the answer the writer already gave.

| Field in Twyne | Hard tokens (code) | Soft tokens (Jev) | What the writer gets |
| --- | --- | --- | --- |
| Audience / goal / tone | — | Score each span on brief-coach's levels (Vague → Sharp) | Brief coaching moves from the whole field to the actual words: "general readers" marked vague, "nurses who already know triage" marked sharp |
| Constraints | `under 1500 words`, quoted phrases | `avoid:"the lawsuit"`, `style:no jargon`, `pov:first person` | Each constraint becomes a rule checked live against the draft and shown inside the field (`1,812 / 1,500`) and in the Charter |
| Find | `in:ch3`, `kind:dialogue`, `"exact"` | Description → Choice over sentence IDs, plus a Noul for whether any match exists | "where I first mention the ledger" or "every place I hedge about the flood" become a search |
| Replace | the literal match list | One Noul per match ("here, does *the town* mean its people?") | Conditional replace: only the matches where it means what you meant |
| Comment composer | `@persona`, `#todo` | Reference resolution ("what I said about the ledger earlier" → `S012`); intent (note to self / question for a persona / task) | A comment that links its own evidence, draws a thread, and routes itself |
| Research query | years, quoted titles | Target kind (claim / quote / person / statistic / event / work) and the claim span it supports | The `research-targets` types filled from the query itself, shown before searching |
| Command bar / selection "ask" | `/rewrite`, `/move` | Intent and arguments ("shorter, less hedgy" → `rewrite(length: shorter, hedges: remove)`); the function-calling pattern | The parsed action is shown as tokens before Enter, so you see what will happen |
| Rubric criterion / Claim Check slot | — | Noul: "could a draft fail this?" | Criteria that rule nothing out are flagged as you type them |
| Bibliography paste | candidate authors, years, and titles found by regex | Which candidate fills which field | A messy citation becomes a structured entry |
| Cross-field | — | Noul: do tone and audience conflict? | Both conflicting spans are underlined and linked |

The manuscript is the largest rich field of all. "In the line" instruments should use the same pattern, rendered as ProseMirror decorations rather than marks, just as `<rich-input>` uses highlights rather than markup.

Cost and limits: Jev 1.13 charges $0.042 per million input tokens and allows 80 requests/s. A 300-token check costs about a thousandth of a cent, so the binding limit is Twyne's own judgement budget (12 calls/min shared across all features). Rich fields need their own budget lane, debounced to a pause of about 600 ms.

## Foundation fixes (prerequisites)

1. Settled attempts and the sentence ledger (above).
2. Let callers use a custom judgement endpoint without a Convex client (audit gap 8; also `struggle-tracker.ts` `ask`).
3. Mark candidates as `asked` only after the judgement succeeds; re-index the archive when earlier paragraphs change (audit gaps 5 and 6).
4. Remove the "You wrote" echo, or turn it into Recover or a thread.
5. Measure applied edits, edits still kept after 24 h, time until typing resumes after an instrument closes, and the reason for each dismissal. Do not measure opens.

## Phasing

1. **A living skeleton**: the card schema, the document spine, lenses, static features recomputed live, and the first code-only ledgers (style sheet, naming variants, raw pronoun counts, presence grid). Useful offline and puts the whole piece in view.
2. **Scores attributed to paragraphs**: per-paragraph scores for local criteria on settle, the ≈ estimate settling on the periodic whole-piece reading, impact ranking, the stance and tense ledgers with Jev classification, and Deliberate as a Charter rule.
3. **Offline Sentence bench**: settled attempts, sentence ledger, rule rewrites validated by Harper, word alternatives, Hear, ghost preview.
4. **Jev as selector**: Place, Threads, the entity index and relationship web, continuity, blind attribution, the contextual selection menu, rich fields.
5. **On-device model bundle** (opt-in): embeddings (terminology drift, section similarity, cohesion), fill-mask, Whisper.
6. **Scene bench**: See it with the invented-details list, voices, the tension curve; media providers behind explicit consent and per-use cost.
