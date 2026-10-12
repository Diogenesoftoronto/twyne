# Offline Cast: retained-source contract

Source and original-browser audit, followed by the bounded offline native
implementation, 2026-10-04. The retained model/store is `src/cast.rs`; the
Board, roster manager and retained-analysis view are `src/cast_view.rs`.
Host navigation, store lifetime and durable acknowledgements are coordinated
by the application's Cast coordinator. The delivered writer-note rail remains
frozen. No provider, account or Convex actions were performed.

## Delivered scope and capability boundary

The implemented offline slice is the global Cast roster and room settings,
with folio-scoped retained editorial notes and writer **File only** replies.
Roster management, existing-note reading/grouping/clamping, and existing
analysis reading/copy/download require no model. Generating notes, asking an
editor to answer, proposing/fixing edits, background reading, narration, and
voice conversations require real separate capabilities.

The native Cast tab now mounts the retained Board with the original vermilion
accent. The Room of Editors and retained Full Analysis routes use the same
retained `CastView` entity. Generation and persona mark actions remain gated;
preserved quote metadata does not enable a mark command. Cast persistence is
independent of manuscripts, House and writer Marginalia.

## Authority

Paths below are relative to the repository root, except native paths explicitly
prefixed `desktop/gpui/`.

- `src/types/index.ts`: `Persona` (1), `PersonaFeedback` (53),
  `PersonaNotePayload` (81), `PersonaMemo`/`RoomAnalysis` (236),
  `PersonaReply` (548), `RoomSettings`/defaults (818).
- `src/utils/personas.ts`: all five exact initialized personas, including
  prose, speech metadata, and generation preferences. Copy the original data;
  do not paraphrase the descriptions, backstories, or voice instructions.
- `src/components/personas/personas-panel.tsx`: hydration (362), original
  styles (398), writer replies (1299), room settings (1689), clear (1895),
  panel rendering (1905), feed grouping (2426), analysis modal (2802).
- `src/routes/personas/index.tsx`: local roster manager, add/edit/remove/move/
  reset and assistance overrides. The Show voice prompt control uses the
  existing pure `buildVoicePreview(toAgentPersona(persona))` formatter.
- `src/utils/idb.ts`: personas store/load/save (837), folio meta keys (967),
  local analysis load/save (1029).
- `src/utils/convex-sync.ts`: global custom-persona save (1352), scoped notes/
  replies (1363), room settings (1508), whole-room strike (1530).
- `src/utils/exchange.ts`: manuscript backup (690), analysis Markdown (951).
- `src/components/editor/extensions/persona-note-mark.ts` and
  `src/components/editor/twyne-editor.tsx`: actual persona marks and the
  `twyne:persona-notes`, `twyne:clear-persona-notes`, and
  `twyne:scroll-to-persona-note` commands (1949–1985).
- `src/utils/speech.ts`: provider-specific speech selection (290), exact
  persona identity resolution by name/id/role (442). No built-in browser
  `speechSynthesis` fallback is used.

## Exact retained DTOs

Use camelCase JSON, original string IDs, and flattened unknown fields at every
object level. Preserve optional-field absence and explicit null when imported;
do not hydrate defaults back into the retained payload merely for rendering.
Keep unknown enum strings/provider-map keys rather than deleting their rows.
Native request IDs and generation counters belong to the native envelope,
not the web DTOs. The original `Persona` has no `updatedAt`.

| DTO | Required fields | Optional fields |
| --- | --- | --- |
| `Persona` | `id`, `name`, `role`, `color`, `icon`, `description`, `focus` | `backstory`, `criticalMethod`, `voice`, `signatureMoves: string[]`, `avoidances: string[]`, `sampleLines: string[]`, `speechVoice`, `speechVoices: provider → string`, `providerId`, `model`, `temperature` |
| `PersonaFeedback` | `personaId`, `personaName`, `personaColor`, `feedback`, `timestamp`, `type` | `folioId`, `traceId`, `paragraphIndex`, `anchor`, `noteId`, `briefTitle`, `origin` |
| `PersonaReply` | `id`, `noteId`, `author`, `authorKind`, `text`, `timestamp` | `folioId`, `personaId` |
| `RoomSettings` | `level`, `maxProposals`, `maxLargeEdits`, `personaScope: string[]` | `perPersona: persona ID → level`, `backgroundRoom` |
| `PersonaMemo` | `personaId`, `personaName`, `personaColor`, `text`, `provider` | `anchor` |
| `RoomAnalysis` | `memos: PersonaMemo[]`, `synthesis`, `synthesisProvider`, `timestamp` | `folioId`, `briefTitle` |

