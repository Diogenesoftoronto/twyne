# Retained native Apparatus view

The view owns presentation and exact metadata requests. The host owns original
JavaScript scans/formatting/builders, clipboard publication, editor placement,
source previews, research and route coordination. It performs no manuscript scan
or formatting work during rendering or typing.

```rust
ApparatusSurface::{Board, Page}
ApparatusCapabilities {
    persist, scan, copy, cite, preview, research, provider,
    account_sources, auto_insert: bool
}
// local(): persist + scan + copy; all other capabilities false.
ApparatusViewContext {
    folio_id: String,
    metadata_generation: u64,
    context_id: Uuid,
    formatted_rows: Vec<ApparatusFormattedEntry>, // GLOBAL raw-array indices
    copy_all_text: String, // ONLY exact active scope, both provenance groups
    research: Option<ApparatusResearchState>, // actual host activity, never inferred
}
ApparatusDetectedCitation // alias of semantic_bridge::ApparatusDetectedCitation
```

`ApparatusResearchState` supplies status/phase/last_query/error/provider,
`Vec<ApparatusResearchTarget>` and `Vec<ApparatusResearchActivity>` with already
formatted actual timestamp labels. Missing activity never means a running
watcher. Imported settings alone do not enable research.

```rust
ApparatusView::new(Arc<ApparatusRecord>, Option<String>, ApparatusCapabilities,
                   &mut Window, &mut Context<Self>) -> Self
set_scope(Option<String>, &mut Window, &mut Context<Self>) -> bool
set_surface(ApparatusSurface, &mut Window, &mut Context<Self>)
set_capabilities(ApparatusCapabilities, &mut Context<Self>)
set_context(ApparatusViewContext, &mut Context<Self>) -> bool
saved_record() -> &Arc<ApparatusRecord>
active_folio_id() -> Option<&str>
surface() -> ApparatusSurface
display() -> Option<&ApparatusDisplay>
pending_request() -> Option<&ApparatusRequest>
prepare_pending_edits(&mut Context<Self>) -> Result<Option<ApparatusRequest>>
flush_pending_edits(&mut Window, &mut Context<Self>) -> Result<Option<ApparatusRequest>>
request_edit(ApparatusEdit, &mut Context<Self>) -> Result<Option<ApparatusRequest>>
ack_saved(Uuid, Arc<ApparatusRecord>, &mut Window, &mut Context<Self>) -> bool
report_error(Uuid, impl Into<String>, &mut Context<Self>) -> bool
retry(&mut Context<Self>) -> bool
replace_record(Arc<ApparatusRecord>, &mut Window, &mut Context<Self>) -> bool
```

No editable text fields exist in the original bibliography view. Explicit flush
returns the same held request and does not construct another candidate. A scope
switch refuses an unacknowledged metadata candidate. Accepted record/display
projection is cached at construction/scope/ACK/replace boundaries. Context must
match the exact active scope and saved generation; formatted rows match by
global index plus original ID/scope, never ID alone. A successful metadata ACK
invalidates old formatting until the host supplies its fresh scoped projection.

```rust
ApparatusAddDetectedRequest {
    request_id: Uuid, folio_id: String, base: Arc<ApparatusRecord>,
    detected: ApparatusDetectedCitation,
}
pending_add() -> Option<&ApparatusAddDetectedRequest>
request_add_detected(&str, &mut Context<Self>) -> Option<ApparatusAddDetectedRequest>
accept_add_detected(Uuid, ApparatusBuiltEntry, &mut Context<Self>)
    -> Result<Option<ApparatusRequest>>
report_add_error(Uuid, impl Into<String>, &mut Context<Self>) -> bool
retry_add(&mut Context<Self>) -> bool
cancel_add(Uuid, &mut Context<Self>) -> bool

ApparatusScanRequest {
    request_id: Uuid, folio_id: String, surface: ApparatusSurface,
    base: Arc<ApparatusRecord>,
}
request_scan(&mut Context<Self>) -> Option<ApparatusScanRequest>
accept_scan(Uuid, Vec<ApparatusDetectedCitation>, &mut Context<Self>) -> bool
report_scan_error(Uuid, impl Into<String>, &mut Context<Self>) -> bool
append_detected(&str, &[ApparatusDetectedCitation], &mut Context<Self>) -> bool
dismiss_detected(&str, &mut Context<Self>) -> bool

ApparatusCopyRequest {
    request_id: Uuid, folio_id: String, base: Arc<ApparatusRecord>,
    context_id: Uuid, source_index: Option<usize>, text: String,
}
request_copy_all(&mut Context<Self>) -> Option<ApparatusCopyRequest>
request_copy_one(usize, &mut Context<Self>) -> Option<ApparatusCopyRequest>
pending_copy() -> Option<&ApparatusCopyRequest>
ack_copy(Uuid, Result<(), String>, &mut Context<Self>) -> bool
clear_context(&mut Context<Self>) // disable formatted actions during host refresh

ApparatusCiteRequest {
    request_id: Uuid, folio_id: String, base: Arc<ApparatusRecord>,
    context_id: Uuid, source_index: usize, source_id: String,
    raw_entry: Value, footnote: String,
}
pending_citation() -> Option<&ApparatusCiteRequest>
request_citation(usize, &mut Context<Self>) -> Option<ApparatusCiteRequest>
pending_scan() -> Option<&ApparatusScanRequest>
detected_rows(ApparatusSurface) -> &[ApparatusDetectedCitation] // current scope only
ack_citation(Uuid, Result<f64, String>, &mut Context<Self>)
    -> Result<Option<ApparatusRequest>>
```

