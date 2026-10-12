//! Observed native interface bounds for the isolated capture tool only.

use crate::app::WritingRoom;
use gpui_kit::{App, WeakEntity, Window};
use std::path::PathBuf;

pub(super) fn schedule(
    window: &mut Window,
    path: PathBuf,
    frames: u8,
    watch: bool,
    room: WeakEntity<WritingRoom>,
) {
    window.on_next_frame(move |window, cx| {
        if frames > 0 {
            schedule(window, path, frames - 1, watch, room);
        } else {
            match write_geometry(window, &path, cx, &room, 1) {
                Ok(()) => println!("TWYNE_CAPTURE_GEOMETRY_READY"),
                Err(error) => eprintln!("TWYNE_CAPTURE_GEOMETRY_ERROR: {error:#}"),
            }
            if watch {
                observe_next_frame(window, path, room, 2);
            }
        }
    });
    window.refresh();
}

fn observe_next_frame(
    window: &mut Window,
    path: PathBuf,
    room: WeakEntity<WritingRoom>,
    sequence: u64,
) {
    window.on_next_frame(move |window, cx| {
        if let Err(error) = write_geometry(window, &path, cx, &room, sequence) {
            eprintln!("TWYNE_CAPTURE_GEOMETRY_ERROR: {error:#}");
        } else if let Some(next) = sequence.checked_add(1) {
            observe_next_frame(window, path, room, next);
        } else {
            eprintln!("TWYNE_CAPTURE_GEOMETRY_ERROR: observation sequence exhausted");
        }
    });
}

fn write_geometry(
    window: &Window,
    path: &std::path::Path,
    cx: &App,
    room: &WeakEntity<WritingRoom>,
    sequence: u64,
) -> anyhow::Result<()> {
    let elements = gpui_kit::base::test_support::snapshots(window)
        .into_iter()
        .map(|snapshot| {
            let bounds = snapshot.bounds();
            serde_json::json!({
                "path": snapshot.path().iter().map(|id| format!("{id:?}")).collect::<Vec<_>>(),
                "rect": {
                    "x": f32::from(bounds.left()), "y": f32::from(bounds.top()),
                    "width": f32::from(bounds.size.width), "height": f32::from(bounds.size.height),
                },
                "visible": snapshot.visible(),
                "label": snapshot.label(),
                "role": snapshot.role().map(|role| format!("{role:?}")),
                "value": snapshot.value(),
                "expanded": snapshot.expanded(),
                "disabled": snapshot.disabled(),
                "focused": snapshot.focused(),
            })
        })
        .collect::<Vec<_>>();
    let viewport = window.viewport_size();
    let record = serde_json::json!({
        "captureSequence": sequence.to_string(),
        "windowId": window.window_handle().window_id().as_u64().to_string(),
        "scaleFactor": window.scale_factor(),
        "dossierPreparationCpu": twyne_desktop::dossier_paper::resize_diagnostic_snapshot(),
        "dossierImageLifecycle": room.upgrade().and_then(|room| room.read(cx).capture_dossier_image_lifecycle(window, cx)),
        "viewport": {"width": f32::from(viewport.width), "height": f32::from(viewport.height)},
        "windowOrigin": {"x": f32::from(window.bounds().left()), "y": f32::from(window.bounds().top())},
        "elements": elements,
        "keyboardInput": window.last_input_was_keyboard(),
        "windowActive": window.is_window_active(),
        "captureReady": room.upgrade().is_some_and(|room| room.read(cx).capture_apparatus_ready(cx)),
    });
    std::fs::write(path, serde_json::to_vec_pretty(&record)?)?;
    Ok(())
}