`PersonaFeedback.type` currently uses encouragement/suggestion/critique/
perspective; labels are **in defense of**, **a small suggestion**,
**a counter-reading**, and **from the audience**. `origin` absent means convened;
`background` uses **in passing**, a 2px colored left rule and quieter opacity.
Neither feedback nor replies have writer-comment `resolved`/`struck` fields.
Do not merge these records into the independent `UserComment` ledger.

`PersonaReply.authorKind` is user/persona. A newly filed offline reply is
`author: "You"`, `authorKind: "user"`, trimmed nonempty text, current timestamp,
and the exact scoped `noteId`. Existing persona replies are readable retained
material, not evidence of a working native conversation. Source creates new
reply IDs with `preply-<time>-<random>`; preserve imported IDs verbatim.

## Original resident roster and artwork

There are no portrait image files in these controls. The original roster uses
Unicode glyphs inside colored circles; note cards use the same glyphs in larger
portrait badges. The empty panel uses **❦**. Arbitrary saved `icon` and `color`
strings remain data; resolve known CSS theme variables only for presentation.

| Original ID | Name | Role | Glyph | Retained color | Light-theme value | OpenAI voice | Temperature |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `devil` | Mlle. Sceptique | The Devil's Advocate | ♠ | `var(--color-persona-devil)` | `#c1272d` | `onyx` | 0.3 |
| `angel` | Sœur Encourageante | The Patron of Strengths | ♥ | `var(--color-persona-angel)` | `#8a9a5b` | `shimmer` | 0.6 |
| `scholar` | Professeur Athenæum | The Scholar | ♦ | `var(--color-persona-scholar)` | `#5c6bc0` | `echo` | 0.3 |
| `editor` | M. Le Stylo | The Copy Chief | ✦ | `var(--color-persona-editor)` | `#d4a017` | `ash` | 0.4 |
| `reader` | Le Lecteur | The Target Reader | ♣ | `var(--color-persona-reader)` | `#2c4a7c` | `alloy` | 0.7 |

Each original persona also has a distinct public Fish Audio model ID in
`speechVoices.fishaudio`:
`devil=91f2fedea8bc4465a6c668b2776be809`,
`angel=23c1b755b9994a68a1d21d6a67562445`,
`scholar=c5f56a6cc2ec4fa8920cb4c5889a3fb7`,
`editor=3274bdf8143c4378a2cb779582d26364`,
`reader=125d6460953a443d8c65909adf87ca3f`.
They are voice identifiers, not credentials.

## Voice and provider boundaries

`voice` is prose direction, separate from `speechVoice` (an audio identifier)
and `speechVoices` (per-provider identifiers). `providerId`, `model`, and
`temperature` are optional generation preferences. The current roster form
edits lore/voiceprint but exposes no audio-provider/voice/model/temperature
inputs; its spread-based edit preserves those fields. Do not add an apparent
working audio selector in this offline slice.

Narration resolves a known persona's name/id/role and preserves that speaker's
label, direction, and provider-specific voice. Provider override wins over
`speechVoice`. Supertonic maps the resident OpenAI names to actual local
embedding IDs: onyx→M1, shimmer→F1, echo→M2, ash→F2, alloy→M3. The original
browser implementation can run Supertonic on-device after model download;
GPUI currently has no equivalent renderer/model adapter. Likewise original
`litert` is an Electrobun loopback integration, not a GPUI capability. Neither
one makes native offline narration/generation available automatically.

