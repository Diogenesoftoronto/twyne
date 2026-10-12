//! Source-produced vector checks plus adverse completion/capture/cleanup scenarios.
//! Synthetic objects only: never opens devices, providers, or the desktop UI.
#[allow(dead_code, unused_imports)]
#[cfg(not(feature = "native-audio"))]
#[path = "../../src/native_audio/mod.rs"]
mod native_audio;

#[cfg(feature = "native-audio")]
use twyne_desktop::native_audio;

use native_audio::backend::OnCaptureChunk;
use native_audio::*;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, LazyLock, Mutex},
};

fn vectors() -> &'static Value {
    static SOURCE: LazyLock<Value> =
        LazyLock::new(|| serde_json::from_str(include_str!("source-vectors.json")).unwrap());
    &SOURCE
}
fn configured() -> (NativeSpeechTransport, MockAudioSink) {
    let backend = MockLoopbackBackend::new();
    let mut transport = NativeSpeechTransport::new(&backend).unwrap();
    let sink = backend.last_sink.lock().unwrap().as_ref().unwrap().clone();
    transport
        .set_provider_configuration(Some(SpeechProviderConfig::new(
            "original/config-id",
            "openai",
            "tts-1",
        )))
        .unwrap();
    (transport, sink)
}
fn pending_clip(transport: &NativeSpeechTransport) -> CachedClip {
    CachedClip {
        key: transport.pending_load().unwrap().key.clone(),
        format: PcmFormat::live_default(),
        samples: vec![123; 24_000],
        wav_bytes: vec![],
        alignment: None,
    }
}
fn sample_vec(value: &Value) -> Vec<i16> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap() as i16)
        .collect()
}

#[test]
fn exact_source_fallback_and_supplied_intl_utf16_chunks() {
    for row in vectors()["segmentation"].as_array().unwrap() {
        let source = row["source"].as_str().unwrap();
        let expected: Vec<SpeechTextSegment> =
            serde_json::from_value(row["sourceFallback"].clone()).unwrap();
        let options = serde_json::from_value(row["options"].clone()).unwrap();
        assert_eq!(
            segment_speech_text(source, options),
            expected,
            "{}",
            row["id"]
        );
        let intl: Vec<SpeechTextSegment> =
            serde_json::from_value(row["sourceIntl"].clone()).unwrap();
        assert!(validate_source_segments(source, &intl));
        for segment in intl {
            assert_eq!(
                slice_utf16(source, segment.start, segment.end),
                Some(segment.text.as_str())
            );
        }
    }
    let source = "😀 identical. 😀 identical.";
    assert!(slice_utf16(source, 1, 2).is_none());
    assert!(!validate_source_segments(
        source,
        &[SpeechTextSegment {
            text: "😀".into(),
            start: 0,
            end: 1
        }]
    ));
    let (mut transport, _) = configured();
    let row = &vectors()["segmentation"][0];
    let segments: Vec<SpeechTextSegment> =
        serde_json::from_value(row["sourceIntl"].clone()).unwrap();
    let expected = segments[0].start + 101;
    transport
        .speak_with_segments(
            SpeakRequest::new("folio", row["source"].as_str().unwrap()).with_source_offset(101),
            segments,
        )
        .unwrap();
    assert_eq!(transport.current_speech_source_offset(), Some(expected));
}

#[test]
fn original_persona_prose_presence_and_voice_selection() {
    let cast = default_personas();
    assert_eq!(serde_json::to_value(&cast).unwrap(), vectors()["personas"]);
    for row in vectors()["voiceCases"].as_array().unwrap() {
        let request: SpeakRequest = serde_json::from_value(row["request"].clone()).unwrap();
        let expected: SpeakRequest = serde_json::from_value(row["enriched"].clone()).unwrap();
        let enriched = with_persona_voice(&request, &cast);
        assert_eq!(enriched, expected, "{}", row["id"]);
        let map = enriched.voices.clone().unwrap_or_default();
        for kind in ["openai", "fishaudio", "supertonic"] {
            let selected = pick_voice_for_provider(&map, enriched.voice.as_deref(), Some(kind));
            let selected = if kind == "supertonic" {
                Some(resolve_supertonic_voice(selected.as_deref(), "F1"))
            } else {
                selected
            };
            assert_eq!(
                serde_json::to_value(selected).unwrap(),
                row["selected"][kind]
            );
        }
    }
    assert!(
        with_persona_voice(
            &SpeakRequest::new("n", "text").with_author("Marguerite"),
            &cast
        )
        .voice
        .is_none()
    );
    let mut explicit = SpeakRequest::new("n", "text").with_author(&cast[0].name);
    explicit.voices = Some(BTreeMap::new());
    assert_eq!(
        with_persona_voice(&explicit, &cast).voices,
        Some(BTreeMap::new())
    );
}

