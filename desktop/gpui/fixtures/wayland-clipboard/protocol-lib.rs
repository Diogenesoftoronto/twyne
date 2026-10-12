//! Standalone copy of the exact owned transport API for adapter tests before
//! Root applies the integration patch. It never installs a Wayland client.
#[allow(dead_code)]
#[path = "../../vendor/gpui-pre-linux/src/linux/wayland/rich_clipboard.rs"]
mod rich_clipboard;
pub use rich_clipboard::{
    Formats, PendingPublication, PublicationToken, RichClipboardHandle, SelectionToken,
    current_rich_clipboard,
};
