//! Source-aware visual edits at the save boundary.
use crate::{
    manuscript::Manuscript,
    semantic_bridge::SemanticBridge,
    workspace::{ContentFormat, LayoutSettings, ProjectionState},
};
use anyhow::{Result, ensure};
use std::sync::Arc;

/// Reconcile a verified native rich document without replacing authored source
/// outside the changed blocks. Cached imports must first be projected here.
pub fn apply_html(mut document: Manuscript, html: &str) -> Result<Manuscript> {
    let workspace = Arc::make_mut(
        document
            .workspace
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("This folio has no rich workspace."))?,
    );
    ensure!(
        matches!(
            workspace.projection,
            ProjectionState::Verified | ProjectionState::LegacyHtml
        ),
        "Project the canonical source before editing its cached view."
    );
    let bridge = SemanticBridge::discover()?;
    let converted = match workspace.canonical_source() {
        Some(source) => bridge.reconcile(source, html)?,
        None => bridge.from_html(html)?,
    };
    workspace.content.typst_source = Some(converted.source.clone());
    workspace.content.html = converted.html;
    workspace.content.format = Some(ContentFormat::Typst);
    workspace.content.updated_at = document.updated_at;
    workspace.projection = ProjectionState::Verified;
    document.body = converted.source;
    document.validate()?;
    Ok(document)
}

pub fn visible_text(document: &Manuscript) -> String {
    document
        .workspace
        .as_deref()
        .and_then(|workspace| crate::editor::RichDocument::from_html(&workspace.content.html).ok())
        .map_or_else(|| document.body.clone(), |rich| rich.plain_text())
}

/// Capture page controls at the same freshness boundary as rich text. Merely
/// opening a ribbon preserves absent fields in an imported backup.
pub fn apply_page_settings(
    mut document: Manuscript,
    layout: LayoutSettings,
    header: String,
    footer: String,
) -> Result<Manuscript> {
    layout.validate()?;
    if let Some(workspace) = &mut document.workspace {
        let current = &workspace.folio;
        if current.layout.as_ref().cloned().unwrap_or_default() != layout
            || current.header.as_deref().unwrap_or_default() != header
            || current.footer.as_deref().unwrap_or_default() != footer
        {
            let workspace = Arc::make_mut(workspace);
            if workspace.folio.layout.as_ref().cloned().unwrap_or_default() != layout {
                workspace.folio.layout = Some(layout);
            }
            if workspace.folio.header.as_deref().unwrap_or_default() != header {
                workspace.folio.header = Some(header);
            }
            if workspace.folio.footer.as_deref().unwrap_or_default() != footer {
                workspace.folio.footer = Some(footer);
            }
            workspace.folio.updated_at = document.updated_at;
        }
    }
    document.validate()?;
    Ok(document)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exchange::import_typst;
    use crate::workspace::PaperSize;

    #[test]
    fn unchanged_page_controls_preserve_absent_imported_fields() {
        let mut workspace = import_typst(
            b"= Untouched\r\n",
            "Untouched.typ",
            uuid::Uuid::new_v4().to_string(),
            1,
        )
        .unwrap();
        workspace.folio.layout = None;
        let document = Manuscript::from_workspace(workspace).unwrap();
        let original = document.workspace.clone();
        let saved = apply_page_settings(
            document,
            LayoutSettings::default(),
            String::new(),
            String::new(),
        )
        .unwrap();
        assert_eq!(saved.workspace, original);
        assert_eq!(saved.body.as_bytes(), b"= Untouched\r\n");
    }

    #[test]
    fn page_changes_keep_authored_source_and_future_metadata() {
        let source = "\u{feff}// Authored\r\n#let custom = [Keep me]\r\n\r\n= Untouched\r\n";
        let mut workspace = import_typst(
            source.as_bytes(),
            "Untouched.typ",
            uuid::Uuid::new_v4().to_string(),
            1,
        )
        .unwrap();
        workspace
            .folio
            .extra
            .insert("future".into(), serde_json::json!({"edition": 3}));
        let document = Manuscript::from_workspace(workspace).unwrap();
        let mut layout = document
            .workspace
            .as_deref()
            .unwrap()
            .folio
            .layout
            .clone()
            .unwrap();
        layout.paper = Some(PaperSize::A4);
        let saved = apply_page_settings(
            document,
            layout,
            "東京 · draft".into(),
            "Keep this footer".into(),
        )
        .unwrap();
        let workspace = saved.workspace.as_deref().unwrap();
        assert_eq!(workspace.canonical_source(), Some(source));
        assert_eq!(saved.body, source);
        assert_eq!(
            workspace.folio.extra["future"],
            serde_json::json!({"edition": 3})
        );
        assert_eq!(workspace.folio.header.as_deref(), Some("東京 · draft"));
        assert_eq!(workspace.folio.footer.as_deref(), Some("Keep this footer"));
        assert_eq!(
            workspace.folio.layout.as_ref().unwrap().paper,
            Some(PaperSize::A4)
        );
    }
}