#[test]
fn source_voice_menus_and_supertonic_configuration_fallback() {
    let (mut transport, _) = configured();
    transport
        .set_provider_configuration(Some(SpeechProviderConfig::new(
            "browser",
            "supertonic",
            "supertonic-tts",
        )))
        .unwrap();
    transport
        .speak(SpeakRequest::new("n", "ordinary prose"))
        .unwrap();
    let menu = transport.current_speech_voice_menu().unwrap();
    let actual: Vec<_> = menu.options.iter().map(|v| v.id.as_str()).collect();
    for id in vectors()["browserVoices"].as_array().unwrap() {
        assert!(actual.contains(&id.as_str().unwrap()));
    }
    assert!(!actual.contains(&"M5"));
    assert!(!menu.allows_custom);
    let mut config = SpeechProviderConfig::new("browser", "supertonic", "supertonic-tts");
    config.voice = Some("alloy".into());
    transport.set_provider_configuration(Some(config)).unwrap();
    transport
        .speak(SpeakRequest::new("n", "ordinary prose"))
        .unwrap();
    assert_eq!(transport.pending_load().unwrap().voice, "alloy"); // Source maps request voice, not feature fallback.
    transport.stop_speech().unwrap();
    assert!(transport.current_speech_voice_menu().is_none());
}

#[test]
fn fish_alignment_uses_exact_repeated_utf16_source_ranges() {
    for row in vectors()["alignment"].as_array().unwrap() {
        let event: FishTimestampEvent = serde_json::from_value(row["event"].clone()).unwrap();
        let ranges = map_fish_timestamp_event(
            row["source"].as_str().unwrap(),
            &event,
            row["sourceStart"].as_u64().unwrap() as usize,
        );
        let expected: Vec<SpeechAlignmentRange> =
            serde_json::from_value(row["ranges"].clone()).unwrap();
        assert_eq!(ranges, expected);
        for check in row["times"].as_array().unwrap() {
            let range = alignment_range_at_time(&ranges, check["seconds"].as_f64().unwrap());
            let index = range
                .map(|r| ranges.iter().position(|v| std::ptr::eq(v, r)).unwrap() as i64)
                .unwrap_or(-1);
            assert_eq!(index, check["index"].as_i64().unwrap());
        }
        for check in row["offsets"].as_array().unwrap() {
            let range = alignment_range_at_source_offset(
                &ranges,
                check["offset"].as_u64().unwrap() as usize,
            );
            let index = range
                .map(|r| ranges.iter().position(|v| std::ptr::eq(v, r)).unwrap() as i64)
                .unwrap_or(-1);
            assert_eq!(index, check["index"].as_i64().unwrap());
        }
    }
    let invalid:FishTimestampEvent=serde_json::from_value(json!({"content":"A","chunk_audio_offset_sec":"Infinity","alignment":{"segments":[{"text":"A","start":0,"end":1}]}})).unwrap();
    assert!(map_fish_timestamp_event("A", &invalid, 0).is_empty()); // Native rejects impossible playback timestamps.
}

