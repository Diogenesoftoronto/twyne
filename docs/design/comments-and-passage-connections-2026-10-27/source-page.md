Twyne should make an editorial note easy to read, identify and act on without competing with the manuscript. Fix presentation consistency first: preserve Markdown in compact cards, carry the reason for a passage connection into its inspection view, and reconcile writing typography with the proof. Build issue grouping and optional persona synthesis on that foundation.

# Evidence and release status

Production deployment `9d5cafb8-bb5a-409a-b809-d1290dcbaf9f` was reported SUCCESS by the read-only Mist investigation: created October 23 at 23:15:43 UTC and finished 23:26:01 UTC, on main commit `2462fa25ecc562d8ca285c457d9406f44817f8ae`. Public source below is pinned to that commit.

Mist’s checkout at `/home/diogenes/Projects/twyne` is on `feat/clairic-extraction`, HEAD `4359cea99b85c9b5975bd8f38711c6915f131561`, with extensive local changes. Keith’s recollection is correct: newer Markdown fixes exist locally in `src/utils/markdown.ts` and `src/global.css`, covering escaping, nested link formatting, raw HTML handling, safe image links and rich-content styling. They do not change the compact cards’ plain-text rendering. Core flow and passage-gather files match deployed main, so do not treat their difference from local branch HEAD as new work.

Mist’s Chrome was successfully accessed through Playwriter, and the live public Marginalia demo’s synthetic notes and appearance were inspected. A safe reference screenshot was captured, partly obscured by the advancing tour overlay; the inspection tab was then closed without changing manuscripts or settings. This confirms the public demo, not full-editor collapsed comments, long-thread behavior or passage gathering. The earlier in-app browser route was unavailable, but it did not prevent this alternative browser inspection. Generated proposals remain grounded in the inspected committed synthetic fixtures and public manual, not screenshots of implemented fixes. No repository or deployment changes were made.

# What Keith asked for

## Direct voice requirements

- Normal text and headings should feel coherent rather than showing odd H3 styling. A Twyne document should resemble the reference spoken as “Typist” as closely as possible. The repository implements Typst; that supports Typst as the likely reference, but does not erase the transcript ambiguity.

- Collapsed and truncated comments must render Markdown, explicitly bold text, properly.

- The hover or gathered view for “Further on in this piece” should explain why the passage matters, not merely repeat its text.

- Consistent color coding should help readers recognize related issues and distinguish different ones.

- Persona commentary may connect a local passage to the higher-level understanding of the piece and recognizable editorial strengths. Targeted generation and display are optional.

- Preserve these requirements in a document with relevant code, hypotheses, verification suggestions and proposed UI images. Try Twyne rather than requiring the user to produce a screen recording.

## Earlier feedback preserved through the voice recap

These points were recapped by the voice assistant before Keith said some details were still missing: clearer persona/avatar cues rather than generic red dots, an expanded View all for long threads, discoverable hover/pointer affordances, and zen mode without blank space reserved for hidden comment bubbles. They remain design requirements to verify against the earlier transcript and current UI, not independently reproduced defects.

# Compact comments with rich text

**Code evidence.** `src/components/in-flow/flow-surface.tsx` renders the compact body through `clip(item.body, 280)` as plain JSX text (around lines 1097–1106), and the compact reply through a similar 420-character clip. Expanded `src/components/comments/comment-body.tsx` calls `renderMarkdown`. `src/utils/markdown.ts` already centralizes HTML escaping and allowed URL protocols. Gathered notes also render as plain text in `passage-gather.tsx` around lines 459–465.

**Proposed behavior.** Use one safe comment rendering pipeline for compact, expanded and gathered views. Compact mode preserves emphasis, code and meaningful line breaks; full mode retains the complete comment. Prefer clamping a valid rendered tree over slicing raw Markdown mid-token. If a strict character budget is needed, truncate a parsed token tree while closing formatting cleanly. Never truncate generated HTML strings. Do not insert linked Markdown inside the existing button wrapper: split the card into semantic content and a separate Open conversation button so interactive links are not nested inside a button.

**Acceptance.** The same fixture containing bold, italic, code, a link, list and an emoji must retain meaning in all three surfaces. Text that crosses the truncation boundary inside a bold token must not leak asterisks. Expanding must restore all text without rewriting storage. HTML and javascript links remain inert. Streaming incomplete Markdown must not crash or cause unstable height jumps; verify after stream completion too.

