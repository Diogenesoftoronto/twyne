//! Actual mounted application/control/marker regression on GPUI TestPlatform.
//! HeadlessAtlas key registration is not a GPU upload/presentation/OS receipt.

use super::{WritingRoom, tests::room};
use gpui_kit::test::TestWindowExt;
use gpui_kit::{AnyWindowHandle, App, Entity, FocusHandle, Role, TestAppContext, Window};
use serde_json::Value;
use std::collections::BTreeSet;
use twyne_desktop::{
    dossier::{DossierMode, DossierOptions, DossierRecovery, RecoveryIdentity},
    manuscript::timestamp,
    settings::AppearanceStore,
    theme::{ThemePreset, palette},
};

const TITLE: &str = "A retained Dossier — 東京 e\u{301}";
const SUFFIX: &str = " after Settings";
const MAX_FRAME_ROUNDS: usize = 6;

fn observation(room: &Entity<WritingRoom>, window: &Window, cx: &App) -> Value {
    let snapshot = room
        .read(cx)
        .capture_dossier_image_lifecycle(window, cx)
        .expect("Parent must review/apply the real ui-tests diagnostic patch first");
    assert_eq!(snapshot["schemaVersion"], 1);
    assert_eq!(snapshot["applicationQualified"], true);
    assert_eq!(
        snapshot["windowId"],
        window.window_handle().window_id().as_u64().to_string()
    );
    assert_eq!(snapshot["imagesTruncated"], 0);
    assert_eq!(snapshot["eventsDropped"], "0");
    assert_eq!(snapshot["eventSequenceExhausted"], false);
    snapshot
}

/// Draw the actual mounted view/marker and deliver its real deferred effects.
/// Never call Ledger::paint_receipt/retire_after_frame or construct a receipt.
/// TestWindowExt manually draws/clears a headless frame; this is not the OS
/// frame/presentation guarantee checked by the independent native-proof lane.
fn settle(
    cx: &mut TestAppContext,
    handle: AnyWindowHandle,
    room: &Entity<WritingRoom>,
    description: &str,
    ready: impl Fn(&Value) -> bool,
) -> Value {
    let mut last = Value::Null;
    for _ in 0..MAX_FRAME_ROUNDS {
        cx.run_until_parked();
        last = cx
            .update_window(handle, |_, window, cx| {
                window.simulate_next_frame(cx);
                window.render_frame(cx);
                observation(room, window, cx)
            })
            .unwrap();
        if ready(&last) {
            return last;
        }
    }
    panic!(
        "{description} did not settle in {MAX_FRAME_ROUNDS} actual headless draw/effect rounds: {last}"
    );
}

fn image_ids(snapshot: &Value) -> BTreeSet<String> {
    snapshot["images"]
        .as_array()
        .unwrap()
        .iter()
        .map(|image| image["id"].as_str().unwrap().to_owned())
        .collect()
}

fn title_input_value(window: &Window) -> String {
    let values = gpui_kit::base::test_support::snapshots(window)
        .into_iter()
        .filter(|snapshot| {
            snapshot
                .path()
                .contains(&gpui_kit::ElementId::from("dossier-answer-0"))
                && snapshot.role() == Some(Role::TextInput)
        })
        .map(|snapshot| snapshot.value().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        values.len(),
        1,
        "Read exactly one actual retained title input"
    );
    values.into_iter().next().unwrap()
}

fn title_focus(window: &Window, cx: &App) -> FocusHandle {
    let focused = window.focused(cx).expect("The real title input must focus");
    assert!(
        gpui_kit::base::test_support::snapshots(window)
            .iter()
            .any(|snapshot| {
                snapshot
                    .path()
                    .contains(&gpui_kit::ElementId::from("dossier-answer-0"))
                    && snapshot.role() == Some(Role::TextInput)
                    && snapshot.focused() == Some(true)
            })
    );
    focused
}

