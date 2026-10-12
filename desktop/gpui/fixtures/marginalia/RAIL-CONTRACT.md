# Writer-note preview / rail

Source: `flow-conductor.ts`'s comment producer/controller, `flow-items.ts`,
`flow-surface.tsx`, `margin-surface.ts`, and the executed source CSS in
`browser-rail-metrics.json`. This module renders writer comments only. It does
not sample writing pace, create marks, store notes, or simulate persona output.

`MarginRailNote::from_comment(&UserComment) -> Option<MarginRailNote>` produces
the original pending, nonempty-anchor comment preview, retaining its exact
`CommentRef`, author/title, body, last reply, reply count and source timestamp.
Root restricts notes to the active scope and durably acknowledged ledger.

`MarginRailContext { mode: FlowMode, cursor_text: String,
visible_anchor_quotes: HashSet<String>, dismissed: HashSet<CommentRef>,
shown: HashSet<CommentRef>, weight: f64, now: u64, working_limit: usize }`.
`select_writer_notes(&[MarginRailNote], &MarginRailContext) -> MarginRailDecision`
ports the original comment-only score and stable order; the decision exposes
`visible: Vec<CommentRef>`, `held: usize`. Root owns the authoritative mode,
profile weight, prior shown set and dismissal set; this is no second detector.
Quote overlap affects ranking only, never identity or mark placement.

`MarginRailRect { left, top, width, height: f32 }` uses viewport pixels.
`MarginRailAnchor { target: CommentRef, groups: Vec<Vec<MarginRailRect>> }`
contains measured lines for that exact editor mark. An entry with empty groups
means a known mark whose bounds are not presently available. An absent entry is
not a mark; `anchors: None` means authority is unknown. Metadata-only/source-only
threads never get an ordinary preview or an invented connector.

`MarginRailObstacle { top, height: f32 }` is relative to the page canvas.
`MarginRailGeometry { viewport_width, viewport_height: f32, canvas, scroller,
text: MarginRailRect, cursor_top: Option<f32>, obstacles: Vec<MarginRailObstacle> }`.
Root supplies cached fresh canvas/text/scroller/anchor geometry at accepted
render boundaries, not a whole-manuscript scan on every typed character.

`MarginRailOpenThread { target: CommentRef, anchor_top: f32, height: Option<f32> }`
reserves the actual thread's slot (280px until measured); resolved cardless
threads may reserve a slot only with actual same-scope mark authority.
`MarginRailSlot { left, top, width, max_h: f32 }` is the original fixed viewport
placement. `stack_margin_cards` is the original stable stacking algorithm.

`MarginRailSnapshot { folio_id: Option<String>, notes: Vec<MarginRailNote>,
visible: Vec<CommentRef>, held: usize, enabled: bool, mode: FlowMode, zen: bool,
read_only: bool, foreground_open: bool, anchors: Option<Vec<MarginRailAnchor>>,
geometry: Option<MarginRailGeometry>, peek: Option<CommentRef>,
open_thread: Option<MarginRailOpenThread> }`. Root supplies selected visible IDs.

`MarginRailCapabilities { open_threads: bool, dismiss: bool }` defaults false.
`MarginRailView::new(snapshot, capabilities, cx)`; setters
`set_snapshot(snapshot, cx)`, `set_capabilities(capabilities, cx)`,
`set_peek(Option<CommentRef>, cx)`,
`set_open_thread(Option<MarginRailOpenThread>, cx)`;
`reveal(&CommentRef, anchor_top: f32, cx) -> Option<MarginRailSlot>` recalls a
transiently set-aside card, reserves its slot and returns current placement;
`slot(&CommentRef) -> Option<MarginRailSlot>`.

`MarginRailPresentation` contains the snapshot's eleven dynamic fields, excluding
`folio_id` and `notes`. `set_presentation(presentation, cx)` updates selection,
mode, guards, peeks, thread reservation and cached geometry while retaining saved
note bodies and rendered previews. Root calls `set_snapshot` only when the
durably accepted ledger/scope changes. Preview strings are cached at that boundary;
the renderer never scans or clones full body text for a scroll/geometry frame.

Events: `MarginRailEvent::OpenThread { target, slot: Option<MarginRailSlot> }`,
`SetAside(CommentRef)`, `SlotChanged { target, slot: Option<MarginRailSlot> }`.
Open/SetAside are interactions, not successful durable note mutations.
Dismissals are local controller-lifetime state; Root may update original Flow
profile outcome counters. Recall never changes note/history/drafts.

Mount the retained entity on a positioned window-sized overlay parent. The view
uses viewport coordinates and adds no scroll container. Its empty/background
area must not intercept editor input. The renderer hides in read-only, Zen,
unknown anchor authority or full Flow. Disabled ambient selection is empty;
an explicit known-mark peek/open can still show a preview, as in the source.
The slot/reveal handshake requires enabled. Settling uses original 0.4 opacity.
At least 304px to the right of the canvas gives a 268px room rail at canvas.right
+28; otherwise the single preview docks right16px, width min(300, viewport-32),
bottom max(16, viewport.height-scroller.bottom+12). Foreground conversation,
selection action, tool or dialog suppresses only that dock. Opening a rail
thread hides its preview but retains its measured reservation; other cards step
around it and supplied tool/slip obstacles with a 10px gap.

Admission to `reveal` requires actual Rail room. Source's existing open thread
can subsequently follow a Dock slot on reflow: left12px, width min(340, viewport-24),
top bounded by scroller.top+8 and viewport.height-220, maxH at least160. Root
retains whether the thread originally entered through Rail; an initial Dock
open keeps its ordinary inline placement instead of fabricating a rail handshake.
Measured card reservations include the real top3+bottom1 borders. The overlay
and measuring canvas have explicit origins, and only the card rectangle occludes
pointer input. The source accent covers the outer top border, painted by a
borderless wrapper rather than a masked child below/behind the native border.

`margin_rail_connections(snapshot, layout, focus)` returns exact measured-mark
underlines, gutter brackets and related-note Bezier paths. Equal quotations
relate only already-known scoped IDs. An unplaced/unknown ID gets no invented
line. Dock retains brackets/highlights and omits connectors, avoiding a line
to the single docked card when it is a different note. Hover and keyboard focus
reveal the close control; Open/Set aside use actual capability-guarded buttons.
Rail More/Fewer expands only known pending notes and preserves source order.

Plain previews preserve the full original body in the DTO, clip rendered text
at 280/420 UTF-16 units using the original ellipsis rule, collapse ordinary HTML
whitespace, and show only the latest reply. Markdown remains literal here.
The actual Board/inline thread uses its separate Markdown renderer.
Clipping consumes at most limit+1 UTF-16 units (short UTF-8 bodies fast-path);
a bisected surrogate uses the browser's replacement glyph in the rendered
UTF-8 preview. Full saved body/reply bytes remain intact.

Runtime proof is separate from source-derived deterministic fixtures, mounted
controls and native visual comparison. Native rail integration/render captures
remain Root's. Audio/persona/tools/post/galley surfaces are outside this slice.

Current checks: seven pure native tests execute100 original selector/score
cases, four stacking cases, five clipping cases (including a surrogate cut),
and four original drawing-closure cases generated by `generate-rail.ts`. Five
mounted native tests exercise actual hover, Tab/Enter, Open, Set aside/recall,
More/Fewer, pointer pass-through/occlusion, capability/scope/quiet guards,
actual outer-card height, and retained full-body/cache data across presentation
updates. These deterministic/mounted checks are separate from the real source
browser proof and Root's actual X11/Vulkan captures.
