# Offline Marginalia contract

The following public API is the stable Root
integration contract. Source authority is `src/utils/user-comments.ts`,
`reconcile-comments.ts`, `components/comments/comments-panel.tsx`, and
`components/editor/user-comment-panel.tsx`. This slice owns `marginalia.rs`,
`marginalia_view.rs`, and this fixture directory. Root owns the library OS lock,
route/panel lifetime, inline composer selection, actual manuscript mark
commands, and shared freshness coordinator. Comments are independent metadata;
they never mutate the House ledger.

## Model and storage

```rust
pub enum UserCommentAuthor { User, Persona, Other(String) }
pub struct UserCommentReply {
    pub id: String, pub author: String, pub author_kind: UserCommentAuthor,
    pub persona_id: Option<String>, pub color: Option<String>, pub text: String,
    pub created_at: u64, pub extra: ExtraFields,
}
pub struct UserComment {
    pub id: String, pub folio_id: String, pub text: String, pub author: String,
    pub anchor: Option<String>, pub resolved: bool,
    pub created_at: u64, pub updated_at: u64,
    pub replies: Vec<UserCommentReply>, pub audio_id: Option<String>,
    pub audio_duration_ms: Option<f64>, pub transcript_provider: Option<String>,
    pub extra: ExtraFields,
}
pub struct CommentRef { pub folio_id: String, pub id: String }
pub type ReplyDrafts = BTreeMap<String, BTreeMap<String, String>>;
pub struct MarginaliaRecord {
    pub format: String, pub version: u64, pub generation: u64,
    pub comments: Vec<UserComment>, pub reply_drafts: ReplyDrafts,
    pub extra: ExtraFields,
}
pub enum MarginaliaEdit {
    Upsert(UserComment),
    AppendReply { target: CommentRef, reply: UserCommentReply },
    SetResolved { target: CommentRef, resolved: bool },
    Erase(Vec<CommentRef>),
    Reconcile { folio_id: String, mark_ids: Vec<String> },
    ReplyDrafts(ReplyDrafts),
    Batch(Vec<MarginaliaEdit>),
}
pub enum MarginaliaEffect {
    Upserted(CommentRef),
    ReplyAppended { target: CommentRef, reply_id: String },
    Resolved { target: CommentRef, resolved: bool },
    Erased(CommentRef),
    Orphaned(CommentRef),
}
pub struct MarginaliaRequest {
    pub request_id: Uuid, pub expected_generation: u64,
    pub base: Arc<MarginaliaRecord>, pub candidate: Arc<MarginaliaRecord>,
    pub effects: Vec<MarginaliaEffect>,
}
pub struct MarginaliaLoad {
    pub record: Arc<MarginaliaRecord>, pub warnings: Vec<String>,
}
```

DTO serialization uses the original camelCase names. Optional absence,
unknown properties, unfamiliar author kinds, persona/color metadata, voice
references, original string IDs, and comment/reply order are preserved. Native
reply drafts are keyed by original folio ID, then original comment ID; they
are separate from filed comments and are omitted from web-array exports.

```rust
impl MarginaliaRecord {
    pub fn from_comments(comments: Vec<UserComment>) -> Result<Self>;
    pub fn from_value(value: &Value) -> Result<Self>;
    pub fn validate(&self) -> Result<()>;
    pub fn to_web_value(&self) -> Result<Value>;
}
pub fn parse_marginalia_json(bytes: &[u8]) -> Result<MarginaliaRecord>;
pub fn parse_legacy_comments_json(bytes: &[u8]) -> Result<Vec<UserComment>>;
impl MarginaliaStore {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self>;
    pub fn path(&self) -> &Path;
    pub fn load(&self) -> Result<MarginaliaLoad>;
    pub fn save_request(&self, request: &MarginaliaRequest)
        -> Result<Arc<MarginaliaRecord>>;
}
impl MarginaliaSession {
    pub fn new(record: Arc<MarginaliaRecord>) -> Self;
    pub fn saved(&self) -> &Arc<MarginaliaRecord>;
    pub fn pending(&self) -> Option<&MarginaliaRequest>;
    pub fn error(&self) -> Option<&str>;
    pub fn request(&mut self, edit: MarginaliaEdit, now: u64)
        -> Result<Option<MarginaliaRequest>>;
    pub fn acknowledge_saved(&mut self, id: Uuid, record: Arc<MarginaliaRecord>) -> bool;
    pub fn report_error(&mut self, id: Uuid, message: impl Into<String>) -> bool;
    pub fn retry(&mut self) -> Option<MarginaliaRequest>;
    pub fn discard_failed(&mut self) -> bool;
    pub fn replace_record(&mut self, record: Arc<MarginaliaRecord>) -> bool;
}
```