# Explain the passage connection

**Code evidence.** `flow-conductor.ts` creates “Further on in this piece” echoes with `data.relation` and `data.explanation` around lines 947–966. The source explicitly distinguishes a semantic reading from a local shared-word match. `FlowSurface` shows the explanation in the original card, but its gather handler passes only `item.body` into `notes`, and does not populate the existing `GatherRequest.note`. The sheet therefore receives the quote but not the reason. This is a source-confirmed data omission in the deployed commit; its current screen manifestation still needs live verification.

**Proposed behavior.** Preserve a structured connection object: relation label, concise explanation, provenance (shared-word match versus a model reading), source and target passage IDs, optional persona identity, and issue group ID. The sheet opens with “Why these passages are linked,” followed by the actual reason and a restrained provenance label. Each excerpt retains its surrounding paragraph, position and Go to passage action. Do not manufacture a semantic interpretation for an unreviewed lexical match. Missing reasons should say “Shared words only; not reviewed for meaning,” or another accurate state, rather than imply certainty.

**Acceptance.** A shared-word fixture and a semantic-reading fixture show different truthful explanations on the card and sheet. Explanation survives click, keyboard and dwell entry, mobile dock, multiple connected passages, and changed-anchor guards. No automatic generation occurs on hover. The manuscript is unchanged after opening, closing or jumping. Escape restores focus to the trigger. Existing `e2e/passage-connections.e2e.ts` is the relevant regression suite to extend.

# Typography and heading parity

**Code evidence.** Web `src/global.css` lines 938–947 explicitly styles H3 as 0.75rem, uppercase, heavily tracked, red sans-serif. `src/utils/typst/theme.ts` lines 40–41 deliberately mirrors this with 9pt red DM Sans, tracking 0.32em and uppercase. Therefore “match Typst” is not itself a fix for unwanted H3 appearance: both renderers encode it.

**Proposed behavior.** Separate semantic heading level from decorative editorial role. Ordinary H3 remains a readable sentence-case subheading in the manuscript’s type system; a red all-caps kicker remains available as an explicit role, not the default third-level heading. Define a shared typography contract for body, H1–H6, lists, quotes, inline notes and spacing, then map that contract into browser CSS and Typst. Preserve user-selected fonts and physical page setup. Do not flatten all content into ordinary paragraphs merely to hide the symptom.

**Acceptance.** A synthetic document containing paragraphs, all heading levels, bold/italic, lists, quotes, code, links and notes is compared in Write, Proof and PDF. Match hierarchy, chosen fonts and relative spacing; document unavoidable browser-versus-typesetter line-breaking differences rather than promise pixel identity. Assert H3 remains an H3 in the document structure and outline, and copy/paste and round-trip source preserve it. Check 200% zoom and narrow screens.

# Persona identity and long conversations

**Existing support.** Cards already use `PersonaMasthead` and portraits. In-text markers in `extensions/mark-anchor-widgets.ts` lines 93–102 remain generic buttons labeled “Open note.” The proposal should improve those anchors, not replace already working portrait cards. Both comment panels map all saved replies; their card bodies scroll. No explicit View all control was found. This is a discoverability proposal, not evidence that saved replies are omitted. The dirty local persona panel also removes `NoteEvidenceList` relative to production; preserve the production evidence experience unless deliberately reviewed.

**Proposed behavior.** Reuse the existing portrait component and persona ID across note anchor, compact card and expanded thread. Show a readable name and role; use initials when the portrait is unavailable. Keep human comments clearly human. An explicit “View all 8 replies” control reveals the whole conversation with stable ordering, preserved scroll position and a clear way back. Do not imply a persona is proven best at a skill without evidence; editorial role and actual contribution are safer labels.

**Updated portrait direction.** The primary active comment should use a large portrait above the agent’s text in a generous card, not a tiny avatar beside a compressed bubble. Keep lightweight in-text anchors distinct from this expanded reading treatment. The ten proposals below explore how to allocate that space.

**Acceptance.** Avatar failure, missing persona, human comment, mixed-persona replies, empty thread and a 50-reply thread remain usable. Keyboard and touch expose the same content as hover. Screen-reader names identify the author and action. Expanding a thread does not obscure its anchored passage or steal a draft reply.