fn assert_actual_retirement(before: &Value, retired: &Value) {
    let events = retired["events"].as_array().unwrap();
    for old in before["images"].as_array().unwrap() {
        let drops = events
            .iter()
            .filter(|event| {
                event["stage"] == "atlas_drop" && event["details"]["imageId"] == old["id"]
            })
            .collect::<Vec<_>>();
        assert_eq!(drops.len(), 1, "Actual old ID must be retired once: {old}");
        let drop = drops[0];
        assert_eq!(drop["windowId"], before["windowId"]);
        assert_eq!(drop["registryWindowId"], before["windowId"]);
        assert_eq!(drop["windowQualified"], true);
        assert_eq!(drop["details"]["receipt"], drop["epoch"]);
        assert_eq!(drop["details"]["dropSucceeded"], true);
        assert_eq!(drop["details"]["presentBefore"], old["atlasPresent"]);
        assert_eq!(drop["details"]["presentAfter"], false);
        let marker = events
            .iter()
            .find(|event| {
                event["stage"] == "marker_receipt" && event["details"]["receipt"] == drop["epoch"]
            })
            .expect("Actual mounted marker, not a fabricated ledger receipt");
        assert_eq!(marker["windowId"], before["windowId"]);
        assert_eq!(marker["invalidatedEpoch"], drop["epoch"]);
        assert_eq!(marker["invalidationQueued"], false);
        assert!(
            marker["sequence"].as_str().unwrap().parse::<u64>().unwrap()
                < drop["sequence"].as_str().unwrap().parse::<u64>().unwrap()
        );
        let pending = marker["images"]
            .as_array()
            .unwrap()
            .iter()
            .find(|image| image["id"] == old["id"])
            .unwrap();
        assert_eq!(pending["active"], false);
        assert_eq!(pending["atlasPresent"], old["atlasPresent"]);
    }
}