Source rejects empty responses and `provider: "local"` fake fallback notes.
Never simulate a convened editor, a typing stream, background reading status,
audio playback, or model answer. Get notes/Propose edits/full analysis/Ask the
editor/ask for a fix and model-dependent feedback controls stay disabled until
their actual capabilities exist. Existing analysis can be opened without
generation. Background-room promise/status copy must be capability-gated.

## Room settings and offline actions

Default settings are exactly
`{level:"sentence",maxProposals:6,maxLargeEdits:2,personaScope:[],backgroundRoom:true}`.
Missing `backgroundRoom` is effectively on. Empty `personaScope` means all
editors may propose; it cannot represent nobody. Effective level is
`perPersona[personaId] ?? level` (not a min between the two values).

Panel controls are **▸/▾ Room settings**, **Edit scope**, **Notes only** /
**Sentence** / **Paragraph**, **Read as I write**, **Edits per pass** (1–20),
and **Paragraph edits** (0–10). Settings are local configuration; persisted
background preferences do not imply an active native checker.

The manager has **Room of Editors**, **+ New editor**, **Reset defaults**,
**← Back to desk**, **Tunable Assistance**, **How much each editor edits**,
comments/sentence/paragraph override pills, **may propose** / **blocked**,
**Move up** / **Move down**, **Edit**, **Remove**, **Save**, **Cancel**,
and **▸ Show voice prompt** / **▾ Hide voice prompt**. The empty live manager
says **No editors on staff.** and **+ Hire your first editor**.

New editors require a trimmed nonempty name, use a new UUID string, and default
to role **The Editor**, icon **❧**, description **A sharp, insightful editorial
voice.**, focus **General editing**, and the first palette swatch (vermilion).
Edit preserves ID and all fields outside the edited form. Source icon inputs
have `maxLength=2` UTF-16 units. Optional lore fields trim to absent when empty;
the three line-list fields trim each line, strip one initial `-`/`•`/`—` bullet,
drop blank lines, and become absent if empty. The manager color swatches are
vermilion, mustard, cobalt, forest, periwinkle, sage, blush, ink, stored as their
original CSS-variable strings. Reset requires the original inline confirmation
and replaces the roster with exact defaults; it does not clear notes/settings.

## Notes, anchors, and original panel

The panel heading is **The Room of Editors** with brief title or **Untitled
project**, followed by ` · <format>` when present. Controls are **▾ Hide
controls** / **▸ Show controls**, **Cast**, a **Current cast, N editors** list,
**Edit cast →**, **✦ Get notes**, **✎ Propose edits** (absent when room level is
comments), **❡ Run full analysis ↗** or **❡ Open full analysis ↗**, and settings.
The source empty copy is **No notes yet. Write a few paragraphs, then get notes.**
The native offline copy/control state must not imply generation works.

The feed supports note count, **▾ grouped** / **▸ all notes**, **▸ compact** /
**▾ full**, Markdown bodies, original anchors truncated at 160 UTF-16 units,
reply threads, **↩ reply**, **File only**, **Ask the editor ↺**, and **Cancel**.
Only File only is a local persisted writer reply. Source Ctrl/⌘+Enter asks the
editor; do not remap that shortcut silently to filing. Helpful/unhelpful
controls carry `traceId` into analytics, not the local note DTO; keep gated.

`anchor` is quote metadata, not proof of a live manuscript mark. The actual
source mark is `span[data-persona-note-id]` with
`data-persona-note-{author,color,label,note,quote}` and legacy attribute
`data-persona-note-brief` for `briefTitle`. Same-type marks may overlap
(`excludes:""`). Preserve all attributes and source bytes; do not reconstruct
marks by matching quote text, especially repeated sentences. Root supplies
actual same-scope mark knowledge; unknown means no active jump capability.

**clear ✕** means strike the entire active room: remove its notes and replies
and every actual persona pin from that manuscript. It does not clear the
analysis or roster. This action must remain gated until a real persona-mark
removal transaction is available; writer-comment RemoveComment is not that
transaction. Metadata-only clears must not masquerade as whole-room clear.

