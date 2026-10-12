# Retained Rubric / Galley native view contract

The current authorities are `rubric-panel.tsx`, `live-review-panel.tsx`,
`routes/rubric/index.tsx`, `grade-stamp.tsx`, the matching `global.css` rules,
and the separately owned native `rubric.rs`. This view does not grade a draft,
start automatic review, invent editorial judgments, or infer an anchor from
quoted text. The host owns disk writes, fresh document context and navigation.

```rust
enum RubricSurface { Board, Galley }
enum RubricSection { Criteria, Editors, Passages } // initially Passages
enum RubricFreshness { Unknown, Fresh, Stale }
struct RubricViewContext {
    freshness: RubricFreshness,
    draft_word_count: Option<usize>,
    minimum_words: usize, // default 500
    result_filed_label: Option<String>,
    live_review_filed_label: Option<String>,
    live_review_status: Option<String>,
    room_parts: Option<semantic_bridge::RubricRoomParts>,
}
struct RubricCapabilities {
    persist: bool, grade: bool, ask_editors: bool, suggest_criteria: bool,
    review_guide: bool, refine_dossier: bool, tools: bool,
}
// Default enables none. local() enables only persist.

RubricView::new(Arc<RubricRecord>, Option<String>, RubricViewContext,
    RubricCapabilities, window, cx) -> Self
saved_record() -> &Arc<RubricRecord>
pending_request() -> Option<&RubricRequest>
active_folio_id() -> Option<&str>
surface() -> RubricSurface
section() -> RubricSection
set_scope(Option<String>, RubricViewContext, window, cx) -> bool
set_context(RubricViewContext, cx)
set_capabilities(RubricCapabilities, cx)
set_surface(RubricSurface, window, cx)
set_section(RubricSection, cx)
has_unsaved_changes(cx) -> bool
prepare_pending_edits(cx) -> Result<Option<RubricRequest>>
flush_pending_edits(window, cx) -> Result<Option<RubricRequest>>
request_edit(RubricEdit, window, cx) -> Result<Option<RubricRequest>>
ack_saved(Uuid, Arc<RubricRecord>, window, cx) -> bool
report_error(Uuid, impl Into<String>, cx) -> bool
retry(cx) -> Option<RubricRequest>
replace_record(Arc<RubricRecord>, window, cx) -> bool
```

`prepare_pending_edits` reads the current weight-input rope, including its final
unblurred character. It joins an existing exact request. Custom name and
description inputs are retained per folio in the entity but are never filed
by capture, navigation, close, or scope changes; only explicit Add / Enter
creates a stable custom criterion ID. Pending controls are disabled. Failed
saves retain the exact candidate and inputs; retry uses the same request ID.
Mismatching or late ACK/error messages are ignored. Scope changes refuse a
pending save or an uncommitted weight input, while custom forms remain held.
The selected Criteria / Editors / Passages reading stays selected across
accepted scope changes, matching the retained source component.
Manual weights commit on Enter, an explicit host boundary or 350 ms idle;
Blur does not race the following step button. A step reads the current finite
input rope, so typing 2 then pressing + files 2.25, not 1.25. ACK reuses the
same active weight entity and focus handle, preserving continued typing.

Events: `SaveRequested(RubricRequest)`, `Filed { request_id, effects }`,
`SurfaceRequested(RubricSurface)`, `BackToDesk`, and capability-gated
`GradeRequested { folio_id }`, `AskEditorsRequested { folio_id }`,
`SuggestCriteriaRequested { folio_id }`, `ReviewGuideRequested`,
`RefineDossierRequested { folio_id }`,
`OpenToolRequested { folio_id, criterion_id, tool }`.

The accepted display projection is cached only at record, scope and ACK
boundaries. The active enclosing artifact scope is authoritative; a stored
row's `folioId` and unscoped legacy values never supply aliases. Malformed,
null and absent fields remain distinct and malformed values surface issues.
Local criteria editing appears only inside a valid saved result, even when
the model can reconcile default criteria without one. Spine rows cannot be
deleted. Judges and findings remain read-only.

Initial Board and full Galley use the saved visible-criteria weighted score.
After an accepted Board criteria edit, Board reweights the saved raw typed
judgment scores; it never changes the stored overall, grade, summary or
history. Galley always uses the initial visible projection. Room explanation
uses the host's exact `RubricRoomParts` with source 45/35/20 percentages,
without recomputing or publishing a grade. Locale-specific date strings are
also host-supplied.

There is no automatic-review toggle in the source Rubric or LiveReviewPanel.
The raw stored `liveReviewEnabled` preference belongs to Rubric metadata and
is preserved; Appearance and automatic focus are separate preferences.
No metadata was added to manuscript backup.

Original grade impressions are the packaged PNG alpha masks. Native recolor
is cached from those bytes, with the source tier rotation and 88 / 144 px
geometry; it is not a replacement drawing. Generated provider answers,
streaming/loading states, live checker status, and audio cues are unavailable
unless an actual host capability implements them.