#[cfg(any(target_os = "linux", target_os = "freebsd"))]
#[gpui_kit::test]
fn retained_dossier_settings_theme_and_back_keep_actual_title_and_scope(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    let (dossier, original_lease, original_focus, options) = cx
        .update_window(handle, |_, window, cx| {
            let dossier = view.update(cx, |room, cx| {
                room.open_dossier(window, cx);
                room.dossier.clone().expect("Open through the actual host")
            });
            window.render_frame(cx);
            window.click("dossier-answer-0", cx);
            window.press("secondary-a", cx);
            window.input(TITLE, cx);
            window.render_frame(cx);
            assert_eq!(title_input_value(window), TITLE);
            let focus = title_focus(window, cx);
            let form = dossier.read(cx);
            let lease = form
                .image_lease()
                .expect("Host attaches accepted images")
                .clone();
            assert!(lease.is_current());
            let options: DossierOptions = form.session.options.clone();
            (dossier.clone(), lease, focus, options)
        })
        .unwrap();
    let before = settle(
        cx,
        handle,
        &view,
        "actual initial prepared/painted images",
        |snapshot| {
            snapshot["consumerCount"] == 1
                && snapshot["activeCount"]
                    .as_u64()
                    .is_some_and(|count| count > 0)
                && snapshot["pendingCount"] == 0
                && snapshot["invalidationQueued"] == false
                && snapshot["images"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|image| image["atlasPresent"] == true)
        },
    );
    let old_ids = image_ids(&before);
    assert!(
        !old_ids.is_empty(),
        "At least actual prepared paper is required"
    );
    let identity: RecoveryIdentity = options.recovery_identity();
    assert_eq!(options.mode, DossierMode::Create);
    assert_eq!(
        identity.scope,
        format!("create:{}", options.folio_id.as_deref().unwrap())
    );
    assert_eq!(identity.owner, None);
    assert_eq!(identity.base, "0");
    let recovery = DossierRecovery::new(store.root().join("dossier-recovery"), identity.clone());

    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| room.open_settings(window, cx));
        window.render_frame(cx);
        assert!(window.find("settings-page").visible());
        assert!(window.try_find("dossier-form").is_none());
        assert_eq!(
            view.read(cx).dossier.as_ref().unwrap().entity_id(),
            dossier.entity_id()
        );
    })
    .unwrap();
    let retired = settle(
        cx,
        handle,
        &view,
        "retained route actually retires old lease/keys",
        |snapshot| {
            snapshot["consumerCount"] == 0
                && snapshot["trackedCount"] == 0
                && snapshot["pendingCount"] == 0
                && snapshot["invalidationQueued"] == false
        },
    );
    assert!(!original_lease.is_current());
    assert_eq!(retired["surface"]["dossierRetained"], true);
    assert_eq!(retired["surface"]["dossierMounted"], false);
    assert_actual_retirement(&before, &retired);
    assert_eq!(
        recovery
            .load(timestamp())
            .unwrap()
            .unwrap()
            .answers
            .working_title,
        TITLE
    );

    cx.update_window(handle, |_, window, cx| {
        window.click("settings-preset-nightpress", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let themed = settle(
        cx,
        handle,
        &view,
        "actual Nightpress callback leaves retired form unmounted",
        |snapshot| {
            snapshot["consumerCount"] == 0
                && snapshot["trackedCount"] == 0
                && snapshot["pendingCount"] == 0
        },
    );
    let appearance = AppearanceStore::open(store.root())
        .unwrap()
        .load()
        .unwrap()
        .record;
    assert_eq!(appearance.preference.preset, ThemePreset::Nightpress);
    assert_eq!(appearance.generation, 1);
    assert!(
        !original_lease.is_current(),
        "A real palette callback must not revive an old lease"
    );
    assert_eq!(themed["epoch"], retired["epoch"]);
    assert_eq!(
        themed["latestEventSequence"],
        retired["latestEventSequence"]
    );
    cx.update_window(handle, |_, window, cx| {
        assert!(palette(cx).dark);
        assert!(window.find("settings-saved-status").visible());
        assert_eq!(
            view.read(cx).dossier.as_ref().unwrap().entity_id(),
            dossier.entity_id()
        );
        window.click("settings-back", cx);
        assert!(window.try_find("settings-page").is_none());
        assert!(window.find("dossier-form").visible());
    })
    .unwrap();
    let resumed = settle(
        cx,
        handle,
        &view,
        "actual Back prepares/paints a fresh accepted lease",
        |snapshot| {
            snapshot["consumerCount"] == 1
                && snapshot["activeCount"]
                    .as_u64()
                    .is_some_and(|count| count > 0)
                && snapshot["pendingCount"] == 0
                && snapshot["invalidationQueued"] == false
                && snapshot["images"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|image| image["atlasPresent"] == true)
        },
    );
    assert_eq!(resumed["surface"]["dossierRetained"], true);
    assert_eq!(resumed["surface"]["dossierMounted"], true);
    assert_ne!(resumed["consumerIds"], before["consumerIds"]);
    assert_ne!(
        image_ids(&resumed),
        old_ids,
        "Current palette must actually prepare new paper, not paint old accepted pointers"
    );
    assert!(
        !original_lease.is_current(),
        "The old lease must stay retired after a fresh attachment"
    );
    cx.update_window(handle, |_, window, cx| {
        assert_eq!(
            view.read(cx).dossier.as_ref().unwrap().entity_id(),
            dossier.entity_id()
        );
        assert!(dossier.read(cx).image_lease().unwrap().is_current());
        assert_eq!(
            dossier.read(cx).session.options.recovery_identity(),
            identity
        );
        window.click("dossier-answer-0", cx);
        assert_eq!(
            title_focus(window, cx),
            original_focus,
            "The actual title input identity must survive, not be recreated/hydrated"
        );
        assert_eq!(title_input_value(window), TITLE);
        window.press("end", cx);
        window.input(SUFFIX, cx);
        window.render_frame(cx);
        assert_eq!(title_input_value(window), format!("{TITLE}{SUFFIX}"));
        assert!(original_focus.is_focused(window));
        // Read the real retained control synchronously at this explicit
        // boundary, including a Change notification which may still be queued.
        dossier
            .update(cx, |form, cx| form.flush_recovery(cx))
            .unwrap();
    })
    .unwrap();
    let loaded = recovery.load(timestamp()).unwrap().unwrap();
    assert_eq!(loaded.answers.working_title, format!("{TITLE}{SUFFIX}"));
    assert_eq!(loaded.step, 0);
    let raw: Value = serde_json::from_slice(&std::fs::read(recovery.path()).unwrap()).unwrap();
    assert_eq!(raw["identity"], serde_json::to_value(identity).unwrap());
    assert_eq!(
        raw["draft"]["answers"]["workingTitle"],
        format!("{TITLE}{SUFFIX}")
    );
}
