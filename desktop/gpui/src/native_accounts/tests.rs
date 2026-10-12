//! Synthetic protocol/store tests only. No account credential, live callback,
//! network request, accepted JWT, or native manuscript application is fabricated.

use super::{
    auth::{
        ATTEMPT_LIFETIME_MS, CallbackInput, CallbackRegistration, SignInAttempt, SignInReceipt,
        safe_return_to,
    },
    journal::{ConflictReason, JOURNAL_VERSION},
    protocol::{CLOUD_CONTENT_JSON_BUDGET, ContentFormat, ContentSnapshot, MAX_SOURCE_UTF16},
    store::LoadSource,
    *,
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    sync::{Arc, Barrier},
    thread,
};

fn identity(subject: &str) -> AccountIdentity {
    AccountIdentity {
        issuer: "https://fixture.convex.site".into(),
        subject: subject.into(),
        token_identifier: format!("https://fixture.convex.site|{subject}"),
    }
}

fn lease(subject: &str) -> SessionLease {
    SessionLease::new(identity(subject)).unwrap()
}

fn payload(source: &str) -> SyncPayload {
    SyncPayload {
        folios: vec![
            json!({"id": "folio-not-a-uuid", "name": "Fixture", "unknown": {"retained": true}}),
        ],
        folio_content: vec![ContentSnapshot {
            folio_id: "folio-not-a-uuid".into(),
            html: "<p>Fixture.</p>".into(),
            format: Some(ContentFormat::Typst),
            typst_source: Some(source.into()),
            updated_at: None,
            extra: BTreeMap::new(),
        }],
        ..SyncPayload::default()
    }
}

fn remote(payload: SyncPayload, revision: u64) -> PullSnapshot {
    PullSnapshot {
        sync_revision: revision,
        legacy_brief: None,
        legacy_brief_updated_at: 0,
        folios_updated_at: 0,
        custom_personas_updated_at: 0,
        bibliography_updated_at: 0,
        payload,
    }
}

fn hydrate(journal: &mut AccountJournal, lease: &SessionLease, value: SyncPayload, revision: u64) {
    let stage = journal
        .stage_pull(lease, Some(lease), remote(value, revision), BTreeSet::new())
        .unwrap();
    // A synthetic state-machine application receipt, never real manuscript I/O.
    journal
        .commit_pull(
            Some(lease),
            &ApplyReceipt {
                stage_id: stage.id,
                edit_generation: stage.edit_generation,
                applied: stage.merged,
            },
            &BTreeSet::new(),
        )
        .unwrap();
}

fn contracts() -> Value {
    serde_json::from_str(include_str!(
        "../../fixtures/account-sync/source-contracts.json"
    ))
    .unwrap()
}

fn registration() -> CallbackRegistration {
    CallbackRegistration {
        origin: "http://127.0.0.1:42177".into(),
        twyne_backend_trusted: true,
        gateway_product: Some("twyne".into()),
    }
}

#[test]
fn source_executed_pkce_request_and_return_paths_match() {
    let fixture = contracts();
    let now = fixture["auth"]["nowMs"].as_u64().unwrap();
    let attempt = SignInAttempt::prepare(
        &registration(),
        [1; 32],
        [2; 32],
        now,
        "/editor?folio=fixture",
    )
    .unwrap();
    assert_eq!(
        attempt.authorization_url().unwrap(),
        fixture["auth"]["authorizationUrl"].as_str().unwrap()
    );
    for case in fixture["auth"]["returnPaths"].as_array().unwrap() {
        assert_eq!(
            safe_return_to(case["input"].as_str().unwrap()),
            case["expected"].as_str().unwrap()
        );
    }
}

