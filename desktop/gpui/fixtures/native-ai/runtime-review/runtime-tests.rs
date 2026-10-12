//! Captured-response and request-ticket checks; no provider, socket or child runs.
use super::*;
use serde_json::{Value, json};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    time::Duration,
};

fn source_vectors() -> Value {
    serde_json::from_str(include_str!("source-vectors.json")).unwrap()
}
fn request(stream: bool) -> CompletionRequest {
    CompletionRequest::new(
        AiFeature::RubricJudge,
        LOCAL_PROVIDER_ID,
        LOCAL_MODEL_ID,
        vec![ChatMessage::user("synthetic manuscript")],
    )
    .with_revision("folio-a", 1)
    .with_streaming(stream)
}
fn coordinator() -> NativeAiCoordinator {
    let settings = AiSettingsRecord {
        default_provider_id: Some(LOCAL_PROVIDER_ID.into()),
        providers: vec![AiProviderConfig::new_litert("http://127.0.0.1:45123/v1")],
        ..Default::default()
    };
    let coordinator = NativeAiCoordinator::new(LiteRtConfig::default(), settings);
    coordinator
        .set_active_revision(Some(RevisionIdentity::new("folio-a", 1)))
        .unwrap();
    coordinator
}
fn response(media: &str, body: &[u8]) -> Vec<u8> {
    let mut wire = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {media}\r\nContent-Length: {}\r\n\r\n",
        body.len()
    )
    .into_bytes();
    wire.extend_from_slice(body);
    wire
}
fn stream_body() -> &'static str {
    "\u{feff}: keepalive\r\nevent: message\r\ndata: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"Considering\"},\"finish_reason\":null}]}\r\n\r\ndata: {\"choices\":[\r\ndata: {\"index\":0,\"delta\":{\"content\":\"Hi 東京😀\"},\"finish_reason\":null}]}\r\n\r\ndata: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\r\n\r\ndata: [DONE]\r\n\r\n"
}
fn json_body() -> &'static [u8] {
    br#"{"choices":[{"message":{"content":"Synthetic answer"},"finish_reason":"stop"}]}"#
}

#[test]
fn original_structured_reply_vectors_match_with_explicit_representation_refusals() {
    let vectors = source_vectors();
    for row in vectors["fences"].as_array().unwrap() {
        assert_eq!(
            strip_json_fences(row["input"].as_str().unwrap()),
            row["result"].as_str().unwrap()
        );
    }
    for row in vectors["judge"].as_array().unwrap() {
        let actual = parse_judge_output(row["input"].as_str().unwrap());
        if row["nativeBoundary"].is_string() {
            assert_eq!(actual, None, "{}", row["name"]);
            assert_eq!(row["result"]["score"], 5);
        } else {
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                row["result"],
                "{}",
                row["name"]
            );
        }
    }
    for row in vectors["tagged"].as_array().unwrap() {
        let actual =
            extract_tagged_json(row["input"].as_str().unwrap(), row["tag"].as_str().unwrap());
        let actual =
            actual.map(|value| json!({"value":value.value,"start":value.start,"end":value.end}));
        assert_eq!(serde_json::to_value(actual).unwrap(), row["result"]);
    }
    for row in vectors["research"].as_array().unwrap() {
        let actual = parse_research_targets(row["input"].as_str().unwrap(), usize::MAX);
        if let Some(boundary) = row["nativeBoundary"].as_str() {
            assert_eq!(actual.unwrap_err(), boundary, "{}", row["name"]);
        } else {
            assert_eq!(
                serde_json::to_value(actual.unwrap()).unwrap(),
                row["result"],
                "{}",
                row["name"]
            );
        }
    }
    let input = vectors["research"][0]["input"].as_str().unwrap();
    let full = parse_research_targets(input, usize::MAX).unwrap();
    assert_eq!(parse_research_targets(input, 1).unwrap(), full[..1]);
    assert!(parse_research_targets(input, 0).unwrap().is_empty());
}

