//! Owned-display cross-process transport probe; never defaults to DISPLAY.

#[cfg(target_os = "linux")]
fn main() -> anyhow::Result<()> {
    use std::{
        sync::Arc,
        time::{Duration, Instant},
    };
    use twyne_desktop::editor::clipboard_x11::{ClipboardOffer, ClipboardPaste, X11Clipboard};

    let args = std::env::args().skip(1).collect::<Vec<_>>();
    anyhow::ensure!(
        args.len() >= 3 && args[1].starts_with(':'),
        "usage: twyne-clipboard-probe publish|read|check :OWNED_DISPLAY file [ready-file] [stop-file]"
    );
    if args[0] == "ui" {
        return native_view::run(&args);
    }
    if args[0] == "wrap" {
        return native_wrap::run(&args);
    }
    if args[0] == "drag" {
        return native_drag::run(&args);
    }
    if args[0] == "typography" {
        return native_typography::run(&args);
    }
    if matches!(args[0].as_str(), "oversized-incr" | "stalled-incr") {
        return adversary(&args);
    }
    let clipboard = X11Clipboard::connect(Some(&args[1]))?;
    match args[0].as_str() {
        "publish" | "publish-rich" => {
            let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&args[2])?)?;
            let offer = if args[0] == "publish-rich" {
                let document = twyne_desktop::editor::RichDocument::from_html(
                    value["html"].as_str().unwrap_or(""),
                )?;
                let start = value["start"].as_u64().unwrap_or(0) as usize;
                let end = value["end"]
                    .as_u64()
                    .map_or(document.text_len(), |end| end as usize);
                ClipboardOffer::rich(&document.copy_fragment(start..end)?)?
            } else {
                ClipboardOffer {
                    text: Arc::from(value["text"].as_str().unwrap_or("")),
                    html: value["html"].as_str().map(Arc::from),
                    native_metadata: value["native_metadata"].as_str().map(Arc::from),
                }
            };
            let owner = clipboard.publish(offer)?;
            if let Some(ready) = args.get(3) {
                std::fs::write(ready, format!("{owner:?}"))?;
            }
            let deadline = Instant::now() + Duration::from_secs(30);
            while Instant::now() < deadline {
                if args
                    .get(4)
                    .is_some_and(|stop| std::path::Path::new(stop).exists())
                {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        "read" | "check" | "owner-check" => {
            let snapshot = clipboard
                .read()?
                .ok_or_else(|| anyhow::anyhow!("No clipboard owner"))?;
            if args[0] == "owner-check" {
                if let Some(ready) = args.get(3) {
                    std::fs::write(ready, b"read")?;
                }
                let stop = args
                    .get(4)
                    .ok_or_else(|| anyhow::anyhow!("owner-check requires a release file"))?;
                let deadline = Instant::now() + Duration::from_secs(10);
                while !std::path::Path::new(stop).exists() && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
            let paste = snapshot.paste()?;
            let (kind, html) = match paste {
                ClipboardPaste::Rich(fragment) => ("rich", Some(fragment.to_html())),
                ClipboardPaste::Plain(_) => ("plain", None),
                ClipboardPaste::Empty => ("empty", None),
            };
            let result = serde_json::json!({
                "kind": kind, "text": snapshot.text, "html": snapshot.html,
                "fragment_html": html, "native_metadata": snapshot.native_metadata,
                "rtf_offered": snapshot.rtf_offered, "owner_current": clipboard.is_current(snapshot.owner)?,
                "incremental_transfers": snapshot.incremental_transfers,
            });
            std::fs::write(&args[2], serde_json::to_vec_pretty(&result)?)?;
        }
        _ => anyhow::bail!("Unknown clipboard probe mode"),
    }
    Ok(())
}

#[cfg(target_os = "linux")]
#[path = "clipboard-native-view.rs"]
mod native_view;

#[cfg(target_os = "linux")]
#[path = "long-word-native.rs"]
mod native_wrap;

#[cfg(target_os = "linux")]
#[path = "block-drag-native.rs"]
mod native_drag;

#[cfg(target_os = "linux")]
#[path = "notebook-typography-native.rs"]
mod native_typography;

#[cfg(target_os = "linux")]
fn adversary(args: &[String]) -> anyhow::Result<()> {
    use std::time::{Duration, Instant};
    use x11rb::{
        connection::Connection,
        protocol::{
            Event,
            xproto::{
                AtomEnum, ConnectionExt, CreateWindowAux, EventMask, PropMode,
                SELECTION_NOTIFY_EVENT, SelectionNotifyEvent, WindowClass,
            },
        },
        wrapper::ConnectionExt as _,
    };
    let (connection, screen) = x11rb::connect(Some(args[1].as_str()))?;
    let root = &connection.setup().roots[screen];
    let window = connection.generate_id()?;
    connection
        .create_window(
            x11rb::COPY_DEPTH_FROM_PARENT,
            window,
            root.root,
            0,
            0,
            1,
            1,
            0,
            WindowClass::INPUT_OUTPUT,
            root.root_visual,
            &CreateWindowAux::new(),
        )?
        .check()?;
    let atom = |name: &[u8]| -> anyhow::Result<u32> {
        Ok(connection.intern_atom(false, name)?.reply()?.atom)
    };
    let clipboard = atom(b"CLIPBOARD")?;
    let targets = atom(b"TARGETS")?;
    let utf8 = atom(b"UTF8_STRING")?;
    let incr = atom(b"INCR")?;
    connection
        .set_selection_owner(window, clipboard, x11rb::CURRENT_TIME)?
        .check()?;
    connection.flush()?;
    if let Some(ready) = args.get(3) {
        std::fs::write(ready, b"ready")?;
    }
    let deadline = Instant::now() + Duration::from_secs(12);
    while Instant::now() < deadline {
        if args
            .get(4)
            .is_some_and(|stop| std::path::Path::new(stop).exists())
        {
            break;
        }
        if let Some(Event::SelectionRequest(event)) = connection.poll_for_event()? {
            let property = if event.property == x11rb::NONE {
                event.target
            } else {
                event.property
            };
            let mut notify = SelectionNotifyEvent {
                response_type: SELECTION_NOTIFY_EVENT,
                sequence: 0,
                time: event.time,
                requestor: event.requestor,
                selection: event.selection,
                target: event.target,
                property: x11rb::NONE,
            };
            if event.target == targets {
                connection
                    .change_property32(
                        PropMode::REPLACE,
                        event.requestor,
                        property,
                        AtomEnum::ATOM,
                        &[targets, utf8],
                    )?
                    .check()?;
                notify.property = property;
            } else if event.target == utf8 {
                let size = if args[0] == "oversized-incr" {
                    64 * 1024 * 1024 + 1
                } else {
                    1
                };
                connection
                    .change_property32(PropMode::REPLACE, event.requestor, property, incr, &[size])?
                    .check()?;
                notify.property = property;
            }
            connection
                .send_event(false, event.requestor, EventMask::NO_EVENT, notify)?
                .check()?;
            connection.flush()?;
        } else {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("This bounded transport probe requires an owned X11 display on Linux");
}