`user-comments.json` is an isolated native file under Root's locked native data
directory. `parse_marginalia_json` accepts a unified web flat array or an
explicit native envelope. Legacy parsing is a separate API. A malformed or
incompatible native envelope is never reinterpreted as legacy data. Legacy
conversion retains the original empty folio scope and available metadata;
it does not attach notes to the active native manuscript.

The writer checks both full base and generation, validates the request before
writing, preserves exact previous primary bytes in an atomic backup, fsyncs
file/directory, and recognizes a valid exact-primary candidate on retry.
Recovery never overwrites damaged or future-format bytes silently. Only an
exact matching durable ACK advances the saved read model. Effects describe
metadata changes for Root after ACK; they never perform source edits or publish
ledger success themselves. Erase targets carry both original ID and folio scope.

## Anchors, counts, and view

```rust
pub struct MarginaliaCapabilities {
    pub persist: bool, pub erase_anchors: bool,
    pub jump_to_anchor: bool, pub ask_editor: bool,
    pub play_audio: bool, pub speak: bool,
}
pub enum MarginaliaEvent {
    SaveRequested(MarginaliaRequest),
    Filed { request_id: Uuid, effects: Vec<MarginaliaEffect> },
    JumpToComment(CommentRef),
    AskEditor(CommentRef),
    PlayAudio { target: CommentRef, audio_id: String },
    Speak { target: CommentRef, text: String },
}
impl MarginaliaView {
    pub fn new(record: Arc<MarginaliaRecord>, active_folio_id: Option<String>,
        anchor_ids: Option<Vec<String>>, capabilities: MarginaliaCapabilities,
        window: &mut Window, cx: &mut Context<Self>) -> Self;
    pub fn saved_record(&self) -> &Arc<MarginaliaRecord>;
    pub fn pending_request(&self) -> Option<&MarginaliaRequest>;
    pub fn pending_request_id(&self) -> Option<Uuid>;
    pub fn capture_reply_drafts(&self, cx: &App) -> ReplyDrafts;
    pub fn has_unsaved_changes(&self, cx: &App) -> bool;
    pub fn prepare_pending_edits(&mut self, cx: &mut Context<Self>)
        -> Result<Option<MarginaliaRequest>>;
    pub fn flush_pending_edits(&mut self, window: &mut Window,
        cx: &mut Context<Self>) -> Result<Option<MarginaliaRequest>>;
    pub fn request_edit(&mut self, edit: MarginaliaEdit, window: &mut Window,
        cx: &mut Context<Self>) -> Result<Option<MarginaliaRequest>>;
    pub fn reply_input(&mut self, target: &CommentRef, window: &mut Window,
        cx: &mut Context<Self>) -> Result<Entity<TextareaState>>;
    pub fn set_inline_thread(&mut self, target: Option<CommentRef>,
        cx: &mut Context<Self>) -> bool;
    pub fn ack_saved(&mut self, id: Uuid, record: Arc<MarginaliaRecord>,
        window: &mut Window, cx: &mut Context<Self>) -> bool;
    pub fn report_error(&mut self, id: Uuid, message: impl Into<String>,
        cx: &mut Context<Self>) -> bool;
    pub fn replace_record(&mut self, record: Arc<MarginaliaRecord>,
        window: &mut Window, cx: &mut Context<Self>) -> bool;
    pub fn set_scope(&mut self, active_folio_id: Option<String>,
        anchor_ids: Option<Vec<String>>, window: &mut Window,
        cx: &mut Context<Self>) -> bool;
    pub fn set_anchors(&mut self, ids: Option<Vec<String>>, cx: &mut Context<Self>);
    pub fn set_capabilities(&mut self, capabilities: MarginaliaCapabilities,
        cx: &mut Context<Self>);
}
```

