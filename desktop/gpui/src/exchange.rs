//! Lossless interchange with the real web `.twyne.json` and `.typ` contracts.
//!
//! Canonical Typst is never reconstructed from HTML here. A cached projection
//! can be retained without certifying that it was generated from that source.

use crate::workspace::{
    ContentFormat, ExtraFields, Folio, FolioContentSnapshot, ImportProvenance, ProjectBrief,
    ProjectionState, WorkspaceDocument,
};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Value, json};
use std::path::Path;

pub const BACKUP_VERSION: u32 = 2;
/// Bound the envelope before JSON allocation; embedded image data is allowed.
pub const MAX_BACKUP_BYTES: usize = 64_000_000;
/// Matches the web document bridge's 5,000,000 UTF-16 code-unit limit.
pub const MAX_SOURCE_UNITS: usize = 5_000_000;

/// Missing and explicit null have different wire representations.
/// Web v2 writes `brief: null`, while older valid backups can omit it.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum OptionalField<T> {
    #[default]
    Missing,
    Null,
    Value(T),
}

impl<T> OptionalField<T> {
    pub fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }

    pub fn as_ref(&self) -> Option<&T> {
        match self {
            Self::Value(value) => Some(value),
            _ => None,
        }
    }
}

impl<T: Serialize> Serialize for OptionalField<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Value(value) => value.serialize(serializer),
            Self::Missing | Self::Null => serializer.serialize_none(),
        }
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for OptionalField<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match Option::<T>::deserialize(deserializer)? {
            Some(value) => Self::Value(value),
            None => Self::Null,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupContent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ContentFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typst_source: Option<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl BackupContent {
    pub fn canonical_source(&self) -> Option<&str> {
        self.typst_source.as_deref()
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.html.is_some() || self.typst_source.is_some(),
            "That JSON file is not a Twyne backup. Expected content.html or content.typstSource."
        );
        if let Some(source) = self.canonical_source() {
            validate_source(source)?;
        }
        Ok(())
    }
}

/// The web exporter stores one manuscript and brief plus a folio catalog.
/// There is no active folio ID and no other folios' content in this envelope.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TwyneBackup {
    /// Version is metadata in the web importer, which accepts usable content
    /// even when this field is absent or comes from a later exporter.
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub version: OptionalField<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exported_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub brief: OptionalField<ProjectBrief>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folios: Option<Vec<Folio>>,
    pub content: BackupContent,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl TwyneBackup {
    /// Construct the exact current web exporter shape. The caller supplies
    /// canonical source and its projection; this method does no conversion.
    pub fn new_v2(
        title: impl Into<String>,
        source: impl Into<String>,
        html: impl Into<String>,
        brief: Option<ProjectBrief>,
        folios: Vec<Folio>,
        exported_at: impl Into<String>,
    ) -> Self {
        Self {
            version: OptionalField::Value(json!(BACKUP_VERSION)),
            exported_at: Some(exported_at.into()),
            title: Some(title.into()),
            brief: brief.map_or(OptionalField::Null, OptionalField::Value),
            folios: Some(folios),
            content: BackupContent {
                html: Some(html.into()),
                format: Some(ContentFormat::Typst),
                typst_source: Some(source.into()),
                extra: ExtraFields::new(),
            },
            extra: ExtraFields::new(),
        }
    }

    pub fn display_title(&self) -> &str {
        self.title.as_deref().unwrap_or("Imported piece")
    }

    pub fn canonical_source(&self) -> Option<&str> {
        self.content.canonical_source()
    }

    pub fn version_number(&self) -> Option<u64> {
        self.version.as_ref().and_then(Value::as_u64)
    }

    pub fn validate(&self) -> Result<()> {
        // Match importAs: usable content determines compatibility, while the
        // original version is retained. Never discard future metadata merely
        // because this build did not assign its version number.
        self.content.validate()?;
        for folio in self.folios.iter().flatten() {
            folio.validate()?;
        }
        Ok(())
    }

    /// The caller supplies the destination folio explicitly. Do not infer it
    /// from the first catalog entry: the active manuscript is not identified
    /// by the web file. Existing IDs in the retained catalog are unchanged.
    pub fn into_document(self, destination: Folio, imported_at: u64) -> Result<WorkspaceDocument> {
        self.validate()?;
        destination.validate()?;
        let projection = match (&self.content.typst_source, &self.content.html) {
            (Some(_), Some(_)) => ProjectionState::UnverifiedCache,
            (Some(_), None) => ProjectionState::Unavailable,
            (None, _) => ProjectionState::LegacyHtml,
        };
        let content = FolioContentSnapshot {
            folio_id: destination.id.clone(),
            html: self.content.html.clone().unwrap_or_default(),
            format: self.content.format,
            typst_source: self.content.typst_source.clone(),
            updated_at: imported_at,
            extra: self.content.extra.clone(),
        };
        let document = WorkspaceDocument {
            folio: destination,
            content,
            brief: self.brief.as_ref().cloned(),
            projection,
            backup_template: Some(Box::new(self)),
            provenance: None,
            extra: ExtraFields::new(),
        };
        // Some legacy envelopes mark format=typst without a source but still
        // carry valid HTML. Preserve the envelope in the template while giving
        // the native legacy snapshot an honest content format.
        let mut document = document;
        if document.canonical_source().is_none() {
            document.content.format = document.content.format.map(|_| ContentFormat::Html);
        }
        document.validate()?;
        Ok(document)
    }
}

