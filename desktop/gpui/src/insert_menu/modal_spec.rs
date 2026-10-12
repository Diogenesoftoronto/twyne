//! Literal copy and dimensions read from the original insertion panels.
use super::parameters::FormKind;
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextModalSpec {
    pub kicker: String,
    pub title: String,
    pub description: String,
    pub input_label: String,
    pub placeholder: String,
    pub help_text: String,
    pub rows: usize,
    pub min_height_rem: f32,
    pub submit_label: String,
    pub preview_label: Option<String>,
}
#[derive(Deserialize)]
struct Catalog {
    footnote: TextModalSpec,
    endnote: TextModalSpec,
    mermaid: TextModalSpec,
}

pub fn spec(kind: FormKind) -> Option<&'static TextModalSpec> {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    let catalog = CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../fixtures/insert-menu/source-text-modals.json"
        ))
        .expect("verified original text modal fixture")
    });
    Some(match kind {
        FormKind::Footnote => &catalog.footnote,
        FormKind::Endnote => &catalog.endnote,
        FormKind::Mermaid => &catalog.mermaid,
        _ => return None,
    })
}
