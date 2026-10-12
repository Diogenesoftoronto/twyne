//! Native proof preparation reuses the source app's editorial settings.
use anyhow::{Context, Result, anyhow};
use gpui_kit::AssetSource;
use serde_json::Value;
use std::sync::{Arc, OnceLock};
use twyne_desktop::{
    assets::TwyneAssets,
    native_typst::{CompileRequest, CompileResult, TypstAsset, TypstEngine},
    semantic_bridge::SemanticBridge,
    workspace::WorkspaceDocument,
};

#[derive(Default)]
pub struct NativeCompiler {
    engine: OnceLock<Result<TypstEngine, String>>,
}

pub struct ProofBuild {
    pub compilation: CompileResult,
    /// The real bounded visual projection of the canonical source. Only a
    /// successful, current compile may be applied to the workspace.
    pub html: Option<String>,
}

impl NativeCompiler {
    pub fn compile(
        &self,
        generation: u64,
        source: Arc<str>,
        workspace: Option<&WorkspaceDocument>,
        title: &str,
    ) -> Result<ProofBuild> {
        let engine = self
            .engine
            .get_or_init(|| TypstEngine::new().map_err(|error| format!("{error:#}")))
            .as_ref()
            .map_err(|error| anyhow!("{error}"))?;
        let bridge = SemanticBridge::discover()?;
        let mut payload =
            serde_json::json!({"title":title, "html":"", "typstSource":source.as_ref()});
        if let Some(workspace) = workspace {
            payload["html"] = Value::String(workspace.content.html.clone());
            if let Some(layout) = &workspace.folio.layout {
                payload["layout"] = serde_json::to_value(layout)?;
            }
            if let Some(header) = &workspace.folio.header {
                payload["header"] = Value::String(header.clone());
            }
            if let Some(footer) = &workspace.folio.footer {
                payload["footer"] = Value::String(footer.clone());
            }
        }
        let prepared = bridge.prepare_proof(&source, &payload)?;
        let mut request = CompileRequest::new(generation, source.clone());
        request.prepared_source = Some(prepared.source.into());
        for asset in prepared.decorations {
            let bytes = TwyneAssets
                .load(&asset.url)?
                .with_context(|| format!("The original artwork is unavailable: {}", asset.url))?;
            // The web renderer decodes AVIF artwork to PNG before supplying
            // Typst. The native catalog supplies lossless WebP with identical
            // RGBA pixels; preserve those pixels under the expected PNG path.
            let decoded = image::load_from_memory(bytes.as_ref())?;
            let mut png = std::io::Cursor::new(Vec::new());
            decoded.write_to(&mut png, image::ImageFormat::Png)?;
            request.assets.push(TypstAsset::new(
                asset.path,
                Arc::<[u8]>::from(png.into_inner()),
            ));
        }
        let compilation = engine.compile(request);
        let html = if compilation.proof.is_some() {
            Some(bridge.project(&source)?.html)
        } else {
            None
        };
        Ok(ProofBuild { compilation, html })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use twyne_desktop::workspace::{
        ContentFormat, ExtraFields, Folio, FolioContentSnapshot, ProjectionState,
    };

    #[test]
    fn real_editorial_compile_keeps_source_and_uses_original_artwork_in_svg_and_pdf() {
        let html = "<h1>The notebook</h1><p>The notebook was small enough to carry in a coat pocket. By November, its corners had softened and the cover had begun to remember the shape of a hand.</p><p>Most pages held ordinary things: the name of a book, a sentence overheard on the train, the hours of a shop she kept arriving at after it had closed.</p><h2>A note for the next draft</h2><p>Keep the opening concrete. Let the change in the room carry the ending.</p>";
        let source = SemanticBridge::discover()
            .unwrap()
            .from_html(html)
            .unwrap()
            .source;
        let source: Arc<str> = source.into();
        let workspace = WorkspaceDocument {
            folio: Folio::draft("native-proof-fixture", "The notebook", 1),
            content: FolioContentSnapshot {
                folio_id: "native-proof-fixture".into(),
                html: html.into(),
                format: Some(ContentFormat::Typst),
                typst_source: Some(source.to_string()),
                updated_at: 1,
                extra: ExtraFields::new(),
            },
            brief: None,
            projection: ProjectionState::Verified,
            backup_template: None,
            provenance: None,
            extra: ExtraFields::new(),
        };
        let result = NativeCompiler::default()
            .compile(9, source.clone(), Some(&workspace), "The notebook")
            .unwrap();
        let proof = result
            .compilation
            .proof
            .unwrap_or_else(|| panic!("{:?}", result.compilation.diagnostics));
        assert!(Arc::ptr_eq(&proof.source, &source));
        assert_eq!(proof.generation, 9);
        assert_eq!(proof.pages.len(), 1);
        assert!(proof.pdf.starts_with(b"%PDF-"));
        assert!(proof.pages[0].svg.contains("data:image/"));
        assert_eq!(result.html.as_deref(), Some(html));
        if let Some(directory) = std::env::var_os("TWYNE_NATIVE_PROOF_ARTIFACT_DIR") {
            let directory = std::path::PathBuf::from(directory);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("native.pdf"), &proof.pdf).unwrap();
            std::fs::write(directory.join("native.svg"), &proof.pages[0].svg).unwrap();
            std::fs::write(directory.join("canonical.typ"), proof.source.as_bytes()).unwrap();
            std::fs::write(
                directory.join("prepared.typ"),
                proof.compiled_source.as_bytes(),
            )
            .unwrap();
        }
    }
}