#[test]
fn original_normalized_routing_vectors_match_without_provider_authority() {
    #[derive(Debug, PartialEq, serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Resolution {
        provider_id: String,
        model: String,
        temperature: f64,
        max_tokens: Option<u32>,
    }

    for row in source_vectors()["routing"].as_array().unwrap() {
        let settings: AiSettingsRecord = serde_json::from_value(row["settings"].clone()).unwrap();
        let feature: AiFeature = serde_json::from_value(row["feature"].clone()).unwrap();
        let actual = if row["persona"].is_object() {
            let persona = &row["persona"];
            resolve_feature_config_for_persona(
                &settings,
                &feature,
                persona["providerId"].as_str(),
                persona["model"].as_str(),
                persona["temperature"].as_f64(),
            )
        } else {
            resolve_feature_config(&settings, &feature)
        };
        let actual = actual.map(|resolved| Resolution {
            provider_id: resolved.provider.id,
            model: resolved.model,
            temperature: resolved.temperature,
            max_tokens: resolved.max_tokens,
        });
        // JSON's `0` and `0.0` are the same Source Number. Compare this field
        // as an exact f64 instead of serde_json's distinct integer/float variants.
        let expected: Option<Resolution> = serde_json::from_value(row["result"].clone()).unwrap();
        assert_eq!(actual, expected, "{}", row["name"]);
        assert_eq!(
            has_configured_ai_provider(&settings),
            row["hasAi"].as_bool().unwrap()
        );
        assert_eq!(
            has_configured_voice_provider(&settings),
            row["hasVoice"].as_bool().unwrap()
        );
    }
}

#[test]
fn serialization_and_debug_exclude_credentials_endpoints_prompts_and_error_bodies() {
    let secret = "synthetic-private-sentinel";
    let mut provider =
        AiProviderConfig::new_litert(&format!("http://{secret}@127.0.0.1:45123/v1?key={secret}"));
    provider.api_key = Some(secret.into());
    let value = serde_json::to_value(&provider).unwrap();
    assert!(value.get("apiKey").is_none());
    assert!(value.get("baseUrl").is_none());
    assert!(!format!("{provider:?}").contains(secret));
    let mut req = request(false);
    req.messages = vec![ChatMessage::user(secret)];
    req.model = secret.into();
    req.provider_id = secret.into();
    assert!(!format!("{:?}", req.messages).contains(secret));
    assert!(!format!("{req:?}").contains(secret));
    let error = AiError::HttpError {
        status: 401,
        message: secret.into(),
    };
    assert!(!format!("{error:?} {error}").contains(secret));
    let error = LiteRtError::StartupFailed(secret.into());
    assert!(!format!("{error:?} {error}").contains(secret));
}

#[test]
fn unavailable_dispatch_and_strict_literal_endpoint_do_not_create_success_or_snapshots() {
    for value in [
        "https://127.0.0.1:1/v1",
        "http://localhost:1/v1",
        "http://127.1:1/v1",
        "http://2130706433:1/v1",
        "http://0x7f000001:1/v1",
        "http://[::1]:1/v1",
        "http://key@127.0.0.1:1/v1",
        "http://127.0.0.1:1/v1?key=a",
        "http://127.0.0.1:1/v1#fragment",
        "http://127.0.0.1:0/v1",
        "http://127.0.0.1:1/v1/other",
        "http://127.0.0.1:1/v1/",
    ] {
        assert!(LoopbackClient::from_base_url(value).is_none(), "{value}");
    }
    assert_eq!(
        LoopbackClient::from_base_url("http://127.0.0.1:80/v1")
            .unwrap()
            .port(),
        80
    );
    let client = LoopbackClient::from_base_url("http://127.0.0.1:45123/v1").unwrap();
    assert!(matches!(
        client.send_completion(&request(false)),
        Err(AiError::CapabilityUnavailable)
    ));
    let mut calls = 0;
    assert!(matches!(
        client.stream_completion(&request(true), |_| {
            calls += 1;
            true
        }),
        Err(AiError::CapabilityUnavailable)
    ));
    assert_eq!(calls, 0);
    let coordinator = coordinator();
    assert!(matches!(
        coordinator.execute_request(request(false)),
        Err(AiError::CapabilityUnavailable)
    ));
    assert_eq!(coordinator.in_flight_count(), 0);
}

