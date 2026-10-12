//! In-document insertion commands. Pure contracts/adapters are independent of
//! the GPUI menu and workspace host, so each can be maintained separately.
mod catalog;
mod context;
mod filter;
pub mod markdown;
pub mod modal_spec;
pub mod parameters;
pub mod rich;
pub mod table_grid;
pub use catalog::{Candidate, CommandDefinition, candidates, commands};
pub use context::{SlashQuery, detect, detect_rich};

#[cfg(feature = "desktop")]
pub mod form;
#[cfg(feature = "desktop")]
pub mod table_picker;
#[cfg(feature = "desktop")]
pub mod view;

#[cfg(test)]
mod tests;
