//! Native account transport and offline sync consistency. Module loading makes
//! no account requests. The host supplies an approved callback registration,
//! owns the resident SDK helper, and attaches a partition after accepted auth.
//! Journal identities supplied by callers remain consistency inputs, not proof.

pub mod auth;
pub mod callback;
pub mod journal;
pub mod knowledge_wire;
pub mod protocol;
pub mod store;
pub mod transport;

pub use auth::{AccountIdentity, SessionLease};
pub use journal::{AccountJournal, ApplyReceipt, Conflict, Dispatch, PushAcknowledgement};
pub use protocol::{PullSnapshot, SyncPayload};
pub use store::{AccountSyncStore, LoadedJournal};

#[cfg(test)]
mod tests;
