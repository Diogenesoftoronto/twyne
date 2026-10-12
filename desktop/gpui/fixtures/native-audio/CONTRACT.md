# Native audio foundation contract

This is an unintegrated, audio-only foundation reviewed against the current Source. It does **not** complete `PORT_PLAN.md` row 25. No device implementation, synthesis, gateway connection, editor anchoring, permissions UI, or spoken-note/interview workflow is supplied.

## Authority and executed reference

Current authorities are `src/utils/{speech,speech-segments,speech-alignment,live-voice-audio,live-voice,live-voice-contract,browser-inference,personas,application-errors}.ts` and `src/types/application-errors.ts`. `generate-source-vectors.ts` executes the original segment/alignment/error helpers, private voice helpers extracted without alteration, original Worklet, and `liveVoiceAudio` with in-memory WebAudio/device stubs. Configuration/IDB dependencies of the private voice helpers are isolated stubs; no synthesis/account code runs. The produced `source-vectors.json` records the helper hashes and observed outputs; `resident_personas.json` contains the actual Source voice prose/IDs/overrides.

The Rust implementation covers the supplied corpus and adverse controller scenarios. Bun verifies reference freshness and actual helper behavior. These checks establish neither general ICU/locale parity nor provider/browser/device/UI acceptance.

## Requests, offsets, and observable state

- `SpeakRequest` retains `id/text/sourceOffset/voice/voices/instructions/label/author/progressive`. `voices: Option<BTreeMap<...>>` distinguishes absent from explicit `{}`: an empty map suppresses persona defaults. Native-only `generation` is excluded from serialization. Auth clients, sign-in eligibility, API keys, and delegation tokens are deliberately absent.
- `PersonaVoice` is a **voice-only projection**, not the full Cast/exchange DTO. `default_voice: Option<String>` retains an absent custom voice. Built-ins come from the executed Source fixture, including full direction prose. Match author to trimmed lowercase name or lowercase ID/role only; no invented aliases.
- All Source text offsets are **UTF-16 code units**, never Rust bytes/scalars. `slice_utf16` refuses an offset inside a surrogate pair. Segment intervals are half-open; Source alignment lookup retains its inclusive end behavior. Fish ranges are local to the exact clip text. Host must join them to the actual document/revision, submitted text, and source offset before native editor highlights.
- `segment_speech_text` ports Source's conservative fallback only. Main Source prefers `Intl.Segmenter`. Exact main-path chunks can enter via `speak_with_segments(request, Vec<SpeechTextSegment>)`, which verifies ordered exact UTF-16 slices. Progressive native `speak` uses the fallback and makes no Intl parity claim. Unbroken tokens may exceed the preferred cap, as in Source; provider text limits remain host responsibility.
- `SpeechState` uses Source status values and serializes `alignment: []` when empty. Live state adds actual Source `pending` and `sources`; action/source DTOs are retained data only. No proposals/actions are executed.
- `AudioAppError` uses actual Source code/source/recovery vocabulary and reviewed message defaults. It is a narrow safe adapter, not a full metadata exchange DTO: metadata is string-valued, known operation/feature values only, and references are process-local. Arbitrary provider/platform message, stack/body, reference, and metadata are not trusted at the transport boundary. There are no invented `DEVICE_ERROR` or `PLAYBACK_FELL_BEHIND` application codes. Private prose/configuration/platform details are omitted from `Debug`.

## Narration API and completion boundary

```rust
NativeSpeechTransport::new(&dyn AudioBackend) -> Result<Self, AudioAppError>
set_provider_configuration(Option<SpeechProviderConfig>) -> Result<(), AudioAppError>
speak(SpeakRequest) -> Result<(), AudioAppError>
speak_queue(Vec<SpeakRequest>, SpeakQueueOptions) -> Result<(), AudioAppError>
speak_with_segments(SpeakRequest, Vec<SpeechTextSegment>) -> Result<(), AudioAppError>
pending_load() -> Option<&SpeechLoadRequest>
load_clip_and_play(generation, CachedClip) -> Result<bool, AudioAppError>
on_playback_ended(generation) -> Result<bool, AudioAppError>
on_playback_error(generation, AudioAppError) -> bool
update_playback_clock(generation, seconds) -> bool
```

`SpeechProviderConfig` has configured provider **ID**, kind, model, display name, response format, speed, optional voice/instructions; no credentials. Configuration is absent until the host supplies an actually eligible route. Missing config yields `CONFIGURATION_ERROR`; no hosted/account availability is inferred. Convenience `set_provider_config(kind, model)` uses kind as identity and is unsuitable for account-isolated production configuration. Changing config cancels/clears the queue and cache. One host-owned controller is required; the module cannot impose app-wide exclusivity across independent instances.