#[test]
fn pcm_quantization_playback_and_rms_match_executed_source_worklet() {
    let vector = &vectors()["pcm"];
    let inputs: Vec<_> = vector["input"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap() as f32)
        .collect();
    let expected = sample_vec(&vector["quantized"]);
    assert_eq!(
        inputs.into_iter().map(f32_to_i16).collect::<Vec<_>>(),
        expected
    );
    let playback: Vec<_> = expected.iter().map(|&v| i16_to_f32(v) as f64).collect();
    let expected_playback: Vec<f64> = serde_json::from_value(vector["playback"].clone()).unwrap();
    assert_eq!(playback, expected_playback);
    let mut chunk = expected;
    chunk.resize(LIVE_CHUNK_SAMPLES, 0);
    assert!((calculate_rms_level(&chunk) as f64 - vector["level"].as_f64().unwrap()).abs() < 1e-7);
    assert_eq!(vector["chunkBytes"], json!(LIVE_CHUNK_BYTES));
}

#[test]
fn framing_carries_partial_blocks_and_does_not_flush_unfinished_audio() {
    let mut framer = LivePcmFramer::default();
    let mut frames = Vec::new();
    framer.push(&vec![10; 777], |frame, _| frames.push(frame.to_vec()));
    assert!(frames.is_empty());
    framer.push(&vec![20; 1623], |frame, _| frames.push(frame.to_vec()));
    assert_eq!(frames.len(), 1);
    assert_eq!(&frames[0][..777], &vec![10; 777]);
    assert_eq!(frames[0][777], 20);
    framer.push(&[33; 21], |_, _| panic!("partial block escaped"));
    assert_eq!(framer.pending_samples(), 21);
    framer.reset();
    assert_eq!(framer.pending_samples(), 0);
}

#[test]
fn original_unlock_wav_and_malformed_frame_boundaries() {
    let silence: Vec<u8> = vectors()["silenceWav"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_u64().unwrap() as u8)
        .collect();
    let (format, samples) = decode_wav_bytes(&silence).unwrap();
    assert_eq!(format, PcmFormat::tts_narration(44_100));
    assert!(samples.is_empty());
    assert_eq!(encode_wav_bytes(format, &[]).unwrap(), silence);
    for bytes in [vec![], vec![0], vec![1, 2, 3]] {
        assert!(pcm_bytes_to_i16(&bytes).is_err());
    }
    let samples = [-32768, 32767, -1, 0];
    let wav = encode_wav_bytes(PcmFormat::cd_quality(), &samples).unwrap();
    assert_eq!(decode_wav_bytes(&wav).unwrap().1, samples);
    assert!(
        encode_wav_bytes(
            PcmFormat {
                channels: 0,
                ..format
            },
            &[]
        )
        .is_err()
    );
    assert!(encode_wav_bytes(PcmFormat::cd_quality(), &[1]).is_err());
    for (range, replacement) in [
        (22..24, vec![0, 0]),
        (28..32, vec![0, 0, 0, 0]),
        (4..8, vec![1, 0, 0, 0]),
        (34..36, vec![8, 0]),
    ] {
        let mut corrupt = wav.clone();
        corrupt[range].copy_from_slice(&replacement);
        assert!(decode_wav_bytes(&corrupt).is_err());
    }
    let mut oversized = wav.clone();
    oversized[40..44].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(decode_wav_bytes(&oversized).is_err());
    assert!(
        PcmFormat::live_default()
            .validate(native_audio::pcm::MAX_PCM_BYTES / 2 + 1)
            .is_err()
    );
}

#[test]
fn private_errors_and_debug_output_never_echo_credentials_or_manuscript() {
    let secret = "Authorization: Bearer private-token; PRIVATE MANUSCRIPT";
    for raw in [
        AudioBackendError::PermissionDenied(secret.into()),
        AudioBackendError::Internal(secret.into()),
    ] {
        assert!(!format!("{raw:?}").contains(secret));
        let safe = raw.to_app_error(secret);
        assert!(
            !serde_json::to_string(&safe)
                .unwrap()
                .contains("private-token")
        );
    }
    let mut error = AudioAppError::new("PROVIDER_ERROR", secret, "provider");
    error.message = secret.into();
    error.reference_id = secret.into();
    error.metadata.insert("authorization".into(), secret.into());
    let (mut transport, _) = configured();
    transport
        .speak(SpeakRequest::new("private-id", secret))
        .unwrap();
    let token = transport.generation();
    transport.on_playback_error(token, error);
    let public = serde_json::to_string(transport.speech_state()).unwrap();
    assert!(!public.contains("private-token"));
    assert!(!format!("{:?}", transport.speech_state()).contains("private-id"));
    assert!(!format!("{:?}", SpeakRequest::new(secret, secret)).contains("private-token"));
    assert!(
        !format!(
            "{:?}",
            LiveVoiceState {
                user_transcript: secret.into(),
                ..Default::default()
            }
        )
        .contains("private-token")
    );
}