All capabilities default off. `MarginaliaCapabilities::local()` enables filing
and erasure for an explicit local test consumer. Production Root enables
`erase_anchors` only when actual manuscript-mark removal is available. Both the
Erase button and programmatic erasure, including nested batches, require
`persist` and `erase_anchors`; replies and strike/restore only need `persist`.
Supplying `None` anchor IDs means anchor knowledge is unavailable;
it never means every note is a ghost. Known mark IDs partition the scoped flat
array into live and ghost notes, and separately identify headless marks.
Matching quote text is not an existing mark. Jumps are emitted only for a
supplied live mark when the capability exists.

The pure reconciliation helper retains ghosts for transient projection. The
web editor's debounced caller also deletes current-folio threads with verified
missing marks (`twyne-editor.tsx:760-807`). Root owns that separate freshness and
durable-deletion integration and calls `Reconcile` with an accepted fresh
manuscript's actual scoped mark IDs. That edit removes only missing scoped
thread metadata and emits `Orphaned`, distinct from `Erased`: the mark is already
absent, so no source-removal command follows its ACK. Foreign IDs, including
colliding imported IDs, and every held reply draft remain intact. The view
closes a now-unreachable composer after ACK while retaining its saved text and
rope. `Reconcile` needs persistence, not the mark-erasure capability. Unknown
anchor knowledge must never be converted into an empty set for this edit.

The panel preserves the original heading, instructions, quiet empty state,
Pending/Struck cards, quotations, author/date, replies, and controls. Ghost-only
filters Pending; Struck stays visible. Original insertion order is preserved.
Closing a reply keeps its held text; deliberate Cancel clears that reply draft.
Draft capture reads actual textarea ropes, including an unblurred final
character. Preparing drafts returns the existing pending request unchanged.
Reply drafts are cleared only when the filed reply is acknowledged.

`reply_input` hydrates or returns one retained native input for an existing
note in the active original folio scope, including resolved notes as the
original inline panel permits. Root calls it before
`set_inline_thread(Some(target))`; that setter suppresses the same target's
Board composer and disables its Annotate control while Root mounts the shared
input beside the manuscript mark. `set_inline_thread(None)` returns the held
Board composer when pending. Missing/foreign targets are rejected. Scope changes
clear the inline mount flag after the ordinary freshness boundary. Draft
capture and ACK operate on the same entity in either location.

`set_scope` and `replace_record` return false when held changes or a pending
request require Root's freshness boundary first. Closing/changing the Board
must capture or prepare the current entity before dropping it. An unplaced
inline composer remains Root's independent text/selection state, never a
filed `UserComment` in this model.

No persona/provider/audio/connected action is fabricated. Retained imported
persona replies and audio references remain inspectable metadata. Root may
enable capability events only when it has an actual handler.

## Proof boundaries

The fixture generator executes the real source store operation bodies, pure
anchor reconciliation, and the original editor caller's scoped filter/delete
body, with isolated local file/time/ID substitutes. It does not execute a DOM
walk, debounce, provider, sync or browser rendering. Ten core tests pass for
these contracts, actual-browser flat-array import, absence/unknown metadata,
race-preserving replies, scoped changes, draft retention, actual failed writes,
stale/full-base conflicts, idempotent ACK retries and future/corrupt recovery.

Eight mounted native tests pass at 360×860 for actual reply typing/Ctrl+Enter,
strike/reopen/erase with disk ACK/error/retry, readonly/capability gating,
scope/disk draft recovery, Tab/focus/reveal, resolved-thread inline sharing, and
verified-orphan ACK keeping an unblurred reply. Kit's base accessibility
snapshot does not expose its disabled flag, so gating checks use actual inert
clicks/events rather than asserting a fabricated snapshot flag.

The original app was also exercised through its real local UI to place two
marks, file one reply and strike one thread. `browser-comments.json` is its
actual flat `/user-comments.json` extracted from a persisted Lix copy;
`browser-manuscript.html` is the actual saved marked HTML,
`browser-manuscript-dom.html` its rendered DOM with transient widget/initial
projection, and `browser-content-snapshot.json` its saved source metadata.
`BROWSER.md` records those boundaries and measured typography. The native
Markdown renderer and browser marked-HTML renderer are distinct; no pixel,
provider, audio, sync, package or install parity is inferred from model/UI tests.
