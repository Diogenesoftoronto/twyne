//! Standalone runner for the in-module `#[cfg(test)]` tests of the
//! `dossier_conversation` slice, compiled with rustc test semantics
//! against cached target deps (no Cargo execution, which the parent owns).
//!
//! Usage (from the repository root, with the nix gcc wrapper on PATH):
//! ```text
//! rtk proxy rustc --edition 2024 --test \
//!   desktop/gpui/fixtures/dossier-conversation/native_unit_test.rs \
//!   -o /tmp/dossier_conversation_unit \
//!   --extern twyne_desktop=desktop/gpui/target/debug/libtwyne_desktop.rlib \
//!   --extern serde=desktop/gpui/target/debug/deps/libserde-010749ac3c6af426.rlib \
//!   --extern serde_json=desktop/gpui/target/debug/deps/libserde_json-5d3ae3515dd65969.rlib \
//!   --extern anyhow=desktop/gpui/target/debug/deps/libanyhow-b347aa55b430c21e.rlib \
//!   --extern uuid=desktop/gpui/target/debug/deps/libuuid-256f8653e5ad68e8.rlib \
//!   --extern tempfile=desktop/gpui/target/debug/deps/libtempfile-*.rlib \
//!   -L desktop/gpui/target/debug/deps
//! ```
//! Then run the produced binary (add `--nocapture` as needed).

extern crate twyne_desktop;
extern crate serde;
extern crate serde_json;
extern crate anyhow;
extern crate uuid;
extern crate tempfile;

pub use twyne_desktop::{dossier, house, manuscript, workspace};

#[path = "../../src/dossier_conversation/mod.rs"]
pub mod dossier_conversation;