## Persistence and exchange

The original stores are independent:

- Global `Persona[]`: IndexedDB `twyne`, store `personas`, keyPath `id`.
  Save clears and puts the array. Load uses `getAll()`.
- Global `RoomSettings`: Lix path `/room-settings.json`.
- Scoped `PersonaFeedback[]`: Lix path `/folios/<original-folio-id>/persona-notes.json`.
- Scoped `PersonaReply[]`: Lix path `/folios/<original-folio-id>/persona-replies.json`.
- Scoped `RoomAnalysis`: IndexedDB `meta` record
  `{key:"room-analysis:<folioId>",value:<analysis>,updatedAt:<time>}`;
  the legacy unscoped key is `room-analysis`.

Preserve the original artifact scope separately from optional row `folioId`.
Legacy missing/empty fields and foreign rows remain retained; do not migrate
them onto the active native UUID or guess an identity from a folio catalog.
New File only replies use the Root-supplied original folio identity. Imported
notes without `noteId` remain readable; no invented ID enables a reply or mark
command on them.

The current `.twyne.json` v2 exporter includes title/brief/folio catalog and one
HTML/Typst content pair. It has no standalone Cast roster/settings/notes/
replies/analysis fields. Embedded persona-note spans may travel in raw HTML,
but that is not the complete retained ledger and cannot recover replies,
timestamps, roster lore, or global settings. Native exchange already preserves
unknown envelope fields; leave them intact. A future explicit Cast metadata
import/export needs its own source-compatible contract. Do not advertise Cast
coverage in manuscript backup or synthesize a complete ledger from inline HTML.
`exportRoomAnalysisMarkdown` is a separate existing read-only export, with
**The Full Analysis — <briefTitle or Untitled>**, filed date, **The Room's
Verdict**, and each memo's persona name/text.

For native durability, use a separate versioned `cast.json` envelope with
generation, retained roster/settings, and original-string-scoped folio
artifacts. Keep native draft recovery separate from filed replies. As with
House/Marginalia, Store clones must share one writer mutex, detached workers
hold the Root library Store/OS lock, and saves use full-base + generation CAS,
atomic replacement/fsync/backups, and exact-primary idempotence. Corrupt/future
native envelopes are not silently interpreted as web arrays. Explicit imports
carry path/scope provenance and preserve unknown fields. On failed or stale
write, do not publish success, drop the final unblurred character, clear a
reply draft, or update an inline thread.

## Source quirks requiring explicit parity decisions

1. Both panel and manager use defaults if the hydrated custom array is empty.
   Removing every editor shows an empty manager in the current mount, but
   reload/remount restores the five defaults. Retain the raw empty array;
   do not claim it means a durable empty effective cast in the web app.
2. `move()` swaps the live array, but IDB `getAll()` returns primary-key order,
   so saved custom order is not durable in the original. Native may preserve
   explicit array order as a stated durability improvement; do not invent a
   `position` field or rewrite imported web IDs to accomplish it.
3. Removing an editor only removes `personaScope` membership inside the
   conditional for an existing perPersona override. Source can therefore
   retain removed/foreign scope IDs. Do not prune unknown references globally.
4. Clicking a level already explicitly overridden removes the override.
   Starting from implicit-all scope and toggling one ID creates `[thatID]`;
   it narrows to that editor rather than excluding it. Empty scope again
   displays all. Preserve this executed meaning unless a fix is agreed.
5. Grouping takes the latest timestamp per persona, retaining first-seen
   persona order; equal timestamps retain the first row. Hydrated all-notes
   preserves artifact array order. The grouped **older** toggle changes its
   label/state but the current JSX does not render older cards. Do not claim
   older-note expansion exists solely because the control does.
6. Explicit convening replaces the live feed with the new pass but local save
   upserts by noteId into accumulated notes. Reload can expose older saved
   passes. Background notes prepend to the live feed. Keep retained data and
   presentation separate; no native generation is in this slice.