A `SpeechLoadRequest` exposes exact generation, opaque key, submitted request, provider projection, and resolved voice. Host synthesizes/decodes outside this module and returns PCM with that **same key and generation**. Wrong-key, superseded, duplicate, and non-Loading completions return `false` before sounding or touching cache. Malformed format, empty clip, impossible timing, invalid precision, or non-boundary alignment is rejected. End/error/time callbacks also require the captured generation. Retry creates a new pending generation.

Pause/resume/seek/next/previous/revoice preserve Source queue semantics, including the >3-second Previous rule. Output errors stop before publishing Error; sink failures still require real platform cleanup proof. Public state carries intended display labels but diagnostic `Debug` does not print them.

`SpeechClipCache` uses Source identity inputs with length-delimited SHA-256 instead of private plaintext `::` keys. LRU is 24 entries with an additional 32 MiB PCM/WAV budget (alignment overhead is not included). Matching-generation removal prevents old work erasing current work. This is work bookkeeping, **not** a shared provider-promise/prefetch/billing deduplication implementation. Cache is memory-only; host must clear it on account/config changes.

## PCM and live lifecycle

`PcmFormat` checks sample rate 1..192000, channels 1..32, 16-bit frames, complete interleaved frames, and a 16 MiB PCM cap. RIFF parsing validates actual lengths/rates/alignment/chunks and accepts the exact empty Source unlock WAV. It does not decode provider MP3/Opus/AAC or stream MediaSource data.

`f32_to_i16` matches Source Worklet truncation: clamp, negative ×32768, positive ×32767. Playback divides **both signs by 32768**, preserving Source's positive peak. `LivePcmFramer` carries input and emits only full 2400-sample mono blocks at 24 kHz, with Source RMS. It never sends a partial final block. Silence helpers/mock output are synthetic test data, not synthesized narration.

```rust
NativeLiveVoiceSession::new() -> Self
start_session(&dyn AudioBackend, author, callback) -> Result<u64, AudioAppError>
// callback: FnMut(generation: u64, samples: &[i16], rms: f32) + Send
mark_session_started(generation, actual_started_at_ms: u64) -> bool
enqueue_assistant_audio_bytes(generation, &[u8]) -> Result<bool, AudioAppError>
enqueue_assistant_audio_samples(generation, &[i16]) -> Result<bool, AudioAppError>
update_input_level(generation, level) -> bool
update_transcripts(generation, user, assistant) -> bool
update_clock(generation, monotonic_seconds) -> bool
on_assistant_speech_ended(generation) -> bool
begin_close() -> Option<u64>
acknowledge_session_closed(generation) -> bool
stop_session()
```

`start_session` initializes only supplied audio objects and remains **Connecting**. The host must obtain actual provider `session.started` before arming capture with `mark_session_started`. Captured frames are suppressed before ACK, during mute, after close/stop, and across generations; mute/unmute also discards a held partial frame even when no callback arrives while muted. Host must check the generation again at its actual network-send boundary. Muting does not send zeros as a simulated live request.

`AudioSink::schedule_pcm` must append on **one monotonic output clock**; default unsupported backends refuse it. Start is max(actual output clock, queued end). The Source >5s guard checks queued lead before appending the next chunk. A first large chunk is not pre-rejected merely for duration; format/memory limits still apply. End of one chunk does not mark Listening while later chunks remain. Capture/sink construction failure, malformed audio, and lag error release both objects.

Close releases audio immediately and remains Closing until actual host receipt. Only `acknowledge_session_closed` marks finalized. Stop invalidates all old tokens. Transcripts are retained for display as Source does; the native 12000 UTF-16 cap keeps scalar boundaries instead of creating a lone surrogate. Connection/receipt deadlines, session auth/eligibility/budgets, WS/SSE, receipt settlement, proposal approval/revision guards, sources, and app mutual exclusion remain host work. Source starts Live by stopping narration; the two isolated native controllers do not perform that arbitration themselves.

## Unapplied integration

`integration.patch` only adds a guarded `native_audio` module and `native-audio = ["dep:sha2"]`, using already installed regex/serde/serde_json/sha2. No new cpal/hound dependency, lock update, mock runtime hook, or default feature activation. Parent owns review, application, Cargo checks and future physical/provider/UI adapters.
