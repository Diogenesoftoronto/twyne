# Dossier conversation foundation — frozen review handoff

The owned module is ready for parent registration/native checks, not a connected conversation release. No dependencies added. Source, shared app/form/editor, manifests and Cargo were not edited.

The current lifecycle/host contract and executed provenance are in [the host review](../dossier-host-review/README.md). Repairs:

- ID-only probe upsert; invalid/busy answers preserve the probe and retained answers.
- Exhausted generations refuse before mutation. Retry retains input without duplicate bubbles; nudge keeps the active probe without a writer bubble.
- Refine retains probes and Source truthiness fallback; blank/wrong-field review edits refuse.
- Hydration validates before replacing review/AI/filing state; complete form metadata and unknown answer/recovery fields survive.
- Filing freezes a full reviewed candidate and uses qualified ACK/failure. Only durable ACK archives the superseded brief; entire-brief comparison includes metadata. Absent scope is not a fake `new` folio.
- Basic native controls dispatch and error/retry renders. Default unconnected capability immediately fails honestly, retains input and emits no provider event. Host must supply manual-form handoff.

```rust
// Session
filing_token() -> Option<u64>
filing_matches(token: u64, submission: &DossierSubmission) -> bool
acknowledge_filed(token: u64) -> anyhow::Result<bool>
filing_failed(token: u64) -> bool
// View
receive_turn_result(token, result, window, cx) -> Result<bool>
acknowledge_filed(token, cx) -> Result<bool>
report_filing_error(token, error, cx) -> bool
// Seam
hydrate_session_from_draft(&mut session, draft) -> Result<()>
```

Turn completion returns true for accepted success; false for failure or stale input. Stale input is neutral. Session/view never clear recovery. Filing/generation event payloads stay token-qualified. `ConversationMode::provider_mode()` supplies Source wire mode.

Current review proof: original-Source corpus: 25 cases, Bun 8/8 PASS, 56 expectations. Ten new native regressions are registered in `mod.rs`. Owned Rust formatted with child traversal disabled. **No Cargo, Devenv, rustc, provider/account, durable host or display checks ran in this review.** Parent must run compilation/native/host acceptance.

Prior worker reported 23 in-module checks, 7 standalone checks, 6 Bun tests and cached-rlib view type check before these repairs. Those historical results do not validate current code.

Pending: real provider/cancellation; full conversation recovery; typed probe/inline review/reference controls; stream/reasoning; amendment durable host protocol; measured responsive/a11y/rendered parity. Rust document/protocol convenience copies have bounded fixtures, not universal Source equivalence. Canonical filing uses the original semantic helper and the offline form remains functional.