#[test]
fn captured_sse_utf8_http_chunks_and_events_are_independent_of_byte_partitions() {
    let client = LoopbackClient::new("127.0.0.1", 45123);
    let wire = response("text/event-stream; charset=utf-8", stream_body().as_bytes());
    for split in 0..=wire.len() {
        let req = request(true);
        let mut complete = 0;
        let result = client
            .decode_captured_response(&req, &[&wire[..split], &wire[split..]], |snapshot| {
                complete += usize::from(snapshot.status == StreamRunStatus::Complete);
                true
            })
            .unwrap();
        assert_eq!(result.text, "Hi 東京😀");
        assert_eq!(result.reasoning, "Considering");
        assert_eq!(result.evidence, CompletionEvidence::SyntheticFixture);
        assert_eq!(complete, 1);
        assert!(!format!("{result:?}").contains("Considering"));
    }
    let mut chunked =
        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n"
            .to_vec();
    for chunk in stream_body().as_bytes().chunks(7) {
        chunked.extend_from_slice(format!("{:x};test=yes\r\n", chunk.len()).as_bytes());
        chunked.extend_from_slice(chunk);
        chunked.extend_from_slice(b"\r\n");
    }
    chunked.extend_from_slice(b"0\r\nX-Test: yes\r\n\r\n");
    let bytes: Vec<_> = chunked.chunks(1).collect();
    assert_eq!(
        client
            .decode_captured_response(&request(true), &bytes, |_| true)
            .unwrap()
            .text,
        "Hi 東京😀"
    );
}

#[test]
fn nonstream_captured_completion_and_provider_status_keep_receipt_and_error_boundaries() {
    let client = LoopbackClient::new("127.0.0.1", 45123);
    let result = client
        .decode_captured_response(
            &request(false),
            &[&response("application/json", json_body())],
            |_| true,
        )
        .unwrap();
    assert_eq!(result.text, "Synthetic answer");
    assert_eq!(result.snapshot.status, StreamRunStatus::Complete);
    assert_eq!(result.evidence, CompletionEvidence::SyntheticFixture);
    assert!(!format!("{result:?}").contains("Synthetic answer"));
    let secret = "synthetic-provider-private-output";
    let wire = format!(
        "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{secret}",
        secret.len()
    );
    let error = client
        .decode_captured_response(&request(false), &[wire.as_bytes()], |_| true)
        .unwrap_err();
    assert!(matches!(error, AiError::HttpError { status: 401, .. }));
    assert!(!format!("{error:?} {error}").contains(secret));
    let request = request(false);
    let payload: Value =
        serde_json::from_str(&LoopbackClient::build_payload(&request).unwrap()).unwrap();
    assert!(payload.get("max_tokens").is_none());
    let payload: Value = serde_json::from_str(
        &LoopbackClient::build_payload(&request.with_max_tokens(Some(91))).unwrap(),
    )
    .unwrap();
    assert_eq!(payload["max_tokens"], 91);
}

#[test]
fn missing_or_unframed_terminal_and_invalid_deltas_never_emit_finish() {
    let client = LoopbackClient::new("127.0.0.1", 45123);
    for body in [
        "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}\n\n",
        "data: [DONE]\n",
        "data: [DONE]",
        "data: {broken}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":5}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"\"}]}\n\n",
        "data: {\"choices\":[{\"index\":1,\"delta\":{}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{}},{\"delta\":{}}]}\n\n",
        "data: [DONE]\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n\n",
        "data: [DONE]\n\ndata: pending\n",
    ] {
        let wire = response("text/event-stream", body.as_bytes());
        let mut complete = 0;
        assert!(
            client
                .decode_captured_response(&request(true), &[&wire], |snapshot| {
                    complete += usize::from(snapshot.status == StreamRunStatus::Complete);
                    true
                })
                .is_err(),
            "{body}"
        );
        assert_eq!(complete, 0);
    }
    let body = b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n";
    assert!(
        client
            .decode_captured_response(
                &request(true),
                &[&response("text/event-stream", body)],
                |_| true
            )
            .is_ok()
    );
}