#[test]
fn cache_identity_is_private_unambiguous_and_old_work_cannot_erase_new_work() {
    let secret = "private manuscript text";
    let key = compute_cache_key(
        "account-provider-id",
        "tts",
        "alloy",
        "mp3",
        None,
        Some(secret),
        secret,
    );
    assert_eq!(key.len(), 64);
    assert!(!key.contains("private"));
    assert_ne!(
        compute_cache_key("a::b", "c", "v", "mp3", None, None, "t"),
        compute_cache_key("a", "b::c", "v", "mp3", None, None, "t")
    );
    assert_ne!(
        key,
        compute_cache_key(
            "another-provider-id",
            "tts",
            "alloy",
            "mp3",
            None,
            Some(secret),
            secret
        )
    );
    let mut cache = SpeechClipCache::new(2);
    assert!(cache.begin_in_flight(&key, 1));
    cache.cancel_in_flight(1);
    assert!(cache.begin_in_flight(&key, 2));
    assert!(!cache.finish_in_flight(&key, 1));
    assert!(cache.is_in_flight(&key));
    assert!(cache.finish_in_flight(&key, 2));
    for name in ["a", "b"] {
        cache.insert(CachedClip {
            key: name.into(),
            format: PcmFormat::live_default(),
            samples: vec![1],
            wav_bytes: vec![],
            alignment: None,
        });
    }
    assert!(cache.get("a").is_some());
    cache.insert(CachedClip {
        key: "c".into(),
        format: PcmFormat::live_default(),
        samples: vec![1],
        wav_bytes: vec![],
        alignment: None,
    });
    assert!(!cache.contains("b"));
    assert!(cache.contains("a"));
}

#[test]
fn absent_configuration_is_an_error_not_an_invented_hosted_voice() {
    let backend = MockLoopbackBackend::new();
    let mut transport = NativeSpeechTransport::new(&backend).unwrap();
    transport
        .speak(SpeakRequest::new("blank", "\u{feff} \t"))
        .unwrap();
    assert_eq!(transport.speech_state().status, SpeechStatus::Idle);
    let error = transport
        .speak(SpeakRequest::new("n", "A real passage."))
        .unwrap_err();
    assert_eq!(error.code, "CONFIGURATION_ERROR");
    assert_eq!(transport.speech_state().status, SpeechStatus::Error);
    assert_eq!(
        serde_json::to_value(SpeechState::default()).unwrap()["alignment"],
        json!([])
    );
    assert_eq!(
        serde_json::to_value(LiveVoiceState::default()).unwrap()["pending"],
        Value::Null
    );
}

#[test]
fn completion_identity_stale_callbacks_and_retry_are_neutral() {
    let (mut transport, sink) = configured();
    transport
        .speak(SpeakRequest::new("one", "First passage."))
        .unwrap();
    let old = transport.generation();
    let old_clip = pending_clip(&transport);
    transport
        .speak(SpeakRequest::new("two", "Second passage."))
        .unwrap();
    let current = transport.generation();
    assert!(!transport.load_clip_and_play(old, old_clip).unwrap());
    let mut wrong = pending_clip(&transport);
    wrong.key = "wrong".into();
    assert!(!transport.load_clip_and_play(current, wrong).unwrap());
    assert_eq!(sink.play_count(), 0);
    let clip = pending_clip(&transport);
    assert!(transport.load_clip_and_play(current, clip.clone()).unwrap());
    assert!(!transport.load_clip_and_play(current, clip).unwrap());
    assert_eq!(sink.play_count(), 1);
    assert!(!transport.on_playback_ended(old).unwrap());
    assert!(!transport.on_playback_error(old, AudioAppError::provider_error("late", "synthesize")));
    assert!(!transport.update_playback_clock(old, 99.0));
    assert_eq!(transport.speech_state().id.as_deref(), Some("two"));
    transport.on_playback_error(
        current,
        AudioAppError::provider_error("failure", "synthesize"),
    );
    assert!(sink.is_stopped());
    transport.clear_cache();
    transport.retry_speech().unwrap();
    assert!(transport.pending_load().is_some());
}

