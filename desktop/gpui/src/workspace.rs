//! Twyne's persisted folio contracts, shared by the web and native workspaces.
//!
//! These DTOs mirror `src/types/index.ts` and the `FolioContentSnapshot` in
//! `src/utils/idb.ts`. Defaults are rendering choices, not migrations: parsing
//! an old layout must not write a pagination mode that its writer never chose.

use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Fields introduced by another Twyne version survive native round trips.
pub type ExtraFields = BTreeMap<String, Value>;

macro_rules! string_enum {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
        pub enum $name {
            $(#[serde(rename = $value)] $variant),+
        }
    };
}

string_enum!(FolioType { Draft => "draft", Notes => "notes", Outline => "outline" });
string_enum!(ContentFormat { Html => "html", Typst => "typst" });
string_enum!(DocWidth { Narrow => "narrow", Normal => "normal", Wide => "wide" });
string_enum!(DocMargin { Tight => "tight", Normal => "normal", Roomy => "roomy" });
string_enum!(PaperSize { Letter => "letter", A4 => "a4", Legal => "legal" });
string_enum!(Orientation { Portrait => "portrait", Landscape => "landscape" });
string_enum!(PaginationMode { Paginated => "paginated", Continuous => "continuous" });
string_enum!(MarginUnit { Rem => "rem", Inches => "in", Millimeters => "mm" });
string_enum!(OpeningInitialMode { Off => "off", Plain => "plain", Illuminated => "illuminated" });
string_enum!(OpeningInitialCollection { Botanical => "botanical", Alternate => "alternate" });
string_enum!(OpeningInitialSize { Small => "small", Medium => "medium", Large => "large" });
string_enum!(PageBorderStyle {
    None => "none", Plain => "plain", Botanical => "botanical",
    Engraved => "engraved", Illuminated => "illuminated"
});
string_enum!(AttachmentKind { Document => "document", Link => "link" });
string_enum!(ProbeKind { Choice => "choice", Multi => "multi", Blanks => "blanks", Scale => "scale" });
string_enum!(BriefField {
    WorkingTitle => "workingTitle", Format => "format", Audience => "audience",
    Goal => "goal", Tone => "tone", Constraints => "constraints", SuccessSignal => "successSignal"
});

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpeningInitialSettings {
    pub mode: OpeningInitialMode,
    pub collection: OpeningInitialCollection,
    pub size: OpeningInitialSize,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl Default for OpeningInitialSettings {
    fn default() -> Self {
        Self {
            mode: OpeningInitialMode::Illuminated,
            collection: OpeningInitialCollection::Botanical,
            size: OpeningInitialSize::Medium,
            extra: ExtraFields::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSettings {
    pub width: DocWidth,
    pub margin: DocMargin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin_x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin_left: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin_right: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin_top: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin_bottom: Option<f64>,
    pub running_header: bool,
    pub page_numbers: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_margin_guides: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paper: Option<PaperSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orientation: Option<Orientation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pagination: Option<PaginationMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin_unit: Option<MarginUnit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opening_initial: Option<OpeningInitialSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_border: Option<PageBorderStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_gap: Option<f64>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl Default for LayoutSettings {
    fn default() -> Self {
        // Mirrors DEFAULT_LAYOUT, including deliberately absent pagination.
        Self {
            width: DocWidth::Normal,
            margin: DocMargin::Normal,
            margin_x: Some(2.0),
            margin_left: Some(2.0),
            margin_right: Some(2.0),
            margin_top: Some(1.0),
            margin_bottom: Some(1.0),
            running_header: false,
            page_numbers: true,
            show_margin_guides: Some(false),
            paper: Some(PaperSize::Letter),
            orientation: Some(Orientation::Portrait),
            pagination: None,
            margin_unit: Some(MarginUnit::Rem),
            opening_initial: Some(OpeningInitialSettings::default()),
            page_border: Some(PageBorderStyle::Plain),
            columns: Some(1),
            column_gap: Some(1.5),
            extra: ExtraFields::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResolvedMargins {
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResolvedPageSetup {
    pub paper: PaperSize,
    pub orientation: Orientation,
    pub pagination: PaginationMode,
    pub margin_unit: MarginUnit,
    pub width_in: f64,
    pub height_in: f64,
}

impl LayoutSettings {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.columns
                .is_none_or(|columns| (1..=3).contains(&columns)),
            "A Twyne manuscript must have one, two, or three columns."
        );
        for number in [
            self.margin_x,
            self.margin_left,
            self.margin_right,
            self.margin_top,
            self.margin_bottom,
            self.column_gap,
        ]
        .into_iter()
        .flatten()
        {
            ensure!(number.is_finite(), "Page measurements must be finite.");
        }
        Ok(())
    }

    pub fn resolve_margins(&self) -> ResolvedMargins {
        let preset = match self.margin {
            DocMargin::Tight => 1.5,
            DocMargin::Normal => 3.0,
            DocMargin::Roomy => 5.0,
        };
        let x = self.margin_x.unwrap_or(preset);
        ResolvedMargins {
            left: self.margin_left.unwrap_or(x),
            right: self.margin_right.unwrap_or(x),
            top: self
                .margin_top
                .unwrap_or(if self.margin == DocMargin::Roomy {
                    5.0
                } else {
                    2.5
                }),
            bottom: self
                .margin_bottom
                .unwrap_or(if self.margin == DocMargin::Roomy {
                    5.0
                } else {
                    4.0
                }),
        }
    }

    pub fn resolve_page_setup(&self) -> ResolvedPageSetup {
        let paper = self.paper.unwrap_or(PaperSize::Letter);
        let orientation = self.orientation.unwrap_or(Orientation::Portrait);
        let (width, height) = match paper {
            PaperSize::Letter => (8.5, 11.0),
            PaperSize::A4 => (8.2677, 11.6929),
            PaperSize::Legal => (8.5, 14.0),
        };
        let landscape = orientation == Orientation::Landscape;
        ResolvedPageSetup {
            paper,
            orientation,
            pagination: self.pagination.unwrap_or(PaginationMode::Continuous),
            margin_unit: self.margin_unit.unwrap_or(MarginUnit::Rem),
            width_in: if landscape { height } else { width },
            height_in: if landscape { width } else { height },
        }
    }

    /// Print has a separate fallback from the editor's scrolling view.
    pub fn print_pagination(&self) -> PaginationMode {
        self.pagination.unwrap_or(PaginationMode::Paginated)
    }

    pub fn resolve_columns(&self) -> u8 {
        self.columns
            .filter(|columns| matches!(columns, 2 | 3))
            .unwrap_or(1)
    }

    pub fn resolve_column_gap(&self) -> f64 {
        self.column_gap
            .filter(|gap| gap.is_finite())
            .map(|gap| gap.clamp(0.75, 3.0))
            .unwrap_or(1.5)
    }

    pub fn width_rem(&self) -> f64 {
        match self.width {
            DocWidth::Narrow => 36.0,
            DocWidth::Normal => 48.0,
            DocWidth::Wide => 62.0,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Folio {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub folio_type: FolioType,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<LayoutSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl Folio {
    pub fn draft(id: impl Into<String>, name: impl Into<String>, now: u64) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            folio_type: FolioType::Draft,
            created_at: now,
            updated_at: now,
            layout: Some(LayoutSettings::default()),
            header: None,
            footer: None,
            extra: ExtraFields::new(),
        }
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(!self.id.is_empty(), "A folio must have an identity.");
        if let Some(layout) = &self.layout {
            layout.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolioContentSnapshot {
    pub folio_id: String,
    pub html: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ContentFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typst_source: Option<String>,
    pub updated_at: u64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl FolioContentSnapshot {
    /// An empty source is still canonical. Presence, rather than length, wins.
    pub fn canonical_source(&self) -> Option<&str> {
        self.typst_source.as_deref()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInterviewAnswers {
    pub working_title: String,
    pub format: String,
    pub audience: String,
    pub goal: String,
    pub tone: String,
    pub constraints: String,
    pub success_signal: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DossierAttachment {
    pub id: String,
    pub kind: AttachmentKind,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub why: String,
    pub added_at: u64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(untagged)]
pub enum ProbeAnswer {
    Text(String),
    Texts(Vec<String>),
    Number(f64),
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DossierProbe {
    pub id: String,
    pub kind: ProbeKind,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<ProbeAnswer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relates_to: Option<BriefField>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBrief {
    pub answers: ProjectInterviewAnswers,
    pub attachments: Vec<DossierAttachment>,
    pub completed_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probes: Option<Vec<DossierProbe>>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

/// Cached HTML accompanying a source is not proof of a successful compilation.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectionState {
    /// A legacy HTML document with no canonical Typst yet.
    LegacyHtml,
    /// Imported HTML is retained, but has not been derived from the source here.
    UnverifiedCache,
    /// Canonical source has no visual projection yet (for example a `.typ` file).
    Unavailable,
    /// The converter/compiler integration verified this HTML for this source.
    Verified,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportProvenance {
    pub file_name: String,
    /// Original import bytes, including a UTF-8 BOM and line endings.
    pub original_bytes: Vec<u8>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

/// A native folio and its content are persisted as a single recoverable unit.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDocument {
    pub folio: Folio,
    pub content: FolioContentSnapshot,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brief: Option<ProjectBrief>,
    pub projection: ProjectionState,
    /// The web envelope has a catalog, not content for every catalog entry.
    /// Keep it intact so an import/export cannot erase other folio metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_template: Option<Box<crate::exchange::TwyneBackup>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<ImportProvenance>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl WorkspaceDocument {
    pub fn canonical_source(&self) -> Option<&str> {
        self.content.canonical_source()
    }

    pub fn validate(&self) -> Result<()> {
        self.folio.validate()?;
        ensure!(
            self.folio.id == self.content.folio_id,
            "The content belongs to a different folio."
        );
        ensure!(
            self.content.format != Some(ContentFormat::Typst)
                || self.content.typst_source.is_some(),
            "A Typst snapshot is missing its canonical source."
        );
        match self.projection {
            ProjectionState::LegacyHtml => ensure!(
                self.canonical_source().is_none(),
                "A canonical Typst document cannot be labelled as legacy HTML."
            ),
            ProjectionState::Unavailable
            | ProjectionState::UnverifiedCache
            | ProjectionState::Verified => ensure!(
                self.canonical_source().is_some(),
                "A Typst projection must identify its canonical source."
            ),
        }
        Ok(())
    }

    /// Only a verified conversion may replace the projection of a source.
    /// This method does not compile or apply an edit; callers must provide the
    /// exact expected source so a late conversion cannot attach to a newer one.
    pub fn install_verified_projection(
        &mut self,
        expected_source: &str,
        html: String,
    ) -> Result<()> {
        ensure!(
            self.canonical_source() == Some(expected_source),
            "The manuscript source changed before its projection was ready."
        );
        self.content.html = html;
        self.projection = ProjectionState::Verified;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn old_layout_preserves_absence_and_matches_web_fallbacks() {
        let value = json!({
            "width": "normal", "margin": "roomy", "runningHeader": false,
            "pageNumbers": true, "futureRuler": {"unit": "pica"}
        });
        let layout: LayoutSettings = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&layout).unwrap(), value);
        assert_eq!(
            layout.resolve_margins(),
            ResolvedMargins {
                left: 5.0,
                right: 5.0,
                top: 5.0,
                bottom: 5.0
            }
        );
        assert_eq!(
            layout.resolve_page_setup().pagination,
            PaginationMode::Continuous
        );
        assert_eq!(layout.print_pagination(), PaginationMode::Paginated);
        assert_eq!(layout.resolve_page_setup().paper, PaperSize::Letter);
        assert_eq!(layout.resolve_columns(), 1);
        assert_eq!(layout.resolve_column_gap(), 1.5);
    }

    #[test]
    fn defaults_do_not_invent_a_pagination_preference() {
        let value = serde_json::to_value(LayoutSettings::default()).unwrap();
        assert!(!value.as_object().unwrap().contains_key("pagination"));
        assert_eq!(value["openingInitial"]["mode"], "illuminated");
    }

    #[test]
    fn independent_margins_and_landscape_match_the_web_model() {
        let layout: LayoutSettings = serde_json::from_value(json!({
            "width": "wide", "margin": "tight", "marginX": 2.25,
            "marginLeft": 0.0, "marginBottom": 6.25, "runningHeader": true,
            "pageNumbers": false, "paper": "legal", "orientation": "landscape",
            "pagination": "continuous", "columns": 3, "columnGap": 10.0
        }))
        .unwrap();
        assert_eq!(
            layout.resolve_margins(),
            ResolvedMargins {
                left: 0.0,
                right: 2.25,
                top: 2.5,
                bottom: 6.25
            }
        );
        assert_eq!(layout.resolve_page_setup().width_in, 14.0);
        assert_eq!(layout.resolve_page_setup().height_in, 8.5);
        assert_eq!(layout.print_pagination(), PaginationMode::Continuous);
        assert_eq!(layout.resolve_columns(), 3);
        assert_eq!(layout.resolve_column_gap(), 3.0);
        assert_eq!(layout.width_rem(), 62.0);
        assert_eq!(layout.column_gap, Some(10.0));
    }

    #[test]
    fn absent_and_empty_probes_are_distinct() {
        let value = json!({
            "answers": {"workingTitle": "", "format": "", "audience": "", "goal": "",
                "tone": "", "constraints": "", "successSignal": ""},
            "attachments": [], "completedAt": 1, "updatedAt": 2
        });
        let brief: ProjectBrief = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&brief).unwrap(), value);
        let mut with_probes = brief;
        with_probes.probes = Some(Vec::new());
        assert_eq!(
            serde_json::to_value(with_probes).unwrap()["probes"],
            json!([])
        );
    }
}
