//! Mounted Dossier filing and deterministically delayed host receipts.
//! These are GPUI host tests, not operating-system or async-race evidence.

use super::{DossierFilingScope, WritingRoom, tests::room};
use gpui_kit::test::TestWindowExt;
use gpui_kit::{App, AppContext, Entity, TestAppContext, Window};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use twyne_desktop::{
    dossier::{DossierDraft, DossierMode, DossierSubmission, FilingState},
    dossier_view::{DossierEvent, DossierView},
    manuscript::{Manuscript, timestamp},
    storage::Store,
    workspace::ProjectionState,
};
use uuid::Uuid;

#[derive(Clone)]
struct FilingRequest {
    token: u64,
    submission: DossierSubmission,
}

struct HeldForm {
    view: Entity<DossierView>,
    scope: DossierFilingScope,
    requests: Arc<Mutex<Vec<FilingRequest>>>,
}

impl HeldForm {
    fn request(&self) -> FilingRequest {
        let requests = self.requests.lock().unwrap();
        assert_eq!(
            requests.len(),
            1,
            "A real Send must emit exactly one request"
        );
        requests[0].clone()
    }
}

/// Open through the production route. Hold only delivery to the application so
/// a test can deliver the real event after a switch/reopen without racing clocks.
fn open_held_form(room: &Entity<WritingRoom>, window: &mut Window, cx: &mut App) -> HeldForm {
    let view = room.update(cx, |room, cx| {
        room.open_dossier(window, cx);
        room.dossier_subscription = None;
        room.dossier.clone().expect("The Dossier must open")
    });
    let document = room.read(cx).active_document();
    let options = &view.read(cx).session.options;
    let scope = DossierFilingScope {
        folio_id: document.id,
        revision: document.revision,
        mode: options.mode,
        recovery: options.recovery_identity(),
    };
    let requests = Arc::new(Mutex::new(Vec::new()));
    let receiver = requests.clone();
    cx.subscribe(&view, move |_, event: &DossierEvent, _| {
        if let DossierEvent::FilingRequested { token, submission } = event {
            receiver.lock().unwrap().push(FilingRequest {
                token: *token,
                submission: submission.clone(),
            });
        }
    })
    .detach();
    window.render_frame(cx);
    HeldForm {
        view,
        scope,
        requests,
    }
}

fn write_title(title: &str, window: &mut Window, cx: &mut App) {
    window.click(("dossier-section", 0_usize), cx);
    window.render_frame(cx);
    window.click("dossier-answer-0", cx);
    window.press("secondary-a", cx);
    window.input(title, cx);
}

fn send_to_press(window: &mut Window, cx: &mut App) {
    window.click(("dossier-section", 9_usize), cx);
    window.click("dossier-next", cx);
}

struct RecoverySnapshot {
    path: PathBuf,
    bytes: Vec<u8>,
    draft: DossierDraft,
    filing: FilingState,
    token: Option<u64>,
}

fn recovery_snapshot(view: &Entity<DossierView>, cx: &App) -> RecoverySnapshot {
    let form = view.read(cx);
    let recovery = form.session.options.recovery.as_ref().unwrap();
    let path = recovery.path();
    let draft = form.session.draft.clone();
    assert_eq!(recovery.load(timestamp()).unwrap().unwrap(), draft);
    RecoverySnapshot {
        bytes: fs::read(&path).unwrap(),
        path,
        draft,
        filing: form.session.filing,
        token: form.filing_token(),
    }
}

fn assert_recovery_unchanged(snapshot: &RecoverySnapshot, view: &Entity<DossierView>, cx: &App) {
    assert_eq!(fs::read(&snapshot.path).unwrap(), snapshot.bytes);
    let form = view.read(cx);
    assert_eq!(
        form.session.options.recovery.as_ref().unwrap().path(),
        snapshot.path
    );
    assert_eq!(form.session.draft, snapshot.draft);
    assert_eq!(form.session.filing, snapshot.filing);
    assert_eq!(form.filing_token(), snapshot.token);
}

fn stored_document(store: &Store, id: Uuid) -> Manuscript {
    store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .expect("The filed manuscript must be present on disk")
}

fn save_request(
    store: &Store,
    original: Manuscript,
    scope: &DossierFilingScope,
    request: FilingRequest,
) -> Manuscript {
    let document = twyne_desktop::dossier_filing::prepare_document(
        original,
        request.submission.brief,
        request.submission.prior_material,
        request.submission.mode,
    )
    .unwrap();
    store.save_if_revision(&document, scope.revision).unwrap();
    document
}