#[test]
fn source_executed_callback_guards_and_one_shot_consumption_match() {
    let fixture = contracts();
    let now = fixture["auth"]["nowMs"].as_u64().unwrap();
    for case in fixture["auth"]["callbackCases"].as_array().unwrap() {
        let mut attempt =
            SignInAttempt::prepare(&registration(), [1; 32], [2; 32], now, "/").unwrap();
        let input = CallbackInput {
            origin: case["origin"].as_str().unwrap().into(),
            pathname: case["pathname"].as_str().unwrap().into(),
            fragment: case["fragment"].as_str().unwrap().into(),
            error_present: case["errorPresent"].as_bool().unwrap(),
            codes: serde_json::from_value(case["codes"].clone()).unwrap(),
            states: serde_json::from_value(case["states"].clone()).unwrap(),
        };
        let callback_time = if case["name"] == "expired-at-boundary" {
            now + ATTEMPT_LIFETIME_MS
        } else {
            now
        };
        assert_eq!(
            attempt.consume_callback(&input, callback_time).is_ok(),
            case["accepted"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
        assert!(attempt.consume_callback(&input, now).is_err());
        assert!(attempt.authorization_url().is_err());
    }
}

#[test]
fn registration_never_infers_twyne_approval_from_loopback_or_product_hint() {
    let mut value = registration();
    value.twyne_backend_trusted = false;
    assert!(SignInAttempt::prepare(&value, [1; 32], [2; 32], 0, "/").is_err());
    value.twyne_backend_trusted = true;
    value.gateway_product = Some("keating".into());
    assert!(value.require_supported().is_err());
    for origin in [
        "twyne:///auth/notorganic/",
        "http://external.example:42177",
        "https://example.com/path",
        "https://u:p@example.com",
        "http://127.0.0.1:0",
        "http://127.0.0.1:80",
        "https://example.com:443",
        "https://*.example.com",
        "https://example.com\n",
    ] {
        value.origin = origin.into();
        value.gateway_product = Some("twyne".into());
        assert!(value.require_supported().is_err(), "{origin}");
    }
}

#[test]
fn callback_and_redemption_debug_redact_fixture_secrets() {
    let mut attempt = SignInAttempt::prepare(&registration(), [1; 32], [2; 32], 0, "/").unwrap();
    let input = CallbackInput {
        origin: registration().origin,
        pathname: auth::CALLBACK_PATH.into(),
        codes: vec!["DO_NOT_LOG_CODE".into()],
        states: vec![attempt.state().into()],
        ..CallbackInput::default()
    };
    let request = attempt.consume_callback(&input, 1).unwrap();
    for text in [
        format!("{input:?}"),
        format!("{request:?}"),
        format!("{attempt:?}"),
    ] {
        assert!(!text.contains("DO_NOT_LOG_CODE"));
        assert!(!text.contains(&request.verifier));
    }
}

#[test]
fn session_receipt_checks_same_user_but_does_not_attest_authentication() {
    let mut receipt = SignInReceipt {
        issued_user_id: "opaque-user".into(),
        refreshed_user_id: "opaque-user".into(),
        session_user_id: "opaque-user".into(),
        session_id: "synthetic-session-id".into(),
        redemption_error: false,
        refresh_error: false,
    };
    assert_eq!(
        receipt
            .consistent_account("https://fixture.convex.site")
            .unwrap(),
        identity("opaque-user")
    );
    receipt.redemption_error = true;
    assert!(
        receipt
            .consistent_account("https://fixture.convex.site")
            .is_err()
    );
    receipt.redemption_error = false;
    receipt.refreshed_user_id = "different-user".into();
    assert!(
        receipt
            .consistent_account("https://fixture.convex.site")
            .is_err()
    );
    receipt.refreshed_user_id = "opaque-user".into();
    receipt.session_id.clear();
    assert!(
        receipt
            .consistent_account("https://fixture.convex.site")
            .is_err()
    );
}

#[test]
fn account_key_keeps_issuer_bytes_and_rejects_substitution() {
    let mut value = identity("opaque-user");
    value.token_identifier = "did:plc:fixture".into();
    assert!(value.validate().is_err());
    let trailing = AccountIdentity {
        issuer: "https://fixture.convex.site/".into(),
        subject: "opaque-user".into(),
        token_identifier: "https://fixture.convex.site/|opaque-user".into(),
    };
    trailing.validate().unwrap();
    assert_ne!(
        trailing.partition_id().unwrap(),
        identity("opaque-user").partition_id().unwrap()
    );
}

#[test]
fn eight_executed_source_wire_diffs_match_with_exact_source() {
    for case in contracts()["syncCases"].as_array().unwrap() {
        let baseline: SyncPayload = serde_json::from_value(case["baseline"].clone()).unwrap();
        let desired: SyncPayload = serde_json::from_value(case["desired"].clone()).unwrap();
        let got = desired.push_arguments(&baseline, 7).unwrap();
        let mut expected = case["expected"].clone();
        if let Some(expected) = expected.as_object_mut() {
            expected.insert("expectedRevision".into(), json!(7));
        }
        assert_eq!(got.unwrap_or(Value::Null), expected, "{}", case["name"]);
    }
}

#[test]
fn pull_metadata_normalizes_without_rewriting_source() {
    let mut value = payload("\u{feff}// exact\r\n雪\n");
    value.folio_content[0].updated_at = Some(120);
    value
        .briefs
        .push(json!({"folioId":"folio-not-a-uuid","brief":{"foreign":true},"updatedAt":120}));
    value
        .rubric_results
        .push(json!({"result":{"foreign":true},"updatedAt":120}));
    let raw = json!({"syncRevision":3,"legacyBrief":{"answers":{"workingTitle":"Legacy"}},"legacyBriefUpdatedAt":10,"foliosUpdatedAt":20,"customPersonasUpdatedAt":0,"bibliographyUpdatedAt":30,"briefs":value.briefs,"folios":value.folios,"folioContent":value.folio_content,"customPersonas":null,"personaNotes":[],"personaReplies":[],"rubricResults":value.rubric_results,"bibliography":[],"futurePullMetadata":{"retain":true}});
    let pulled: PullSnapshot = serde_json::from_value(raw).unwrap();
    let normalized = pulled.payload.normalized().unwrap();
    assert_eq!(
        normalized.folio_content[0].typst_source.as_deref(),
        Some("\u{feff}// exact\r\n雪\n")
    );
    assert_eq!(normalized.folio_content[0].updated_at, None);
    assert_eq!(normalized.rubric_results[0]["folioId"], "");
    assert_eq!(
        normalized.extra["futurePullMetadata"],
        json!({"retain":true})
    );
    assert!(pulled.legacy_brief.is_some());
    assert!(pulled.payload.custom_personas.is_none());
}

#[test]
fn admission_rejects_downgrade_oversize_and_unknown_closed_fields_without_erasing_them() {
    let baseline = payload("canonical");
    let mut changed = baseline.clone();
    changed.folio_content[0].typst_source = None;
    changed.folio_content[0].format = Some(ContentFormat::Html);
    assert!(changed.push_arguments(&baseline, 0).is_err());
    changed = baseline.clone();
    changed.folio_content[0].html = "x".repeat(CLOUD_CONTENT_JSON_BUDGET + 1);
    assert!(changed.push_arguments(&baseline, 0).is_err());
    changed = baseline.clone();
    changed.folio_content[0].typst_source = Some("😀".repeat(MAX_SOURCE_UTF16 / 2 + 1));
    assert!(changed.push_arguments(&baseline, 0).is_err());
    changed = baseline.clone();
    changed.folio_content[0]
        .extra
        .insert("futureContent".into(), json!({"keep":true}));
    assert!(changed.push_arguments(&baseline, 0).is_err());
    assert_eq!(
        changed.folio_content[0].extra["futureContent"],
        json!({"keep":true})
    );
}

#[test]
fn acknowledged_old_push_does_not_clear_newer_offline_intent() {
    let lease = lease("one");
    let mut state = AccountJournal::new(lease.account.clone()).unwrap();
    hydrate(&mut state, &lease, payload("base"), 4);
    state.enqueue(payload("first edit")).unwrap();
    let dispatch = state
        .prepare_dispatch(&lease, Some(&lease))
        .unwrap()
        .unwrap();
    let new_id = state.enqueue(payload("newer edit")).unwrap();
    state
        .acknowledge_push(
            &dispatch,
            Some(&lease),
            &PushAcknowledgement {
                ok: true,
                revision: 5,
                synced_at: 100,
            },
        )
        .unwrap();
    assert_eq!(state.outbox.as_ref().unwrap().id, new_id);
    assert_eq!(
        state.acknowledged.as_ref().unwrap().folio_content[0]
            .typst_source
            .as_deref(),
        Some("first edit")
    );
    let next = state
        .prepare_dispatch(&lease, Some(&lease))
        .unwrap()
        .unwrap();
    assert_eq!(next.arguments["expectedRevision"], 5);
    assert_eq!(
        next.arguments["folioContent"][0]["typstSource"],
        "newer edit"
    );
}

#[test]
fn account_switch_and_new_lease_cannot_acknowledge_a_previous_request() {
    let first = lease("one");
    let other_account = lease("two");
    let reauthenticated = lease("one");
    let mut state = AccountJournal::new(first.account.clone()).unwrap();
    hydrate(&mut state, &first, payload("base"), 0);
    state.enqueue(payload("edited")).unwrap();
    let dispatch = state
        .prepare_dispatch(&first, Some(&first))
        .unwrap()
        .unwrap();
    let before = state.clone();
    let receipt = PushAcknowledgement {
        ok: true,
        revision: 1,
        synced_at: 100,
    };
    for active in [None, Some(&other_account), Some(&reauthenticated)] {
        assert!(state.acknowledge_push(&dispatch, active, &receipt).is_err());
        assert_eq!(state, before);
    }
    assert!(
        state
            .prepare_dispatch(&reauthenticated, Some(&reauthenticated))
            .is_err()
    );
}

#[test]
fn malformed_acknowledgement_never_advances_baseline() {
    let lease = lease("one");
    let mut state = AccountJournal::new(lease.account.clone()).unwrap();
    hydrate(&mut state, &lease, payload("base"), 4);
    state.enqueue(payload("edited")).unwrap();
    let dispatch = state
        .prepare_dispatch(&lease, Some(&lease))
        .unwrap()
        .unwrap();
    let before = state.clone();
    for receipt in [
        PushAcknowledgement {
            ok: false,
            revision: 5,
            synced_at: 0,
        },
        PushAcknowledgement {
            ok: true,
            revision: 4,
            synced_at: 0,
        },
        PushAcknowledgement {
            ok: true,
            revision: 6,
            synced_at: 0,
        },
    ] {
        assert!(
            state
                .acknowledge_push(&dispatch, Some(&lease), &receipt)
                .is_err()
        );
        assert_eq!(state, before);
    }
}

#[test]
fn ambiguous_push_outcome_requires_observation_not_invented_success() {
    let lease = lease("one");
    let mut state = AccountJournal::new(lease.account.clone()).unwrap();
    hydrate(&mut state, &lease, payload("base"), 0);
    state.enqueue(payload("edited")).unwrap();
    let dispatch = state
        .prepare_dispatch(&lease, Some(&lease))
        .unwrap()
        .unwrap();
    state.mark_outcome_unknown(&dispatch, Some(&lease)).unwrap();
    assert!(state.prepare_dispatch(&lease, Some(&lease)).is_err());
    assert_eq!(state.remote_revision, Some(0));
    assert!(state.outbox.is_some());
    hydrate(&mut state, &lease, payload("edited"), 1);
    assert!(state.outbox.is_none());
    assert!(state.in_flight.is_none());
    assert_eq!(state.last_synced_at, None); // observed, not a fabricated push ACK
}

#[test]
fn divergent_content_and_delete_edit_conflicts_preserve_all_three_values() {
    let base = payload("base");
    let local = payload("local\r\n");
    let remote = payload("remote\n");
    let (merged, conflicts) =
        journal::merge_snapshots(&base, &local, &remote, &BTreeSet::new()).unwrap();
    assert_eq!(
        merged.folio_content[0].typst_source.as_deref(),
        Some("local\r\n")
    );
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].base.as_ref().unwrap()["typstSource"], "base");
    assert_eq!(
        conflicts[0].remote.as_ref().unwrap()["typstSource"],
        "remote\n"
    );
    let mut deleted = base.clone();
    deleted.folio_content.clear();
    let (merged, conflicts) =
        journal::merge_snapshots(&base, &deleted, &remote, &BTreeSet::new()).unwrap();
    assert!(merged.folio_content.is_empty());
    assert!(conflicts[0].local.is_none());
}

