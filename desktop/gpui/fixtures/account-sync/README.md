# Account/sync foundation — HANDOFF

Frozen scoped files: `src/native_accounts/**` and this fixture directory. This is an offline protocol/state/persistence foundation, not connected sign-in or a connected library. `auth::CONNECTED_AUTH_AVAILABLE` is deliberately false. Root owns all runtime exports, manifests, app/Store/UI/transport integration; `integration.patch` is **unapplied**.

Read [contracts.md](contracts.md) before integration. Its separate source policies, identities, callback approvals, capacity constraints, sharing/publishing boundaries, and native gaps are authoritative for this slice.

## Exact interfaces

| Interface | Purpose / required Root boundary |
| --- | --- |
| `auth::CallbackRegistration::require_supported()` | Syntax + explicit exact-origin Twyne trust and Not Organic Twyne-product registration. Operator configuration is required; URL syntax or `product=twyne` is not approval. |
| `auth::SignInAttempt::prepare(registration, verifier_entropy:[u8;32], state_entropy:[u8;32], now_ms, return_to)` | Same Source PKCE S256 request. Root supplies fresh OS CSPRNG entropy; this does not open a browser or listener. |
| `SignInAttempt::{authorization_url,consume_callback}` | Parsed components preserve duplicate query values; consumption is once even on failure. A returned request is only data for the unimplemented trusted redemption transport. Debug output redacts code/verifier/state. |
| `auth::SignInReceipt::consistent_account(trusted_issuer)` | Issued/refreshed/session user consistency only. A constructed or parsed receipt is **not** authenticated identity/JWT/session proof. |
| `AccountIdentity`, `SessionLease` | Exact issuer/subject/token-identifier consistency and unique operation-lifetime guard. Root creates a lease only after real accepted Convex auth; invalidate it at sign-out/account change. |
| `protocol::{SyncPayload,PullSnapshot,ContentSnapshot}` | Original section names, canonical source, HTML, nullable-persona distinction and pull metadata; retain unknown fields. No caller owner is added to requests. |
| `SyncPayload::{normalized,push_arguments}` | Source-compatible row/whole-section diff, omitted/empty semantics, removals, expected head. Known pull timestamps are omitted without rewriting source. Conservative changed-content JSON budget 950,000 bytes; Source UTF-16 bound 5,000,000. Server encoding/whole-account capacity remains independently enforced. |
| `AccountJournal::enqueue(payload)` | Explicitly associate a candidate with **this** account. Durable latest-unsent intent coalesces; an in-flight desired snapshot remains immutable. Run only at an explicit save/flush boundary, never a whole-doc per-key path. |
| `AccountJournal::prepare_dispatch(lease,active)` | Requires observed baseline/head and no pending pull/stage/conflict. Persist candidate journal before transport submission. Request data does not prove transport/auth availability. |
| `AccountJournal::{acknowledge_push,mark_rejected,mark_outcome_unknown}` | Exact dispatch/current-lease guards. ACK advances only sent baseline; newer intent survives. Only proven noncommit can use `mark_rejected`; timeout/socket-loss/ambiguous result requires pull. No server idempotency key exists. |
| `AccountJournal::{stage_pull,commit_pull}` | Retain remote snapshot and base/local/remote conflicts. Root must perform actual guarded local application/persistence, then give exact stage/payload/edit-generation and unchanged pending-Source-set receipt. These consistency fields alone are not local I/O proof. |
| `AccountJournal::resolve_conflicts(lease,active,expected_conflicts,expected_edit_generation,candidate)` | Explicit resolution after actual guarded Root local persistence. Rejects an old account/lease/dialogue generation. Native three-way preservation is deliberately **not** the Source timestamp merge or a Lix CRDT. |
| `AccountJournal::{suspend_session,native_id_for}` | Startup/sign-out leaves uncertain in-flight data and requires a pull; remote string ID ↔ local UUID mapping must be persisted before hydrate. |
| `AccountSyncStore::{open,load,save_request,expected_value,acknowledge_expected}` | `open(app_root)` uses only `app_root/account-sync`. Per-account SHA-256 names, OS lock across handles/processes, exact primary+backup byte/value CAS, fsynced atomic save/previous backup, warnings on recovery, untouched future/invalid versions. Exact expected-save acknowledgement re-syncs primary/dir under lock. 64 MiB journal cap; Unix modes 0700/0600. No credentials stored. |

Pull receipts and queue records preserve the original canonical source; they do not compile it, regenerate HTML, establish a verified projection, change Source selection/history, or write the current native manuscript. Root must preserve its Source pending/conflict/revision guards and use a staged/recoverable two-store application protocol. Do not emit 'saved' from a journal-only receipt.

## Dependencies/export

No new dependencies: existing `anyhow`, `serde`, `serde_json`, `fs2`, `tempfile`, `uuid`, plus desktop-enabled `base64` and `sha2`. The proposed export is `#[cfg(feature="desktop")] pub mod native_accounts;`, so no-default core keeps optional auth dependencies unreferenced. No app, manifest, credential vault, auth transport, browser storage, or existing Store was edited.

## Reproduction and evidence

Executed here:

```sh
rtk proxy bun desktop/gpui/fixtures/account-sync/capture-contracts.ts
rtk proxy bun desktop/gpui/fixtures/account-sync/capture-contracts.ts --check
rtk proxy rustfmt --edition 2024 --check desktop/gpui/src/native_accounts/mod.rs desktop/gpui/src/native_accounts/auth.rs desktop/gpui/src/native_accounts/protocol.rs desktop/gpui/src/native_accounts/journal.rs desktop/gpui/src/native_accounts/store.rs desktop/gpui/src/native_accounts/tests.rs
```

The generator AST-selects four original sync helpers and four auth helpers plus the callback constant, with drift guards and a forbidden-network/global-context guard. It records exact source SHA-256. Only selected pure bodies execute; no app module is imported. Eight original wire diff cases, nine callback cases, six return paths and a deterministic PKCE request are captured. Fixture entropy/codes/session IDs are synthetic and confer no access.

Prepared, **not run here**, because Root owns Cargo scheduling:

```sh
# After Root reviews and applies integration.patch:
rtk proxy devenv shell -- rtk proxy cargo test --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --lib native_accounts::tests
rtk proxy devenv shell -- rtk proxy cargo check --manifest-path desktop/gpui/Cargo.toml --locked --offline --no-default-features --lib
```

The 26 prepared tests include real temporary-filesystem restart/backup/corruption/blocked-path retry and simultaneous separate-handle CAS tests, alongside synthetic protocol/lease/conflict tests. They have not established passing Rust type-checks, filesystem behavior, native account UI, OS secure storage, registered callbacks, live identity, live sync, multi-device convergence, service limits, or platform portability. Root must run/review these gates before runtime use.

## First connected slice remains separate

Both native callback origin approvals must exist before auth transport. Implement external-browser/listener routing, protected Better Auth cookie jar, refreshed-session authenticity, Convex JWT acquisition/accepted-auth state and current-lease cancellation. Then use **read-only staged pull into a separate account partition**, with explicit device-library association before any upload. Do not silently carry the browser's unpartitioned automatic seeding into native. Sharing/Lix, roles/presence, invitations, publication, global provider sessions and deletion are outside this foundation and owned by other lanes.