#[test]
fn malformed_alignment_and_device_resume_failure_stop_audio() {
    let (mut transport, sink) = configured();
    transport.speak(SpeakRequest::new("n", "😀 prose")).unwrap();
    let token = transport.generation();
    let mut malformed = pending_clip(&transport);
    malformed.alignment = Some(SpeechAlignmentSnapshot::new(
        "fishaudio",
        vec![SpeechAlignmentRange {
            source_start: 1,
            source_end: 2,
            audio_start: 0.0,
            audio_end: 1.0,
            precision: "word".into(),
        }],
    ));
    assert!(transport.load_clip_and_play(token, malformed).is_err());
    assert_eq!(sink.play_count(), 0);
    transport.retry_speech().unwrap();
    let token = transport.generation();
    let clip = pending_clip(&transport);
    transport.load_clip_and_play(token, clip).unwrap();
    transport.pause_speech();
    sink.inject_permission_denied(true);
    transport.resume_speech();
    assert_eq!(transport.speech_state().status, SpeechStatus::Error);
    assert!(sink.is_stopped());
}

#[test]
fn queue_navigation_uses_grace_pause_voice_restart_and_final_idle() {
    let (mut transport, sink) = configured();
    transport
        .speak_queue(
            vec![
                SpeakRequest::new("n", "First"),
                SpeakRequest::new("n", "Second"),
            ],
            SpeakQueueOptions {
                owner_id: Some("folio".into()),
                start_index: 0,
            },
        )
        .unwrap();
    let clip = pending_clip(&transport);
    transport
        .load_clip_and_play(transport.generation(), clip)
        .unwrap();
    transport.next_speech().unwrap();
    let clip = pending_clip(&transport);
    transport
        .load_clip_and_play(transport.generation(), clip)
        .unwrap();
    sink.step_time(0.5);
    transport.update_playback_clock(transport.generation(), 0.5);
    transport.previous_speech().unwrap();
    assert_eq!(transport.queue_index(), 0);
    transport.restart_speech_with_voice("cedar").unwrap();
    assert_eq!(transport.queue_length(), 2);
    assert_eq!(transport.pending_load().unwrap().voice, "cedar");
    assert_eq!(transport.speech_state().owner_id.as_deref(), Some("folio"));
    let clip = pending_clip(&transport);
    transport
        .load_clip_and_play(transport.generation(), clip)
        .unwrap();
    transport.next_speech().unwrap();
    let clip = pending_clip(&transport);
    transport
        .load_clip_and_play(transport.generation(), clip)
        .unwrap();
    transport.on_playback_ended(transport.generation()).unwrap();
    assert_eq!(transport.speech_state(), &SpeechState::default());
}

