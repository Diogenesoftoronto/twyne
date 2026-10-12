# Offline House and Library

The source contract is `src/utils/house-model.ts`, `house-store.ts`, the current
House and Library routes, and `src/components/house/house.css`. This slice owns
`house.rs`, `house_view.rs`, and this fixture directory. Root owns navigation,
the library OS lock, background saves, manuscript freshness, summaries, and
export integration.

## Data and identity

`HouseState`, `House`, `Collection`, `PartialAnswers`, `CharterItem`, and
`LedgerEntry` retain the current camelCase web shape. Optional dossier values
retain their absence. Unknown properties, unfamiliar wire enum values,
fractional charter order, and foreign membership references survive loading and
subsequent native writes.

Collection membership uses the original String folio ID. `LibraryFolio.native_id`
is a navigation identity only. A v2 document backup's folio catalog does not
identify its active content; this module does not infer an alias from its first
entry or delete foreign references when local folios are unavailable. An
explicit membership change repairs only the selected folio's memberships. A
Dissolve operation releases that collection's folios and withdraws that
collection's charter articles.

There is no invented collection archive field or action. The optional folio
archive request preserves the older native capability and is off by default.

`assemble_context_stack`, `effective_brief`, and `context_for_models` implement
the original nearest-layer rules, stand-ins, provenance, charter ordering, and
the web helper's UTF-16 token estimate. The effective brief is a read model;
it preserves reference/probe/brief metadata and never rewrites a manuscript or
canonical Typst source.

## Durable changes

`HouseRecord` wraps a web `HouseState` with the native format, version, and
generation. `HouseStore::open(root)` holds a separate `house.json`. Root must
hold the library OS lock for the store's lifetime and retain the shared store
until a background write completes.

`HouseSession::request` creates a `HouseRequest` containing its request ID,
expected generation, full base, and full candidate. The saved read model changes
only when the exact request is acknowledged with its durable candidate.
`save_request` compares the full base and generation, preserves the previous
primary bytes in an atomic backup and fsyncs the replacement and directory.
Root's coordinator recognizes an already saved exact candidate when retrying;
the store itself requires its expected base. A stale writer cannot overwrite
another writer's same-generation content.

A failed request retains its candidate and generated IDs. A corrupt primary
can recover from a valid backup, with a warning and a preserved damaged copy
on the next save. Corruption without a usable backup and incompatible native
format versions fail explicitly instead of becoming an empty House.

Both views expose `pending_request()`, `prepare_pending_edits(cx)`,
`flush_pending_edits(window, cx)`, `ack_saved(id, record, window, cx)`,
`report_error(id, message, cx)`, and `replace_record`. House preparation reads the
actual held inputs synchronously, including a final unblurred character, and
returns an existing pending request unchanged. Library is a read view and has
no House write to prepare or acknowledge. Root may use the same route/quit
boundary for both.

Existing names, dossier fields, descriptions, charter edits, and membership
actions are filed through `HouseEvent::SaveRequested`. Navigation waits for the
successful acknowledgment when there are held edits. Retry reuses the request;
Discard explicitly releases a failed draft. A new article remains an unfiled
input until Add article is invoked; this module does not claim independent
recovery for that unfiled input.

## Native views and capabilities

`HouseView::new(record, folios, capabilities, window, cx)` owns the original
letterhead, Cabinet, Register, and sheets. `set_active_folio` controls the desk
mark; Root can select the active folio with `set_selection` when opening the
route. Form Tab and Shift-Tab advance between prose fields without native
textarea indentation; focus reveals lower fields within the outer House scroll.

`LibraryView::new` uses the same constructor arguments. Its default chrome is
the original House link, Sort, Back to desk, context sentence, and auto-fill
folio cards. Search and scopes remain available through `LibraryQuery` and
`set_query`; an explicit `library_filters` capability may expose those optional
native controls. They are absent from the original default route.

`set_name_order(original_ids, cx)` accepts Root's stable JavaScript
`localeCompare` ordering. Without that supplied order, Name uses a deterministic
case-folded fallback; it is not described as an Intl implementation. Ranking is
built once per query. Preview and word count are optional for source-only or
unreconciled documents and are never fabricated from Typst code.

Refine, export, folio archive, and Engine requests are capability boundaries.
There is no provider conversation, account mutation, connected review, or
synthetic Engine success in this offline slice.

## Evidence

Regenerate the fixture with:

```sh
rtk proxy bun desktop/gpui/fixtures/house/generate.ts
```

The generator executes the current pure web House model and the unmodified
store operation bodies. The harness replaces only IDB/window boundaries, time,
and newly generated IDs. This is web data-contract evidence, not a browser,
provider, sync, or IDB durability claim.

The native model suite covers actual web operations and context output, unknown
metadata and orphan references, explicit ambiguous-membership repair, Dissolve,
disk backup/recovery, failed writes, full-base/generation conflicts, foreign
acknowledgments, and stable filtering/order. Mounted GPUI tests drive actual
creation/rename inputs, immediate preparation, failure/retry/navigation,
membership checkboxes, article filing, Dissolve, read-only gates, Library
mouse/keyboard opening, and focus reachability at 1280×860.

Root's app-level checks and fresh native screenshots are separate evidence.
Model and mounted-control tests alone do not establish visual parity, connected
behavior, clean installation, or device packaging.

The original House and Library and the actual 1280×860 native client captures
were inspected. The source-backed corrections include the 44px House name
frame, double letterhead rule, drawer/sheet columns, original caption tracking,
opaque original paper fills, dotted dossier rules, and reserved Library grid
tracks. Root also measured the actual browser cascade: Library Sort and Back
use Libre Baskerville at 12px/17.1429px, and preview prose uses Lora at
13.12px/19.68px. The native controls use those values. Some folder/card text
metrics and preview wrap still differ between browser and GPUI rendering; this
is not a claim of pixel parity. Native import timestamps naturally differ from
the reference folio's earlier timestamp. The offline empty charter does not
promise an unimplemented pause-and-margin checker.