7. Source File only optimistically displays a writer reply before awaiting
   save; IDB/Lix helpers do not provide native CAS/ACK proof. Native must keep
   a pending presentation separate and publish filed success only after
   actual durable ACK. Source reply opening/cancel clears one global draft;
   native recovery must retain scoped drafts through failed writes/navigation.
8. Full-analysis modal **clear** only clears live `store.analysis`; it does
   not delete the IDB record. A durable delete cannot be called exact source
   behavior without an explicit decision. Reading/copy/download are safe now.

## Landed native API

`CastRecord::default()` is the native envelope, format `twyne-gpui-cast`,
version 1, generation 0. Retained `personas` and `roomSettings` use
`OptionalField` so missing, null and actual values round-trip separately.
`folios: BTreeMap<String, CastFolioArtifacts>` holds original-path-scoped
`notes`, `replies`, optional `analysis` and flattened unknown metadata.
`replyDrafts` is scoped by folio ID and note ID; `rosterDraft` is a separately
recoverable global form draft. These recovery fields are not filed artifacts.

```rust
pub struct CastNoteRef { pub folio_id: String, pub id: String }
pub enum CastEdit {
    ReplaceRoster(Vec<Persona>),
    SetRoomSettings(RoomSettings),
    FileReply { target: CastNoteRef, reply: PersonaReply },
    Recovery {
        reply_drafts: CastReplyDrafts,
        roster_draft: Option<Box<CastPersonaDraft>>,
    },
    Batch(Vec<CastEdit>),
}
pub enum CastEffect {
    RosterChanged,
    SettingsChanged,
    ReplyFiled { target: CastNoteRef, reply_id: String },
}
```

`CastRequest` contains `request_id: Uuid`, `expected_generation: u64`,
`base: Arc<CastRecord>`, `candidate: Arc<CastRecord>` and `effects`.
`CastSession` owns the exact accepted record and optional pending request.
No optimistic filed artifact is installed before durable acknowledgement.
`CastStore::open(root)`, `path()`, `load()` and `save_request(&CastRequest)`
use the separate native `cast.json`. Clones share the same writer mutex.
The host retains its library OS lock through detached writes. Exact-primary
candidate equality makes synchronous close and a concurrent save idempotent.
Other writers require the full expected base and generation, not generation
alone. Corrupt/future envelopes fail closed; explicit original flat DTO
parsers are distinct from native envelope parsing.

`CastBriefLabel { title: Option<String>, format: Option<String> }` is display
metadata. `CastSurface` is `Board`, `Manager` or `Analysis`. The ten boolean
`CastCapabilities` are `persist`, `generate_notes`, `propose_edits`,
`generate_analysis`, `ask_editor`, `speak`, `persona_anchors`, `clear_room`,
`analytics` and `background_reading`. Default enables none; `local()` enables
only persistence. Existing notes, analysis and voice prompts remain readable.

```rust
CastView::new(record: Arc<CastRecord>, scope: Option<String>,
    brief: CastBriefLabel, anchors: Option<Vec<String>>,
    capabilities: CastCapabilities, window, cx) -> CastView

saved_record() -> &Arc<CastRecord>
pending_request() -> Option<&CastRequest>
active_folio_id() -> Option<&str>
surface() -> CastSurface
set_scope(scope, brief, anchors, window, cx) -> bool
set_anchors(anchors, cx)
set_capabilities(capabilities, cx)
set_surface(surface, window, cx)
set_analysis_filed_label(label: Option<String>, cx)
capture_reply_drafts(cx) -> CastReplyDrafts
capture_roster_draft(cx) -> Option<CastPersonaDraft>
has_unsaved_changes(cx) -> bool
prepare_pending_edits(cx) -> Result<Option<CastRequest>>
flush_pending_edits(window, cx) -> Result<Option<CastRequest>>
request_edit(edit, window, cx) -> Result<Option<CastRequest>>
ack_saved(request_id, Arc<CastRecord>, window, cx) -> bool
report_error(request_id, message, cx) -> bool
retry(cx) -> Option<CastRequest>
replace_record(Arc<CastRecord>, window, cx) -> bool
reply_input(target, window, cx) -> Result<Entity<TextareaState>>
```

