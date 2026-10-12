//! The offline Cast retains the web roster and editorial artifacts. Provider
//! work and persona marks are separate capabilities owned by the application.

use crate::{exchange::OptionalField, house::is_js_whitespace, workspace::ExtraFields};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

pub const CAST_FORMAT: &str = "twyne-gpui-cast";
pub const CAST_VERSION: u64 = 1;
pub const MAX_CAST_BYTES: usize = 16 * 1024 * 1024;
pub type CastReplyDrafts = BTreeMap<String, BTreeMap<String, String>>;

macro_rules! open_enum {
    ($name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub enum $name { $($variant,)+ Other(String) }
        impl $name {
            pub fn as_str(&self) -> &str {
                match self { $(Self::$variant => $wire,)+ Self::Other(value) => value }
            }
        }
        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok,S::Error> {
                serializer.serialize_str(self.as_str())
            }
        }
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self,D::Error> {
                let value = String::deserialize(deserializer)?;
                Ok(match value.as_str() { $($wire => Self::$variant,)+ _ => Self::Other(value) })
            }
        }
    };
}
open_enum!(AssistanceLevel { Comments => "comments", Sentence => "sentence", Paragraph => "paragraph" });
open_enum!(FeedbackKind { Encouragement => "encouragement", Suggestion => "suggestion", Critique => "critique", Perspective => "perspective" });
open_enum!(FeedbackOrigin { Convened => "convened", Background => "background" });
open_enum!(PersonaReplyAuthor { User => "user", Persona => "persona" });
impl FeedbackKind {
    pub fn label(&self) -> &str {
        match self {
            Self::Encouragement => "in defense of",
            Self::Suggestion => "a small suggestion",
            Self::Critique => "a counter-reading",
            Self::Perspective => "from the audience",
            Self::Other(value) => value,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Persona {
    pub id: String,
    pub name: String,
    pub role: String,
    pub color: String,
    pub icon: String,
    pub description: String,
    pub focus: String,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub backstory: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub critical_method: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub voice: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub signature_moves: OptionalField<Vec<String>>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub avoidances: OptionalField<Vec<String>>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub sample_lines: OptionalField<Vec<String>>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub speech_voice: OptionalField<String>,
    /// Unknown provider keys and null overrides remain retained metadata.
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub speech_voices: OptionalField<BTreeMap<String, Value>>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub provider_id: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub model: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub temperature: OptionalField<f64>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersonaFeedback {
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub folio_id: OptionalField<String>,
    pub persona_id: String,
    pub persona_name: String,
    pub persona_color: String,
    pub feedback: String,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub trace_id: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub paragraph_index: OptionalField<u64>,
    pub timestamp: u64,
    #[serde(rename = "type")]
    pub kind: FeedbackKind,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub anchor: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub note_id: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub brief_title: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub origin: OptionalField<FeedbackOrigin>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl PersonaFeedback {
    pub fn reference(&self, artifact_scope: &str) -> Option<CastNoteRef> {
        self.note_id
            .as_ref()
            .filter(|id| !id.is_empty())
            .map(|id| CastNoteRef {
                folio_id: artifact_scope.into(),
                id: id.clone(),
            })
    }
    pub fn in_passing(&self) -> bool {
        self.origin.as_ref() == Some(&FeedbackOrigin::Background)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersonaReply {
    pub id: String,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub folio_id: OptionalField<String>,
    pub note_id: String,
    pub author: String,
    pub author_kind: PersonaReplyAuthor,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub persona_id: OptionalField<String>,
    pub text: String,
    pub timestamp: u64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl PersonaReply {
    pub fn writer(target: &CastNoteRef, text: String, now: u64) -> Self {
        Self {
            id: format!("preply-{now}-{}", Uuid::new_v4()),
            folio_id: OptionalField::Value(target.folio_id.clone()),
            note_id: target.id.clone(),
            author: "You".into(),
            author_kind: PersonaReplyAuthor::User,
            persona_id: OptionalField::Missing,
            text: text.trim_matches(is_js_whitespace).into(),
            timestamp: now,
            extra: ExtraFields::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoomSettings {
    pub level: AssistanceLevel,
    pub max_proposals: u64,
    pub max_large_edits: u64,
    pub persona_scope: Vec<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub per_persona: OptionalField<BTreeMap<String, OptionalField<AssistanceLevel>>>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub background_room: OptionalField<bool>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl Default for RoomSettings {
    fn default() -> Self {
        Self {
            level: AssistanceLevel::Sentence,
            max_proposals: 6,
            max_large_edits: 2,
            persona_scope: Vec::new(),
            per_persona: OptionalField::Missing,
            background_room: OptionalField::Value(true),
            extra: ExtraFields::new(),
        }
    }
}
impl RoomSettings {
    pub fn effective_level(&self, id: &str) -> &AssistanceLevel {
        self.per_persona
            .as_ref()
            .and_then(|levels| levels.get(id))
            .and_then(OptionalField::as_ref)
            .unwrap_or(&self.level)
    }
    pub fn may_propose(&self, id: &str) -> bool {
        self.persona_scope.is_empty() || self.persona_scope.iter().any(|value| value == id)
    }
    pub fn background_enabled(&self) -> bool {
        self.background_room.as_ref() != Some(&false)
    }
    pub fn toggle_level(&mut self, id: &str, level: AssistanceLevel) {
        let mut overrides = self.per_persona.as_ref().cloned().unwrap_or_default();
        if overrides.get(id).and_then(OptionalField::as_ref) == Some(&level) {
            overrides.remove(id);
        } else {
            overrides.insert(id.into(), OptionalField::Value(level));
        }
        self.per_persona = OptionalField::Value(overrides);
    }
    /// Exact original narrowing: [] means all, but its first toggle yields [id].
    pub fn toggle_scope(&mut self, id: &str) {
        if self.persona_scope.iter().any(|value| value == id) {
            self.persona_scope.retain(|value| value != id);
        } else {
            self.persona_scope.push(id.into());
        }
    }
    /// The original only prunes scope when a truthy per-editor override exists.
    /// Unrecognized/foreign references outside that one explicit removal survive.
    pub fn removed_persona(&mut self, id: &str) {
        if self
            .per_persona
            .as_ref()
            .and_then(|levels| levels.get(id))
            .and_then(OptionalField::as_ref)
            .is_some_and(|level| !level.as_str().is_empty())
        {
            let mut overrides = self.per_persona.as_ref().unwrap().clone();
            overrides.remove(id);
            self.per_persona = OptionalField::Value(overrides);
            self.persona_scope.retain(|value| value != id);
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersonaMemo {
    pub persona_id: String,
    pub persona_name: String,
    pub persona_color: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub anchor: OptionalField<String>,
    pub provider: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoomAnalysis {
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub folio_id: OptionalField<String>,
    pub memos: Vec<PersonaMemo>,
    pub synthesis: String,
    pub synthesis_provider: String,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub brief_title: OptionalField<String>,
    pub timestamp: u64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct CastNoteRef {
    /// Original artifact-path identity; never inferred from a backup catalog.
    pub folio_id: String,
    pub id: String,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CastFolioArtifacts {
    #[serde(default)]
    pub notes: Vec<PersonaFeedback>,
    #[serde(default)]
    pub replies: Vec<PersonaReply>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub analysis: OptionalField<RoomAnalysis>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

pub fn resident_personas() -> &'static [Persona] {
    static PERSONAS: OnceLock<Vec<Persona>> = OnceLock::new();
    PERSONAS.get_or_init(|| {
        serde_json::from_str(include_str!("../fixtures/cast/resident-personas.json"))
            .expect("the TS-produced resident Cast fixture is valid")
    })
}
pub fn mounted_personas(retained: &OptionalField<Vec<Persona>>) -> Vec<Persona> {
    retained
        .as_ref()
        .filter(|personas| !personas.is_empty())
        .map_or_else(|| resident_personas().to_vec(), Clone::clone)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum PersonaField {
    Name,
    Role,
    Description,
    Focus,
    Backstory,
    CriticalMethod,
    Voice,
    SignatureMoves,
    Avoidances,
    SampleLines,
    Icon,
    Color,
}
impl PersonaField {
    pub const ALL: [Self; 12] = [
        Self::Icon,
        Self::Name,
        Self::Role,
        Self::Description,
        Self::Focus,
        Self::Backstory,
        Self::CriticalMethod,
        Self::Voice,
        Self::SignatureMoves,
        Self::Avoidances,
        Self::SampleLines,
        Self::Color,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Self::Name => "Editor name",
            Self::Role => "Role",
            Self::Description => "Voice description",
            Self::Focus => "Focus",
            Self::Backstory => "Short backstory",
            Self::CriticalMethod => "Editorial doctrine",
            Self::Voice => "Voiceprint",
            Self::SignatureMoves => "Signature moves, one per line",
            Self::Avoidances => "Never does, one per line",
            Self::SampleLines => "Sample lines, one per line",
            Self::Icon => "Editor icon",
            Self::Color => "Colour",
        }
    }
    pub fn is_multiline(self) -> bool {
        matches!(
            self,
            Self::Description
                | Self::Backstory
                | Self::CriticalMethod
                | Self::Voice
                | Self::SignatureMoves
                | Self::Avoidances
                | Self::SampleLines
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CastPersonaDraft {
    /// Missing means a new editor; Value retains the exact prior edited object.
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub base: OptionalField<Persona>,
    pub fields: BTreeMap<PersonaField, String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl CastPersonaDraft {
    pub fn new_editor() -> Self {
        let mut fields = PersonaField::ALL
            .into_iter()
            .map(|field| (field, String::new()))
            .collect::<BTreeMap<_, _>>();
        fields.insert(PersonaField::Icon, "❧".into());
        fields.insert(PersonaField::Color, "var(--color-vermilion)".into());
        Self {
            base: OptionalField::Missing,
            fields,
            extra: ExtraFields::new(),
        }
    }
    pub fn edit(persona: &Persona) -> Self {
        let mut fields = BTreeMap::new();
        for (field, value) in [
            (PersonaField::Name, &persona.name),
            (PersonaField::Role, &persona.role),
            (PersonaField::Description, &persona.description),
            (PersonaField::Focus, &persona.focus),
            (PersonaField::Icon, &persona.icon),
            (PersonaField::Color, &persona.color),
        ] {
            fields.insert(field, value.clone());
        }
        for (field, value) in [
            (PersonaField::Backstory, &persona.backstory),
            (PersonaField::CriticalMethod, &persona.critical_method),
            (PersonaField::Voice, &persona.voice),
        ] {
            fields.insert(field, value.as_ref().cloned().unwrap_or_default());
        }
        for (field, value) in [
            (PersonaField::SignatureMoves, &persona.signature_moves),
            (PersonaField::Avoidances, &persona.avoidances),
            (PersonaField::SampleLines, &persona.sample_lines),
        ] {
            fields.insert(
                field,
                value
                    .as_ref()
                    .map(|lines| lines.join("\n"))
                    .unwrap_or_default(),
            );
        }
        Self {
            base: OptionalField::Value(persona.clone()),
            fields,
            extra: ExtraFields::new(),
        }
    }
    pub fn get(&self, field: PersonaField) -> &str {
        self.fields.get(&field).map_or("", String::as_str)
    }
    pub fn persona(&self) -> Result<Persona> {
        let new = self.base.as_ref().is_none();
        let mut persona = self.base.as_ref().cloned().unwrap_or_else(|| Persona {
            id: Uuid::new_v4().to_string(),
            name: String::new(),
            role: "The Editor".into(),
            color: "var(--color-vermilion)".into(),
            icon: "❧".into(),
            description: "A sharp, insightful editorial voice.".into(),
            focus: "General editing".into(),
            backstory: OptionalField::Missing,
            critical_method: OptionalField::Missing,
            voice: OptionalField::Missing,
            signature_moves: OptionalField::Missing,
            avoidances: OptionalField::Missing,
            sample_lines: OptionalField::Missing,
            speech_voice: OptionalField::Missing,
            speech_voices: OptionalField::Missing,
            provider_id: OptionalField::Missing,
            model: OptionalField::Missing,
            temperature: OptionalField::Missing,
            extra: ExtraFields::new(),
        });
        for field in [
            PersonaField::Name,
            PersonaField::Role,
            PersonaField::Description,
            PersonaField::Focus,
            PersonaField::Icon,
            PersonaField::Color,
        ] {
            let raw = self.get(field);
            let value = if new {
                raw.trim_matches(is_js_whitespace)
            } else {
                raw
            };
            let destination = match field {
                PersonaField::Name => &mut persona.name,
                PersonaField::Role => &mut persona.role,
                PersonaField::Description => &mut persona.description,
                PersonaField::Focus => &mut persona.focus,
                PersonaField::Icon => &mut persona.icon,
                PersonaField::Color => &mut persona.color,
                _ => unreachable!(),
            };
            if !new || !value.is_empty() {
                *destination = value.into();
            }
        }
        ensure!(
            !new || !persona.name.is_empty(),
            "Give the new editor a name before hiring them."
        );
        persona.backstory = prose_field(self.get(PersonaField::Backstory));
        persona.critical_method = prose_field(self.get(PersonaField::CriticalMethod));
        persona.voice = prose_field(self.get(PersonaField::Voice));
        persona.signature_moves = lines_from_textarea(self.get(PersonaField::SignatureMoves));
        persona.avoidances = lines_from_textarea(self.get(PersonaField::Avoidances));
        persona.sample_lines = lines_from_textarea(self.get(PersonaField::SampleLines));
        Ok(persona)
    }
}
fn prose_field(value: &str) -> OptionalField<String> {
    let value = value.trim_matches(is_js_whitespace);
    if value.is_empty() {
        OptionalField::Missing
    } else {
        OptionalField::Value(value.into())
    }
}
pub fn lines_from_textarea(value: &str) -> OptionalField<Vec<String>> {
    let lines = value
        .split('\n')
        .filter_map(|raw| {
            let line = raw.trim_matches(is_js_whitespace);
            let line = line
                .strip_prefix(['-', '•', '—'])
                .map(|rest| rest.trim_start_matches(is_js_whitespace))
                .unwrap_or(line);
            (!line.is_empty()).then(|| line.to_owned())
        })
        .collect::<Vec<_>>();
    if lines.is_empty() {
        OptionalField::Missing
    } else {
        OptionalField::Value(lines)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CastRecord {
    pub format: String,
    pub version: u64,
    pub generation: u64,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub personas: OptionalField<Vec<Persona>>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub room_settings: OptionalField<RoomSettings>,
    #[serde(default)]
    pub folios: BTreeMap<String, CastFolioArtifacts>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub reply_drafts: CastReplyDrafts,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roster_draft: Option<CastPersonaDraft>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl Default for CastRecord {
    fn default() -> Self {
        Self {
            format: CAST_FORMAT.into(),
            version: CAST_VERSION,
            generation: 0,
            personas: OptionalField::Missing,
            room_settings: OptionalField::Missing,
            folios: BTreeMap::new(),
            reply_drafts: CastReplyDrafts::new(),
            roster_draft: None,
            extra: ExtraFields::new(),
        }
    }
}
impl CastRecord {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.format == CAST_FORMAT && self.version == CAST_VERSION,
            "This Cast format needs a compatible version of Twyne. Its file was kept."
        );
        for persona in self.personas.as_ref().into_iter().flatten() {
            ensure!(
                persona
                    .temperature
                    .as_ref()
                    .is_none_or(|value| value.is_finite()),
                "An editor temperature is not a finite number."
            );
        }
        Ok(())
    }
    pub fn settings(&self) -> RoomSettings {
        self.room_settings.as_ref().cloned().unwrap_or_default()
    }
    pub fn note(&self, target: &CastNoteRef) -> Option<&PersonaFeedback> {
        let mut matches = self
            .folios
            .get(&target.folio_id)?
            .notes
            .iter()
            .filter(|note| note.note_id.as_ref() == Some(&target.id));
        let note = matches.next()?;
        matches.next().is_none().then_some(note)
    }
    pub fn analysis(&self, folio_id: &str) -> Option<&RoomAnalysis> {
        self.folios.get(folio_id)?.analysis.as_ref()
    }
    /// Scope is supplied from an explicit original artifact path, not guessed.
    pub fn import_scoped(&mut self, scope: String, artifacts: CastFolioArtifacts) {
        self.folios.insert(scope, artifacts);
    }
}
fn parse_bounded<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T> {
    ensure!(
        bytes.len() <= MAX_CAST_BYTES,
        "Cast exceeds its 16 MiB metadata limit."
    );
    Ok(serde_json::from_slice(bytes)?)
}
pub fn parse_cast_json(bytes: &[u8]) -> Result<CastRecord> {
    // Native envelope only. A corrupt/future envelope is never a web array.
    let record: CastRecord = parse_bounded(bytes)?;
    record.validate()?;
    Ok(record)
}
pub fn parse_web_personas(bytes: &[u8]) -> Result<Vec<Persona>> {
    parse_bounded(bytes)
}
pub fn parse_web_notes(bytes: &[u8]) -> Result<Vec<PersonaFeedback>> {
    parse_bounded(bytes)
}
pub fn parse_web_replies(bytes: &[u8]) -> Result<Vec<PersonaReply>> {
    parse_bounded(bytes)
}
pub fn parse_web_room_settings(bytes: &[u8]) -> Result<RoomSettings> {
    parse_bounded(bytes)
}
pub fn parse_web_analysis(bytes: &[u8]) -> Result<RoomAnalysis> {
    parse_bounded(bytes)
}

/// Original grouped presentation keeps first-seen persona order and first-row
/// timestamp ties. This does not sort or rewrite the retained artifact array.
pub fn grouped_notes(notes: &[PersonaFeedback]) -> Vec<&PersonaFeedback> {
    let mut positions: HashMap<&str, usize> = HashMap::new();
    let mut result: Vec<&PersonaFeedback> = Vec::new();
    for note in notes {
        if let Some(index) = positions.get(note.persona_id.as_str()).copied() {
            if result[index].timestamp < note.timestamp {
                result[index] = note;
            }
        } else {
            positions.insert(&note.persona_id, result.len());
            result.push(note);
        }
    }
    result
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptTemplates {
    persona_template: String,
    editorial_protocol: String,
}
pub fn voice_preview(persona: &Persona) -> String {
    static TEMPLATES: OnceLock<PromptTemplates> = OnceLock::new();
    let templates = TEMPLATES.get_or_init(|| {
        serde_json::from_str(include_str!("../fixtures/cast/prompt-templates.json"))
            .expect("the original prompt templates are valid")
    });
    let has_prose = [&persona.backstory, &persona.critical_method, &persona.voice]
        .iter()
        .any(|field| field.as_ref().is_some_and(|value| !value.is_empty()));
    let has_lines = [
        &persona.signature_moves,
        &persona.avoidances,
        &persona.sample_lines,
    ]
    .iter()
    .any(|field| field.as_ref().is_some_and(|lines| !lines.is_empty()));
    let voice = if !has_prose && !has_lines {
        "\nSpeak in your own voice. Do not sound like the other editors.\n".to_owned()
    } else {
        let mut lines = vec![
            "\nPERSONA BIBLE (binding for every note, reply, rewrite, analysis, and judgment):"
                .to_owned(),
        ];
        for (field, header) in [
            (
                &persona.backstory,
                "BACKSTORY (internalize it; mention it only when it naturally matters):",
            ),
            (&persona.critical_method, "EDITORIAL DOCTRINE:"),
            (&persona.voice, "VOICEPRINT:"),
        ] {
            if let Some(value) = field.as_ref().filter(|value| !value.is_empty()) {
                lines.push(format!("{header}\n{value}"));
            }
        }
        for (field, header, prefix) in [
            (
                &persona.signature_moves,
                "SIGNATURE MOVES (use one or two when natural, not all mechanically):",
                "- ",
            ),
            (&persona.avoidances, "NEVER BORROW THESE HABITS:", "- "),
            (
                &persona.sample_lines,
                "Lines in your register, for calibration (do not reuse them verbatim):",
                "  — ",
            ),
        ] {
            if let Some(values) = field.as_ref().filter(|lines| !lines.is_empty()) {
                lines.push(format!(
                    "{header}\n{}",
                    values
                        .iter()
                        .map(|value| format!("{prefix}{value}"))
                        .collect::<Vec<_>>()
                        .join("\n")
                ));
            }
        }
        format!("{}\n", lines.join("\n"))
    };
    // Single-pass placeholder substitution: inserted braces must remain data.
    let vars = [
        ("personaName", &persona.name),
        ("personaRole", &persona.role),
        ("personaDescription", &persona.description),
        ("personaFocus", &persona.focus),
        ("voice", &voice),
    ];
    let mut identity = String::new();
    let mut rest = templates.persona_template.as_str();
    while let Some(start) = rest.find('{') {
        identity.push_str(&rest[..start]);
        let tail = &rest[start + 1..];
        if let Some(end) = tail.find('}') {
            let key = &tail[..end];
            if let Some((_, value)) = vars.iter().find(|(name, _)| *name == key) {
                identity.push_str(value);
            } else {
                identity.push_str(&rest[start..start + end + 2]);
            }
            rest = &tail[end + 1..];
        } else {
            identity.push_str(&rest[start..]);
            rest = "";
            break;
        }
    }
    identity.push_str(rest);
    let source = format!("{identity}\n\n{}", templates.editorial_protocol);
    let mut result = String::new();
    let mut newlines = 0;
    for character in source.chars() {
        if character == '\n' {
            newlines += 1;
            if newlines <= 2 {
                result.push(character);
            }
        } else {
            newlines = 0;
            result.push(character);
        }
    }
    result
}
/// The caller supplies the original Intl/localized filed label. This function
/// cannot silently assume a browser locale or timezone when exporting prose.
pub fn analysis_markdown(analysis: &RoomAnalysis, filed_label: &str) -> String {
    let title = analysis
        .brief_title
        .as_ref()
        .filter(|value| !value.is_empty())
        .map_or("Untitled", String::as_str);
    let mut parts = vec![
        format!("# The Full Analysis — {title}"),
        String::new(),
        format!("*Filed {filed_label}*"),
        String::new(),
    ];
    if !analysis.synthesis.is_empty() {
        parts.extend([
            "## The Room's Verdict".into(),
            String::new(),
            analysis.synthesis.trim_matches(is_js_whitespace).into(),
            String::new(),
        ]);
    }
    for memo in &analysis.memos {
        parts.extend([
            format!("## {}", memo.persona_name),
            String::new(),
            memo.text.trim_matches(is_js_whitespace).into(),
            String::new(),
        ]);
    }
    parts.join("\n")
}
pub fn analysis_filename(analysis: &RoomAnalysis) -> String {
    let name = analysis
        .brief_title
        .as_ref()
        .filter(|value| !value.is_empty())
        .map_or_else(
            || "full-analysis".into(),
            |value| format!("{value} full analysis"),
        );
    let mut base = String::new();
    for character in name.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            base.push(character);
        } else if !base.ends_with('-') {
            base.push('-');
        }
    }
    let base = base.trim_matches('-').chars().take(64).collect::<String>();
    format!("{}.md", if base.is_empty() { "untitled" } else { &base })
}

#[derive(Clone, Debug, PartialEq)]
pub enum CastEdit {
    ReplaceRoster(Vec<Persona>),
    SetRoomSettings(RoomSettings),
    FileReply {
        target: CastNoteRef,
        reply: PersonaReply,
    },
    Recovery {
        reply_drafts: CastReplyDrafts,
        roster_draft: Option<Box<CastPersonaDraft>>,
    },
    Batch(Vec<CastEdit>),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CastEffect {
    RosterChanged,
    SettingsChanged,
    ReplyFiled {
        target: CastNoteRef,
        reply_id: String,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub struct CastRequest {
    pub request_id: Uuid,
    pub expected_generation: u64,
    pub base: Arc<CastRecord>,
    pub candidate: Arc<CastRecord>,
    pub effects: Vec<CastEffect>,
}
fn apply_edit(
    record: &mut CastRecord,
    edit: &CastEdit,
    effects: &mut Vec<CastEffect>,
) -> Result<()> {
    match edit {
        CastEdit::Batch(edits) => {
            for edit in edits {
                apply_edit(record, edit, effects)?;
            }
        }
        CastEdit::ReplaceRoster(personas) => {
            let next = OptionalField::Value(personas.clone());
            if record.personas != next {
                record.personas = next;
                effects.push(CastEffect::RosterChanged);
            }
        }
        CastEdit::SetRoomSettings(settings) => {
            let next = OptionalField::Value(settings.clone());
            if record.room_settings != next {
                record.room_settings = next;
                effects.push(CastEffect::SettingsChanged);
            }
        }
        CastEdit::Recovery {
            reply_drafts,
            roster_draft,
        } => {
            record.reply_drafts = reply_drafts.clone();
            record.roster_draft = roster_draft.as_deref().cloned();
        }
        CastEdit::FileReply { target, reply } => {
            ensure!(
                !target.folio_id.is_empty() && !target.id.is_empty(),
                "A reply needs an existing scoped editorial note."
            );
            ensure!(
                record.note(target).is_some(),
                "This editorial note is missing or ambiguous. Its reply draft was kept."
            );
            ensure!(
                reply.note_id == target.id
                    && reply.folio_id.as_ref() == Some(&target.folio_id)
                    && reply.author_kind == PersonaReplyAuthor::User,
                "File only must retain a writer reply in the exact note scope."
            );
            ensure!(
                !reply.text.trim_matches(is_js_whitespace).is_empty(),
                "Write a reply before filing it."
            );
            let artifacts = record.folios.get_mut(&target.folio_id).unwrap();
            if let Some(previous) = artifacts
                .replies
                .iter()
                .find(|previous| previous.id == reply.id)
            {
                ensure!(
                    previous == reply,
                    "This reply ID already belongs to different retained material."
                );
            } else {
                artifacts.replies.push(reply.clone());
                effects.push(CastEffect::ReplyFiled {
                    target: target.clone(),
                    reply_id: reply.id.clone(),
                });
            }
            if let Some(drafts) = record.reply_drafts.get_mut(&target.folio_id) {
                drafts.remove(&target.id);
                if drafts.is_empty() {
                    record.reply_drafts.remove(&target.folio_id);
                }
            }
        }
    }
    Ok(())
}

pub struct CastSession {
    saved: Arc<CastRecord>,
    pending: Option<CastRequest>,
    error: Option<String>,
}
impl CastSession {
    pub fn new(record: Arc<CastRecord>) -> Self {
        Self {
            saved: record,
            pending: None,
            error: None,
        }
    }
    pub fn saved(&self) -> &Arc<CastRecord> {
        &self.saved
    }
    pub fn pending(&self) -> Option<&CastRequest> {
        self.pending.as_ref()
    }
    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }
    pub fn request(&mut self, edit: CastEdit) -> Result<Option<CastRequest>> {
        ensure!(
            self.pending.is_none(),
            "Finish the previous Cast save before filing another change."
        );
        let mut candidate = (*self.saved).clone();
        let mut effects = Vec::new();
        apply_edit(&mut candidate, &edit, &mut effects)?;
        if candidate == *self.saved {
            return Ok(None);
        }
        candidate.generation = candidate
            .generation
            .checked_add(1)
            .context("Cast has exhausted its save generation.")?;
        candidate.validate()?;
        let request = CastRequest {
            request_id: Uuid::new_v4(),
            expected_generation: self.saved.generation,
            base: self.saved.clone(),
            candidate: Arc::new(candidate),
            effects,
        };
        self.pending = Some(request.clone());
        self.error = None;
        Ok(Some(request))
    }
    pub fn acknowledge_saved(&mut self, request_id: Uuid, record: Arc<CastRecord>) -> bool {
        if !self.pending.as_ref().is_some_and(|request| {
            request.request_id == request_id
                && request.base == self.saved
                && request.candidate == record
        }) {
            return false;
        }
        self.saved = record;
        self.pending = None;
        self.error = None;
        true
    }
    pub fn report_error(&mut self, request_id: Uuid, message: impl Into<String>) -> bool {
        if self.pending.as_ref().map(|request| request.request_id) != Some(request_id) {
            return false;
        }
        self.error = Some(message.into());
        true
    }
    pub fn retry(&mut self) -> Option<CastRequest> {
        self.error.take()?;
        self.pending.clone()
    }
    pub fn replace_record(&mut self, record: Arc<CastRecord>) -> bool {
        if self.pending.is_some()
            || record.generation < self.saved.generation
            || (record.generation == self.saved.generation && record != self.saved)
        {
            return false;
        }
        self.saved = record;
        self.error = None;
        true
    }
}

#[derive(Clone, Debug)]
pub struct CastLoad {
    pub record: Arc<CastRecord>,
    pub warnings: Vec<String>,
}
#[derive(Clone)]
pub struct CastStore {
    inner: Arc<StoreInner>,
}
struct StoreInner {
    path: PathBuf,
    writer: Mutex<()>,
}
impl CastStore {
    /// The application holds its library OS lock until detached writers finish.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(&root).context("Could not create the Cast folder.")?;
        Ok(Self {
            inner: Arc::new(StoreInner {
                path: root.join("cast.json"),
                writer: Mutex::new(()),
            }),
        })
    }
    pub fn path(&self) -> &Path {
        &self.inner.path
    }
    pub fn load(&self) -> Result<CastLoad> {
        let _guard = self
            .inner
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The Cast writer stopped unexpectedly."))?;
        self.load_locked()
    }
    fn load_locked(&self) -> Result<CastLoad> {
        let backup = self.path().with_extension("json.bak");
        if !self.path().exists() {
            return if backup.exists() {
                Ok(CastLoad {
                    record: Arc::new(read_record(&backup)?),
                    warnings: vec![
                        "Recovered Cast from its previous save. The recovery file is kept.".into(),
                    ],
                })
            } else {
                Ok(CastLoad {
                    record: Arc::new(CastRecord::default()),
                    warnings: Vec::new(),
                })
            };
        }
        match read_record(self.path()) {
            Ok(record) => Ok(CastLoad {
                record: Arc::new(record),
                warnings: Vec::new(),
            }),
            Err(error) => {
                let bytes = read_bounded(self.path())?;
                // A valid future/wrong-schema JSON primary must not be replaced
                // by an old backup just because this application cannot open it.
                if serde_json::from_slice::<Value>(&bytes).is_ok() {
                    return Err(error);
                }
                if backup.exists() {
                    Ok(CastLoad { record: Arc::new(read_record(&backup).with_context(|| format!("Could not recover Cast: {error}"))?), warnings: vec!["Recovered Cast from its previous save. The damaged file is kept until another save.".into()] })
                } else {
                    Err(error.context("Could not open Cast. Its damaged file has been kept."))
                }
            }
        }
    }
    pub fn save_request(&self, request: &CastRequest) -> Result<Arc<CastRecord>> {
        let _guard = self
            .inner
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The Cast writer stopped unexpectedly."))?;
        request.base.validate()?;
        request.candidate.validate()?;
        ensure!(
            request.expected_generation == request.base.generation
                && Some(request.candidate.generation) == request.base.generation.checked_add(1),
            "The Cast request has an invalid save generation."
        );
        let bytes = serde_json::to_vec_pretty(&*request.candidate)?;
        ensure!(
            bytes.len() <= MAX_CAST_BYTES,
            "Cast exceeds its 16 MiB metadata limit. Its previous save was kept."
        );
        let current = self.load_locked()?.record;
        if current == request.candidate
            && read_record(self.path()).ok().as_ref() == Some(&*request.candidate)
        {
            File::open(self.path())?.sync_all()?;
            sync_parent(self.path())?;
            return Ok(request.candidate.clone());
        }
        ensure!(
            current.generation == request.expected_generation && current == request.base,
            "Cast changed before this edit could be filed. Reload it before saving."
        );
        if self.path().exists() {
            let previous = read_bounded(self.path())?;
            if read_record(self.path()).is_ok() {
                atomic_write(&self.path().with_extension("json.bak"), &previous)?;
            } else {
                atomic_write(
                    &self
                        .path()
                        .with_extension(format!("json.damaged-{}", Uuid::new_v4())),
                    &previous,
                )?;
            }
        }
        atomic_write(self.path(), &bytes).context("Cast could not be saved on this device.")?;
        Ok(request.candidate.clone())
    }
}
fn read_record(path: &Path) -> Result<CastRecord> {
    parse_cast_json(&read_bounded(path)?)
}
fn read_bounded(path: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_CAST_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= MAX_CAST_BYTES,
        "Cast is too large to open safely."
    );
    Ok(bytes)
}
fn sync_parent(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path.parent().context("Cast has no parent folder.")?)?.sync_all()?;
    Ok(())
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("Cast has no parent folder.")?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    sync_parent(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> Value {
        serde_json::from_str(include_str!("../fixtures/cast/web-reference.json")).unwrap()
    }
    fn source_record() -> CastRecord {
        let f = fixture();
        let mut record = CastRecord {
            personas: OptionalField::Value(vec![
                serde_json::from_value(f["optionalPersona"].clone()).unwrap(),
            ]),
            room_settings: OptionalField::Value(RoomSettings::default()),
            ..CastRecord::default()
        };
        record.import_scoped(
            "web/folio:café".into(),
            CastFolioArtifacts {
                notes: serde_json::from_value(f["notes"].clone()).unwrap(),
                replies: serde_json::from_value(f["replies"].clone()).unwrap(),
                analysis: OptionalField::Value(
                    serde_json::from_value(f["analysis"].clone()).unwrap(),
                ),
                extra: ExtraFields::new(),
            },
        );
        record.import_scoped(
            "unimported/foreign".into(),
            record.folios["web/folio:café"].clone(),
        );
        record.reply_drafts.insert(
            "web/folio:café".into(),
            BTreeMap::from([
                (
                    "pn-source:one".into(),
                    "Final unblurred character café.".into(),
                ),
                (
                    "missing-note-id".into(),
                    "Retain an unreachable draft.".into(),
                ),
            ]),
        );
        record
            .extra
            .insert("futureEnvelope".into(), json!({"exact":"<>& 東京"}));
        record
    }
    fn target() -> CastNoteRef {
        CastNoteRef {
            folio_id: "web/folio:café".into(),
            id: "pn-source:one".into(),
        }
    }

    #[test]
    fn actual_ts_defaults_voice_prompts_and_analysis_export_match() {
        let f = fixture();
        assert_eq!(
            serde_json::to_value(RoomSettings::default()).unwrap(),
            f["defaults"]
        );
        assert_eq!(resident_personas().len(), 5);
        for case in f["voicePreviews"].as_array().unwrap() {
            let persona = serde_json::from_value(case["persona"].clone()).unwrap();
            assert_eq!(voice_preview(&persona), case["preview"].as_str().unwrap());
        }
        let analysis = serde_json::from_value(f["analysis"].clone()).unwrap();
        assert_eq!(
            analysis_markdown(
                &analysis,
                f["analysisExport"]["filedLabel"].as_str().unwrap()
            ),
            f["analysisExport"]["markdown"].as_str().unwrap()
        );
        assert_eq!(
            analysis_filename(&analysis),
            f["analysisExport"]["filename"].as_str().unwrap()
        );
    }
    #[test]
    fn executed_source_assistance_and_removal_semantics_match() {
        for case in fixture()["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|case| case["operation"] != "edit")
        {
            let mut settings: RoomSettings =
                serde_json::from_value(case["before"]["roomSettings"].clone()).unwrap();
            match case["operation"].as_str().unwrap() {
                "toggleScope" => settings.toggle_scope("devil"),
                "setPersonaLevel" => settings.toggle_level("devil", AssistanceLevel::Comments),
                "remove" => settings.removed_persona("devil"),
                _ => unreachable!(),
            }
            assert_eq!(
                serde_json::to_value(settings).unwrap(),
                case["after"]["roomSettings"]
            );
        }
    }
    #[test]
    fn edited_roster_keeps_unknown_audio_and_provenance_fields() {
        let f = fixture();
        let case = f["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["operation"] == "edit")
            .unwrap();
        let persona = serde_json::from_value(case["before"][0].clone()).unwrap();
        let mut draft = CastPersonaDraft::edit(&persona);
        for (field, key) in [
            (PersonaField::Name, "draftName"),
            (PersonaField::Role, "draftRole"),
            (PersonaField::Description, "draftDescription"),
            (PersonaField::Focus, "draftFocus"),
            (PersonaField::Backstory, "draftBackstory"),
            (PersonaField::CriticalMethod, "draftCriticalMethod"),
            (PersonaField::Voice, "draftVoice"),
            (PersonaField::SignatureMoves, "draftSignatureMoves"),
            (PersonaField::Avoidances, "draftAvoidances"),
            (PersonaField::SampleLines, "draftSampleLines"),
            (PersonaField::Icon, "draftIcon"),
            (PersonaField::Color, "draftColor"),
        ] {
            draft
                .fields
                .insert(field, case["draft"][key].as_str().unwrap().into());
        }
        assert_eq!(
            serde_json::to_value(draft.persona().unwrap()).unwrap(),
            case["after"][0]
        );
        let mut new = CastPersonaDraft::new_editor();
        assert!(new.persona().is_err());
        new.fields
            .insert(PersonaField::Name, "  A new local editor  ".into());
        let new = new.persona().unwrap();
        assert_eq!(new.name, "A new local editor");
        assert_eq!(new.role, "The Editor");
        assert_eq!(new.icon, "❧");
    }
    #[test]
    fn optional_null_absence_foreign_scopes_and_future_enums_round_trip() {
        let record = source_record();
        let value = serde_json::to_value(&record).unwrap();
        let round = parse_cast_json(&serde_json::to_vec(&record).unwrap()).unwrap();
        assert_eq!(record, round);
        assert_eq!(serde_json::to_value(round).unwrap(), value);
        assert!(value["personas"][0]["voice"].is_null());
        assert!(value["personas"][0].get("criticalMethod").is_none());
        assert_eq!(
            value["folios"]["web/folio:café"]["notes"][3]["type"],
            "future-type"
        );
        assert!(
            value["folios"]["web/folio:café"]["notes"][1]
                .get("folioId")
                .is_none()
        );
        assert_eq!(
            parse_web_notes(&serde_json::to_vec(&fixture()["notes"]).unwrap()).unwrap(),
            record.folios["web/folio:café"].notes
        );
    }
    #[test]
    fn empty_mount_fallback_does_not_rewrite_retained_empty_and_order_is_durable() {
        let empty = OptionalField::Value(Vec::new());
        assert_eq!(mounted_personas(&empty), resident_personas());
        assert_eq!(empty, OptionalField::Value(Vec::new()));
        let folder = tempfile::tempdir().unwrap();
        let store = CastStore::open(folder.path()).unwrap();
        let mut session = CastSession::new(store.load().unwrap().record);
        let mut reversed = resident_personas().to_vec();
        reversed.reverse();
        let request = session
            .request(CastEdit::ReplaceRoster(reversed.clone()))
            .unwrap()
            .unwrap();
        let saved = store.save_request(&request).unwrap();
        assert!(session.acknowledge_saved(request.request_id, saved));
        assert_eq!(
            store.load().unwrap().record.personas.as_ref(),
            Some(&reversed)
        );
        let request = session
            .request(CastEdit::ReplaceRoster(Vec::new()))
            .unwrap()
            .unwrap();
        store.save_request(&request).unwrap();
        assert!(
            store
                .load()
                .unwrap()
                .record
                .personas
                .as_ref()
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn repeated_quotes_cannot_manufacture_targets_and_file_only_is_scoped() {
        let original = Arc::new(source_record());
        let foreign = original.folios["unimported/foreign"].clone();
        let mut session = CastSession::new(original.clone());
        let target = target();
        let request = session
            .request(CastEdit::FileReply {
                target: target.clone(),
                reply: PersonaReply::writer(&target, "  File only — café.  ".into(), 2000),
            })
            .unwrap()
            .unwrap();
        assert_eq!(session.saved(), &original);
        assert_eq!(request.candidate.folios["unimported/foreign"], foreign);
        assert_eq!(
            request.candidate.folios["web/folio:café"]
                .replies
                .last()
                .unwrap()
                .text,
            "File only — café."
        );
        assert!(request.candidate.reply_drafts["web/folio:café"].contains_key("missing-note-id"));
        assert!(!request.candidate.reply_drafts["web/folio:café"].contains_key("pn-source:one"));
        let mut session = CastSession::new(original.clone());
        let missing = CastNoteRef {
            id: "the repeated sentence is not a note id".into(),
            ..target.clone()
        };
        assert!(
            session
                .request(CastEdit::FileReply {
                    reply: PersonaReply::writer(&missing, "Kept.".into(), 2000),
                    target: missing
                })
                .is_err()
        );
        let mut record = (*original).clone();
        let duplicate = record.folios[&target.folio_id].notes[0].clone();
        record
            .folios
            .get_mut(&target.folio_id)
            .unwrap()
            .notes
            .push(duplicate);
        assert!(
            CastSession::new(Arc::new(record))
                .request(CastEdit::FileReply {
                    reply: PersonaReply::writer(&target, "Ambiguous.".into(), 2000),
                    target
                })
                .is_err()
        );
        assert_eq!(
            grouped_notes(&original.folios["web/folio:café"].notes)
                .iter()
                .map(|note| serde_json::to_value(&note.note_id).unwrap())
                .collect::<Vec<_>>(),
            fixture()["groupedIds"].as_array().unwrap().clone()
        );
    }
    #[test]
    fn failed_write_retry_idempotence_full_base_cas_and_exact_ack() {
        let folder = tempfile::tempdir().unwrap();
        let store = CastStore::open(folder.path()).unwrap();
        let seed = source_record();
        let mut init = CastSession::new(store.load().unwrap().record);
        let request = init
            .request(CastEdit::Batch(vec![
                CastEdit::ReplaceRoster(seed.personas.as_ref().unwrap().clone()),
                CastEdit::SetRoomSettings(seed.settings()),
            ]))
            .unwrap()
            .unwrap();
        let base = store.save_request(&request).unwrap();
        let mut a = CastSession::new(base.clone());
        let mut b = CastSession::new(base.clone());
        let mut settings = base.settings();
        settings.max_proposals = 12;
        let first = a
            .request(CastEdit::SetRoomSettings(settings))
            .unwrap()
            .unwrap();
        let stale = b
            .request(CastEdit::ReplaceRoster(resident_personas().to_vec()))
            .unwrap()
            .unwrap();
        fs::create_dir(store.path().with_extension("json.bak")).unwrap();
        assert!(store.save_request(&first).is_err());
        assert_eq!(store.load().unwrap().record, base);
        assert!(a.report_error(first.request_id, "disk failure"));
        let retry = a.retry().unwrap();
        assert_eq!(retry, first);
        fs::remove_dir(store.path().with_extension("json.bak")).unwrap();
        let saved = store.clone().save_request(&retry).unwrap();
        assert!(store.save_request(&retry).is_ok());
        assert!(store.save_request(&stale).is_err());
        assert!(!a.acknowledge_saved(Uuid::new_v4(), saved.clone()));
        assert!(!a.acknowledge_saved(first.request_id, base));
        assert!(a.acknowledge_saved(first.request_id, saved));
        assert!(!a.report_error(first.request_id, "late failure"));
        let mut altered = (*retry.base).clone();
        altered
            .extra
            .insert("external-same-generation".into(), json!(true));
        let mut changed = CastSession::new(Arc::new(altered));
        let incompatible = changed
            .request(CastEdit::ReplaceRoster(Vec::new()))
            .unwrap()
            .unwrap();
        assert!(store.save_request(&incompatible).is_err());
    }
    #[test]
    fn recoverable_final_character_and_roster_base_survive_reopen() {
        let folder = tempfile::tempdir().unwrap();
        let store = CastStore::open(folder.path()).unwrap();
        let mut session = CastSession::new(store.load().unwrap().record);
        let mut draft = CastPersonaDraft::edit(&resident_personas()[0]);
        draft
            .fields
            .insert(PersonaField::Voice, "Still typing café.".into());
        let reply_drafts = source_record().reply_drafts;
        let request = session
            .request(CastEdit::Recovery {
                reply_drafts: reply_drafts.clone(),
                roster_draft: Some(Box::new(draft.clone())),
            })
            .unwrap()
            .unwrap();
        store.save_request(&request).unwrap();
        let loaded = CastStore::open(folder.path())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(loaded.reply_drafts, reply_drafts);
        assert_eq!(loaded.roster_draft, Some(draft));
        assert!(!loaded.folios.contains_key("web/folio:café")); // Recovery is not a filed thread or note.
    }
    #[test]
    fn damaged_recovery_never_reinterprets_future_envelopes_or_legacy_arrays() {
        let folder = tempfile::tempdir().unwrap();
        let store = CastStore::open(folder.path()).unwrap();
        let base = source_record();
        fs::write(
            store.path().with_extension("json.bak"),
            serde_json::to_vec(&base).unwrap(),
        )
        .unwrap();
        fs::write(store.path(), b"{ damaged").unwrap();
        let recovered = store.load().unwrap();
        assert_eq!(*recovered.record, base);
        assert!(!recovered.warnings.is_empty());
        let mut session = CastSession::new(recovered.record);
        let request = session
            .request(CastEdit::ReplaceRoster(Vec::new()))
            .unwrap()
            .unwrap();
        store.save_request(&request).unwrap();
        assert!(fs::read_dir(folder.path()).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("damaged-")
        }));
        let mut future = base;
        future.version += 1;
        let bytes = serde_json::to_vec(&future).unwrap();
        fs::write(store.path(), &bytes).unwrap();
        assert!(store.load().is_err());
        assert_eq!(fs::read(store.path()).unwrap(), bytes);
        assert!(
            parse_cast_json(include_bytes!("../fixtures/cast/resident-personas.json")).is_err()
        );
    }
}
