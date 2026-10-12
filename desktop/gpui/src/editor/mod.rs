//! Twyne's structured visual document model.
//!
//! HTML is the interoperable visual projection used by the existing editor.
//! This module retains that tree, including unknown attributes and source
//! atoms. Authored Typst belongs to the workspace/session layer and is never
//! generated here from a cached HTML projection.
//!
//! Selection offsets count Unicode scalar values in `editing_text()`, not
//! UTF-8 bytes or UTF-16 code units. Text blocks end with one synthetic newline;
//! inline/block atoms occupy one U+FFFC object replacement character. Native
//! views can use `blocks()` and their ranges without flattening the document
//! into a Markdown editor. HTML and human-readable text are derived only when
//! requested; editing/history use shared trees with cached subtree lengths.

mod block_moves;
mod clipboard;
#[cfg(all(feature = "desktop", target_os = "linux"))]
pub mod clipboard_wayland;
#[cfg(all(feature = "desktop", target_os = "linux"))]
pub mod clipboard_x11;
mod command;
mod comments;
mod html;
mod model;
pub mod pagination;
mod recase;
mod tables;
mod transaction;

pub use block_moves::{BlockMovePlan, DropPlacement};
pub use clipboard::RichFragment;
pub use command::*;
pub use comments::{CommentAttributes, CommentRange};
pub use html::{HTML_LIMITS, HtmlImport, HtmlLimits, HtmlUsage};
pub use model::*;
pub use transaction::{CommandOutcome, EditDelta, RichEditor};

#[cfg(feature = "desktop")]
pub mod view;

#[cfg(feature = "desktop")]
pub mod math_source_editor;

#[cfg(test)]
mod tests;
