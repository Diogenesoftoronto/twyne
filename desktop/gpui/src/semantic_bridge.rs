//! Runs the same bounded document projection/reconciliation as Twyne's web app.
//!
//! The packaged helper is a local executable, with no network or hosted UI.
//! These operations belong at explicit/idle freshness boundaries, never inside
//! the native input transaction. Authored source stays authoritative.

use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

#[derive(Clone, Debug)]
pub struct SemanticBridge {
    executable: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct Projection {
    pub html: String,
}

#[derive(Debug, Deserialize)]
pub struct InlineSvg {
    pub svg: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderedFolioNames {
    pub folio_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct LibraryCardText {
    pub words: usize,
    pub preview: String,
}

#[derive(Debug, Deserialize)]
pub struct LocalTimestamp {
    pub label: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricDraftContext {
    pub fingerprint: String,
    pub word_count: usize,
    pub min_words: usize,
    pub ready: bool,
    pub static_score: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricRoomParts {
    pub judge_mean: f64,
    pub min_judge: f64,
    pub static_total: f64,
    pub effective_static: f64,
    pub raw_mean: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApparatusDetectedCitation {
    pub id: String,
    pub text: String,
    pub from: usize,
    pub to: usize,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lookup_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ApparatusDetectedCitations {
    pub citations: Vec<ApparatusDetectedCitation>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ApparatusHtmlScan {
    pub text: String,
    pub citations: Vec<ApparatusDetectedCitation>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ApparatusSteeringResult {
    pub ok: bool,
    pub message: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ApparatusScanSurface {
    Board,
    Page,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApparatusFormattedEntry {
    pub index: usize,
    pub id: String,
    pub folio_id: String,
    pub citation: String,
    pub footnote: String,
    pub normalized_url: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ApparatusFormattingIssue {
    pub index: usize,
    pub error: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApparatusFormattedBibliography {
    pub rows: Vec<ApparatusFormattedEntry>,
    pub issues: Vec<ApparatusFormattingIssue>,
    pub copy_text: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApparatusMergeTarget {
    pub index: usize,
    pub expected_raw_row: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApparatusBuiltEntry {
    pub entry: Value,
    pub merge_target: Option<ApparatusMergeTarget>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CitationTextChild {
    pub offset: usize,
    pub text: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct CitationTextBlock {
    /// Native global UTF-16 start minus one, for the original pos+1 mapping.
    pub position: isize,
    pub children: Vec<CitationTextChild>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct CitationUtf16Range {
    pub from: usize,
    pub to: usize,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CitationFoundRange {
    pub range: Option<CitationUtf16Range>,
}

#[derive(Debug, Deserialize)]
pub struct Reconciliation {
    pub source: String,
    pub html: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct DecorationAsset {
    pub path: String,
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct PreparedProof {
    pub source: String,
    pub decorations: Vec<DecorationAsset>,
}

#[derive(Deserialize)]
struct Response<T> {
    ok: bool,
    result: Option<T>,
    error: Option<String>,
}

impl SemanticBridge {
    pub fn discover() -> Result<Self> {
        if let Some(path) = std::env::var_os("TWYNE_DOCUMENT_HELPER") {
            ensure!(!path.is_empty(), "TWYNE_DOCUMENT_HELPER cannot be empty.");
            return Self::at(path.into());
        }
        let name = if cfg!(windows) {
            "twyne-document.exe"
        } else {
            "twyne-document"
        };
        let sibling = std::env::current_exe()?
            .parent()
            .context("No application directory")?
            .join(name);
        if sibling.is_file() {
            return Self::at(sibling);
        }
        // A development build can use the separately compiled helper. Releases
        // ship it next to the application; no user-installed Bun is required.
        Self::at(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("document")
                .join(name),
        )
    }

    pub fn at(executable: PathBuf) -> Result<Self> {
        ensure!(
            executable.is_file(),
            "The local document helper is missing: {}. Build it with desktop.gpui.build-helper.",
            executable.display()
        );
        Ok(Self { executable })
    }

    fn call<T: DeserializeOwned>(&self, request: impl Serialize) -> Result<T> {
        let bytes = serde_json::to_vec(&request)?;
        ensure!(
            bytes.len() <= 64 * 1024 * 1024,
            "Document request is too large."
        );
        let mut child = Command::new(&self.executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Could not start the local document helper")?;
        let write_result = child
            .stdin
            .take()
            .context("Document helper input is unavailable")?
            .write_all(&bytes);
        if let Err(error) = write_result {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error).context("Could not send the document to the local helper");
        }
        let output = child
            .wait_with_output()
            .context("Document helper stopped unexpectedly")?;
        let response: Response<T> = serde_json::from_slice(&output.stdout)
            .context("Document helper returned an unreadable result")?;
        if !response.ok || !output.status.success() {
            bail!(
                "{}",
                response
                    .error
                    .unwrap_or_else(|| "Document conversion failed.".into())
            );
        }
        response
            .result
            .context("Document helper returned no result")
    }

    pub fn project(&self, source: &str) -> Result<Projection> {
        self.call(serde_json::json!({"command":"project", "source":source}))
    }

    pub fn render_latex(&self, source: &str, block: bool) -> Result<InlineSvg> {
        self.render_inline("latex", source, block)
    }

    pub fn render_inline(&self, kind: &str, source: &str, block: bool) -> Result<InlineSvg> {
        self.call(serde_json::json!({"command":"renderInline", "kind":kind, "source":source, "block":block}))
    }

    pub fn from_html(&self, html: &str) -> Result<Reconciliation> {
        self.call(serde_json::json!({"command":"fromHtml", "html":html}))
    }

    pub fn from_markdown(&self, markdown: &str) -> Result<Reconciliation> {
        self.call(serde_json::json!({"command":"fromMarkdown", "markdown":markdown}))
    }

    pub fn order_folio_names(&self, folios: &[(String, String)]) -> Result<OrderedFolioNames> {
        let names: Vec<_> = folios
            .iter()
            .map(|(folio_id, name)| serde_json::json!({"folioId": folio_id, "name": name}))
            .collect();
        self.call(serde_json::json!({"command": "orderFolioNames", "folios": names}))
    }

    pub fn library_card_text(&self, html: &str) -> Result<LibraryCardText> {
        self.call(serde_json::json!({"command": "libraryCardText", "html": html}))
    }

    pub fn rubric_draft_context(&self, html: &str) -> Result<RubricDraftContext> {
        self.call(serde_json::json!({"command": "rubricDraftContext", "html": html}))
    }

    pub fn rubric_room_parts(
        &self,
        judges: &Value,
        static_score: &Value,
        brief: Option<&Value>,
        target_fit: Option<f64>,
    ) -> Result<RubricRoomParts> {
        self.call(serde_json::json!({
            "command": "rubricRoomParts", "judges": judges,
            "staticScore": static_score, "brief": brief, "targetFit": target_fit,
        }))
    }

    /// Explicit scans use the original regexes and UTF-16 offsets. No result
    /// establishes source verification, research or an editorial anchor.
    pub fn apparatus_detect(&self, text: &str) -> Result<ApparatusDetectedCitations> {
        self.call(serde_json::json!({"command": "apparatusDetect", "text": text}))
    }

    pub fn apparatus_scan_html(
        &self,
        html: &str,
        surface: ApparatusScanSurface,
    ) -> Result<ApparatusHtmlScan> {
        self.call(serde_json::json!({
            "command": "apparatusScanHtml", "html": html, "surface": surface,
        }))
    }

    /// Reuses the original steering gates with the actual offline provider
    /// adapter. This explicit action cannot start research or return success.
    pub fn apparatus_steer_offline(
        &self,
        instructions: &str,
        folio_id: Option<&str>,
        text: &str,
    ) -> Result<ApparatusSteeringResult> {
        let result: ApparatusSteeringResult = self.call(serde_json::json!({
            "command": "apparatusSteerOffline", "instructions": instructions,
            "folioId": folio_id, "text": text,
        }))?;
        ensure!(
            !result.ok,
            "The offline steering adapter cannot start research."
        );
        Ok(result)
    }

    pub fn apparatus_format(
        &self,
        entries: &[Value],
        style: &str,
    ) -> Result<ApparatusFormattedBibliography> {
        self.call(serde_json::json!({
            "command": "apparatusFormat", "entries": entries, "style": style,
        }))
    }

    /// Produces the exact original offline candidate and optional raw row
    /// guard. The host must still validate and acknowledge a durable CAS write.
    pub fn apparatus_build_detected(
        &self,
        citation: &ApparatusDetectedCitation,
        folio_id: &str,
        now: f64,
        bibliography: &[Value],
    ) -> Result<ApparatusBuiltEntry> {
        ensure!(now.is_finite(), "The source creation date is invalid.");
        self.call(serde_json::json!({
            "command": "apparatusBuildDetected", "citation": citation,
            "folioId": folio_id, "now": now, "bibliography": bibliography,
        }))
    }

    pub fn citation_find_range(
        &self,
        quote: &str,
        blocks: &[CitationTextBlock],
    ) -> Result<CitationFoundRange> {
        self.call(serde_json::json!({
            "command": "citationFindRange", "quote": quote, "blocks": blocks,
        }))
    }

    pub fn local_timestamp(&self, timestamp: u64) -> Result<LocalTimestamp> {
        self.call(serde_json::json!({"command": "localTimestamp", "timestamp": timestamp}))
    }

    /// Rubric stores the original JavaScript number, including signed and
    /// fractional dates. Its Date semantics belong to the same local helper.
    pub fn local_timestamp_ms(&self, timestamp: f64) -> Result<LocalTimestamp> {
        ensure!(timestamp.is_finite(), "The filed date is invalid.");
        self.call(serde_json::json!({"command": "localTimestamp", "timestamp": timestamp}))
    }

    pub fn starter(
        &self,
        answers: &Value,
        material: Option<&str>,
        filename: Option<&str>,
    ) -> Result<Reconciliation> {
        self.call(serde_json::json!({"command":"starter", "answers":answers, "material":material, "filename":filename}))
    }

    pub fn reconcile(&self, source: &str, html: &str) -> Result<Reconciliation> {
        self.call(serde_json::json!({"command":"reconcile", "source":source, "html":html}))
    }

    pub fn prepare_proof(&self, source: &str, payload: &Value) -> Result<PreparedProof> {
        self.call(serde_json::json!({"command":"prepareProof", "source":source, "payload":payload}))
    }
}