# Interaction and focus mode

**Existing support.** FlowSurface contains explicit gather buttons, focus handlers and a 1.1-second resting-pointer trigger; click and keyboard tests already exist. The card body already has pointer cursor styling and an Open the conversation tooltip. Visible action text is a refinement, not a missing-pointer bug. Its manual zen branch hides the surface, while automatic focus retains a held-note post. CSS also widens continuous zen pages, but paginated pages are excluded. Treat the reported blank-space problem as a layout-state investigation, not simply “remove the sidebar.”

**Proposed behavior.** Use a consistent visible Open or View passages action, pointer cursor only on interactive surfaces, and focus-visible styling. Avoid making a new modal appear merely because someone pauses to read a card; test intentional hover preview versus explicit sheet opening. In zen mode release space assigned only to hidden cards while preserving comfortable reading measure and physical print margins in paginated mode. Manual zen and automatic writing focus remain distinct.

**Acceptance.** Measure manuscript bounds and unused reserved regions before and after manual zen and automatic focus at desktop and mobile widths, both paginated and continuous. Repeated toggles, typing, pause, opening/closing threads, resize, Escape and Back/Forward must not leave invisible overlays or stale layout. Reduced motion and touch must work without dwell. The caret, selection and scroll anchor remain stable.

# Issue grouping and optional persona synthesis

**Code evidence.** `FlowItem` has an optional color and unstructured kind-specific data. `kindAccent` currently maps broad item kinds to colors; persona color can override it. That is not a stable issue taxonomy.

**Proposed behavior.** Model issue identity separately from author identity. A shared issue group receives a stable ID, textual category and restrained accent used on its card edge, passage highlight and map marker. Persona identity stays in the portrait/name rather than competing color schemes. Provide legend/filter controls and a non-color cue such as a category word plus symbol. Treat proposed categories such as Clarity, Evidence and Structure as editable design examples, not already existing product classifications.

Offer an optional “Perspective on this issue” panel that connects concrete passages to the piece’s goal. Existing stored insight can be shown without inference. Any new targeted generation is an explicit user action with appropriate model connection/cost handling, not a hover side effect. Disable, hide and error states must leave ordinary comments fully usable. Clearly distinguish authored commentary, model suggestions and lexical matching.

**Acceptance.** Related issue IDs retain color across sorting, sessions and views; different authors can discuss the same issue without changing its identity. Grayscale, color-vision simulation, high contrast and keyboard navigation still distinguish categories. Synthesis off sends no request; opening an existing insight sends no generation request; failure does not remove the original comment. Never overwrite the manuscript from a proposed insight.

# Suggested modular boundaries and rollout

1. `CommentContent` with compact, full and gathered presentation using the shared safe renderer.

2. `PassageConnectionSummary` shared by card, hover and gathered sheet, with explicit provenance.

3. `IssuePresentation` resolving stable category label, icon and color separately from `PersonaIdentity`.

4. A shared document typography contract consumed by CSS and Typst adapters.

5. An optional `PersonaIssueInsight` region with generation isolated from display.

Roll out presentation fixes independently from issue grouping and model-backed insights. Suggested flags are design placeholders, not existing settings: rich compact comments, connection explanations, issue grouping and persona insights. Rendering and keyboard behavior should not depend on a model service. First reconcile existing local fixes with deployed code, then extend current tests instead of creating a second parallel implementation.

# Verification order

Local, main and deployment metadata have been reconciled. Next run focused renderer and connection tests; exercise synthetic fixtures in the browser; compare Write/Proof/PDF typography; then review desktop/mobile screenshots and accessibility. Repository tests described above have been inspected, not executed during this investigation. No code or deployment changes are part of this proposal.

# Source references

All public code links below are pinned to the deployed commit rather than a moving branch.