#[test]
fn nonoverlapping_row_changes_merge_without_timestamp_guessing() {
    let mut base = payload("base");
    base.briefs = vec![json!({"folioId":"a","brief":{"value":"base"}})];
    let mut local = base.clone();
    local.briefs[0]["brief"]["value"] = json!("local");
    let mut remote = base.clone();
    remote.folio_content[0].typst_source = Some("remote".into());
    let (merged, conflicts) =
        journal::merge_snapshots(&base, &local, &remote, &BTreeSet::new()).unwrap();
    assert!(conflicts.is_empty());
    assert_eq!(merged.briefs[0]["brief"]["value"], "local");
    assert_eq!(
        merged.folio_content[0].typst_source.as_deref(),
        Some("remote")
    );
}

#[test]
fn pending_source_prevents_remote_content_replacement_and_conflicts_block_send() {
    let lease = lease("one");
    let mut state = AccountJournal::new(lease.account.clone()).unwrap();
    hydrate(&mut state, &lease, payload("base"), 0);
    let pending = BTreeSet::from(["folio-not-a-uuid".into()]);
    let stage = state
        .stage_pull(
            &lease,
            Some(&lease),
            remote(payload("remote"), 1),
            pending.clone(),
        )
        .unwrap();
    assert_eq!(
        stage.merged.folio_content[0].typst_source.as_deref(),
        Some("base")
    );
    assert_eq!(stage.conflicts[0].reason, ConflictReason::PendingSource);
    let receipt = ApplyReceipt {
        stage_id: stage.id,
        edit_generation: stage.edit_generation,
        applied: stage.merged.clone(),
    };
    assert!(
        state
            .commit_pull(Some(&lease), &receipt, &BTreeSet::new())
            .is_err()
    );
    state.commit_pull(Some(&lease), &receipt, &pending).unwrap();
    assert!(state.prepare_dispatch(&lease, Some(&lease)).is_err());
    let conflicts = state.conflicts.clone();
    state
        .resolve_conflicts(
            &lease,
            Some(&lease),
            &conflicts,
            state.edit_generation,
            payload("explicitly resolved"),
        )
        .unwrap();
    assert!(
        state
            .prepare_dispatch(&lease, Some(&lease))
            .unwrap()
            .is_some()
    );
}

