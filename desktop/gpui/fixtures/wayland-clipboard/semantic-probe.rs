//! Uses the existing actual RichDocument implementation with the exact owned
//! adapter. The standalone protocol library has no installed application.
pub use twyne_desktop::editor::{EditorError, HTML_LIMITS, RichFragment};
pub mod editor {
    pub use twyne_desktop::editor::RichDocument;
}
#[allow(dead_code)]
#[path = "../../src/editor/clipboard_wayland.rs"]
mod clipboard_wayland;