pub fn parse_backup(bytes: &[u8]) -> Result<TwyneBackup> {
    ensure!(
        bytes.len() <= MAX_BACKUP_BYTES,
        "The backup exceeds the 64 MB import limit."
    );
    let text = std::str::from_utf8(bytes).context("The Twyne backup is not valid UTF-8.")?;
    // A BOM belongs to the import provenance, not to the JSON grammar.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let backup: TwyneBackup = serde_json::from_str(text)
        .context("That file does not look like a Twyne backup (JSON parse failed).")?;
    backup.validate()?;
    Ok(backup)
}

pub fn serialize_backup(backup: &TwyneBackup) -> Result<Vec<u8>> {
    backup.validate()?;
    let bytes =
        serde_json::to_vec_pretty(backup).context("Could not serialize the Twyne backup.")?;
    ensure!(
        bytes.len() <= MAX_BACKUP_BYTES,
        "The backup exceeds the 64 MB export limit."
    );
    Ok(bytes)
}

pub fn import_backup(
    bytes: &[u8],
    file_name: impl Into<String>,
    destination: Folio,
    imported_at: u64,
) -> Result<WorkspaceDocument> {
    let mut document = parse_backup(bytes)?.into_document(destination, imported_at)?;
    document.provenance = Some(ImportProvenance {
        file_name: file_name.into(),
        original_bytes: bytes.to_vec(),
        extra: ExtraFields::new(),
    });
    Ok(document)
}

/// A `.typ` import is canonical source-only until an actual converter is run.
pub fn import_typst(
    bytes: &[u8],
    file_name: impl Into<String>,
    folio_id: impl Into<String>,
    imported_at: u64,
) -> Result<WorkspaceDocument> {
    let source = std::str::from_utf8(bytes).context("The Typst source is not valid UTF-8.")?;
    validate_source(source)?;
    let file_name = file_name.into();
    let title = Path::new(&file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&file_name);
    let title = if title.to_ascii_lowercase().ends_with(".typ") {
        &title[..title.len() - 4]
    } else {
        title
    };
    let title = if title.is_empty() {
        "Imported piece"
    } else {
        title
    };
    let folio = Folio::draft(folio_id, title, imported_at);
    let document = WorkspaceDocument {
        content: FolioContentSnapshot {
            folio_id: folio.id.clone(),
            html: String::new(),
            format: Some(ContentFormat::Typst),
            typst_source: Some(source.to_owned()),
            updated_at: imported_at,
            extra: ExtraFields::new(),
        },
        folio,
        brief: None,
        projection: ProjectionState::Unavailable,
        backup_template: None,
        provenance: Some(ImportProvenance {
            file_name,
            original_bytes: bytes.to_vec(),
            extra: ExtraFields::new(),
        }),
        extra: ExtraFields::new(),
    };
    document.validate()?;
    Ok(document)
}