#[test]
fn staged_application_is_stale_after_real_local_intent_or_changed_payload() {
    let lease = lease("one");
    let mut state = AccountJournal::new(lease.account.clone()).unwrap();
    hydrate(&mut state, &lease, payload("base"), 0);
    let stage = state
        .stage_pull(
            &lease,
            Some(&lease),
            remote(payload("remote"), 1),
            BTreeSet::new(),
        )
        .unwrap();
    let wrong = ApplyReceipt {
        stage_id: stage.id,
        edit_generation: stage.edit_generation,
        applied: payload("different"),
    };
    assert!(
        state
            .commit_pull(Some(&lease), &wrong, &BTreeSet::new())
            .is_err()
    );
    state.enqueue(payload("typed while waiting")).unwrap();
    assert!(
        state
            .commit_pull(
                Some(&lease),
                &ApplyReceipt {
                    stage_id: stage.id,
                    edit_generation: stage.edit_generation,
                    applied: stage.merged
                },
                &BTreeSet::new()
            )
            .is_err()
    );
    assert_eq!(
        state.outbox.as_ref().unwrap().desired.folio_content[0]
            .typst_source
            .as_deref(),
        Some("typed while waiting")
    );
}

#[test]
fn native_mapping_and_projection_extensions_survive_restart() {
    let root = tempfile::tempdir().unwrap();
    let store = AccountSyncStore::open(root.path()).unwrap();
    let base = store.load(&identity("one")).unwrap();
    let mut candidate = base.value.clone();
    let id = candidate.native_id_for("folio-non-uuid").unwrap();
    assert_eq!(candidate.native_id_for("folio-non-uuid").unwrap(), id);
    candidate.local_extensions.insert("folio-non-uuid".into(), json!({"projection":"unverifiedCache","originalBytes":[239,187,191],"future":{"keep":true}}));
    candidate.enqueue(payload("\u{feff}exact\r\n")).unwrap();
    store.save_request(&base, candidate).unwrap();
    let reopened = AccountSyncStore::open(root.path())
        .unwrap()
        .load(&identity("one"))
        .unwrap();
    assert_eq!(reopened.value.remote_ids["folio-non-uuid"], id);
    assert_eq!(
        reopened
            .value
            .outbox
            .as_ref()
            .unwrap()
            .desired
            .folio_content[0]
            .typst_source
            .as_deref(),
        Some("\u{feff}exact\r\n")
    );
    assert_eq!(
        reopened.value.local_extensions["folio-non-uuid"]["future"],
        json!({"keep":true})
    );
    assert!(reopened.value.needs_pull);
}