#[gpui_kit::test]
fn old_sender_after_folio_switch_cannot_file_into_either_folio(cx: &mut TestAppContext) {
    let (handle, room, store, _directory) = room(cx);
    let first_id = cx.update(|cx| room.read(cx).active);
    let mut other = Manuscript::new("The other folio");
    other.body = "The other writer's manuscript stays exact.".into();
    let other_id = other.id;
    let held = cx
        .update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(other, window, cx));
                room.select(first_id, window, cx);
            });
            let held = open_held_form(&room, window, cx);
            write_title("Retired request Ω", window, cx);
            send_to_press(window, cx);
            held
        })
        .unwrap();
    let request = held.request();
    cx.update_window(handle, |_, window, cx| {
        assert!(held.view.read(cx).accepts_filing(request.token));
        room.update(cx, |room, cx| room.select(other_id, window, cx));
        let current = open_held_form(&room, window, cx);
        write_title("Other folio's unfinished title 東京", window, cx);
        current
            .view
            .update(cx, |view, cx| view.flush_recovery(cx).unwrap());
        let recovery = recovery_snapshot(&current.view, cx);
        let focused = window
            .focused(cx)
            .expect("The current title must hold focus");
        let first_bytes = fs::read(store.document_path(first_id)).unwrap();
        let other_bytes = fs::read(store.document_path(other_id)).unwrap();
        room.update(cx, |room, cx| {
            room.file_dossier(
                held.view.clone(),
                request.token,
                request.submission.clone(),
                held.scope.clone(),
                window,
                cx,
            );
            assert_eq!(room.active, other_id);
            assert_eq!(
                room.dossier.as_ref().unwrap().entity_id(),
                current.view.entity_id()
            );
            assert!(room.error.is_none());
        });
        assert!(focused.is_focused(window));
        assert_recovery_unchanged(&recovery, &current.view, cx);
        assert_eq!(
            fs::read(store.document_path(first_id)).unwrap(),
            first_bytes
        );
        assert_eq!(
            fs::read(store.document_path(other_id)).unwrap(),
            other_bytes
        );
    })
    .unwrap();
    // Drain any accidentally scheduled save, then inspect the real library.
    cx.run_until_parked();
    assert_ne!(stored_document(&store, first_id).title, "Retired request Ω");
    assert_ne!(stored_document(&store, other_id).title, "Retired request Ω");
}

#[gpui_kit::test]
fn late_durable_success_cannot_clear_reopened_same_scope_recovery_or_move_focus(
    cx: &mut TestAppContext,
) {
    let (handle, room, store, _directory) = room(cx);
    let held = cx
        .update_window(handle, |_, window, cx| {
            let held = open_held_form(&room, window, cx);
            write_title("The first accepted edition Ω", window, cx);
            send_to_press(window, cx);
            held
        })
        .unwrap();
    let request = held.request();
    let original = cx.update(|cx| room.read(cx).active_document().clone());
    let filed = save_request(&store, original, &held.scope, request.clone());
    cx.update_window(handle, |_, window, cx| {
        let current = open_held_form(&room, window, cx);
        assert_ne!(current.view.entity_id(), held.view.entity_id());
        assert_eq!(current.scope.recovery, held.scope.recovery);
        write_title("Reopened draft keeps its final é", window, cx);
        current
            .view
            .update(cx, |view, cx| view.flush_recovery(cx).unwrap());
        let recovery = recovery_snapshot(&current.view, cx);
        let focused = window
            .focused(cx)
            .expect("The reopened title must hold focus");
        room.update(cx, |room, cx| {
            room.finish_dossier_filing(
                &held.view,
                request.token,
                &held.scope,
                Ok(filed.clone()),
                window,
                cx,
            );
            assert_eq!(
                room.dossier.as_ref().unwrap().entity_id(),
                current.view.entity_id()
            );
        });
        assert!(focused.is_focused(window));
        assert_recovery_unchanged(&recovery, &current.view, cx);
        assert!(!held.view.read(cx).accepts_filing(request.token));
        assert_eq!(stored_document(&store, held.scope.folio_id), filed);
    })
    .unwrap();
}

