# Changelog










## 0.14.0
<sub>2026-08-12</sub>

-  *(minor)*
  Twyne 0.14 makes the writing room calmer to use and easier to understand.

  **Editorial help stays in the room.** Grammar, citations, rubrics, comments,
  and research panels now share clearer states and recovery paths, while the
  editor keeps the writer's draft visible and intact during asynchronous work.

  **Speech becomes a real reading aid.** Voice notes and persona playback can be
  queued, replayed, moved forward or backward, and followed through the draft
  with sentence-level highlighting.

  **Settings now explain themselves through behavior.** Provider validation,
  reasoning effort, runtime scaling, model selection, and site configuration are
  wired through explicit controls with safer local defaults and useful feedback
  when a provider or capability is unavailable.

  This is a broad usability and editorial workflow improvement, so it ships as
  a minor release.

## 0.13.0
<sub>2026-08-11</sub>

-  *(minor)*
  Twyne 0.13 turns the writing desk into a place you can inspect, recover, and
  extend without giving up its local-first center.

  **Your draft has a memory.** Revision checkpoints give you named moments to
  return to, while the privacy ledger makes the boundary between local, synced,
  published, and provider-bound data visible. Account recovery and collaboration
  invitations now preserve the work in front of you when authentication or
  delivery needs attention instead of presenting a success-looking dead end.

  **Research becomes something you can arrange.** The apparatus gains a source
  canvas for laying out evidence and relationships, including streamed OpenUI
  cards and inspectors. Sources can be extracted from documents, reached through
  configured MCP research servers, and carried through the dossier and apparatus
  without flattening them into an anonymous block of text.

  **Local AI is a real route, not a checkbox.** Browser models can be discovered,
  downloaded, cached, and used from the same generation path as remote providers.
  Reasoning, errors, model availability, and recovery remain visible, and voice
  playback now has a queue with next, previous, and replay controls rather than a
  single fire-and-forget utterance.

  **The manuscript travels more faithfully.** DOCX import and export join the
  existing readable formats, inline notes survive exchange, and folio state,
  editor preferences, revisions, and collaboration data move through a hardened
  local-to-Convex sync path with stricter identity ownership and conflict handling.

  **The toolchain opens up.** The Twyne CLI package adds Codex and Anthropic SDK
  adapters that reuse each provider's official local sign-in, while prompts move
  into reviewable files with regression tests and an opt-in optimization harness.
  The distinction stays explicit: Twyne credentials authorize Twyne, and provider
  credentials stay on their provider's native transport.

  This is a broad new product surface, so it ships as a minor release.

## 0.12.0
<sub>2026-08-07</sub>

-  *(minor)*
  The room writes where you can see it, and models that think first stop costing
  twice.

  **Hosted notes arrive as they are written.** Convening the room without your own
  API key used to mean five blank cards and a wait, because the server generated
  each note in full before returning it. The hosted path now streams: each editor
  publishes their note as it is composed, keyed by persona, so five cards fill in
  at once and the wait is spent reading rather than watching a spinner. The panel
  cannot tell whether a note came from your key or from ours — both paths deliver
  the same snapshots into the same cards.

  **Thinking is shown, not hidden or punished.** A model that reasons before
  answering now says so — the card reads "thinking…" and offers the scratch work
  folded away, instead of sitting empty for as long as the model works. And a
  reply that opened a `<think>` block is no longer thrown away and asked for
  again: the thinking was already stripped from what you read, so the second call
  bought nothing. Twyne only regenerates when nothing visible survived at all,
  which halves the cost and the wait on exactly the models that can least afford
  either.

  **Room to grow.** Three collections — your folios, your custom editors, your
  bibliography — each used to be stored as a single record holding the whole list.
  Every change rewrote the entire thing, and the list could not grow past the
  database's per-record ceiling: a long enough bibliography would eventually have
  stopped saving. Each is now stored an item at a time, so editing one folio
  touches one folio, and nothing has a ceiling to hit. Existing accounts convert
  themselves on their next save; the rest are converted in the background. Nothing
  about this is visible from the app, which is the point.

  **A harness for small local models.** `bun run eval:local` runs the real
  production path — the same prompts, the same `quote_passage` tool — against any
  OpenAI-compatible endpoint, with and without tools, so a candidate on-device
  model can be judged on whether it can actually anchor a note to a passage.

## 0.11.0
<sub>2026-08-05</sub>

