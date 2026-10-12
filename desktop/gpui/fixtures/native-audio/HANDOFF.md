# Parent integration update

The optional `native-audio` feature and library export are integrated with the existing SHA2 dependency. The registered Cargo contract target now tests the integrated module: **18 pass** under locked offline/no-default-feature execution. See [integration-gates.json](integration-gates.json). The historical integration patch is superseded by this scoped integration. Strict aggregate Clippy and actual devices/providers/UI remain pending.

# Native audio repair handoff

Foundation repaired and frozen; **PORT_PLAN row 25 is not complete**. This supersedes the draft's claims of complete transport/full duplex, billing deduplication, complete correctness, and 9 Bun/17 Rust parity checks. No provider, physical device, permission UI, live gateway, editor-highlight, spoken-note, or interview acceptance was performed.

Ownership stayed within `src/native_audio/**` and `fixtures/native-audio/**`. No Cargo/Devenv, shared runtime/manifest/lock/backend/Source edit, dependency installation, credential lookup, network/provider call, device opening, user recording/playback, or math/Mermaid change. Owned generated `test_bin` was removed; the direct runner creates/removes its binaries under `/tmp`.

## Concrete repairs

- Removed arbitrary platform/provider error messages and private derived `Debug` output from state/requests/cache/backend. Errors use actual Source vocabulary and reviewed public copy; malformed injected references/metadata are normalized before transport state.
- Replaced plaintext delimiter cache keys with length-delimited SHA-256 over the same Source inputs; use configured provider ID, not provider kind. Old in-flight completion cannot clear a newer token. Account/config changes clear queue/cache. There is no provider promise/prefetch implementation or billing proof.
- Replaced invented resident voice instructions/overrides and aliases with executed Source persona metadata. Preserve explicit empty voice maps, absent custom voices, truthy provider overrides, exact Supertonic fallback, and original nine browser voices (no M5).
- Repaired Unicode byte-offset/panic paths using Source UTF-16 slices, exact conservative fallback segmentation, and a validated actual-Intl input seam. Added exact Fish repeated-quote/normalization/offset mapping. Invalid live timestamps/native surrogate boundaries are refused.
- Corrected positive PCM playback divisor to 32768 and Worklet quantization to truncation. Carry only full 2400-sample input frames; discard partial audio across mute and stop. Tightened PCM/WAV bounds, channel/frame/rate/RIFF checks and retained the actual Source empty unlock WAV.
- Replaced live chunk replacement with required monotonic append scheduling. Keep Connecting until actual provider-start ACK, require tokens on callbacks/completions, wait for all queued chunks, release capture+output on errors/close, and finalize only actual close receipt. Mock capture callbacks run outside the mutex and cannot resurrect after reentrant stop.

## Evidence actually run

```sh
rtk proxy bun desktop/gpui/fixtures/native-audio/generate-source-vectors.ts
rtk proxy bun test desktop/gpui/fixtures/native-audio/adapter.test.ts
rtk proxy bun desktop/gpui/fixtures/native-audio/run-rust.ts
rtk proxy git apply --check desktop/gpui/fixtures/native-audio/integration.patch
```

- Executed unmodified Source segment/alignment/error/private voice helpers and exact Worklet/liveVoiceAudio with in-memory configuration/IDB/WebAudio/device stubs. Corpus: 9 Unicode segment cases (actual Intl and Source fallback), 5 voice/presence cases, 3 Fish alignment cases, 13 quantization edge values, partial framing and actual append timing. Source helper hashes recorded in `source-vectors.json`. No provider/device/app calls.
- Bun: **6/6 tests, 109 assertions**. Actual Source helper freshness, resident prose/overrides, UTF-16 segment/alignment behavior, bounded proposal parsing, and safe error normalization.
- Direct Rust 1.95 + already cached serde/serde_json/regex/sha2: **18/18 tests** and module compilation with **`-Dwarnings`**. Source-produced vector comparison plus wrong-key/duplicate/stale callbacks, retained obsolete capture handlers, muted partial recovery, bad PCM/WAV/alignment, cache collision/privacy, device construction/capture failure, reentrant stop, close ACK, queued output, and caption/drop cleanup. Tests use synthetic objects exclusively.
- Scoped rustfmt passed. Integration patch `git apply --check` passed and remains **unapplied**. No Cargo or Clippy claim. Runner requires cached compiler-compatible rlibs; `NATIVE_AUDIO_RUSTC` can select another existing compiler. It never installs/rebuilds dependencies or modifies shared artifacts.

## Parent integration boundary

Read `CONTRACT.md` for concrete signatures and behavioral differences. Proposed patch only registers the optional module and existing SHA2 dependency feature. It deliberately drops the draft's cpal/hound additions and mock app hookup.

Root must supply actual eligible synthesis/decoding and platform adapters, one shared narration instance, explicit user/device consent, current account/scope/revision cancellation, Live↔narration arbitration, actual start/close receipts, generation recheck at send boundaries, safe provider errors, budget/auth/DPoP/WS flow, consent/UI recovery, and undoable speech proposal actions. Media codecs, streaming audio, real seek/output timing, cached alignment/editor highlight joins, browser gesture semantics and physical devices remain unproven.

Exact verified Unicode corpus is not all-locale ICU parity. The native fallback is named as such; actual Source Intl chunks are supported via the host seam. Native validation is stricter for nonfinite provider offsets/unsupported audio, cache digests and memory budget are local improvements, and the caption cap preserves Unicode scalars. `AudioAppError` is a limited safe string-metadata adapter, not complete Source error/exchange preservation.
