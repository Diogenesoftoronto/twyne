//! Prepare a filed folio; disk persistence and recovery acknowledgement follow.
use crate::{
    dossier::{DossierMode, PriorMaterial},
    manuscript::{Manuscript, timestamp},
    semantic_bridge::SemanticBridge,
    workspace::*,
};
use anyhow::Result;
use std::sync::Arc;

pub fn prepare_document(
    mut document: Manuscript,
    brief: ProjectBrief,
    prior_material: Option<PriorMaterial>,
    mode: DossierMode,
) -> Result<Manuscript> {
    let bridge = SemanticBridge::discover()?;
    let now = timestamp();
    let empty =
        document
            .workspace
            .as_deref()
            .map_or(document.body.trim().is_empty(), |workspace| {
                workspace
                    .canonical_source()
                    .map_or(workspace.content.html.trim().is_empty(), |source| {
                        source.trim().is_empty()
                    })
            });
    if document.workspace.is_none() {
        let mut extra = ExtraFields::new();
        let converted = if empty {
            None
        } else {
            extra.insert(
                "nativeMarkdownSource".into(),
                serde_json::Value::String(document.body.clone()),
            );
            Some(bridge.from_markdown(&document.body)?)
        };
        document.workspace = Some(Arc::new(WorkspaceDocument {
            folio: Folio::draft(
                document.id.to_string(),
                document.title.clone(),
                document.created_at,
            ),
            content: FolioContentSnapshot {
                folio_id: document.id.to_string(),
                html: converted
                    .as_ref()
                    .map_or(String::new(), |value| value.html.clone()),
                format: Some(ContentFormat::Typst),
                typst_source: Some(converted.map_or(String::new(), |value| value.source)),
                updated_at: now,
                extra: ExtraFields::new(),
            },
            brief: None,
            projection: ProjectionState::Verified,
            backup_template: None,
            provenance: None,
            extra,
        }));
    }
    let workspace = Arc::make_mut(document.workspace.as_mut().unwrap());
    if empty && mode == DossierMode::Create {
        let material = prior_material.as_ref();
        let converted =
            if let Some(source) = material.and_then(PriorMaterial::canonical_seed_source) {
                crate::semantic_bridge::Reconciliation {
                    source: source.to_owned(),
                    html: bridge.project(source)?.html,
                }
            } else if let Some(html) = material
                .filter(|material| !material.edited)
                .and_then(|material| material.html.as_deref())
            {
                bridge.from_html(html)?
            } else {
                bridge.starter(
                    &serde_json::to_value(&brief.answers)?,
                    material.map(|material| material.text.as_str()),
                    material.and_then(PriorMaterial::imported_filename),
                )?
            };
        workspace.content.typst_source = Some(converted.source);
        workspace.content.html = converted.html;
        workspace.content.format = Some(ContentFormat::Typst);
        workspace.content.updated_at = now;
        workspace.projection = ProjectionState::Verified;
        if let Some(provenance) = material.and_then(|material| material.provenance.as_ref()) {
            workspace.provenance = Some(provenance.clone());
        }
    }
    document.title = brief.answers.working_title.clone();
    workspace.folio.name = document.title.clone();
    workspace.folio.updated_at = now;
    workspace.brief = Some(brief);
    document.body = workspace
        .canonical_source()
        .unwrap_or(&workspace.content.html)
        .to_owned();
    document.touch();
    document.validate()?;
    Ok(document)
}
