//! Incomplete Typst stays separate from the last committed manuscript.
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceDraft {
    pub folio_id: Uuid,
    pub source: String,
    pub base_source: String,
    pub updated_at: u64,
}

/// A tombstone prevents a late autosave from resurrecting a discarded draft.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct SourceDraftRecord {
    pub generation: u64,
    pub draft: Option<SourceDraft>,
}

#[derive(Clone, Debug)]
pub struct SourceSession {
    pub folio_id: Uuid,
    pub generation: u64,
    pub canonical_source: String,
    pub base_source: String,
    pub source: String,
    pub pending: bool,
    pub conflict: bool,
}

impl SourceSession {
    pub fn open(folio_id: Uuid, canonical: &str, saved: SourceDraftRecord) -> Self {
        let recovered = saved.draft.filter(|draft| draft.folio_id == folio_id);
        let source = recovered
            .as_ref()
            .map_or(canonical, |draft| draft.source.as_str())
            .to_owned();
        let base_source = recovered
            .as_ref()
            .map_or(canonical, |draft| draft.base_source.as_str())
            .to_owned();
        let pending = source != canonical;
        let conflict = pending && base_source != canonical;
        Self {
            folio_id,
            generation: saved.generation,
            canonical_source: canonical.to_owned(),
            base_source,
            source,
            pending,
            conflict,
        }
    }

    /// Call when native input changes, before idle derivation or compilation.
    pub fn advance(&mut self) -> u64 {
        self.generation = self.generation.saturating_add(1);
        self.pending = true;
        self.generation
    }

    pub fn capture(&mut self, source: String, now: u64) -> SourceDraftRecord {
        self.source = source;
        self.pending = self.source != self.canonical_source;
        if !self.pending {
            self.conflict = false;
        }
        self.record(now)
    }

    pub fn record(&self, now: u64) -> SourceDraftRecord {
        SourceDraftRecord {
            generation: self.generation,
            draft: self.pending.then(|| SourceDraft {
                folio_id: self.folio_id,
                source: self.source.clone(),
                base_source: self.base_source.clone(),
                updated_at: now,
            }),
        }
    }

    pub fn discard(&mut self, latest: &str, now: u64) -> SourceDraftRecord {
        self.advance();
        self.canonical_source = latest.to_owned();
        self.base_source = latest.to_owned();
        self.source = latest.to_owned();
        self.pending = false;
        self.conflict = false;
        self.record(now)
    }

    pub fn accepts(&self, generation: u64, source: &str) -> bool {
        self.generation == generation && self.source == source
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incomplete_source_recovers_without_replacing_the_manuscript() {
        let id = Uuid::new_v4();
        let mut session = SourceSession::open(id, "= Published\r\n", SourceDraftRecord::default());
        session.advance();
        let draft = session.capture("#let unfinished = (".into(), 123);
        let recovered = SourceSession::open(id, "= Published\r\n", draft);
        assert!(recovered.pending && !recovered.conflict);
        assert_eq!(recovered.canonical_source, "= Published\r\n");
        assert_eq!(recovered.source, "#let unfinished = (");
    }

    #[test]
    fn a_newer_manuscript_keeps_recovered_source_as_a_conflict() {
        let id = Uuid::new_v4();
        let saved = SourceDraftRecord {
            generation: 4,
            draft: Some(SourceDraft {
                folio_id: id,
                source: "My edit".into(),
                base_source: "Original".into(),
                updated_at: 10,
            }),
        };
        let mut session = SourceSession::open(id, "Newer manuscript", saved);
        assert!(session.pending && session.conflict);
        assert_eq!(session.source, "My edit");
        let cleared = session.discard("Newer manuscript", 11);
        assert_eq!(cleared.generation, 5);
        assert!(cleared.draft.is_none());
        assert!(!session.accepts(4, "My edit"));
        assert!(!session.pending && !session.conflict);
    }
}
