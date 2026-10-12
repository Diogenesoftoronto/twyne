//! Original four in-flow writing tools, with Source-compatible spec validation.
//!
//! A model can only append variants/questions; it cannot replace writer text.
//! The view and document/provider adapters own their separate freshness gates.

pub mod budget;
pub mod classification;
pub mod model;
pub mod notebook;
pub mod passage;
pub mod position;
pub mod props;
pub mod saved;
pub mod seed;
pub mod spec;
pub mod step_map;
pub mod store;
pub mod stream;
pub mod struggle;

#[cfg(feature = "desktop")]
mod border;
#[cfg(feature = "desktop")]
pub mod card;
#[cfg(feature = "desktop")]
mod input;
#[cfg(feature = "desktop")]
mod support_text;
#[cfg(feature = "desktop")]
pub mod view;

#[cfg(test)]
mod budget_oracle_tests;
#[cfg(test)]
mod classification_oracle_tests;
#[cfg(test)]
mod integration_oracle_tests;

#[cfg(test)]
mod seed_oracle_tests;
#[cfg(test)]
mod source_oracle_tests;
#[cfg(test)]
mod step_map_oracle_tests;
#[cfg(test)]
mod struggle_oracle_tests;
