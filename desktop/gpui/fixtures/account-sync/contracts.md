# Native account and library sync contracts

Source inventory: 2026-10-04. This describes the current working tree, including existing uncommitted changes. No accounts, credentials, providers, production endpoints, browsers, Cargo, or Devenv were used for this audit. Source tests mentioned below were inspected, not rerun. The new `src/native_accounts/` slice is an offline state/validation adapter; it does not establish connected sign-in or sync.

## Three identities and three independent transports

| Boundary | Actual credential and owner | Source |
| --- | --- | --- |
| Not Organic portal/gateway | Account DID, PKCE code, gateway DPoP capability bound to a server-generated asymmetric key | `convex/lib/providerLink.ts:21–65`; provider `apps/gateway/src/auth.ts:231–305` |
| Twyne account/Convex library | Better Auth user/session, then a **different** Convex JWT. Database ownership is `identity.tokenIdentifier`, not the provider DID, a caller user ID, or an email | `convex/lib/notorganicSignIn.ts:103–217`; `src/utils/auth-context.tsx:171–250`; `convex/sync.ts:29–35` |
| AT Protocol publishing | Separate BrowserOAuthClient/PDS session; its presence does not prove Twyne sign-in | `src/utils/auth-context.tsx:32–42,113–126`; `src/utils/atproto.ts:14–242` |

Twyne's canonical auth identity helper constructs `${issuer}|${subject}` without changing the issuer bytes (`convex/lib/authIdentity.ts:6–10`). Native state must retain the exact configured Convex issuer and authenticated Better Auth subject, together with the server-confirmed token identifier. The provider DID can be associated with that account by the server, but must not be substituted into this key.

The existing Electrobun app embeds `https://twyne.love` and inherits browser auth (`desktop/main.ts:1–57`). The GPUI app currently has local stores and no implemented account/session/Convex transport. A download page's future URL-scheme prose is not a implemented callback contract.

The backend persists a unique `providerIdentities` link containing DID, Better Auth product subject, `verificationMethod=notorganic_pkce`, session version and verification timestamps, rather than a gateway access/refresh token (`convex/providerIdentity.ts:26–108`). Wallet proxy capabilities are issued afresh by an authenticated server action against that verified link (`...:111–129`). Their availability is not a manuscript-library permission or proof of a native session.

## Current Not Organic sign-in

`src/utils/notorganic-connect.ts:15–112` is authoritative:

1. Generate 32 random bytes each for verifier and state; verifier is base64url, challenge is SHA-256/verifier base64url. Save the pending attempt in session storage key `twyne:notorganic-sign-in`; expiry is **600,000 ms**.
2. Open `https://id.notorganic.info/authorize` with response type `code`, client ID equal to the **exact initiating origin**, redirect `${origin}/auth/notorganic/`, method `S256`, scope `wallet:read`, cosmetic product `twyne`, and `prompt=select_account`.
3. Consume the saved attempt once, including on failure. Accept only the same origin and exact callback path, no fragment or `error` query parameter, exactly one nonempty code and one matching state, and a nonexpired valid verifier. Safe return paths start `/`, not `//`, and contain no backslash/control bytes. The callback route removes query parameters from browser history before redemption (`src/routes/auth/notorganic/index.tsx:15–28`).
4. POST Better Auth `/sign-in/notorganic` with `{code, verifier, origin}`. The backend validates origin against `trustedOrigins`, performs the gateway exchange using its own ES256 DPoP key, fetches authenticated `/v1/account`, and verifies DID, `product=twyne`, and integer session version. Profile fields are accepted only after this proof (`convex/auth.ts:37–80`; `convex/lib/providerLink.ts:21–65`; `convex/lib/notorganicSignIn.ts:29–73`).
5. The backend links provider `notorganic` / account ID DID to a Better Auth user, creates a session cookie, and returns the user, not gateway tokens. The browser refreshes `/get-session` with `disableCookieCache=true`, requiring issued `user.id == session.userId == refreshed user.id` and a nonempty session ID before navigation (`src/utils/notorganic-connect.ts:156–193`).
6. Install a Convex JWT and wait for the authenticated callback before starting sync. Token fetches are single-flight and discarded when auth generation changes (`src/utils/convex-token.ts:1–23`; `src/utils/auth-context.tsx:171–250`). A sign-in receipt alone does not prove an installed, accepted Convex token.

### Native callback capability, currently unavailable by default

