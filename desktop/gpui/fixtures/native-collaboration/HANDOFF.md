# Frozen offline foundation handoff

Root review update: the unconditional library export is now integrated. All
nine native tests passed, and locked offline all-target Clippy with `ui-tests`
and denied warnings passed. See `integration-gates.json`. The worker's earlier
unrun/export instructions below describe its handoff checkpoint; connected
sharing and publishing remain unavailable.

Writable scope was limited to `src/native_collaboration/**` and `fixtures/native-collaboration/**`. No shared runtime, Source, manifest, lockfile, network, provider or credential changes were made by this worker. Root added the approved cached dependencies separately. Existing native editor/pagination remain frozen.

The draft is now suitable for **model/projection integration review**, not a fulfilled multiplayer/publishing row. Root must apply/review the unapplied module declaration and run its own Rust checks.

## Repairs

- Removed nonexistent serde feature gates. DTOs serialize their Source camelCase wire names; role/status/kind strings remain lowercase.
- Replaced misleading `AuthenticatedWriter` with `WriterMetadata`. Constructor and flags cannot verify authentication or Pro. Private contact email is separate from public-label projection and redacted from Debug.
- Public labels now implement Source embedded-email rejection `/\S+@\S+/` and exact JS whitespace trimming/splitting, including BOM and excluding NEL.
- `OfflineLoopbackTransport(true,true)` refuses every endpoint with `CapabilityUnavailable`. No fabricated accepted promote/invite/heartbeat/unshare/Convex/PDS/Micropub result survives.
- Native slug logic uses actual NFKD and Source trim-before-slice order, including a retained clipped final hyphen. Server string sanitization no longer corrupts Unicode, strips unterminated tags or matches `<embedding>` as `<embed>`; it follows the seven ordered original replacements and ASCII case/word rules.
- Micropub parses URLs before checking exact loopback hosts, rejects `localhost.evil`, normalizes URLs and matches URLSearchParams form encoding.
- Raw Convex plans retain authored fields/requested kind; client metadata never resolves admin publishing authority or truncates UTF16 titles approximately.
- Presence position types now explicitly carry Source PM tree/UTF16 units. Source bounds and label filtering are pure projections; conversion to native scalar offsets remains deliberately absent.
- Original-source fixture generation now executes original functions and records hashes, rather than reimplementing them or checking only authored expected properties.

## Stable API changes

`WriterMetadata`, `ProseMirrorPosition`, `ProseMirrorContentSize` replace the old authenticated-writer and untyped scalar contracts. `prepare_convex_publish` accepts raw authored fields plus optional requested `PublishKind`; it has no `author_is_admin` input or client `resolved_kind`. `ConvexPublishReceipt::reader_url` only projects a supplied response. `SharedSession::observe_remote_snapshot` replaces `accept_remote_draft` to state its observation-only behavior. Presence DTO constructors/raw names are not public label authority; `generate_remote_cursors` applies safe display projection.

The future host must qualify every DTO/roster/request by verified session + exact folio/Lix scope, perform accepted-membership/role/entitlement checks at the server, guard asynchronous replies by current entity/scope/revision, and preserve pending canonical drafts. Nothing in this foundation substitutes for those guards.

## Verified here

```sh
rtk proxy bun test ./desktop/gpui/fixtures/native-collaboration/source-backed-test.ts
```

**8 passed, 0 failed, 42 assertions.** `rustfmt --edition 2024 --config skip_children=true` was run only on owned files. Nine native crate tests are authored and awaiting Root's scheduled check; no Cargo/Devenv/rustc invocation was made by this worker. No browser, live server, invitation delivery, PDS/Micropub publication or native remote overlay was attempted or verified.

## Still pending

Actual sharing/promote/join/revoke UI; Lix blob transport and push/pull relay; server-authenticated session/accepted membership; invite delivery/rollback ACK; scope-aware relay/timer cleanup; pending-draft/canonical reconciliation; remote Source provenance; PM-to-native cursor mapping and real accessible caret overlays; ownership/admin/entitlement refresh; publication slug uniqueness/updates/timestamps/unpublish; ATProto OAuth/PDS mutations and Standard.site verification; real Micropub dispatch/credential lifecycle; browser DOM sanitization and end-to-end network/device proof. This lane does not fulfill those product rows.

See [README.md](README.md) for exact retained-data and pure-function proof limits. `patch/UNAPPLIED_INTEGRATION_PATCH.diff` remains unapplied; Root controls all shared integration.