Capture reads the current native input rope, including its final unblurred
character. `prepare_pending_edits` needs no Window and joins an existing exact
request; it does not substitute a new request ID. Scope changes refuse an
in-flight request. Record replacement refuses unsaved or pending edits.
Late or mismatching ACK/error messages return false. Error retry re-emits the
same candidate and ID; recovery and filed drafts are only cleared at accepted
ACK. Input subscriptions only notify presentation, without disk writes or
whole-document work per key.

`CastEvent::SaveRequested(CastRequest)` requests actual host persistence;
`Filed { request_id, effects }` follows accepted durable ACK.
`SurfaceRequested(CastSurface)`, `BackToDesk`, and
`DownloadAnalysis { folio_id, filename, markdown }` are host navigation/export
requests. Remaining events are capability-gated: `JumpToPersonaNote`,
`GetNotesRequested`, `ProposeEditsRequested`, `RunAnalysisRequested`,
`AskEditor`, `AskForFix`, `Speak`, `ClearRoomRequested` and `FeedbackRequested`.
None fabricates an editor answer, analytics delivery, mark or voice stream.

The host supplies `set_analysis_filed_label` using the original locale-specific
`new Date(timestamp).toLocaleString()` helper. The view's fallback is a readable
local date; analysis Markdown uses the same supplied label. No Cast metadata
was added to manuscript backup.

## Original browser proof and limits

Owned Playwriter session 4, anonymous offline app at `localhost:5180/editor/`,
1280×860, original marked Notebook, original public Google faces, no provider/
account actions. Auth/provider/sync/analytics/WebSocket traffic remained
intercepted. The audit opened the Board and Room settings and then restored
settings collapsed and Board closed; no data form was edited or filed.

Screenshot: `/tmp/twyne-reference-cast-audit.png`. Source Cast Board rectangle
is x816/y0/w464/h860. Shared contexts end at y163. Heading is x833/y175,
Libre Baskerville 18px/28px, weight600. Source portrait badge is 21.5938px
square, DM Sans 11.2px/16.8px, 1px persona-color border, fully round, paper-soft
fill. Get notes is x829/y306/w216/h36, Special Elite11px/16.5px, outer tracking
1.98px, padding8.8px12px; child title has its own 0.12em tracking. Consult
actual source cascade/child styles when porting, not Kit label defaults.

The initial audit proves the empty original panel, source disclosure and
computed styles. Subsequent native verification exercises retained test
artifacts, not generated provider output: nine model tests and seven mounted
view tests pass, including File only, final-character recovery, failed write /
same-request retry, scope guards, roster reset/reorder and retained analysis.
The host separately exercised real X11 controls and persistence. These checks
do not prove provider conversations, narration or a full-analysis generation.

`browser-manager-metrics-1280.json`, `browser-manager-metrics-620.json` and
`browser-manager-raw-glyphs.json` retain actual original DOM/CDP measurements.
Manager intro is 14/20 px; assistance explanation is 12/16 px. Assistance pills
use fully round source corners, 10.4/15.6 px Special Elite with 1.04 px tracking.
Their raw symbols request Libre Baskerville 16 px semibold / 24 px and resolve
to Liberation Serif Bold for the suits and Adwaita Mono for the star. The
separate circle badge retains the original DM Sans fallback chain instead.
The native view uses the two packaged font seams in their respective contexts.

The corrected actual 1280 px host Manager capture matches the source assistance
panel's y161..519 extent. Remaining measured limits include first persona card
bottom about four pixels lower and New Editor about three pixels farther right.
The edit form is currently above the tunable assistance panel rather than inside
its source roster card. Retained reply spacing and native markdown layout have
not established complete pixel parity. The source's state-only Older toggle is
preserved rather than inventing an older-feed rendering. Narrow and empty Board
host captures are separate proof. Runtime is frozen after these bounded source
corrections; no provider, audio, mark-removal or manuscript-backup coverage is
implied by the local controls.