// Intentionally retains callbacks after stop: proves controller freshness rather
// than relying on a well-behaved mock dropping old callbacks.
#[derive(Clone, Default)]
struct RetainingBackend {
    callbacks: Arc<Mutex<Vec<OnCaptureChunk>>>,
    sink: MockAudioSink,
}
struct RetainingSource {
    callbacks: Arc<Mutex<Vec<OnCaptureChunk>>>,
}
impl AudioSource for RetainingSource {
    fn start_capture(
        &mut self,
        _: PcmFormat,
        callback: OnCaptureChunk,
    ) -> Result<(), AudioBackendError> {
        self.callbacks.lock().unwrap().push(callback);
        Ok(())
    }
    fn stop_capture(&mut self) -> Result<(), AudioBackendError> {
        Ok(())
    }
    fn set_muted(&mut self, _: bool) {}
    fn is_capturing(&self) -> bool {
        true
    }
    fn is_muted(&self) -> bool {
        false
    }
}
impl AudioBackend for RetainingBackend {
    fn create_sink(&self) -> Result<Box<dyn AudioSink>, AudioBackendError> {
        Ok(Box::new(self.sink.clone()))
    }
    fn create_source(&self) -> Result<Box<dyn AudioSource>, AudioBackendError> {
        Ok(Box::new(RetainingSource {
            callbacks: self.callbacks.clone(),
        }))
    }
}
#[test]
fn capture_requires_start_ack_and_drops_muted_partial_and_obsolete_frames() {
    let backend = RetainingBackend::default();
    let captured = Arc::new(Mutex::new(Vec::<(u64, Vec<i16>)>::new()));
    let mut session = NativeLiveVoiceSession::new();
    let held = captured.clone();
    let old = session
        .start_session(
            &backend,
            "Le Lecteur",
            Box::new(move |token, samples, _| held.lock().unwrap().push((token, samples.to_vec()))),
        )
        .unwrap();
    assert_eq!(session.state().status, LiveVoiceStatus::Connecting);
    backend.callbacks.lock().unwrap()[0](&[5; 2400], 1.0);
    assert!(captured.lock().unwrap().is_empty());
    assert!(session.mark_session_started(old, 1700000000000));
    backend.callbacks.lock().unwrap()[0](&[9; 1200], 1.0);
    session.set_muted(true);
    session.set_muted(false); // no device callback while muted
    backend.callbacks.lock().unwrap()[0](&[10; 1200], 1.0);
    assert!(captured.lock().unwrap().is_empty());
    backend.callbacks.lock().unwrap()[0](&[11; 1200], 1.0);
    assert_eq!(captured.lock().unwrap()[0].1[0], 10);
    let held = captured.clone();
    let current = session
        .start_session(
            &backend,
            "Le Lecteur",
            Box::new(move |token, samples, _| held.lock().unwrap().push((token, samples.to_vec()))),
        )
        .unwrap();
    session.mark_session_started(current, 1700000001000);
    backend.callbacks.lock().unwrap()[0](&[99; 2400], 1.0);
    assert_eq!(captured.lock().unwrap().len(), 1);
    backend.callbacks.lock().unwrap()[1](&[12; 2400], 1.0);
    assert_eq!(captured.lock().unwrap()[1].0, current);
    session.stop_session();
    backend.callbacks.lock().unwrap()[1](&[12; 2400], 1.0);
    assert_eq!(captured.lock().unwrap().len(), 2);
}

#[test]
fn live_output_appends_on_monotonic_clock_and_waits_for_all_chunks() {
    let backend = MockLoopbackBackend::new();
    let mut session = NativeLiveVoiceSession::new();
    let token = session
        .start_session(&backend, "Le Lecteur", Box::new(|_, _, _| {}))
        .unwrap();
    session.mark_session_started(token, 1700000000000);
    let sink = backend.last_sink.lock().unwrap().as_ref().unwrap().clone();
    sink.step_time(10.0);
    session
        .enqueue_assistant_audio_samples(token, &[1; 2400])
        .unwrap();
    session
        .enqueue_assistant_audio_samples(token, &[2; 2400])
        .unwrap();
    assert!((session.scheduled_playback_time() - 10.2).abs() < 1e-9);
    assert_eq!(sink.sample_count(), 4800); // Both scheduled chunks remain, not only the last one.
    sink.step_time(0.1);
    session.on_assistant_speech_ended(token);
    assert_eq!(session.state().status, LiveVoiceStatus::Speaking);
    sink.step_time(0.1 + 1e-9);
    session.on_assistant_speech_ended(token);
    assert_eq!(session.state().status, LiveVoiceStatus::Listening);
    let close = session.begin_close().unwrap();
    assert_eq!(session.state().status, LiveVoiceStatus::Closing);
    assert!(!session.state().finalized);
    assert!(session.acknowledge_session_closed(close));
    assert!(session.state().finalized);
    assert!(!session.enqueue_assistant_audio_bytes(token, &[1]).unwrap());
    assert!(!session.update_transcripts(token, "obsolete", "obsolete"));
}