-  *(minor)*
  Twyne grows a way out of the browser, a canonical home for published work, and
  an honest account of what its editors are doing — none of it at the cost of the
  draft leaving the machine it was written on.

  **The room, from your own tools.** A `twyne` CLI and a `twyne-mcp` server talk
  to a single token-scoped endpoint, so folios, feedback, and citations are
  reachable from a terminal or from another agent. Personal access tokens are
  created in Settings and stored only as a SHA-256 digest — the token itself is
  shown once and never again. Every operation resolves that digest and then runs
  bound to the verified owner, so a token cannot reach anyone else's work. Writes
  carry the revision they read: a folio that moved in the meantime comes back as
  a conflict rather than quietly overwriting the newer draft.

  **Published pieces get an address.** Publishing files a Standard.site
  publication and document in the writer's own ATProto repository, and Twyne now
  serves the matching reading pages, so a published piece has a canonical,
  verifiable home instead of only a record in a PDS. The share panel remembers
  the record key locally, which is what makes re-publishing and unpublishing work
  on a later visit; the PDS stays the source of truth.

  **Observability that redacts by default.** Every generation returns the trace
  id that produced it, and that id rides along on the persona note, so a
  thumbs-up or thumbs-down attaches to the exact generation rather than to a
  guess. Negative feedback becomes a pending review queue. Both exporters redact
  content unless it is explicitly turned on: Arize spans blank their input and
  output attributes and mark themselves redacted, and PostHog serializes AI
  content in redacted mode. Token usage and deterministic eval signals scored
  locally travel instead of the prose.

  **Product analytics with an allowlist.** Events go through one typed contract
  that stamps a version and drops any property not on that event's allowlist.
  Draft prose never leaves the browser — word counts are bucketed, folio names
  and ids are not carried, and only stable error codes are sent, never raw
  messages.

  New surface rather than a change in behaviour, so it goes out as a minor.

## 0.10.0
<sub>2026-08-02</sub>

-  *(minor)* - Theme engine, background research, editor and mention improvements

## 0.9.0
<sub>2026-08-02</sub>

-  *(minor)*
  A single consolidation commit lands the work that had accumulated in the working tree — broad surface area, no one headline feature, but the manuscript gained a real math layer, real tables, and a find-replace that stays open while you edit.

  **Math, in the page.** KaTeX fonts and a math node extension render equations inline, with a math-render path that handles the block form. The fonts ship locally so rendering does not depend on a CDN, and the same renderer is exercised by its own test.

  **Tables you can shape.** A table-format extension and a cell formatter drive a floating toolbar, so cell alignment and borders are a click rather than a hand-edited attribute. The toolbar and the section-reorder extension share a test shape, and both carry their own suites.

  **Find-and-replace that lives in the editor.** The find-replace panel and its extension stay mounted while you keep typing, so a replace does not throw away your cursor's place in the draft. It has a test that drives the replace path end to end.

  **Dossier UX cleanup, keybindings, slash commands.** The dossier interview flow is tidied, a keybinding list surfaces what the editor will actually do, and a slash-command extension opens an action menu from the keyboard. Sections can be reordered, and the order is stored on the document rather than painted on the screen.

  **Image upload, palette, form-probes.** Images land through an image-node extension with an inspector, the Convex images function stores them, and a typographic palette and form-probe utilities round out the surface. A section-reorder test, a table-cell-format test, and a typography-options module with its own test back the new behaviour.

  The shape of the release is a broad catch-up rather than a single feature, so it goes out as a minor.

## 0.8.0
<sub>2026-08-02</sub>

-  *(minor)*
  The dossier interview remembers what the writer already wrote.

  **Start over stops being destructive.** Wiping the dossier used to wipe
  the manuscript too. The "starting material" field now seeds from
  `initialMaterial`, which the "Start over" path carries forward into the
  next interview, so nothing already on the page is lost. The interviewer
  also receives that existing manuscript as context so its follow-up
  questions are oriented around what exists rather than a blank brief.

  **No more orphan Close button.** The inline Cancel/Close button on the
  refinery view duplicated the browser back button and the top bar's own
  navigation. It and the `onCancel$` prop are gone, simplifying the
  component surface; the parent routes control their own exit paths.

  **A shared top bar.** A single `DossierTopBar` replaces per-route
  header markup so both create and refine show the same progress
  indicator and title.

## 0.7.0
<sub>2026-08-02</sub>

-  *(minor)*
  Dossier UX cleanup: shared top bar with persistent Form/Conversation mode switch and Start-over (carries the manuscript forward into /dossier/create), plus removal of redundant in-body Close/Cancel exit buttons across dossier routes.

## 0.6.0
<sub>2026-08-01</sub>

-  *(minor)*
  Every folio is its own workspace, and the interview thinks out loud.

  **Folio-scoped sync.** Notes, replies, suggestions, rubric results and the room's analysis are now stored and indexed per folio rather than per writer, so switching pieces switches the whole editorial context instead of carrying the last piece's marginalia into the next one. Rows written before the change carry no folio and are still readable.

  **The interview streams.** Dossier interview turns arrive as they are generated, with the model's reasoning and its answer tracked as separate phases so the thinking can be shown while it happens without leaking into the answer. Streams are persisted, so a reload mid-question does not lose the turn.

  **Choosing a model is searchable.** Provider catalogues are read from models.dev, and the model pickers in settings are type-to-filter rather than a long unsorted list. Adds a relay for Tinker's OpenAI-compatible endpoint so Tinker models can be used as a BYOK provider.