pub fn export_typst_source(document: &WorkspaceDocument) -> Result<Vec<u8>> {
    document.validate()?;
    let source = document.canonical_source().context(
        "This folio has no canonical Typst source. Convert its visual document before exporting Typst.",
    )?;
    validate_source(source)?;
    Ok(source.as_bytes().to_vec())
}

/// Export the active native content while retaining every imported catalog
/// entry and extension field. A legacy HTML-only document stays HTML-only:
/// creating current v2 source requires the actual document converter.
pub fn backup_for_document(
    document: &WorkspaceDocument,
    exported_at: impl Into<String>,
) -> Result<TwyneBackup> {
    document.validate()?;
    let mut backup = match document.backup_template.as_deref() {
        Some(template) => template.clone(),
        None => TwyneBackup {
            version: OptionalField::Value(json!(if document.canonical_source().is_some() {
                BACKUP_VERSION
            } else {
                1
            })),
            exported_at: None,
            title: None,
            brief: OptionalField::Null,
            folios: Some(vec![document.folio.clone()]),
            content: BackupContent {
                html: None,
                format: document.content.format,
                typst_source: None,
                extra: ExtraFields::new(),
            },
            extra: ExtraFields::new(),
        },
    };
    backup.exported_at = Some(exported_at.into());
    backup.title = Some(document.folio.name.clone());
    if document.brief.is_some() || backup.brief.as_ref().is_some() {
        backup.brief = document
            .brief
            .clone()
            .map_or(OptionalField::Null, OptionalField::Value);
    }
    // A source-only import has no HTML cache, so do not invent an empty one.
    backup.content.html = if document.projection == ProjectionState::Unavailable {
        None
    } else {
        Some(document.content.html.clone())
    };
    backup.content.typst_source = document.content.typst_source.clone();
    if document.canonical_source().is_some() {
        // A compatible future envelope keeps its version and extensions.
        if backup
            .version_number()
            .is_some_and(|version| version <= u64::from(BACKUP_VERSION))
        {
            backup.version = OptionalField::Value(json!(BACKUP_VERSION));
        }
        backup.content.format = Some(ContentFormat::Typst);
    } else {
        // Preserve the original legacy wire format when it was absent.
        backup.content.format = backup.content.format.map(|_| ContentFormat::Html);
    }
    backup.content.extra.clone_from(&document.content.extra);
    if let Some(catalog) = &mut backup.folios {
        // Only a deliberate ID match makes this a catalog edit. A destination
        // created for an ambiguous import is not appended to its old catalog.
        if let Some(entry) = catalog
            .iter_mut()
            .find(|folio| folio.id == document.folio.id)
        {
            entry.clone_from(&document.folio);
        }
    }
    backup.validate()?;
    Ok(backup)
}