The current Not Organic public-client validator accepts exact HTTPS origins with same-origin HTTPS callbacks, or HTTP loopback origins/callbacks. Its only custom-scheme exception is **Keating**, not Twyne (`../notorganic-provider/apps/portal/server/public-client.ts:19–84`, relative to the Twyne repo's parent). There is no current `twyne://` registration.

There are **two** required approvals for native loopback:

- Twyne must explicitly trust the exact scheme/host/port. `convex/auth.ts:108–135` permits configured origins and same-port loopback aliases; it does not authorize arbitrary ephemeral ports. Redemption still fixes `/auth/notorganic/`.
- Not Organic must explicitly map that client origin to product **Twyne**. Unconfigured loopback currently maps to **Keating**, whereas fixed production Twyne origins map to Twyne (`../notorganic-provider/apps/gateway/src/public-client-product.ts:5–39`). Sending a `product=twyne` query parameter does not approve an integration. Without this mapping, Twyne's server-side cross-product check fails.

A fixed, operator-approved loopback origin could use the existing HTTP contracts after a secure listener/router is implemented. An arbitrary dynamic port, claimed production HTTPS origin, or new custom scheme needs coordinated registration/backend changes first. The offline validator must fail closed. HTTPS ownership and OS deep-link registration are not established by accepting a string.

Not Organic additionally supports optional `device_session=true`, a 30-day rotating opaque refresh credential, five-minute DPoP access tokens, `/v1/public/device/token`, and `/v1/public/device/revoke` (`apps/gateway/src/auth.ts:31,231–305`; `apps/gateway/src/app.ts:313–427`). Current Twyne redemption does **not** request or retain these device credentials. They do not automatically create a Twyne Better Auth session or a Convex JWT. This first native slice must not introduce a second gateway credential lifecycle.

### Cookie and JWT transport

The installed Better Auth cross-domain client stores cookie-jar JSON in browser local storage `better-auth_cookie`, with cached session data in `better-auth_session_data`. It sends `Better-Auth-Cookie` and receives `Set-Better-Auth-Cookie`, using `credentials=omit`; the server converts those headers to/from cookies (`node_modules/@convex-dev/better-auth/dist/plugins/cross-domain/client.js:33–50,123–205`; `.../cross-domain/index.js:55–74,117–130`). Native must implement a protected cookie jar and expiry handling; copying browser storage or logging these values is not an integration.

The installed Convex plugin defaults JWT expiry to 15 minutes, issuer to `CONVEX_SITE_URL`, audience to `convex`, and includes session ID (`.../plugins/convex/index.js:43–65`). GET `/api/auth/convex/token` is session-authenticated (`...:395–433`); `convex/http.ts:58` registers the auth routes. LSP relay auth separately expects the Better Auth cookie/header, not merely a Convex JWT (`convex/http.ts:15–38,293–343`; `src/utils/lix-auth.ts:14–52`). Provider DPoP, Better Auth session, and Convex JWT must remain distinct credential types. This inventory does not attest current live cookie or token configuration.

## Account-owned library protocol

`convex/sync.ts:607–690,937–1057` exposes `sync:pushAll` and `sync:pullAll`, scoped exclusively by authenticated `tokenIdentifier`. No caller-supplied owner belongs in their payload.

`pullAll({})` always returns an object, including for an empty account:

| Section | Pull shape / replacement policy |
| --- | --- |
| `syncRevision` | Nonnegative account-wide head, initially 0 |
| `briefs` | `{folioId, brief, updatedAt}[]`, plus separate `legacyBrief` and `legacyBriefUpdatedAt` |
| `folios` | Whole catalog of source Folio objects; separate `foliosUpdatedAt` |
| `folioContent` | `{folioId, html, format?, typstSource?, updatedAt}[]` |
| `customPersonas` | Array or **null** (no record), not interchangeable with an empty array; separate timestamp |
| `personaNotes` | `noteId`, optional legacy folio ID, persona metadata, feedback, optional trace/anchor/brief title, created timestamp |
| `personaReplies` | `replyId`, note ID, optional legacy folio ID, author/kind, optional persona ID, text, created timestamp |
| `rubricResults` | `{folioId?, result, updatedAt}[]` |
| `bibliography` | Whole array plus separate timestamp |

`pushAll` takes optional `expectedRevision`, optional changed sections, and explicit removal lists. Missing/omitted means **leave unchanged**, whereas `folios=[]`, `customPersonas=[]`, and `bibliography=[]` clear their collections. Row sections only upsert changed rows; explicit `removedBriefFolioIds`, `removedFolioContentIds`, `removedPersonaNoteIds`, `removedPersonaReplyIds`, `removedRubricFolioIds` delete rows. Content uploads omit local `updatedAt`; the server stamps it. Existing canonical Typst content cannot be replaced by an HTML-only client omitting `typstSource` (`convex/sync.ts:133–171,607–665`; `src/utils/convex-sync.ts:624–813`).

The mutation checks the head **before writes**. A mismatch throws `ConvexError` data `{code:"SYNC_CONFLICT", message:"This workspace changed on another device.", expectedRevision, currentRevision}`. Successful mutation increments the head and returns `{ok:true, syncedAt, revision}`. There is no operation ID/idempotency key. A response lost after server commit requires a pull; retransmission is not an acknowledged success. Direct section setters elsewhere in `convex/sync.ts` do not update this head, so the head alone does not detect every possible writer. Native should use `pushAll` and compare exact observed snapshots until the backend revision contract is unified.

`convex/lib/collections.ts:123–207` preserves v.any item fields, maintains ordering, uses item string ID (fallback index ID otherwise), and replaces/deletes whole collection entries. Aggregate timestamps are max remaining row timestamps; an empty collection has timestamp 0. This is not a per-item tombstone log.

### Current browser offline and conflict behavior

- IndexedDB database `twyne` v4 holds the local library **without account partitioning** (`src/utils/idb.ts:1–90`). Local editor writes debounce 400 ms; departure/crash mirrors and IDB acknowledgements are independent of cloud acknowledgements (`src/routes/editor/index.tsx:360–416`; `src/utils/idb.ts:536–681`). Source and its projection are saved together. Source bytes must not be regenerated from HTML simply to upload.
- The main cloud synchronizer debounces 4 seconds, caches unchanged sections, serializes pushes, and diffs against the **last successful acknowledgement**, not attempted pushes. Failed pushes restore dirty sections (`src/utils/convex-sync.ts:226,471–620,715–875`). Dirty flags, acknowledged baseline, server head, and deletion intent are in memory, not a durable network outbox.
- Sign-out clears cloud context and keeps local manuscripts. A sign-in to an empty remote account can upload the current device library automatically; signing into a nonempty account merges it with the same unpartitioned cache. The `twyne:signed-up-once` marker contains a Better Auth user ID, not an account-specific database (`...:307–389,892–958`). This can attach a previous account's retained device work to another account. A native adapter should require an explicit library association and keep account partitions separate.
- `online`/`offline` listeners in the main synchronizer only notify status; they do not independently schedule a retry (`...:883–889`). Persisted content is not equivalent to a durable transmission queue.
- Clean reactive pulls replace authoritative remote sections and remove missing local rows; dirty/pushing devices defer reactive replacement to the CAS path (`...:960–1128`).
- On CAS conflict the browser pulls, merges, resets the acknowledged baseline, and retries. This is **timestamp/whole-value merging**, not collaborative CRDT reconciliation (`...:1130–1314`). Exact policies: newer remote dossier/content wins; whole remote folio catalog wins if its aggregate timestamp beats max local folio timestamp; remote notes/replies replace each represented folio's entire group; rubric uses newer result timestamp; bibliography unions IDs and prefers newer-or-equal remote timestamps. Custom persona local time currently comes from `Date.now()` (`...:1321–1323`). Conflict merge lacks the clean replacement path's deletion mirroring.
- The main push and queued remote chain do not consistently recheck auth generation after every await. Cross-account late completion is a **source-level risk inference**, not a demonstrated account incident. The native slice must bind every plan/receipt to account plus a unique active-session lease.
- Pending Source drafts are independently preserved: a differing remote base sets conflict and does not discard pending source; unsaved visual edits also become a recoverable conflict (`src/utils/typst/session.ts:315–345`). Native must check pending Source and active manuscript revision before applying a remote projection.

The native first slice retains the existing wire/CAS protocol while staging divergent values explicitly, including deletion-versus-edit conflicts. Its preservation-first three-way reducer is an intentional native policy; it must **not** be described as the browser's exact timestamp merge, Lix compatibility, or live sync.

## Separate queues and preferences

House is not a `pushAll` section. `src/utils/house-sync.ts:13–29,40–233` uses whole-house timestamp winners (local wins equal timestamps), ledger ID union, account-keyed acknowledgement metadata `house-sync-acknowledgements:${accountId}`, and batches at most 200 ledger entries. It retains unacknowledged ledger history beyond the display window and rechecks teardown/client/local revision after awaits. `convex/house.ts:106–243` bounds snapshots to 1,000 collection/member/charter rows and newest 200 query ledger rows; snapshot upload uses incoming timestamp >= existing. A newest-200 query is not proof of all historical acknowledgements.

Usage is explicitly opt-in, with `account_choice_required` on account changes and separate attach-unsynchronized / keep-device-only decisions. Batches are 50; only returned offered keys are acknowledged (`src/utils/usage-sync.ts:35–219`). Do not transfer this opt-in to library sync or treat library sign-in as telemetry consent.

Appearance and room settings have separate server records (`convex/sync.ts:541–604`). Web Appearance writes local state first and best-effort uploads, retaining local state on failure (`src/routes/settings/index.tsx:612–642,800–821`). Neither is covered by `pushAll` head/outbox. Native preference stores' durable saved acknowledgements must stay truthful during future cloud failures.

## Sharing/collaboration boundary (separate implementation lane)

Sharing is Lix-blob collaboration, not the solo library protocol. Promotion requires an authenticated Pro account, captures mounted draft HTML, mirrors it into Lix, uploads its blob, and enables `lix_sync` against `${CONVEX_SITE_URL}/lsp` (`src/utils/collaboration.ts:31–95`; `convex/collaboration.ts:126–173`). The source delegates vector-clock synchronization to installed `@lix-js/sdk`; this audit did not verify SDK convergence or native-format compatibility.

Accepted owner/editor/commenter roles are checked server-side. Owner manages shares/invitations/roles; owner and editor may LSP push; commenter may read and publish presence but cannot push (`convex/collaboration.ts:68–82,477–589`; `convex/lixRelay.ts:35–230`). Relay `new-v1` is unsupported, missing auth is 401, absent role 403, busy push lock 409; LSP uses Better Auth session headers (`convex/http.ts:293–343`). Join installs the shared Lix as the app-wide singleton with a generation guard, rather than a second detached instance (`src/utils/collaboration.ts:113–239`; `src/utils/lix.ts:42–103`). Presence heartbeats are 3 seconds, stale threshold 30 seconds; cursor updates remain distinct from content ownership (`src/utils/collaboration.ts:24,252–312`).

Invitations are explicit external-email actions. Creation looks up Better Auth email and stores found raw `_id`, or normalized email for an unknown user; accept/pending lookups use canonical token identifier or authenticated email (`convex/collaboration.ts:175–232,349–446`). These key representations differ for an already-known user. New Not Organic users also have a hashed `@notorganic.invalid` placeholder email (`convex/lib/notorganicSignIn.ts:92–100`). Compatibility/migration must be tested before claiming invitations address arbitrary Not Organic handles. Do not implement an offline 'invited' success or send email during fixture tests.

## Publication and account departure

| Action | Current destination and authority |
| --- | --- |
| Twyne post / share link | `published:publish` stores sanitized HTML under authenticated owner; slug reads are **public, unauthenticated**, despite UI 'private share' wording. Admin gate is required for official blog status (`convex/published.ts:7,89–236`; `src/components/folio/folio-menu.tsx:390–519`) |
| AT Protocol | Independent PDS OAuth and `site.standard.*` publication/document records, with image blob scope. Separate publish/unpublish and best-effort OAuth revoke (`src/utils/atproto.ts:14–242`; `src/components/folio/folio-menu.tsx:525–630`; `src/utils/standard-site.ts`) |
| Micropub | Explicit endpoint/access token and HTML article export; external send on requested publish, token UI field cleared after success (`src/components/folio/folio-menu.tsx:634–664`; `src/utils/micropub.ts`) |
| Twyne sign-out | Clears Twyne session/sync context; retains device content and does not clear Not Organic portal or independent PDS sessions (`src/components/auth/auth-panel.tsx:88–91`; `src/utils/auth-context.tsx:240–250`) |
| Delete Twyne account | Explicit DELETE confirmation; resumable server purge, then best-effort Twyne sign-out. It is not deletion of the global Not Organic identity, retained local manuscripts, or PDS records (`src/routes/settings/index.tsx:1154–1205`; `convex/account.ts:315–409`) |

Offline library sync must not imply publication permission, collaboration ownership, email delivery, or account deletion completion. Those transports remain outside `native_accounts`.

## Native data and capacity incompatibilities

- Native Manuscript IDs are UUIDs, but source Folio IDs are arbitrary strings. `Manuscript::from_workspace` currently parses a UUID, and backup `import_copy` deliberately assigns a fresh UUID (`desktop/gpui/src/manuscript.rs:107–139`; `src/types/index.ts:729–741`). Account hydrate needs a durable remote-ID ↔ native-UUID mapping; ordinary portable import is not hydrate.
- Native `WorkspaceDocument` retains projection state, original import bytes, backup template, and unknown fields (`desktop/gpui/src/workspace.rs:388–475`). Current sync DTOs do not carry all of that metadata. Preserve local extensions independently and reject unsupported closed wire fields rather than silently stripping future content metadata. Cached HTML is not verified compilation or verified projection.
- Native Store uses durable local revision CAS, atomic fsynced writes/backups and an instance lock, but has no account/session/outbox partition (`desktop/gpui/src/storage.rs:18–307`). Native SourceSession separately guards pending/conflicting source drafts (`desktop/gpui/src/source_session.rs:1–136`). Root must coordinate actual local persistence/application receipts; the outbox itself cannot acknowledge a manuscript save.
- `folioContent` is currently one Convex document containing both source and HTML; the applicable Convex guideline caps a document at 1 MB. Native HTML can reach 32 MiB and the original converter limits source to 5,000,000 UTF-16 units. There is no current chunk/blob protocol for large cloud content. `pullAll` also uses account-wide unpaginated `.collect()` calls (`convex/sync.ts:952–995`). Native preflight must explicitly reject oversize cloud candidates and retain local work; server batching/storage/pagination is a separate backend change.

## Bounded native slice and integration requirements

The new files implement only:

1. Explicit callback registration/capability checks, Source-shaped PKCE authorization request, one-shot callback consumption, same-user issued/refreshed-session receipt checks, and account/session lease binding. Caller-supplied CSPRNG entropy is required. No browser launch, listener, credential vault, token verification, code redemption, cookie handling, or installed-token acknowledgement is supplied.
2. Source-compatible whole/row section diff and omitted-versus-empty semantics, expected head CAS, ACK-only baseline, exact source preservation, conservative cloud content preflight, and durable latest-intent outbox with distinct in-flight/unknown-outcome/conflict state.
3. Account-specific atomic store and exact-value/local-generation CAS; backup recovery with warnings; unknown envelope metadata retained; future versions rejected. Remote pulls are **staged**. A same-account/current-lease, same-local-generation, exact staged payload receipt is required before accepting an application. This receipt is a coordinator contract, not proof that this module saved the live manuscript.
4. Three-way conflict records retain base/local/remote including deletion. Explicit resolution preserves the account's server baseline and queues remaining local intent. Durable remote-ID mapping is available but does not import a live folio.

The unapplied `integration.patch` exports the module only under `desktop`, which already enables its existing SHA-256/base64 dependencies. Root must independently review and apply it. There are no new dependency proposals.

Required next integration: protected native Better Auth cookie/session vault; a registered callback listener/router and external-browser lifecycle; authenticated HTTP/Convex transport with cancellation and same-lease completion checks; accepted Convex JWT state distinct from sign-in; account-library association UI; two-phase local Store/Source preflight and staged application; acknowledgement/error UI backed by actual durable writes; startup/online/close retry boundaries; server oversized-content/pagination/idempotency decisions. Shared Lix, invitations, publication, provider settings, and account deletion remain separate capabilities.

## Acceptance and proof boundary

Prepared Rust tests cover callback origin/path/state/expiry/duplicate/error rejection, default native-registration refusal, Twyne-product approval, PKCE known vector, mismatched session receipts, original wire diff fixtures, local edits during an in-flight push, wrong-account/old-lease acknowledgements, unknown outcomes requiring pull, deletion/edit and pending-Source conflict staging, exact source/projection metadata, remote-ID mapping, store restart/backup/future-version/unknown-fields, failed write/retry, and concurrent same-base writers.

Source-backed web tests already exist at `src/utils/notorganic-connect.test.ts`, `src/utils/convex-sync.test.ts`, `src/utils/house-sync.test.ts`, and `src/utils/usage-sync.test.ts`; they are useful references, not connected native evidence. Execution status for the new slice is recorded in `README.md`/`handoff.json`. No live account, callback listener, credential storage, two-device sync, deletion propagation, role enforcement, sharing, publishing, or real provider/device proof is claimed by this handoff.
