# Dossier lifecycle and filing review

## Parent native gate update

The parent registered `dossier_conversation` and ran the desktop-library Dossier family: **58 passed, 0 failed**, including all ten new Source-backed conversation lifecycle checks. Compilation required the missing GPUI Kit `Sizable` and `Disableable` trait imports. See `../dossier-conversation/parent-gates.json` for the exact gate and source digests. This establishes compiled local lifecycle behavior; the conversation remains unmounted and provider/OS proof remains open. Worker handoff claims below are preserved as history.

This slice executes selected unchanged original Source callbacks and repairs the native conversation foundation. It does not connect a provider or mount the conversation. The existing manual Dossier form remains the offline surface.

## Executed evidence

`source-functions.ts` uses the TypeScript AST to select original declarations/initializers, removes only `export`, and executes them with explicit fake Qwik bindings, provider replies, IDB/mirrors and clock. The actual opening-task body is selected separately; pure probe helpers are imported directly. `source-vectors.json` retains SHA-256 provenance and 25 cases from:

- `src/components/onboarding/conversational-interview.tsx`: initialization 271–319, turns 331+, probe/retry/form 490–521, nudge 523, filing 536 and review 553.
- `src/utils/dossier-probes.ts`: ID-only upsert/readable answers.
- `src/utils/anti-tabula-rasa.ts`: construction, normalization, scoped save/readback/mirrors.
- Create/refine route completion callbacks, `dossier-filing.ts` actual 780 ms feedback and `brief-history.ts` full-brief comparison.

```sh
rtk proxy bun desktop/gpui/fixtures/dossier-host-review/generate.ts
rtk proxy bun test desktop/gpui/fixtures/dossier-host-review/source-contracts.test.ts
```

Observed: **8/8 pass, 56 expectations**. No network, provider, account, real IDB, disk durability or display proof. The fake configured-provider check proves callback branches, not provider routing/credentials. The full Qwik component/hydration lifecycle is not executed.

Three Source weaknesses are recorded accurately: late BYOK errors precede the version guard; repeated function completion calls rely on a disabled button; Refine without brief/scope returns without saving/ACK. Native refuses these cases.

## Native contract

One active generation is accepted; stale/duplicate completions and exhausted generations cannot mutate transcript/probes. Invalid/busy probe answers preserve the active probe. Upsert compares ID only. Nudge preserves the pending active probe without a writer bubble. Refine retains existing probes and Source string truthiness before normalization. Empty/wrong-field edits are rejected.

Filing requires an idle reviewed synthesis and exact nonempty Refine scope. Its full submission is immutable and history stays untouched. Only a matching explicit successful ACK archives the superseded existing brief. No recovery file is cleared in session/view.

```rust
filing_token() -> Option<u64>
filing_matches(token, &DossierSubmission) -> bool
acknowledge_filed(token) -> anyhow::Result<bool>
filing_failed(token) -> bool
```

False means stale/duplicate and is neutral. `ConversationMode::provider_mode()` maps native Create to Source `"first-run"`, Refine to `"refine"`; filing still uses `DossierMode`.

`hydrate_session_from_draft(&mut session, draft) -> Result<()>` validates first, retires AI/filing tokens, clears old synthesis/edit/error/active-probe state, and preserves exact form answers (including blanks), step, references, material, probes, attachments and unknown metadata. Draft extensions stay separate from brief extensions. Generation advances to prevent token reuse.

Ten new `native-lifecycle-tests.rs` regressions compare Source values and cover held/failed/retried filing, stale full-candidate ACKs, invalid hydration, rejected mutation neutrality and metadata. **Authored, not run in this review**; parent owns Cargo/native acceptance.

## Parent host sequence

1. Qualify emitting entity, exact folio/owner/surface visit, token and saved base revision before snapshotting the manuscript. No aliases.
2. Require `filing_matches(token, &submission)`. Run existing `dossier_filing::prepare_document` with the submission's actual mode/material, full original candidate validation, then `save_if_revision` CAS.
3. Failure goes only to that current request; retain review/recovery and the functional form.
4. Durable success must recheck receiver/scope/visit/token/full candidate before ACK. Only true ACK permits matching recovery cleanup. A reopened same-scope form can share the old recovery identity; identity alone is insufficient. A stale callback must not clear/navigate the replacement surface.
5. Source 780 ms filed feedback is separate from durable ACK; delayed navigation requires fresh guards too.

Qualify `SwitchToFormRequested`, project the full `DossierDraft`, persist at the owned recovery boundary and construct the form with that draft. Keep mode/owner/folio/base; reconstruct controlled inputs. Cancel retired conversation on host removal. Do not assign unscoped editions to an active folio. The unapplied module registration is `../dossier-conversation/INTEGRATION.patch`; shared host changes remain parent-owned.

## Remaining boundaries

Events retain `FilingRequested {token,submission}` and token-bearing Send/Probe/Retry/Synthesis requests; SwitchToForm/Cancelled/StartOver remain unit events. Basic buttons dispatch and error/retry renders. Default `can_generate=false` fails immediately with an unavailable-provider message, preserves writer input and emits no generation request. Mounting without a provider needs `can_switch_surface=true` and a real form-handoff consumer. Configured metadata alone must not enable generation.

Typed probe cards, inline review inputs, references, streaming/reasoning display, amendment durable host protocol, responsive/a11y/visual parity and providers are pending. Structured form recovery does not persist the full transcript/pending-input/confidence; that needs a separately scoped envelope. Hydration is a form-draft boundary; host should create a fresh conversation session for replacement surfaces. Rust starter/imported convenience copies are not universally JS-equivalent (multiple blank lines/trim); canonical filing must keep using the original semantic helper. No Source/shared app/editor files changed.