fn validate_source(source: &str) -> Result<()> {
    if source.encode_utf16().take(MAX_SOURCE_UNITS + 1).count() > MAX_SOURCE_UNITS {
        bail!("The Typst source exceeds the 5,000,000 character import limit.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{FolioType, PaginationMode, ProbeAnswer};

    const WEB_V2: &[u8] = include_bytes!("../fixtures/exchange/web-v2.twyne.json");
    const WEB_V1: &[u8] = include_bytes!("../fixtures/exchange/web-v1-html.twyne.json");
    const EXTENDED: &[u8] = include_bytes!("../fixtures/exchange/web-v2-extended.twyne.json");
    const SOURCE: &[u8] = include_bytes!("../fixtures/exchange/canonical.typ");

    #[test]
    fn actual_web_export_preserves_canonical_source_and_project_material() {
        let backup = parse_backup(WEB_V2).unwrap();
        assert_eq!(backup.version_number(), Some(2));
        assert_eq!(backup.canonical_source().unwrap().as_bytes(), SOURCE);
        assert!(backup.content.html.as_ref().unwrap().contains("Stale HTML"));
        let folios = backup.folios.as_ref().unwrap();
        assert_eq!(folios[0].id, "folio-draft-non-uuid");
        assert_eq!(folios[1].folio_type, FolioType::Notes);
        assert_eq!(folios[2].folio_type, FolioType::Outline);
        let layout = folios[0].layout.as_ref().unwrap();
        assert_eq!(layout.pagination, None);
        assert_eq!(folios[0].header.as_deref(), Some("Running header — Å"));
        assert_eq!(folios[0].footer.as_deref(), Some("Private draft / folio 7"));
        let brief = backup.brief.as_ref().unwrap();
        assert_eq!(brief.attachments.len(), 2);
        let probes = brief.probes.as_ref().unwrap();
        assert_eq!(probes[0].answer, Some(ProbeAnswer::Text("Focused".into())));
        assert_eq!(
            probes[1].answer,
            Some(ProbeAnswer::Texts(vec!["History".into(), "Form".into()]))
        );
        assert_eq!(
            probes[2].answer,
            Some(ProbeAnswer::Texts(vec!["notice".into(), "write".into()]))
        );
        assert_eq!(probes[3].answer, Some(ProbeAnswer::Number(7.5)));
        assert_eq!(probes[4].answer, None);
        let roundtrip = parse_backup(&serialize_backup(&backup).unwrap()).unwrap();
        assert_eq!(roundtrip, backup);
    }

    #[test]
    fn backup_catalog_is_not_silently_assigned_to_the_imported_manuscript() {
        let backup = parse_backup(WEB_V2).unwrap();
        let catalog = backup.folios.clone();
        let document = backup
            .into_document(Folio::draft("new-native-id", "Native copy", 123), 123)
            .unwrap();
        assert_eq!(document.folio.id, "new-native-id");
        assert_eq!(document.content.folio_id, "new-native-id");
        assert_eq!(document.projection, ProjectionState::UnverifiedCache);
        assert_eq!(document.backup_template.as_ref().unwrap().folios, catalog);
        assert_eq!(document.canonical_source().unwrap().as_bytes(), SOURCE);
        let reexport = backup_for_document(&document, "2026-10-04T00:00:00Z").unwrap();
        assert_eq!(reexport.folios, catalog);
        assert_eq!(reexport.canonical_source().unwrap().as_bytes(), SOURCE);
    }

    #[test]
    fn unknown_fields_survive_at_every_document_boundary() {
        let backup = parse_backup(EXTENDED).unwrap();
        let roundtrip = parse_backup(&serialize_backup(&backup).unwrap()).unwrap();
        assert_eq!(roundtrip, backup);
        assert_eq!(backup.extra["futureWorkspace"]["revision"], 4);
        assert_eq!(backup.content.extra["sourceMap"]["encoding"], "utf-8");
        let folio = &backup.folios.as_ref().unwrap()[0];
        assert_eq!(folio.extra["futureCover"], "engraved");
        assert_eq!(folio.layout.as_ref().unwrap().extra["futureRule"], "double");
        assert_eq!(
            folio
                .layout
                .as_ref()
                .unwrap()
                .opening_initial
                .as_ref()
                .unwrap()
                .extra["futureInk"],
            "indigo"
        );
        let brief = backup.brief.as_ref().unwrap();
        assert_eq!(brief.extra["futureStatus"], "revised");
        assert_eq!(brief.answers.extra["futureReader"], "the writer");
        assert_eq!(brief.attachments[0].extra["futureLocator"], "sheet 3");
        assert_eq!(
            brief.probes.as_ref().unwrap()[0].extra["futureConfidence"],
            "high"
        );
        let document = backup
            .into_document(Folio::draft("copy", "Copy", 1), 1)
            .unwrap();
        let reexport = backup_for_document(&document, "later").unwrap();
        assert_eq!(
            reexport.extra,
            document.backup_template.as_ref().unwrap().extra
        );
        assert_eq!(
            reexport.content.extra["sourceMap"],
            document.content.extra["sourceMap"]
        );
    }

    #[test]
    fn legacy_html_backup_stays_html_without_fabricating_source() {
        let backup = parse_backup(WEB_V1).unwrap();
        assert_eq!(backup.canonical_source(), None);
        assert_eq!(backup.brief.as_ref().unwrap().probes, None);
        let document = backup
            .into_document(Folio::draft("legacy", "Legacy", 1), 1)
            .unwrap();
        assert_eq!(document.projection, ProjectionState::LegacyHtml);
        assert!(export_typst_source(&document).is_err());
        let reexport = backup_for_document(&document, "later").unwrap();
        assert_eq!(reexport.version_number(), Some(1));
        assert_eq!(reexport.canonical_source(), None);
        assert_eq!(reexport.content.html, Some(document.content.html.clone()));
        assert!(
            !serde_json::to_value(reexport.brief.as_ref().unwrap())
                .unwrap()
                .as_object()
                .unwrap()
                .contains_key("probes")
        );
    }

    #[test]
    fn typst_import_and_export_preserve_bom_unicode_and_crlf_exactly() {
        let bytes =
            "\u{feff}// untouched\r\n#let f(x) = x * 2\r\n\r\n= Å — café\r\n\r\n".as_bytes();
        let document = import_typst(bytes, "folder/Untouched.TYP", "native", 77).unwrap();
        assert_eq!(document.folio.name, "Untouched");
        assert_eq!(document.projection, ProjectionState::Unavailable);
        assert_eq!(document.content.html, "");
        assert_eq!(document.provenance.as_ref().unwrap().original_bytes, bytes);
        assert_eq!(export_typst_source(&document).unwrap(), bytes);
        let backup = backup_for_document(&document, "now").unwrap();
        assert!(backup.content.html.is_none());
        assert_eq!(backup.canonical_source().unwrap().as_bytes(), bytes);
    }

    #[test]
    fn empty_typst_source_still_wins_over_html() {
        let backup =
            parse_backup(br#"{"version":2,"content":{"html":"<p>Stale</p>","typstSource":""}}"#)
                .unwrap();
        let document = backup
            .into_document(Folio::draft("empty", "Empty", 1), 1)
            .unwrap();
        assert_eq!(document.canonical_source(), Some(""));
        assert_eq!(document.projection, ProjectionState::UnverifiedCache);
        assert!(export_typst_source(&document).unwrap().is_empty());
    }

    #[test]
    fn projection_completion_is_guarded_by_the_exact_canonical_source() {
        let mut document = import_typst(SOURCE, "canonical.typ", "native", 1).unwrap();
        assert!(
            document
                .install_verified_projection("old source", "<p>Wrong</p>".into())
                .is_err()
        );
        assert_eq!(document.projection, ProjectionState::Unavailable);
        let source = document.canonical_source().unwrap().to_owned();
        document
            .install_verified_projection(&source, "<p>Verified</p>".into())
            .unwrap();
        assert_eq!(document.projection, ProjectionState::Verified);
        assert_eq!(document.content.html, "<p>Verified</p>");
        assert_eq!(document.canonical_source(), Some(source.as_str()));
    }

    #[test]
    fn absent_null_and_present_briefs_roundtrip_distinctly() {
        for value in [
            json!({"content":{"html":""}}),
            json!({"brief":null,"content":{"html":""}}),
        ] {
            let bytes = serde_json::to_vec(&value).unwrap();
            let backup = parse_backup(&bytes).unwrap();
            let roundtrip: Value =
                serde_json::from_slice(&serialize_backup(&backup).unwrap()).unwrap();
            assert_eq!(value, roundtrip);
        }
    }

    #[test]
    fn compatible_future_and_unversioned_envelopes_match_web_import_acceptance() {
        for version in [
            json!(3),
            json!("future"),
            json!({"edition": 4}),
            Value::Null,
        ] {
            let value = json!({"version":version,"futureField":{"keep":true},"content":{"typstSource":"= Canonical","html":"<p>Stale</p>"}});
            let bytes = serde_json::to_vec(&value).unwrap();
            let backup = parse_backup(&bytes).unwrap();
            assert_eq!(serde_json::to_value(&backup).unwrap(), value);
            let document = backup
                .into_document(Folio::draft("copy", "Copy", 1), 1)
                .unwrap();
            let reexport = backup_for_document(&document, "later").unwrap();
            assert_eq!(serde_json::to_value(reexport).unwrap()["version"], version);
        }
        let backup = parse_backup(br#"{"content":{"html":"<p>Legacy</p>"}}"#).unwrap();
        assert!(backup.version.is_missing());
    }

    #[test]
    fn source_only_backup_is_supported_without_an_invented_projection() {
        let backup = parse_backup(
            br#"{"version":2,"content":{"format":"typst","typstSource":"= Source only"}}"#,
        )
        .unwrap();
        let document = backup
            .into_document(Folio::draft("source", "Source", 1), 1)
            .unwrap();
        assert_eq!(document.projection, ProjectionState::Unavailable);
        assert_eq!(document.content.html, "");
        assert_eq!(
            backup_for_document(&document, "later")
                .unwrap()
                .content
                .html,
            None
        );
    }

    #[test]
    fn original_backup_bytes_and_source_metadata_survive_native_persistence() {
        let mut input = b"\xef\xbb\xbf".to_vec();
        input.extend_from_slice(EXTENDED);
        let document = import_backup(
            &input,
            "extended.twyne.json",
            Folio::draft("copy", "Copy", 1),
            1,
        )
        .unwrap();
        let saved = serde_json::to_vec(&document).unwrap();
        let restored: WorkspaceDocument = serde_json::from_slice(&saved).unwrap();
        assert_eq!(restored, document);
        assert_eq!(restored.provenance.as_ref().unwrap().original_bytes, input);
        assert_eq!(export_typst_source(&restored).unwrap(), SOURCE);
    }

    #[test]
    fn rejects_unrelated_and_malformed_files_without_returning_content() {
        for bytes in [
            b"not json".as_slice(),
            b"null",
            b"[]",
            b"{}",
            br#"{"content":{}}"#,
            br#"{"content":{"html":42}}"#,
            br#"{"content":{"typstSource":true}}"#,
            br#"{"version":2,"folios":[{"id":"bad"}],"content":{"html":""}}"#,
            b"\xff\xfe",
        ] {
            assert!(parse_backup(bytes).is_err(), "accepted {bytes:?}");
        }
        assert!(import_typst(b"\xff", "bad.typ", "id", 1).is_err());
    }

    #[test]
    fn rejects_cross_folio_content_and_invalid_page_settings() {
        let mut document = import_typst(SOURCE, "source.typ", "a", 1).unwrap();
        document.content.folio_id = "b".into();
        assert!(export_typst_source(&document).is_err());
        let mut backup = parse_backup(WEB_V2).unwrap();
        backup.folios.as_mut().unwrap()[0]
            .layout
            .as_mut()
            .unwrap()
            .columns = Some(0);
        assert!(serialize_backup(&backup).is_err());
    }

    #[test]
    fn source_size_limit_matches_utf16_units_rather_than_utf8_bytes() {
        let source = "é".repeat(MAX_SOURCE_UNITS);
        assert!(validate_source(&source).is_ok());
        assert!(validate_source(&(source + "x")).is_err());
        let source = "🧵".repeat(MAX_SOURCE_UNITS / 2);
        assert!(validate_source(&source).is_ok());
        assert!(validate_source(&(source + "🧵")).is_err());
    }

    #[test]
    fn current_v2_constructor_matches_the_web_envelope() {
        let backup = TwyneBackup::new_v2(
            "Title",
            "#let x = 1\r\n",
            "<p>Projection</p>",
            None,
            Vec::new(),
            "2026-10-04T00:00:00.000Z",
        );
        let value = serde_json::to_value(backup).unwrap();
        assert_eq!(
            value,
            json!({
                "version": 2, "exportedAt": "2026-10-04T00:00:00.000Z", "title": "Title",
                "brief": null, "folios": [], "content": {
                    "html": "<p>Projection</p>", "format": "typst", "typstSource": "#let x = 1\r\n"
                }
            })
        );
        assert_eq!(
            parse_backup(WEB_V2).unwrap().folios.unwrap()[1]
                .layout
                .as_ref()
                .unwrap()
                .pagination,
            Some(PaginationMode::Paginated)
        );
    }
}