- [Compact cards and gather handoff](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/src/components/in-flow/flow-surface.tsx#L789-L833)

- [Compact body and reply rendering](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/src/components/in-flow/flow-surface.tsx#L1090-L1120)

- [Expanded comment renderer](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/src/components/comments/comment-body.tsx)

- [Safe Markdown renderer](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/src/utils/markdown.ts)

- [Connection reason creation](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/src/components/editor/extensions/flow-conductor.ts#L943-L969)

- [Gather view](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/src/components/in-flow/passage-gather.tsx#L369-L475)

- [Gather data contract](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/src/utils/passage-gather.ts#L11-L37)

- [Typst editorial typography](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/src/utils/typst/theme.ts#L15-L45)

- [Browser H3 typography](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/src/global.css#L938-L947)

- [Passage interaction regression tests](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/e2e/passage-connections.e2e.ts)

- [Public manual editor reference](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/public/assets/manual/work/editor-overview.jpg)

- [Synthetic connected passage baseline](https://github.com/Diogenesoftoronto/twyne/blob/2462fa25ecc562d8ca285c457d9406f44817f8ae/e2e/visual-baselines/passage-connections.e2e.ts/connected-passages-desktop.png)

# Proposed visual directions

The two images are generated concepts grounded in inspected Twyne reference images and synthetic manuscript text. They are not screenshots of implemented fixes. The first explores rich compact comments and an explicit full-thread action; the second carries the relation explanation and optional editorial perspective into the gathered passage sheet. Exact spacing, counts and palette still need implementation and accessibility checks. The category color should ultimately match consistently across label, passage highlight and connectors; the concept imagery is not an acceptance-test substitute. The small-avatar layout is an earlier exploration, superseded by the large portrait-above-text direction in the ten proposals below.

## Rich compact comments

![Proposed rich comment cards and full thread view](library-file:fde1_bGliZmlsZV83WG1EYTJrVUtlXy0xdGRFNDJRZ0Zn_FileDrive_37b25c228d848191bca6d1d0c417f513)

## Connection explanation and persona perspective

![Proposed passage connection explanation and optional persona insight](library-file:fde1_bGliZmlsZV8yWERkWWxwbFNEeW9sTm4xdFZwRFFR_FileDrive_37b25c228d848191bca6d1d0c417f513)

# Ten portrait led comment proposals

These ten new generated concepts follow the revised direction: **a large portrait above the agent’s text, with a spacious card that uses the available area**. They supersede the small-avatar treatment in the two earlier exploratory images, which remain above for comparison. They are proposed layouts, not implemented screens; all names, passages, counts and conversation content are synthetic. The first four explore different placements during writing; the remaining six explore comparison, focused review, revision, mobile use, passage relationships and long conversations.

Start with **01 Margin portrait card** for everyday writing, **03 Expanded reading sidebar** for detailed discussion, and **08 Mobile reading sheet** as the responsive counterpart. The other layouts are alternatives for specific review tasks, not ten modes that all need to ship. Portrait art varies deliberately across concepts; production should reuse each persona’s stable identity rather than regenerate a new face per comment.

Across all variants, retain the shared safe Markdown renderer, explicit author name and role, labeled issue category, visible focus, and full-thread access. Portraits must not be the sole author identifier. Decorative portraits can have empty alternative text when the adjacent name already identifies the author. Verify text contrast, zoom reflow, reduced motion, keyboard focus return and accessible action names in implementation; the mockups do not establish those properties.

## 01 Margin portrait card

![Twyne portrait proposal 01](library-file:fde1_bGliZmlsZV9rQTlLbTdkczBhWDd3dzRuaWVpRVRn_FileDrive_37b25c228d848191bca6d1d0c417f513)

The closest extension of the current manuscript and margin relationship: a tall portrait-led card occupies roughly a third of the workspace, with the selected passage still visible beside it. Best for ordinary writing with one active editorial note.

**Tradeoff.** The portrait makes identity unmistakable but reduces the number of simultaneous notes. Keep other notes in a count or list rather than shrinking the active card.

**Accessibility and responsive behavior.** Use a labeled complementary region and a real Go to passage action; the connector is decorative, not the only association. Tab reaches Reply and View all independently. Below the comfortable two-column width, move the card below its passage or open the mobile sheet.

**Verification.** Open a note midway through a long paragraph; confirm the full portrait, first useful sentence and thread action are visible without covering the selected line.

## 02 Inline editorial interlude

![Twyne portrait proposal 02](library-file:fde1_bGliZmlsZV9TTC1yU1lhY3FYbWRyeF9RaVhNS3NB_FileDrive_37b25c228d848191bca6d1d0c417f513)

Place a wide portrait-led card between manuscript paragraphs. The agent’s lead observation sits below the portrait, then evidence and next step share the card width. Best for deliberate paragraph-by-paragraph review without a separate sidebar.

**Tradeoff.** This changes the rhythm and length of the reading view. Keep it a review presentation, not text inserted into the document or exported proof.

**Accessibility and responsive behavior.** Treat the card as an aside outside the editable manuscript. Offer collapse and return-to-writing buttons without making the entire card a button. At narrow widths, stack evidence above next step while retaining portrait-first order.

**Verification.** Toggle the interlude on and off; manuscript text, selection, undo history and export must remain unchanged.

## 03 Expanded reading sidebar

![Twyne portrait proposal 03](library-file:fde1_bGliZmlsZV82QU03a1hfR2plclVZWjJzcnJSYWJ3_FileDrive_37b25c228d848191bca6d1d0c417f513)

Give the review pane approximately half the workspace, with a generous portrait, full rich-text reasoning, evidence and reply composer underneath. Best for a detailed editorial conversation while the author checks the source.

**Tradeoff.** The manuscript becomes narrower. Make pane width adjustable and preserve a useful minimum reading width rather than squeezing both sides indefinitely.

**Accessibility and responsive behavior.** Use a keyboard-operable separator, labeled reading and discussion regions, and predictable tab order. At high zoom or narrow widths, switch to one pane with a Return to passage action. Keep composer focus stable during streaming.

**Verification.** Test a long Markdown response with lists, links and code; the portrait may scroll out, but commentary and composer must remain reachable without nested scroll traps.

## 04 Bottom review dock

![Twyne portrait proposal 04](library-file:fde1_bGliZmlsZV9WeXhITnd0S21YOVpJMk4yTlB3UFZ3_FileDrive_37b25c228d848191bca6d1d0c417f513)

Use a full-width dock below the manuscript, with a large centered portrait above the current observation and reply controls. Best when the author wants a broad writing column and sequential review rather than a side rail.

**Tradeoff.** The dock consumes vertical reading space. Its height should be adjustable and opening it must not hide the passage that triggered it.

**Accessibility and responsive behavior.** Label Previous and Next as buttons and announce the selected comment position. Keyboard resizing must have an alternative to dragging. On narrow screens use a full-width sheet; at large text sizes allow normal vertical scrolling instead of a fixed clipped dock.

**Verification.** Open the dock near the bottom of the viewport, advance through notes and close it; verify passage visibility and exact caret/focus restoration.

## 05 Editorial board

![Twyne portrait proposal 05](library-file:fde1_bGliZmlsZV9BVkVydXlKWmxuaFBtOXZWSFQxOFV3_FileDrive_37b25c228d848191bca6d1d0c417f513)

A pinned passage leads into three spacious portrait-over-text columns, one per perspective. Best for comparing how different personas interpret the same passage; category words explain their angle without claiming proven expertise.

**Tradeoff.** This is an explicit review board, not the default writing surface. Several portraits are visually dominant and the full manuscript is temporarily reduced to an excerpt.

**Accessibility and responsive behavior.** Each card is a labeled region in source order. Use textual issue labels as well as color, and keep human replies clearly human. Stack columns at narrow widths without a horizontally scrolling three-card miniature.

**Verification.** Compare three long observations and an empty persona response; column heights should adapt without truncating content or mixing the order of actions.

## 06 Focus review

![Twyne portrait proposal 06](library-file:fde1_bGliZmlsZV8zWkhmc1hENlBmdUpYcy12MnJkZkJ3_FileDrive_37b25c228d848191bca6d1d0c417f513)

Show one generous card beneath a pinned manuscript excerpt. A large portrait leads into the comment, supporting quotation and actions, with explicit previous and next navigation. Best for clearing a review queue one decision at a time.

**Tradeoff.** Less surrounding manuscript is visible. A persistent Back to manuscript action must return to the exact source and position.

**Accessibility and responsive behavior.** Announce Comment 2 of 8 when navigating, but do not repeatedly announce the whole response during streaming. Keep named navigation buttons, visible focus and no automatic advance. Reflow the card at narrow widths; portrait height yields before text clips.

**Verification.** Navigate forward, back and into a thread; confirm no note is silently marked resolved, and return preserves the prior queue and manuscript positions.

## 07 Split revision workspace

![Twyne portrait proposal 07](library-file:fde1_bGliZmlsZV8ydzlBWXpCRjIyWEk2YjZWR0RoZ1B3_FileDrive_37b25c228d848191bca6d1d0c417f513)

Keep the original paragraph on the left and a broad portrait-led rationale and proposed revision on the right. Best when a comment has an actionable rewrite that needs comparison before any change.

**Tradeoff.** The portrait and diff compete for height. Let the card expand, and keep proposed wording clearly separated from the authoritative original.

**Accessibility and responsive behavior.** Read order is original, portrait identity, reasoning, proposed revision, then actions. Copy is distinct from Apply with review; applying must present the exact change and support undo. On narrow screens stack these regions instead of compressing the diff.

**Verification.** Apply, cancel and undo a synthetic suggestion; verify no manuscript mutation occurs merely by opening the card or receiving model output.

## 08 Mobile reading sheet

![Twyne portrait proposal 08](library-file:fde1_bGliZmlsZV81Mkx3a0pzZU1lcDFXZU9SYjFaSE53_FileDrive_37b25c228d848191bca6d1d0c417f513)

Keep the selected passage above a generous touch-friendly sheet, with a large portrait above name, issue label, rich comment and actions. Best for phone review without reducing the persona to a small avatar.

**Tradeoff.** Portrait prominence increases scroll distance. Make the sheet scroll naturally and preserve access to the passage rather than forcing all content into one screen.

**Accessibility and responsive behavior.** Provide a visible Close button, Escape behavior for attached keyboards, focus return and labeled controls with generous touch targets. At larger text sizes reduce decorative portrait height and let content grow; avoid hidden text behind the mobile keyboard.

**Verification.** Test at 390 CSS pixels and enlarged text, with a reply keyboard open. Confirm the selected passage, close control and reply draft remain recoverable.

## 09 Linked passages dossier

![Twyne portrait proposal 09](library-file:fde1_bGliZmlsZV9XcnUzR3l4dll6dmlvVnA0LWl0MEd3_FileDrive_37b25c228d848191bca6d1d0c417f513)

Two passage excerpts and an explicit relationship label lead into an expansive portrait-over-explanation card. Best for the missing why behind a distant passage connection, with direct navigation to either source.

**Tradeoff.** The dossier interrupts linear reading. The scenic illustration in this concept is optional decoration, not a requirement or model-generation dependency.

**Accessibility and responsive behavior.** Order focus through earlier passage, later passage, explanation and navigation; stack excerpts on narrow screens. Pair color with Earlier and Later labels. Keep text on a solid high-contrast surface if decoration is retained.

**Verification.** Open a relationship with and without a stored explanation. Show the actual reason when present; show an honest unavailable state rather than inventing one from the portrait or category.

## 10 Long conversation journal

![Twyne portrait proposal 10](library-file:fde1_bGliZmlsZV9XcmZpbElJSDhOa1NmNm9mQU1yTWZB_FileDrive_37b25c228d848191bca6d1d0c417f513)

A wide conversation column shows successive portrait-led entries beside the manuscript, plus an explicit View all replies action. Best for sustained discussion where every participant’s contribution should remain readable.

**Tradeoff.** Repeated large portraits reduce reply density and require more scrolling. Preserve spacious entries as the default proposal; any compact mode should be an explicit author choice.

**Accessibility and responsive behavior.** Keep chronological semantic order, distinguish persona and human authors, and preserve scroll anchors when earlier replies load. On narrow screens show one pane with a persistent Return to passage action; no forced jump to the newest reply.

**Verification.** Load more than eight replies, follow a source link and return. Verify every saved reply is reachable, Markdown remains rich, and the previous reading position is restored.

# Shared implementation direction for the portrait proposals

Keep portrait presentation separate from content rendering and placement. Reuse the existing persona identity component, then parameterize its portrait size and aspect ratio; let a review shell choose margin, inline, dock or full-page placement. A shared card should compose persona identity, issue label, safe rich text, evidence, thread navigation and actions without hard-coding a particular agent or model.

Use a presentation preference or feature flag for the chosen portrait layout, separate from model-backed synthesis and issue grouping. Reading existing comments must not trigger new inference. Preserve human comments and missing-portrait fallbacks. Give portrait assets a defined aspect ratio to avoid layout shifts, and lazy-load off-screen portraits without delaying their readable text. Test one shared comment fixture across every supported shell before selecting a default.