#[test]
fn account_partitions_never_upload_or_clear_another_accounts_local_library() {
    let root = tempfile::tempdir().unwrap();
    let store = AccountSyncStore::open(root.path()).unwrap();
    let first = store.load(&identity("one")).unwrap();
    let mut candidate = first.value.clone();
    candidate.enqueue(payload("private fixture one")).unwrap();
    store.save_request(&first, candidate).unwrap();
    let second = store.load(&identity("two")).unwrap();
    assert_eq!(second.source, LoadSource::Missing);
    assert!(second.value.outbox.is_none());
    assert!(second.value.acknowledged.is_none());
    assert!(store.load(&identity("one")).unwrap().value.outbox.is_some());
    assert_ne!(
        store.paths(&identity("one")).unwrap(),
        store.paths(&identity("two")).unwrap()
    );
}

#[test]
fn restart_keeps_in_flight_bytes_and_requires_a_pull_in_a_new_session() {
    let root = tempfile::tempdir().unwrap();
    let store = AccountSyncStore::open(root.path()).unwrap();
    let first = lease("one");
    let base = store.load(&first.account).unwrap();
    let mut candidate = base.value.clone();
    hydrate(&mut candidate, &first, payload("base"), 0);
    candidate.enqueue(payload("edited")).unwrap();
    let dispatch = candidate
        .prepare_dispatch(&first, Some(&first))
        .unwrap()
        .unwrap();
    store.save_request(&base, candidate).unwrap();
    let mut recovered = store.load(&first.account).unwrap().value;
    assert_eq!(recovered.in_flight.as_ref(), Some(&dispatch));
    let second = lease("one");
    assert!(recovered.prepare_dispatch(&second, Some(&second)).is_err());
    recovered.suspend_session();
    assert!(recovered.needs_pull);
    assert!(recovered.prepare_dispatch(&second, Some(&second)).is_err());
}