-  *(minor)*
  The page is yours to set, and the desk stops being a dead end.

  **A ruler you can drag.** Page layout was a popover of rem sliders, which asks a writer to translate "3.25 rem" into a picture of their page. There is now a Word-style ruler above the manuscript, spanning exactly the page it describes: the shaded ends are the margins, the pale middle is the live text column, and dragging a marker moves the edge of the text with the draft reflowing under your hand. Margins are independent left and right rather than one symmetric value, the arrow keys drive the markers for anyone not using a mouse, and documents saved before the ruler still open to the page their writer chose.

  **Tab indents, and lists look like lists.** Tab did nothing in the manuscript: inside a list it nested the item, but anywhere else it fell through to the browser and threw you out of your own draft. It now indents the current block a tab stop, Shift+Tab takes it back, and lists and tables keep the behaviour they had. The indent is stored on the block rather than painted on the screen, so it survives into exports and the PDF. Escape releases focus, so binding Tab does not trap anyone on a keyboard. Bullet and numbered lists were also rendering with no markers at all — a global stylesheet reset had stripped them and nothing put them back — so pressing "list" appeared to do nothing. They are back, with markers that cycle by depth the way a word processor's do, in the editor and in the exported document alike.

  **Export as PDF.** From the File menu or straight from the layout tool, since page setup and printing belong together. The PDF carries your own margins and page numbers, and the text stays selectable and searchable. Two silent bugs went with it: exports were dropping the layout entirely and quietly falling back to the default page, and one export path read the saved copy rather than the open editor, so the last sentence you typed could go missing.

  **Reading aloud actually works.** Two separate faults each broke it on their own. Narration was gated on having *any* voice-capable provider, so a writer running an LLM for the room and Google for dictation resolved to no narrator at all, failed, and never reached the hosted fallback. And playback was requested after synthesis had already returned, by which point the browser no longer considered the press a user gesture and refused to make noise — every attempt failed identically. A blocked playback now says the browser blocked it rather than blaming your API key.

  **One place to write from.** The message composer is a single surface holding the text, the microphone and the send key, instead of three stacked controls. Enter sends, Shift+Enter breaks the line, the box grows with what you write, and dictation lands in the draft you are looking at rather than in a second box asking you to approve your own words twice.

  **The editor is no longer a one-way door.** The blog, the manual, the FAQ, the press room, preferences, terms and privacy were reachable only from the landing page footer — so once you were at the desk, you were stuck there. They are all in the drawer now. Signing in also stops redirecting you to the editor, and the front page stops bouncing anyone who has ever filed a brief, which together had made the landing page unreachable for returning writers.

  The manuscript's decorative header and footer bars have been removed from the page.

## 0.5.0
<sub>2026-07-30</sub>

-  *(minor)*
  The editorial room speaks like five different people: each persona now has a distinct mid-century voice, lore, and influences (and may run on its own model/temperature). Personas quote the draft through a tool instead of retyping it, so notes pin to real passages. Adds "Expand to full analysis" (per-editor memos + a room synthesis) and a full-page narrative rubric review.
-  *(minor)*
  Expand the editorial apparatus workflow with richer citation handling, folio-scoped exports, markdown exchange support, endnote markers, and evaluation tooling.
-  *(minor)* - Add agent workflows, waitlist/profile pages, and editor apparatus improvements
-  *(minor)*
  The room stops waiting to be asked, and the rubric starts grading the piece you actually filed.

  **The editors read as you write.** Once you've added ~300 net new words and paused for two minutes, all five read the new paragraphs — not the whole draft — and leave quiet "in passing" notes in the Cast panel. A five-minute floor and a per-session cap keep unasked spending bounded, and **Read as I write** turns it off. Twyne now keeps a paragraph-level record of how the draft has moved, and that digest goes into every pass, including the ones you request, so convening reads a trajectory instead of a cold snapshot.

  **The rubric is gated on relevance.** The static scorer measures shape and never reads the brief, so fluent prose about the wrong subject scored 10/10 on pacing, vocabulary and paragraph shape. A new Target Fit judge scores relevance independently of craft and caps every shape-derived criterion by it; lowering target fit can now only lower a grade, never raise it. The criteria are also yours: disable or reweight the shipped spine, add your own for the room to judge, or ask it to suggest criteria fitted to your format. Each pass is recorded, so the panel shows the run of grades.

  **Voice, both directions.** Every editor, memo and review can be read aloud in a voice of its own, and the manuscript itself can be read back to you. Margin notes and interview answers can be spoken: Twyne keeps the recording *and* a transcript you edit before it saves. Adds Fish Audio as a voice-only BYOK provider — it is never offered to the language features, so configuring it alone can't strand the room.

  **The interview asks better questions.** Alongside the seven prose fields, the interviewer now generates typed follow-ups — multiple choice, fill-in-the-blanks, scales — from what you've already told it, in both the chat and the form. The answers are stored structured and reach every judge.

  Panel tabs carry unread counts, so work arriving while you're looking elsewhere is no longer silent.
-  *(patch)* - Set up Bumpy release tooling
-  *(patch)* - Force https in OAuth client metadata behind TLS-terminating proxy (fixes ATProto loopback validation error in prod)
-  *(patch)* - Switched evals and agents from direct provider calls to Portkey for LLM routing.