#[test]
fn live_lag_and_invalid_pcm_release_both_objects_not_only_playback() {
    let backend = MockLoopbackBackend::new();
    let mut session = NativeLiveVoiceSession::new();
    let token = session
        .start_session(&backend, "Le Lecteur", Box::new(|_, _, _| {}))
        .unwrap();
    session.mark_session_started(token, 1700000000000);
    let source = backend
        .last_source
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .clone();
    let sink = backend.last_sink.lock().unwrap().as_ref().unwrap().clone();
    assert!(
        session
            .enqueue_assistant_audio_samples(token, &vec![1; 144_000])
            .unwrap()
    );
    assert!(
        session
            .enqueue_assistant_audio_samples(token, &[1; 2400])
            .is_err()
    );
    assert_eq!(session.state().status, LiveVoiceStatus::Error);
    assert!(!source.is_capturing());
    assert!(sink.is_stopped());
    let token = session
        .start_session(&backend, "Le Lecteur", Box::new(|_, _, _| {}))
        .unwrap();
    session.mark_session_started(token, 1700000001000);
    assert!(session.enqueue_assistant_audio_bytes(token, &[1]).is_err());
    assert_eq!(
        session.state().error,
        vectors()["pcm"]["oddError"].as_str().unwrap()
    );
}

struct FailingSinkBackend {
    source: MockAudioSource,
}
impl AudioBackend for FailingSinkBackend {
    fn create_sink(&self) -> Result<Box<dyn AudioSink>, AudioBackendError> {
        Err(AudioBackendError::Internal("private device token".into()))
    }
    fn create_source(&self) -> Result<Box<dyn AudioSource>, AudioBackendError> {
        Ok(Box::new(self.source.clone()))
    }
}
struct CaptureFailureBackend {
    source: MockAudioSource,
    sink: MockAudioSink,
}
impl AudioBackend for CaptureFailureBackend {
    fn create_sink(&self) -> Result<Box<dyn AudioSink>, AudioBackendError> {
        Ok(Box::new(self.sink.clone()))
    }
    fn create_source(&self) -> Result<Box<dyn AudioSource>, AudioBackendError> {
        Ok(Box::new(self.source.clone()))
    }
}
#[test]
fn startup_failure_is_error_and_reentrant_capture_stop_never_restores_callback() {
    let mut session = NativeLiveVoiceSession::new();
    let backend = FailingSinkBackend {
        source: MockAudioSource::new(),
    };
    assert!(
        session
            .start_session(&backend, "Le Lecteur", Box::new(|_, _, _| {}))
            .is_err()
    );
    assert_eq!(session.state().status, LiveVoiceStatus::Error);
    assert!(!backend.source.is_capturing());
    assert!(!session.state().error.contains("private"));
    let backend = CaptureFailureBackend {
        source: MockAudioSource::new(),
        sink: MockAudioSink::new(),
    };
    backend.source.inject_permission_denied(true);
    assert!(
        session
            .start_session(&backend, "Le Lecteur", Box::new(|_, _, _| {}))
            .is_err()
    );
    assert_eq!(session.state().status, LiveVoiceStatus::Error);
    assert!(!backend.source.is_capturing());
    assert!(backend.sink.is_stopped());
    let source = MockAudioSource::new();
    let mut owned = source.clone();
    let mut reentrant = source.clone();
    owned
        .start_capture(
            PcmFormat::live_default(),
            Box::new(move |_, _| {
                reentrant.stop_capture().unwrap();
            }),
        )
        .unwrap();
    source.emit_chunk(&[1; 2400]);
    assert!(!source.is_capturing());
    source.emit_chunk(&[1; 2400]);
}

#[test]
fn caption_cap_and_device_drop_are_scoped_to_current_session() {
    let backend = MockLoopbackBackend::new();
    let mut session = NativeLiveVoiceSession::new();
    let token = session
        .start_session(&backend, "Le Lecteur", Box::new(|_, _, _| {}))
        .unwrap();
    session.mark_session_started(token, 1700000000000);
    let caption = "😀".repeat(6001);
    assert!(session.update_transcripts(token, &caption, "reply"));
    assert_eq!(
        session.state().user_transcript.encode_utf16().count(),
        12000
    );
    let source = backend
        .last_source
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .clone();
    drop(session);
    assert!(!source.is_capturing());
}