#[test]
fn captured_response_bounds_framing_utf8_and_cancellation_fail_closed() {
    let client = LoopbackClient::new("127.0.0.1", 45123);
    let invalids = [
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1\r\n\r\n{}".to_vec(),
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n".to_vec(),
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n{}\r\n0\r\n\r\n".to_vec(),
        response("application/json",b"\xff"),
        response("text/plain",json_body()),
        response("application/json",br#"{"choices":[{"message":{"content":"partial"},"finish_reason":null}]}"#),
        response("application/json",br#"{"choices":[{"message":{"content":"partial"},"finish_reason":""}]}"#),
        format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",request::MAX_RESPONSE_BYTES+1).into_bytes(),
        response("text/event-stream",format!("data: {}\n\n","x".repeat(loopback_transport::MAX_SSE_LINE_BYTES+1)).as_bytes()),
    ];
    for wire in invalids {
        assert!(
            client
                .decode_captured_response(&request(false), &[&wire], |_| true)
                .is_err()
        );
    }
    let oversized_line = response(
        "text/event-stream",
        format!(
            "data: {}\n\n",
            "x".repeat(loopback_transport::MAX_SSE_LINE_BYTES + 1)
        )
        .as_bytes(),
    );
    assert!(matches!(
        client.decode_captured_response(&request(true), &[&oversized_line], |_| true),
        Err(AiError::PayloadTooLarge(_))
    ));
    let oversized_header = format!(
        "HTTP/1.1 200 OK\r\nX-Test: {}\r\nContent-Type: application/json\r\n\r\n{{}}",
        "x".repeat(loopback_transport::MAX_HTTP_HEADER_BYTES)
    );
    assert!(matches!(
        client.decode_captured_response(&request(false), &[oversized_header.as_bytes()], |_| true),
        Err(AiError::PayloadTooLarge(_))
    ));
    let wire = response("text/event-stream", stream_body().as_bytes());
    let req = request(true);
    let error = client
        .decode_captured_response(&req, &[&wire], |_| false)
        .unwrap_err();
    assert_eq!(error, AiError::Cancelled);
    assert!(req.cancel_token.is_cancelled());
    let req = request(false).with_timeout(Duration::from_nanos(1));
    assert!(matches!(
        client.decode_captured_response(
            &req,
            &[&response("application/json", json_body())],
            |_| true
        ),
        Err(AiError::Timeout(_))
    ));
    let mut huge = request(false);
    huge.messages[0].content = "\0".repeat(request::MAX_REQUEST_BODY_BYTES / 2);
    assert!(huge.estimated_bytes() < request::MAX_REQUEST_BODY_BYTES);
    assert!(matches!(
        LoopbackClient::build_payload(&huge),
        Err(AiError::PayloadTooLarge(_))
    ));
}

#[test]
fn tickets_bound_queue_cancel_once_and_invalidate_revisited_scopes() {
    let coordinator = coordinator();
    let mut active = Vec::new();
    for _ in 0..MAX_IN_FLIGHT {
        let req = request(true);
        let ticket = coordinator.begin_request(&req).unwrap();
        active.push((req, ticket));
    }
    assert_eq!(
        coordinator.begin_request(&request(true)),
        Err(AiError::QueueFull)
    );
    assert!(coordinator.cancel_request(&active[0].0.request_id));
    assert!(!coordinator.accepts_snapshot(&active[0].1));
    assert_eq!(
        coordinator.finish_request(&active[0].1, RequestTerminal::SucceededSynthetic),
        Err(AiError::Cancelled)
    );
    assert_eq!(
        coordinator.terminal_state(&active[0].1),
        Some(RequestTerminal::Cancelled)
    );
    assert_eq!(
        coordinator.finish_request(&active[0].1, RequestTerminal::Failed),
        Err(AiError::StaleRequest)
    );
    assert_eq!(
        coordinator.begin_request(&active[0].0),
        Err(AiError::Cancelled)
    ); // token itself stays cancelled
    coordinator
        .set_active_revision(Some(RevisionIdentity::new("folio-b", 1)))
        .unwrap();
    assert_eq!(coordinator.in_flight_count(), 0);
    coordinator
        .set_active_revision(Some(RevisionIdentity::new("folio-a", 1)))
        .unwrap();
    assert!(!coordinator.accepts_snapshot(&active[1].1));
    assert!(!coordinator.can_apply_result(&active[1].1));
    assert_eq!(
        coordinator.finish_request(&active[1].1, RequestTerminal::SucceededSynthetic),
        Err(AiError::StaleRequest)
    );
    let mut unscoped = request(false);
    unscoped.revision = None;
    assert_eq!(
        coordinator.begin_request(&unscoped),
        Err(AiError::StaleRequest)
    );
    assert!(!coordinator.is_revision_current(None, "folio-a", 1));
}

#[test]
fn exact_ticket_nonce_and_bounded_receipts_protect_reused_ids() {
    let coordinator = coordinator();
    let first = request(false);
    let old = coordinator.begin_request(&first).unwrap();
    coordinator
        .finish_request(&old, RequestTerminal::Failed)
        .unwrap();
    assert_eq!(
        coordinator.begin_request(&first),
        Err(AiError::DuplicateRequest)
    );
    for _ in 0..coordinator::MAX_TERMINAL_TICKETS {
        let ticket = coordinator.begin_request(&request(false)).unwrap();
        coordinator
            .finish_request(&ticket, RequestTerminal::Failed)
            .unwrap();
    }
    assert_eq!(coordinator.terminal_state(&old), None);
    let current = coordinator.begin_request(&first).unwrap();
    assert_ne!(current, old);
    assert_eq!(
        coordinator.finish_request(&old, RequestTerminal::Failed),
        Err(AiError::StaleRequest)
    );
    assert!(coordinator.accepts_snapshot(&current));
    assert_eq!(coordinator.in_flight_count(), 1);
    coordinator
        .finish_request(&current, RequestTerminal::Failed)
        .unwrap();
}

#[test]
fn captured_result_adoption_stale_callbacks_settings_and_panic_cleanup_are_guarded() {
    let mut coordinator = coordinator();
    let wire = response("application/json", json_body());
    let result = coordinator
        .execute_captured_request(request(false), &[&wire], |_| true)
        .unwrap();
    assert!(coordinator.can_apply_result(&result.ticket));
    let mut settings = coordinator.settings().clone();
    settings.providers[0].api_key = Some("replacement-synthetic-key".into());
    coordinator.update_settings(settings);
    assert!(!coordinator.can_apply_result(&result.ticket));
    let wire = response("text/event-stream", stream_body().as_bytes());
    let result = coordinator.execute_captured_request(request(true), &[&wire], |_| {
        coordinator
            .set_active_revision(Some(RevisionIdentity::new("folio-b", 2)))
            .unwrap();
        true
    });
    assert!(matches!(result, Err(AiError::StaleRequest)));
    assert_eq!(coordinator.in_flight_count(), 0);
    coordinator
        .set_active_revision(Some(RevisionIdentity::new("folio-a", 1)))
        .unwrap();
    let req = request(true);
    assert!(
        catch_unwind(AssertUnwindSafe(|| {
            let _ = coordinator.execute_captured_request(req.clone(), &[&wire], |_| {
                panic!("synthetic callback unwind")
            });
        }))
        .is_err()
    );
    assert_eq!(coordinator.in_flight_count(), 0);
    assert_eq!(
        coordinator.begin_request(&req),
        Err(AiError::DuplicateRequest)
    );
}

#[test]
fn disabled_lifecycle_never_claims_a_ready_model() {
    let mut manager = LiteRtProcessManager::new(LiteRtConfig::default());
    assert_eq!(manager.start().unwrap(), None);
    assert!(!manager.is_ready());
    assert_eq!(manager.base_url(), None);
    let mut config = LiteRtConfig {
        enabled: true,
        model_path: "<fixture-model>".into(),
        ..Default::default()
    };
    let plan = config.launch_plan(45123).unwrap();
    let args: Vec<_> = plan
        .serve_args
        .iter()
        .map(|s| s.to_str().unwrap())
        .collect();
    let source = source_vectors();
    let ready = source["lifecycle"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == "import-ready")
        .unwrap();
    assert_eq!(
        serde_json::to_value(&args[1..]).unwrap(),
        ready["calls"][2]["args"]
    );
    let args: Vec<_> = plan
        .import_args
        .iter()
        .map(|s| s.to_str().unwrap())
        .collect();
    // Source fixture stores the subcommand separately.
    assert_eq!(
        serde_json::to_value(&args[1..]).unwrap(),
        ready["calls"][1]["args"]
    );
    config.host = "localhost".into();
    assert!(matches!(
        config.launch_plan(45123),
        Err(LiteRtError::InvalidConfiguration)
    ));
    config.host = "127.0.0.1".into();
    let mut enabled = LiteRtProcessManager::new(config);
    assert!(matches!(
        enabled.start(),
        Err(LiteRtError::CapabilityUnavailable)
    ));
    assert_eq!(enabled.state(), &LiteRtState::Unavailable);
    assert!(!enabled.is_ready());
    assert_eq!(enabled.base_url(), None);
    assert_eq!(enabled.port(), None);
    assert!(matches!(
        litert_lifecycle::model_is_registered(std::path::Path::new("fixture-bin"), LOCAL_MODEL_ID),
        Err(LiteRtError::CapabilityUnavailable)
    ));
    assert_eq!(
        allocate_free_port("127.0.0.1").unwrap_err().kind(),
        std::io::ErrorKind::Unsupported
    );
}