Builder completion verifies the held request, exact full base and current scope.
The host additionally guards editor revision/context before using the original
builder. The view emits the model AddDetected candidate; an `added` stamp appears
only after durable ACK. A failed builder can retry its same held request. Scope
changes invalidate transient builder/scan/copy/cite tokens, so late completions
cannot mutate another folio. A pending candidate always blocks scope change.

The host clears both its formatting context and the view's context before
refreshing. Copy/Cite remain disabled until the same new context is installed
in both; an old visible context cannot admit a request during background work.

Board detection events append only IDs unseen in the existing list, preserving
payload order and the original behavior for duplicates within one payload.
Dismissing a detection is transient; a later scan may reintroduce it. Each scope
has separate Board and Page lists. Opening Page clears its list and emits a scan;
the returned Page scan replaces that list. Formatting refresh never scans or
wipes detections. The host uses original DOM textContent for Board and original
`html.replace(/<[^>]+>/g, " ")` for Page; UTF-16 offsets are not native positions.

Citation admission is Board-only and capability-gated. The host captures current
folio/editor/revision/selection, preflights the original conversion, commits the
real editor command and returns its actual timestamp or failure. On success the
view preserves the held raw object, changes only `citationInsertedAt`, stages an
exact Upsert and emits SaveRequested. The host must not duplicate this Upsert.
The notice is published after its durable ACK. The host derives target anchor,
source URL and original selection fallback from the retained raw row.

```rust
ApparatusEvent::{
    SaveRequested(ApparatusRequest),
    Filed { request_id: Uuid, effects: Vec<ApparatusEffect> },
    SurfaceRequested(ApparatusSurface), BackToDesk,
    AddDetectedRequested(ApparatusAddDetectedRequest),
    ScanRequested(ApparatusScanRequest),
    CopyRequested(ApparatusCopyRequest), CiteRequested(ApparatusCiteRequest),
    OpenSourceRequested { folio_id, source_index, source_id, url, title },
    LookupRequested { folio_id, detected_id, url },
    RetryResearchRequested { folio_id, target_id: Option<String> },
    AutoInsertRequested { folio_id, enabled },
    SummarizeRequested { folio_id, source_index, source_id },
    AccountSourcesRequested,
}
```

Copy feedback appears only for a matching acknowledged real clipboard write.
No route Cite exists. Whole metadata/storage ownership remains the frozen
Apparatus model and Root-held library OS lock. Drop is exact scoped metadata,
not a manuscript mark removal. All source arrays/unknown/missing/null/foreign
fields remain in the model's raw envelope. The desktop build currently enables
serde_json preserve_order transitively through GPUI; exact `Object.entries`
enumeration conformance is still unverified. No manifest change is made here.

Outer Board tabs, widths (496 desktop /448 at <=720), Steer-search composer,
source-preview host and route coordination belong to Root. This renderer owns
the original inner Sources/Signal/Deep trace/cards and full Apparatus layout.

Presentation-only follow-up retains the same events and existing control IDs:
`apparatus-open-page` emits `SurfaceRequested(Page)`,
`apparatus-auto-footnote` emits the existing gated `AutoInsertRequested`, and
`apparatus-account-sources` is the anonymous section's disabled-by-default
Open account settings button, emitting `AccountSourcesRequested` only when its
capability exists. It is not a connected-source disclosure. The new observed
`apparatus-account-section` is a region named Account knowledge sources.
No metadata, scan/copy/citation token or scope behavior changes in this pass.