#[test]
fn two_handles_same_base_cas_and_exact_bytes_reject_stale_writers() {
    let root = tempfile::tempdir().unwrap();
    let first = AccountSyncStore::open(root.path()).unwrap();
    let second = AccountSyncStore::open(root.path()).unwrap();
    let base = first.load(&identity("one")).unwrap();
    let mut candidate = base.value.clone();
    candidate
        .extra
        .insert("futureEnvelope".into(), json!({"keep":true}));
    let saved = first.save_request(&base, candidate).unwrap();
    assert!(second.save_request(&base, base.value.clone()).is_err());
    let mut candidate = saved.value.clone();
    candidate.extra.clear();
    let preserved = second.save_request(&saved, candidate).unwrap();
    assert_eq!(
        preserved.value.extra["futureEnvelope"],
        json!({"keep":true})
    );
    let (path, _) = second.paths(&identity("one")).unwrap();
    let mut bytes = fs::read(&path).unwrap();
    bytes.push(b' ');
    fs::write(&path, bytes).unwrap();
    assert!(
        second
            .save_request(&preserved, preserved.value.clone())
            .is_err()
    );
}

#[test]
fn simultaneous_process_handle_style_writers_have_one_winner() {
    let root = tempfile::tempdir().unwrap();
    let first = AccountSyncStore::open(root.path()).unwrap();
    let second = AccountSyncStore::open(root.path()).unwrap();
    let base = first.load(&identity("one")).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let handles = [first, second]
        .into_iter()
        .enumerate()
        .map(|(index, store)| {
            let base = base.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                let mut next = base.value.clone();
                next.enqueue(payload(&format!("writer {index}"))).unwrap();
                barrier.wait();
                store.save_request(&base, next).is_ok()
            })
        })
        .collect::<Vec<_>>();
    assert_eq!(
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .filter(|won| *won)
            .count(),
        1
    );
}