#[gpui_kit::test]
fn late_error_cannot_replace_reopened_form_state_or_take_its_focus(cx: &mut TestAppContext) {
    let (handle, room, store, _directory) = room(cx);
    let held = cx
        .update_window(handle, |_, window, cx| {
            let held = open_held_form(&room, window, cx);
            write_title("Old request", window, cx);
            send_to_press(window, cx);
            held
        })
        .unwrap();
    let request = held.request();
    let before = fs::read(store.document_path(held.scope.folio_id)).unwrap();
    cx.update_window(handle, |_, window, cx| {
        let current = open_held_form(&room, window, cx);
        assert_eq!(current.scope.recovery, held.scope.recovery);
        write_title("The new draft and focus stay here Ω", window, cx);
        current
            .view
            .update(cx, |view, cx| view.flush_recovery(cx).unwrap());
        let recovery = recovery_snapshot(&current.view, cx);
        let focused = window
            .focused(cx)
            .expect("The reopened title must hold focus");
        room.update(cx, |room, cx| {
            room.finish_dossier_filing(
                &held.view,
                request.token,
                &held.scope,
                Err(anyhow::anyhow!("The retired background write failed")),
                window,
                cx,
            );
            assert_eq!(
                room.dossier.as_ref().unwrap().entity_id(),
                current.view.entity_id()
            );
            assert!(room.error.is_none());
        });
        assert!(focused.is_focused(window));
        assert_recovery_unchanged(&recovery, &current.view, cx);
        window.render_frame(cx);
        assert!(window.try_find(("dossier-error", 0_usize)).is_none());
        assert_eq!(
            fs::read(store.document_path(held.scope.folio_id)).unwrap(),
            before
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn retired_receipt_cannot_acknowledge_reopened_forms_equal_token(cx: &mut TestAppContext) {
    let (handle, room, store, _directory) = room(cx);
    let held = cx
        .update_window(handle, |_, window, cx| {
            let held = open_held_form(&room, window, cx);
            write_title("Earlier receipt", window, cx);
            send_to_press(window, cx);
            held
        })
        .unwrap();
    let request = held.request();
    let original = cx.update(|cx| room.read(cx).active_document().clone());
    let filed = save_request(&store, original, &held.scope, request.clone());
    let current = cx
        .update_window(handle, |_, window, cx| {
            let current = open_held_form(&room, window, cx);
            assert_eq!(current.scope.recovery, held.scope.recovery);
            write_title("New submitted draft Ω", window, cx);
            send_to_press(window, cx);
            current
        })
        .unwrap();
    let new_request = current.request();
    // Counters are per view. Entity ownership must disambiguate equal tokens.
    assert_eq!(new_request.token, request.token);
    cx.update_window(handle, |_, window, cx| {
        let recovery = recovery_snapshot(&current.view, cx);
        assert_eq!(recovery.filing, FilingState::Filing);
        room.update(cx, |room, cx| {
            room.finish_dossier_filing(
                &held.view,
                request.token,
                &held.scope,
                Ok(filed.clone()),
                window,
                cx,
            );
            room.finish_dossier_filing(
                &held.view,
                request.token,
                &held.scope,
                Err(anyhow::anyhow!("Duplicate retired error")),
                window,
                cx,
            );
            assert_eq!(
                room.dossier.as_ref().unwrap().entity_id(),
                current.view.entity_id()
            );
        });
        assert_recovery_unchanged(&recovery, &current.view, cx);
        assert!(current.view.read(cx).accepts_filing(new_request.token));
        assert!(!held.view.read(cx).accepts_filing(request.token));
        assert_eq!(stored_document(&store, held.scope.folio_id), filed);
    })
    .unwrap();
}

#[gpui_kit::test]
fn newer_durable_base_rejects_old_request_and_keeps_its_dossier_draft(cx: &mut TestAppContext) {
    let (handle, room, store, _directory) = room(cx);
    let held = cx
        .update_window(handle, |_, window, cx| {
            let held = open_held_form(&room, window, cx);
            write_title("The pending Dossier is retained Ω", window, cx);
            send_to_press(window, cx);
            held
        })
        .unwrap();
    let request = held.request();
    let mut newer = cx.update(|cx| room.read(cx).active_document().clone());
    newer.notes = "A later saved revision from the same folio.".into();
    newer.touch();
    store.save_if_revision(&newer, held.scope.revision).unwrap();
    let durable = fs::read(store.document_path(newer.id)).unwrap();
    cx.update_window(handle, |_, window, cx| {
        let recovery = recovery_snapshot(&held.view, cx);
        room.update(cx, |room, cx| {
            *room
                .documents
                .iter_mut()
                .find(|document| document.id == newer.id)
                .unwrap() = newer.clone();
            room.file_dossier(
                held.view.clone(),
                request.token,
                request.submission.clone(),
                held.scope.clone(),
                window,
                cx,
            );
            assert_eq!(room.active_document(), &newer);
            assert_eq!(
                room.dossier.as_ref().unwrap().entity_id(),
                held.view.entity_id()
            );
        });
        assert_eq!(held.view.read(cx).session.filing, FilingState::Idle);
        assert_eq!(held.view.read(cx).filing_token(), None);
        assert_eq!(held.view.read(cx).session.draft, recovery.draft);
        assert_eq!(fs::read(&recovery.path).unwrap(), recovery.bytes);
        window.render_frame(cx);
        assert!(window.find(("dossier-error", 0_usize)).visible());
    })
    .unwrap();
    cx.run_until_parked();
    assert_eq!(fs::read(store.document_path(newer.id)).unwrap(), durable);
}

#[gpui_kit::test]
fn mismatched_submission_mode_never_files_or_discards_recovery(cx: &mut TestAppContext) {
    let (handle, room, store, _directory) = room(cx);
    let held = cx
        .update_window(handle, |_, window, cx| {
            let held = open_held_form(&room, window, cx);
            write_title("Mode-specific draft Ω", window, cx);
            send_to_press(window, cx);
            held
        })
        .unwrap();
    let mut request = held.request();
    assert_eq!(request.submission.mode, DossierMode::Create);
    request.submission.mode = DossierMode::Refine;
    let before = fs::read(store.document_path(held.scope.folio_id)).unwrap();
    cx.update_window(handle, |_, window, cx| {
        let recovery = recovery_snapshot(&held.view, cx);
        room.update(cx, |room, cx| {
            room.file_dossier(
                held.view.clone(),
                request.token,
                request.submission.clone(),
                held.scope.clone(),
                window,
                cx,
            );
        });
        assert_eq!(held.view.read(cx).session.filing, FilingState::Idle);
        assert_eq!(held.view.read(cx).filing_token(), None);
        assert_eq!(held.view.read(cx).session.draft, recovery.draft);
        assert_eq!(fs::read(&recovery.path).unwrap(), recovery.bytes);
        window.render_frame(cx);
        assert!(window.find(("dossier-error", 0_usize)).visible());
    })
    .unwrap();
    cx.run_until_parked();
    assert_eq!(
        fs::read(store.document_path(held.scope.folio_id)).unwrap(),
        before
    );
}

#[gpui_kit::test]
fn newer_live_revision_blocks_old_durable_receipt_without_clearing_recovery(
    cx: &mut TestAppContext,
) {
    let (handle, room, store, _directory) = room(cx);
    let held = cx
        .update_window(handle, |_, window, cx| {
            let held = open_held_form(&room, window, cx);
            write_title("A real saved result", window, cx);
            send_to_press(window, cx);
            held
        })
        .unwrap();
    let request = held.request();
    let original = cx.update(|cx| room.read(cx).active_document().clone());
    let filed = save_request(&store, original.clone(), &held.scope, request.clone());
    let mut newer = original;
    newer.notes = "Later live notes must remain in the room.".into();
    newer.touch();
    cx.update_window(handle, |_, window, cx| {
        let recovery = recovery_snapshot(&held.view, cx);
        room.update(cx, |room, cx| {
            *room
                .documents
                .iter_mut()
                .find(|document| document.id == newer.id)
                .unwrap() = newer.clone();
            room.notes.update(cx, |state, cx| {
                state.set_value(newer.notes.clone(), window, cx);
            });
            room.dirty = true;
            room.finish_dossier_filing(
                &held.view,
                request.token,
                &held.scope,
                Ok(filed.clone()),
                window,
                cx,
            );
            assert_eq!(room.active_document(), &newer);
            assert!(room.dirty);
            assert_eq!(
                room.dossier.as_ref().unwrap().entity_id(),
                held.view.entity_id()
            );
        });
        assert_eq!(held.view.read(cx).session.filing, FilingState::Idle);
        assert_eq!(held.view.read(cx).filing_token(), None);
        assert_eq!(held.view.read(cx).session.draft, recovery.draft);
        assert_eq!(fs::read(&recovery.path).unwrap(), recovery.bytes);
        assert_eq!(stored_document(&store, held.scope.folio_id), filed);
        window.render_frame(cx);
        assert!(window.find(("dossier-error", 0_usize)).visible());
    })
    .unwrap();
}

#[gpui_kit::test]
fn real_filing_failure_retains_draft_and_retry_saves_before_recovery_cleanup(
    cx: &mut TestAppContext,
) {
    let (handle, room, store, _directory) = room(cx);
    let form = cx
        .update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| room.open_dossier(window, cx));
            window.render_frame(cx);
            write_title("A filed title with final Ω", window, cx);
            room.read(cx).dossier.as_ref().unwrap().clone()
        })
        .unwrap();
    let id = cx.update(|cx| room.read(cx).active);
    let path = store.document_path(id);
    let held_path = path.with_extension("json.held-by-test");
    let before = fs::read(&path).unwrap();
    fs::rename(&path, &held_path).unwrap();
    fs::create_dir(&path).unwrap();
    let first_token = cx
        .update_window(handle, |_, window, cx| {
            send_to_press(window, cx);
            form.read(cx).filing_token().unwrap()
        })
        .unwrap();
    cx.run_until_parked();
    let recovery_path = cx
        .update_window(handle, |_, window, cx| {
            let recovery = recovery_snapshot(&form, cx);
            assert_eq!(form.read(cx).session.filing, FilingState::Idle);
            assert_eq!(form.read(cx).filing_token(), None);
            assert_eq!(
                recovery.draft.answers.working_title,
                "A filed title with final Ω"
            );
            assert_eq!(
                room.read(cx).dossier.as_ref().unwrap().entity_id(),
                form.entity_id()
            );
            assert_eq!(fs::read(&held_path).unwrap(), before);
            window.render_frame(cx);
            assert!(window.find(("dossier-error", 0_usize)).visible());
            recovery.path
        })
        .unwrap();
    fs::remove_dir(&path).unwrap();
    fs::rename(&held_path, &path).unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.click("dossier-next", cx);
        assert_ne!(form.read(cx).filing_token().unwrap(), first_token);
    })
    .unwrap();
    cx.run_until_parked();
    let saved = stored_document(&store, id);
    assert_eq!(saved.title, "A filed title with final Ω");
    let workspace = saved.workspace.as_ref().unwrap();
    assert_eq!(
        workspace.brief.as_ref().unwrap().answers.working_title,
        saved.title
    );
    assert_eq!(workspace.projection, ProjectionState::Verified);
    let source = workspace.canonical_source().unwrap();
    let projection = twyne_desktop::semantic_bridge::SemanticBridge::discover()
        .unwrap()
        .project(source)
        .unwrap();
    assert_eq!(projection.html, workspace.content.html);
    assert!(!source.is_empty());
    assert!(!recovery_path.exists());
    cx.update_window(handle, |_, window, cx| {
        assert!(room.read(cx).dossier.is_none());
        assert_eq!(room.read(cx).active_document(), &saved);
        assert_eq!(form.read(cx).session.filing, FilingState::Filed);
        assert_eq!(form.read(cx).filing_token(), None);
        window.render_frame(cx);
    })
    .unwrap();

    // A genuine Refine request updates the brief/title while keeping canonical
    // manuscript bytes. This uses the normal host subscription, not a receipt.
    let canonical = source.to_owned();
    let refined = cx
        .update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| room.open_dossier(window, cx));
            let refined = room.read(cx).dossier.as_ref().unwrap().clone();
            assert_eq!(refined.read(cx).session.options.mode, DossierMode::Refine);
            window.render_frame(cx);
            write_title("The refined saved title 東京", window, cx);
            send_to_press(window, cx);
            refined
        })
        .unwrap();
    cx.run_until_parked();
    let saved_refinement = stored_document(&store, id);
    assert_eq!(saved_refinement.title, "The refined saved title 東京");
    assert_eq!(
        saved_refinement
            .workspace
            .as_ref()
            .unwrap()
            .canonical_source(),
        Some(canonical.as_str())
    );
    assert!(saved_refinement.revision > saved.revision);
    cx.update(|cx| {
        assert!(room.read(cx).dossier.is_none());
        assert_eq!(refined.read(cx).session.filing, FilingState::Filed);
        assert!(
            !refined
                .read(cx)
                .session
                .options
                .recovery
                .as_ref()
                .unwrap()
                .path()
                .exists()
        );
    });
}