#[test]
fn corrupt_primary_recovers_previous_bytes_with_warning_then_repairs_without_poisoning_backup() {
    let root = tempfile::tempdir().unwrap();
    let store = AccountSyncStore::open(root.path()).unwrap();
    let initial = store.load(&identity("one")).unwrap();
    let saved = store.save_request(&initial, initial.value.clone()).unwrap();
    let mut newer = saved.value.clone();
    newer.enqueue(payload("newer")).unwrap();
    store.save_request(&saved, newer).unwrap();
    let (primary, backup) = store.paths(&identity("one")).unwrap();
    let prior_backup = fs::read(&backup).unwrap();
    fs::write(&primary, b"broken fixture").unwrap();
    let recovered = store.load(&identity("one")).unwrap();
    assert_eq!(recovered.source, LoadSource::Backup);
    assert!(!recovered.warnings.is_empty());
    assert_eq!(recovered.value, saved.value);
    let repaired = store
        .save_request(&recovered, recovered.value.clone())
        .unwrap();
    assert_eq!(repaired.source, LoadSource::Primary);
    assert_eq!(fs::read(&backup).unwrap(), prior_backup);
}

#[test]
fn future_version_and_unrecoverable_corruption_remain_untouched() {
    let root = tempfile::tempdir().unwrap();
    let store = AccountSyncStore::open(root.path()).unwrap();
    let initial = store.load(&identity("one")).unwrap();
    let saved = store.save_request(&initial, initial.value.clone()).unwrap();
    store.save_request(&saved, saved.value.clone()).unwrap();
    let (primary, backup) = store.paths(&identity("one")).unwrap();
    let mut future = serde_json::to_value(&saved.value).unwrap();
    future["version"] = json!(JOURNAL_VERSION + 1);
    let bytes = serde_json::to_vec(&future).unwrap();
    fs::write(&primary, &bytes).unwrap();
    assert!(store.load(&identity("one")).is_err());
    assert_eq!(fs::read(&primary).unwrap(), bytes);
    fs::write(&primary, b"broken primary").unwrap();
    fs::write(&backup, b"broken backup").unwrap();
    assert!(store.load(&identity("one")).is_err());
    assert_eq!(fs::read(&primary).unwrap(), b"broken primary");
}

#[test]
fn actual_blocked_file_io_failure_has_no_ack_and_can_retry_after_reload() {
    let root = tempfile::tempdir().unwrap();
    let store = AccountSyncStore::open(root.path()).unwrap();
    let initial = store.load(&identity("one")).unwrap();
    let saved = store.save_request(&initial, initial.value.clone()).unwrap();
    let (primary, backup) = store.paths(&identity("one")).unwrap();
    let unchanged = fs::read(&primary).unwrap();
    fs::create_dir(&backup).unwrap();
    let mut candidate = saved.value.clone();
    candidate.enqueue(payload("retry fixture")).unwrap();
    assert!(store.save_request(&saved, candidate.clone()).is_err());
    assert_eq!(fs::read(&primary).unwrap(), unchanged);
    fs::remove_dir(&backup).unwrap();
    let reloaded = store.load(&identity("one")).unwrap();
    let success = store.save_request(&reloaded, candidate).unwrap();
    assert_eq!(
        success.value.outbox.unwrap().desired.folio_content[0]
            .typst_source
            .as_deref(),
        Some("retry fixture")
    );
}

#[test]
fn uncertain_local_save_acknowledgement_requires_the_full_expected_value() {
    let root = tempfile::tempdir().unwrap();
    let store = AccountSyncStore::open(root.path()).unwrap();
    let initial = store.load(&identity("one")).unwrap();
    let mut candidate = initial.value.clone();
    candidate.enqueue(payload("saved")).unwrap();
    let expected = AccountSyncStore::expected_value(&initial, candidate.clone()).unwrap();
    assert!(store.acknowledge_expected(&expected).is_err());
    store.save_request(&initial, candidate).unwrap();
    assert_eq!(
        store.acknowledge_expected(&expected).unwrap().value,
        expected
    );
    let mut wrong = expected.clone();
    wrong
        .extra
        .insert("sameGenerationDifferentValue".into(), json!(true));
    assert!(store.acknowledge_expected(&wrong).is_err());
}
