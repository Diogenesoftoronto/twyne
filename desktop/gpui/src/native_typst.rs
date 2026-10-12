//! Offline proof compilation using the exact Typst fork embedded by the web compiler.
//!
//! Source is never rewritten here. A fresh file world is built for every request;
//! the SVG pages and PDF are exported from the same compiled `PagedDocument`.

use std::{
    collections::HashMap,
    fmt,
    io::Cursor,
    ops::Range,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};

use anyhow::{Context, ensure};
use chrono::{Datelike, Local, TimeDelta, Utc};
use sha2::{Digest, Sha256};
use typst::{
    Library, LibraryExt, World, WorldExt,
    diag::{FileError, FileResult, Severity, SourceDiagnostic},
    foundations::{Bytes, Datetime},
    layout::{FrameItem, PagedDocument},
    syntax::{FileId, Source, Span, VirtualPath, package::PackageSpec},
    text::{Font, FontBook},
    utils::LazyHash,
};

/// Matches `@myriaddreamin/typst-ts-web-compiler` 0.7.0, including its fork.
pub const TYPST_ENGINE_VERSION: &str = "0.14.2";
pub const TYPST_ENGINE_REVISION: &str = "951788cc614cd805d5d786e17bbf93796df73d10";

// Keep this order identical to src/utils/typst/compiler.worker.ts. Neither the
// platform font registry nor a network font service participates in compilation.
const FONT_FILES: &[&str] = &[
    "LibertinusSerif-Regular.otf",
    "LibertinusSerif-Bold.otf",
    "LibertinusSerif-Italic.otf",
    "LibertinusSerif-BoldItalic.otf",
    "DejaVuSansMono.ttf",
    "LibertinusMath-Regular.otf",
    "lora-Lora-Regular.ttf",
    "lora-Lora-Italic.ttf",
    "lora-Lora-Bold.ttf",
    "lora-Lora-BoldItalic.ttf",
    "librebaskerville-LibreBaskerville-Regular.ttf",
    "librebaskerville-LibreBaskerville-Italic.ttf",
    "librebaskerville-LibreBaskerville-Bold.ttf",
    "librebaskerville-LibreBaskerville-BoldItalic.ttf",
    "dmsans-DMSans-Regular.ttf",
    "dmsans-DMSans-Italic.ttf",
    "dmsans-DMSans-Bold.ttf",
    "dmsans-DMSans-BoldItalic.ttf",
    "fraunces-Fraunces-SOFT-WONK-opsz-wght.ttf",
    "fraunces-Fraunces-Italic-SOFT-WONK-opsz-wght.ttf",
    "specialelite-SpecialElite-Regular.ttf",
];

// The generated catalog also contains UI icon APIs. This private adapter only
// reads its embedded bytes, so the compiler can be built without GPUI enabled.
#[allow(dead_code)]
mod bundled {
    pub enum IconWeight {
        Outline,
        Filled,
    }

    struct EmbeddedAsset {
        path: &'static str,
        bytes: &'static [u8],
    }

    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/catalog.rs"));

    pub(super) fn get(path: &str) -> Option<&'static [u8]> {
        EMBEDDED_ASSETS
            .binary_search_by_key(&path.trim_start_matches('/'), |asset| asset.path)
            .ok()
            .map(|index| EMBEDDED_ASSETS[index].bytes)
    }
}

#[derive(Clone, Debug)]
pub struct TypstAsset {
    /// A virtual workspace path, such as `/images/portrait.png`, or an explicit
    /// offline package file, such as `@local/example:0.1.0/lib.typ`.
    pub path: String,
    pub bytes: Arc<[u8]>,
}

impl TypstAsset {
    pub fn new(path: impl Into<String>, bytes: impl Into<Arc<[u8]>>) -> Self {
        Self {
            path: path.into(),
            bytes: bytes.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CompileDate {
    pub year: i32,
    pub month: u8,
    pub day: u8,
}

#[derive(Clone, Debug)]
pub struct CompileRequest {
    pub generation: u64,
    /// Canonical UTF-8 source; no formatting, helper expansion, or theme injection.
    pub source: Arc<str>,
    /// Optional caller-prepared projection (for example the web's page setup).
    /// It is compiled verbatim, while identity and staleness checks use `source`.
    pub prepared_source: Option<Arc<str>>,
    pub entry_path: String,
    /// Explicit assets override bundled assets and source-root files.
    pub assets: Vec<TypstAsset>,
    /// Optional workspace directory for relative imports and images.
    pub source_root: Option<PathBuf>,
    /// Overrides `datetime.today()` for reproducible proofs. Otherwise the
    /// current date is captured once at the start of this compilation.
    pub date: Option<CompileDate>,
}

impl CompileRequest {
    pub fn new(generation: u64, source: impl Into<Arc<str>>) -> Self {
        Self {
            generation,
            source: source.into(),
            prepared_source: None,
            entry_path: "/main.typ".into(),
            assets: Vec::new(),
            source_root: None,
            date: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}

/// Zero-based line and UTF-16 column, suitable for an editor selection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TextPosition {
    pub line: usize,
    pub column_utf16: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiagnosticSource {
    Canonical,
    Prepared,
    Resource,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceRange {
    pub path: String,
    /// Prepared-source offsets must be mapped before selecting canonical text.
    pub source_kind: DiagnosticSource,
    pub bytes: Range<usize>,
    /// Absolute UTF-16 offsets into this source file.
    pub utf16: Range<usize>,
    pub start: TextPosition,
    pub end: TextPosition,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiagnosticTrace {
    pub message: String,
    pub location: Option<SourceRange>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,
    pub message: String,
    pub location: Option<SourceRange>,
    pub hints: Vec<String>,
    pub trace: Vec<DiagnosticTrace>,
}

impl Diagnostic {
    fn error(message: impl Into<String>) -> Self {
        Self {
            severity: DiagnosticSeverity::Error,
            message: message.into(),
            location: None,
            hints: Vec::new(),
            trace: Vec::new(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct ProofPage {
    pub svg: String,
    pub width_pt: f64,
    pub height_pt: f64,
}

#[derive(Clone, Debug)]
pub struct CompiledProof {
    pub generation: u64,
    pub source_fingerprint: String,
    /// The same immutable source allocation supplied by the caller.
    pub source: Arc<str>,
    /// Exact compiler input. May differ from canonical source only when the
    /// caller explicitly supplied `CompileRequest::prepared_source`.
    pub compiled_source: Arc<str>,
    pub pages: Vec<ProofPage>,
    pub pdf: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct CompileResult {
    pub generation: u64,
    pub source_fingerprint: String,
    pub diagnostics: Vec<Diagnostic>,
    /// Absent on compiler/export errors or missing glyphs, matching the web
    /// worker's refusal to export a PDF with silently lost manuscript text.
    pub proof: Option<CompiledProof>,
}

/// SHA-256 of the exact canonical UTF-8 bytes, including BOM and line endings.
pub fn source_fingerprint(source: &str) -> String {
    format!("{:x}", Sha256::digest(source.as_bytes()))
}

#[derive(Clone)]
pub struct TypstEngine {
    data: Arc<EngineData>,
}

struct EngineData {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    decoration_pngs: Mutex<HashMap<String, FileResult<Bytes>>>,
}

impl EngineData {
    fn bundled_resource(&self, path: &str) -> FileResult<Option<Bytes>> {
        let Some(bytes) = bundled_resource(path) else {
            return Ok(None);
        };
        if !path.starts_with("/twyne-decoration/") || !path.ends_with(".png") {
            return Ok(Some(Bytes::new(bytes)));
        }
        if let Some(bytes) = self
            .decoration_pngs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(path)
            .cloned()
        {
            return bytes.map(Some);
        }
        // The web's virtual paths explicitly say PNG, which takes precedence
        // over magic-byte detection in Typst. Convert original, lossless native
        // WebP bytes to real PNG once; never rename a different codec as PNG.
        let png = (|| {
            let image = image::load_from_memory(bytes)
                .map_err(|error| offline_error(format!("cannot decode bundled {path}: {error}")))?;
            let mut buffer = Cursor::new(Vec::new());
            image
                .write_to(&mut buffer, image::ImageFormat::Png)
                .map_err(|error| offline_error(format!("cannot encode bundled {path}: {error}")))?;
            Ok(Bytes::new(buffer.into_inner()))
        })();
        self.decoration_pngs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(path.to_owned(), png.clone());
        png.map(Some)
    }
}

impl fmt::Debug for TypstEngine {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TypstEngine")
            .field("version", &TYPST_ENGINE_VERSION)
            .field("font_faces", &self.data.fonts.len())
            .finish()
    }
}

impl TypstEngine {
    pub fn new() -> anyhow::Result<Self> {
        let mut fonts = Vec::new();
        for name in FONT_FILES {
            let path = format!("fonts/{name}");
            let bytes = bundled::get(&path).with_context(|| format!("missing font {path}"))?;
            let previous_count = fonts.len();
            fonts.extend(Font::iter(Bytes::new(bytes)));
            ensure!(fonts.len() > previous_count, "invalid bundled font {path}");
        }
        Ok(Self {
            data: Arc::new(EngineData {
                library: LazyHash::new(Library::default()),
                book: LazyHash::new(FontBook::from_fonts(&fonts)),
                fonts,
                decoration_pngs: Mutex::new(HashMap::new()),
            }),
        })
    }

    /// Font family names in the same face order as the web worker.
    pub fn font_families(&self) -> Vec<String> {
        self.data
            .fonts
            .iter()
            .map(|font| font.info().family.to_string())
            .collect()
    }

    /// Synchronous CPU work. Call from the application's background executor;
    /// generation and source fingerprint let the caller discard stale results.
    pub fn compile(&self, request: CompileRequest) -> CompileResult {
        let fingerprint = source_fingerprint(&request.source);
        let mut result = CompileResult {
            generation: request.generation,
            source_fingerprint: fingerprint.clone(),
            diagnostics: Vec::new(),
            proof: None,
        };
        let world = match OfflineWorld::new(self.data.clone(), &request) {
            Ok(world) => world,
            Err(error) => {
                result
                    .diagnostics
                    .push(Diagnostic::error(error.to_string()));
                return result;
            }
        };
        let compiled = typst::compile::<PagedDocument>(&world);
        result.diagnostics.extend(
            compiled
                .warnings
                .iter()
                .map(|diagnostic| map_diagnostic(&world, diagnostic)),
        );
        let document = match compiled.output {
            Ok(document) => document,
            Err(errors) => {
                result.diagnostics.extend(
                    errors
                        .iter()
                        .map(|diagnostic| map_diagnostic(&world, diagnostic)),
                );
                return result;
            }
        };
        result
            .diagnostics
            .extend(missing_glyph_diagnostics(&world, &document));
        let mut missing_glyph = false;
        for diagnostic in &mut result.diagnostics {
            if is_missing_glyph(&diagnostic.message) {
                diagnostic.severity = DiagnosticSeverity::Error;
                diagnostic
                    .hints
                    .push("Supply a font containing this character before exporting.".into());
                missing_glyph = true;
            }
        }
        if missing_glyph {
            return result;
        }
        let pdf = match typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default()) {
            Ok(pdf) => pdf,
            Err(errors) => {
                result.diagnostics.extend(
                    errors
                        .iter()
                        .map(|diagnostic| map_diagnostic(&world, diagnostic)),
                );
                return result;
            }
        };
        let pages = document
            .pages
            .iter()
            .map(|page| ProofPage {
                svg: typst_svg::svg(page),
                width_pt: page.frame.width().to_pt(),
                height_pt: page.frame.height().to_pt(),
            })
            .collect();
        result.proof = Some(CompiledProof {
            generation: request.generation,
            source_fingerprint: fingerprint,
            compiled_source: request
                .prepared_source
                .unwrap_or_else(|| request.source.clone()),
            source: request.source,
            pages,
            pdf,
        });
        result
    }
}

fn is_missing_glyph(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("missing glyph")
        || message.contains("no glyph")
        || (message.contains("does not contain") && message.contains("glyph"))
        || message.contains("no font found for")
        || (message.contains("no font")
            && message.contains("supports")
            && message.contains("character"))
}

fn missing_glyph_diagnostics(world: &OfflineWorld, document: &PagedDocument) -> Vec<Diagnostic> {
    // The engine can produce .notdef glyphs without emitting a warning. Inspect
    // the actual shaped output rather than scanning source strings or comments.
    let mut diagnostics = Vec::new();
    let mut frames: Vec<_> = document.pages.iter().map(|page| &page.frame).collect();
    while let Some(frame) = frames.pop() {
        for (_, item) in frame.items() {
            match item {
                FrameItem::Group(group) => frames.push(&group.frame),
                FrameItem::Text(text) => {
                    for glyph in &text.glyphs {
                        if glyph.id != 0 {
                            continue;
                        }
                        let characters = text.text.get(glyph.range()).unwrap_or("");
                        if characters.is_empty() || characters.chars().all(char::is_control) {
                            continue;
                        }
                        let diagnostic = map_diagnostic(
                            world,
                            &SourceDiagnostic::error(
                                glyph.span.0,
                                format!("no font supports character {characters:?} in this text"),
                            ),
                        );
                        if !diagnostics.contains(&diagnostic) {
                            diagnostics.push(diagnostic);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    diagnostics
}

struct OfflineWorld {
    data: Arc<EngineData>,
    main: FileId,
    prepared: bool,
    assets: HashMap<FileId, Bytes>,
    root: Option<PathBuf>,
    files: Mutex<HashMap<FileId, FileResult<Bytes>>>,
    sources: Mutex<HashMap<FileId, FileResult<Source>>>,
    date: Option<Datetime>,
    now: chrono::DateTime<Utc>,
}

impl OfflineWorld {
    fn new(data: Arc<EngineData>, request: &CompileRequest) -> anyhow::Result<Self> {
        let main = workspace_id(&request.entry_path)?;
        let compiler_source = request.prepared_source.as_ref().unwrap_or(&request.source);
        let mut assets: HashMap<FileId, Bytes> = HashMap::new();
        for asset in &request.assets {
            let id = asset_id(&asset.path)?;
            ensure!(
                id != main,
                "resource {} cannot replace the canonical source",
                asset.path
            );
            if let Some(previous) = assets.get(&id) {
                ensure!(
                    previous.as_slice() == asset.bytes.as_ref(),
                    "conflicting resources at {}",
                    asset.path
                );
            } else {
                assets.insert(id, Bytes::new(asset.bytes.clone()));
            }
        }
        let root = request
            .source_root
            .as_ref()
            .map(|root| {
                let root = root
                    .canonicalize()
                    .with_context(|| format!("cannot open source directory {}", root.display()))?;
                ensure!(
                    root.is_dir(),
                    "source root {} is not a directory",
                    root.display()
                );
                Ok::<_, anyhow::Error>(root)
            })
            .transpose()?;
        let date = request
            .date
            .map(|date| {
                Datetime::from_ymd(date.year, date.month, date.day)
                    .context("invalid deterministic compilation date")
            })
            .transpose()?;
        Ok(Self {
            data,
            main,
            prepared: request.prepared_source.is_some(),
            assets,
            root,
            files: Mutex::new(HashMap::from([(
                main,
                Ok(Bytes::from_string(compiler_source.clone())),
            )])),
            sources: Mutex::new(HashMap::from([(
                main,
                Ok(Source::new(main, compiler_source.to_string())),
            )])),
            date,
            now: Utc::now(),
        })
    }

    fn read_resource(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(bytes) = self.assets.get(&id) {
            return Ok(bytes.clone());
        }
        if let Some(package) = id.package() {
            return Err(offline_error(format!(
                "offline package {package} is unavailable; supply its files locally"
            )));
        }
        let path = id.vpath().as_rooted_path();
        let virtual_path = path.to_string_lossy();
        if let Some(bytes) = self.data.bundled_resource(&virtual_path)? {
            return Ok(bytes);
        }
        let Some(root) = &self.root else {
            return Err(offline_error(format!(
                "offline resource {virtual_path} was not supplied and no source directory is open"
            )));
        };
        let local = id.vpath().resolve(root).ok_or(FileError::AccessDenied)?;
        let canonical = local.canonicalize().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                offline_error(format!(
                    "offline resource {virtual_path} was not found in the source directory"
                ))
            } else {
                FileError::from_io(error, &local)
            }
        })?;
        if !canonical.starts_with(root) {
            return Err(FileError::AccessDenied);
        }
        if canonical.is_dir() {
            return Err(FileError::IsDirectory);
        }
        std::fs::read(&canonical)
            .map(Bytes::new)
            .map_err(|error| FileError::from_io(error, &canonical))
    }
}

impl World for OfflineWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.data.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.data.book
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if let Some(source) = self
            .sources
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&id)
            .cloned()
        {
            return source;
        }
        let source = self
            .file(id)
            .and_then(|bytes| Ok(Source::new(id, bytes.as_str()?.to_owned())));
        self.sources
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id, source.clone());
        source
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(bytes) = self
            .files
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&id)
            .cloned()
        {
            return bytes;
        }
        let bytes = self.read_resource(id);
        self.files
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id, bytes.clone());
        bytes
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.data.fonts.get(index).cloned()
    }

    fn today(&self, offset: Option<i64>) -> Option<Datetime> {
        if let Some(date) = self.date {
            return Some(date);
        }
        let date = if let Some(offset) = offset {
            self.now
                .checked_add_signed(TimeDelta::try_hours(offset)?)?
                .date_naive()
        } else {
            self.now.with_timezone(&Local).date_naive()
        };
        Datetime::from_ymd(date.year(), date.month() as u8, date.day() as u8)
    }
}

fn workspace_id(path: &str) -> anyhow::Result<FileId> {
    ensure!(!path.is_empty(), "empty virtual resource path");
    ensure!(
        !path.contains([':', '\\', '\0']) && !path.starts_with('@'),
        "expected a workspace resource path, got {path}"
    );
    ensure!(
        !Path::new(path)
            .components()
            .any(|part| matches!(part, Component::ParentDir)),
        "resource path {path} escapes the workspace"
    );
    let path = VirtualPath::new(path);
    ensure!(
        path.as_rootless_path().file_name().is_some(),
        "resource path is not a file"
    );
    Ok(FileId::new(None, path))
}

fn asset_id(path: &str) -> anyhow::Result<FileId> {
    let Some(package_path) = path.strip_prefix('@') else {
        return workspace_id(path);
    };
    let mut parts = package_path.splitn(3, '/');
    let namespace = parts.next().context("missing offline package namespace")?;
    let name_version = parts
        .next()
        .context("missing offline package name/version")?;
    let relative_path = parts.next().context("missing offline package file path")?;
    let package: PackageSpec = format!("@{namespace}/{name_version}")
        .parse()
        .map_err(|error| anyhow::anyhow!("invalid offline package path {path}: {error}"))?;
    let workspace = workspace_id(relative_path)?;
    Ok(FileId::new(Some(package), workspace.vpath().clone()))
}

fn offline_error(message: String) -> FileError {
    FileError::Other(Some(message.into()))
}

fn bundled_resource(path: &str) -> Option<&'static [u8]> {
    if let Some(path) = path.strip_prefix("/twyne-decoration/") {
        if let Some(initial) = path
            .strip_prefix("initial-")
            .and_then(|path| path.strip_suffix(".png"))
        {
            return bundled::get(&format!("assets/illuminated-initials/{initial}.avif"));
        }
        if let Some(frame) = path
            .strip_prefix("frame-")
            .and_then(|path| path.strip_suffix(".png"))
        {
            // Native copies of original AVIF artwork are lossless WebP. The
            // engine's resource adapter converts these virtual PNGs on demand.
            return bundled::get(&format!("assets/page-borders/slices/{frame}.avif"))
                .or_else(|| bundled::get(&format!("assets/page-borders/{frame}.avif")));
        }
    }
    bundled::get(path)
}

fn map_diagnostic(world: &OfflineWorld, diagnostic: &SourceDiagnostic) -> Diagnostic {
    Diagnostic {
        severity: match diagnostic.severity {
            Severity::Error => DiagnosticSeverity::Error,
            Severity::Warning => DiagnosticSeverity::Warning,
        },
        message: diagnostic.message.to_string(),
        location: source_range(world, diagnostic.span),
        hints: diagnostic.hints.iter().map(ToString::to_string).collect(),
        trace: diagnostic
            .trace
            .iter()
            .map(|trace| DiagnosticTrace {
                message: trace.v.to_string(),
                location: source_range(world, trace.span),
            })
            .collect(),
    }
}

fn source_range(world: &OfflineWorld, span: Span) -> Option<SourceRange> {
    let id = span.id()?;
    let source = world.source(id).ok()?;
    let bytes = world.range(span)?;
    let lines = source.lines();
    let position = |byte| {
        let line = lines.byte_to_line(byte)?;
        let line_start = lines.line_to_byte(line)?;
        Some(TextPosition {
            line,
            column_utf16: source.text().get(line_start..byte)?.encode_utf16().count(),
        })
    };
    Some(SourceRange {
        source_kind: if id != world.main {
            DiagnosticSource::Resource
        } else if world.prepared {
            DiagnosticSource::Prepared
        } else {
            DiagnosticSource::Canonical
        },
        path: if let Some(package) = id.package() {
            format!("{package}{}", id.vpath().as_rooted_path().display())
        } else {
            id.vpath().as_rooted_path().display().to_string()
        },
        utf16: lines.byte_to_utf16(bytes.start)?..lines.byte_to_utf16(bytes.end)?,
        start: position(bytes.start)?,
        end: position(bytes.end)?,
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;

    fn engine() -> &'static TypstEngine {
        static ENGINE: OnceLock<TypstEngine> = OnceLock::new();
        ENGINE.get_or_init(|| TypstEngine::new().expect("original bundled fonts must parse"))
    }

    fn proof(request: CompileRequest) -> CompiledProof {
        let result = engine().compile(request);
        assert!(
            result.proof.is_some(),
            "compiler failed: {:#?}",
            result.diagnostics
        );
        result.proof.unwrap()
    }

    #[test]
    fn original_web_font_book_is_complete() {
        let families = engine().font_families();
        assert_eq!(families.len(), FONT_FILES.len());
        for expected in [
            "Libertinus Serif",
            "Libertinus Math",
            "DejaVu Sans Mono",
            "Lora",
            "Libre Baskerville",
            "DM Sans",
            "Fraunces",
            "Special Elite",
        ] {
            assert!(
                families.iter().any(|family| family.starts_with(expected)),
                "missing {expected}: {families:?}"
            );
        }
    }

    #[test]
    fn web_generated_fixture_produces_real_pages_and_pdf() {
        let source: Arc<str> = include_str!("../fixtures/typst/web-editorial.typ").into();
        let mut request = CompileRequest::new(41, source.clone());
        request.date = Some(CompileDate {
            year: 2026,
            month: 10,
            day: 4,
        });
        let result = engine().compile(request);
        assert!(
            result
                .diagnostics
                .iter()
                .all(|diagnostic| diagnostic.severity == DiagnosticSeverity::Warning),
            "{:#?}",
            result.diagnostics
        );
        let proof = result.proof.expect("actual web fixture must compile");
        assert_eq!(proof.generation, 41);
        assert_eq!(proof.source_fingerprint, source_fingerprint(&source));
        assert!(Arc::ptr_eq(&proof.source, &source));
        assert_eq!(proof.compiled_source.as_bytes(), source.as_bytes());
        assert!(proof.pdf.starts_with(b"%PDF-"));
        assert!(proof.pdf.len() > 10_000);
        assert!(proof.pages.len() >= 2);
        assert!(proof.pages.iter().all(|page| {
            page.svg.starts_with("<svg")
                && page.svg.contains("<path")
                && page.width_pt == 612.0
                && page.height_pt == 792.0
        }));
        assert!(proof.pages[0].svg.contains("image/png"));
        if let Some(directory) = std::env::var_os("TWYNE_TYPST_PROOF_OUTPUT_DIR") {
            let directory = PathBuf::from(directory);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("engine-web-editorial.pdf"), &proof.pdf).unwrap();
            for (index, page) in proof.pages.iter().enumerate() {
                std::fs::write(
                    directory.join(format!("engine-web-editorial-{}.svg", index + 1)),
                    &page.svg,
                )
                .unwrap();
            }
        }
    }

    #[test]
    fn canonical_bytes_and_identity_survive_preparation() {
        let source: Arc<str> = "\u{feff}= Manuscript\r\n\r\nCanonical text.\r\n".into();
        let prepared: Arc<str> = "#set text(font: \"Lora\")\nPrepared text.".into();
        let mut request = CompileRequest::new(9, source.clone());
        request.prepared_source = Some(prepared.clone());
        let proof = proof(request);
        assert!(Arc::ptr_eq(&proof.source, &source));
        assert!(Arc::ptr_eq(&proof.compiled_source, &prepared));
        assert_eq!(proof.source.as_bytes(), source.as_bytes());
        assert_eq!(proof.source_fingerprint, source_fingerprint(&source));
        assert_ne!(proof.source_fingerprint, source_fingerprint(&prepared));
        let request = CompileRequest::new(10, source.clone());
        let world = OfflineWorld::new(engine().data.clone(), &request).unwrap();
        assert_eq!(
            world.source(world.main()).unwrap().text().as_bytes(),
            source.as_bytes()
        );
        assert_eq!(
            world.file(world.main()).unwrap().as_slice(),
            source.as_bytes()
        );
    }

    #[test]
    fn diagnostics_use_real_byte_utf16_and_line_ranges() {
        let source = "#let prefix = \"😀\"; #unknown_function()\r\n";
        let result = engine().compile(CompileRequest::new(7, source));
        assert!(result.proof.is_none());
        assert_eq!(result.generation, 7);
        assert_eq!(result.source_fingerprint, source_fingerprint(source));
        let diagnostic = result
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.message.contains("unknown variable"))
            .expect("actual Typst unknown-variable diagnostic");
        let range = diagnostic.location.as_ref().unwrap();
        assert_eq!(range.source_kind, DiagnosticSource::Canonical);
        assert_eq!(range.path, "/main.typ");
        assert_eq!(&source[range.bytes.clone()], "unknown_function");
        assert_eq!(
            range.utf16.start,
            source[..range.bytes.start].encode_utf16().count()
        );
        assert_eq!(
            range.utf16.end,
            source[..range.bytes.end].encode_utf16().count()
        );
        assert_eq!(range.start.line, 0);
        assert_eq!(range.start.column_utf16, range.utf16.start);
        assert_ne!(range.utf16.start, range.bytes.start);
    }

    #[test]
    fn prepared_diagnostics_are_not_canonical_offsets() {
        let mut request = CompileRequest::new(11, "Canonical manuscript.");
        request.prepared_source = Some("#unknown_function()".into());
        let result = engine().compile(request);
        assert!(result.proof.is_none());
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic
                .location
                .as_ref()
                .is_some_and(|range| range.source_kind == DiagnosticSource::Prepared)
        }));
    }

    #[test]
    fn imported_file_diagnostics_preserve_resource_range_and_main_trace() {
        let imported = "#let prefix = \"😀\"\n#unknown_function()";
        let mut request = CompileRequest::new(23, "#include \"chapter.typ\"");
        request.assets.push(TypstAsset::new(
            "/chapter.typ",
            imported.as_bytes().to_vec(),
        ));
        let result = engine().compile(request);
        assert!(result.proof.is_none());
        let diagnostic = result
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.message.contains("unknown variable"))
            .unwrap();
        let range = diagnostic.location.as_ref().unwrap();
        assert_eq!(range.source_kind, DiagnosticSource::Resource);
        assert_eq!(range.path, "/chapter.typ");
        assert_eq!(&imported[range.bytes.clone()], "unknown_function");
        assert_eq!(range.start.line, 1);
        assert_eq!(range.start.column_utf16, 1);
        assert!(diagnostic.trace.iter().any(|trace| {
            trace.location.as_ref().is_some_and(|range| {
                range.path == "/main.typ" && range.source_kind == DiagnosticSource::Canonical
            })
        }));
    }

    #[test]
    fn supplied_workspace_imports_and_images_compile_offline() {
        let mut request = CompileRequest::new(
            12,
            "#include \"chapter.typ\"\n#image(\"portrait.svg\", width: 20pt)",
        );
        request.entry_path = "/drafts/main.typ".into();
        request.assets = vec![
            TypstAsset::new("/drafts/chapter.typ", &b"Original imported chapter."[..]),
            TypstAsset::new(
                "/drafts/portrait.svg",
                &b"<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10' fill='#b13b2e'/></svg>"[..],
            ),
        ];
        assert_eq!(proof(request).pages.len(), 1);
    }

    #[test]
    fn correctly_named_lossless_webp_artwork_is_decoded() {
        let mut request = CompileRequest::new(22, "#image(\"original.webp\", width: 48pt)");
        request.assets.push(TypstAsset::new(
            "/original.webp",
            bundled::get("assets/illuminated-initials/a.avif").unwrap(),
        ));
        let proof = proof(request);
        assert_eq!(proof.pages.len(), 1);
        assert!(proof.pdf.starts_with(b"%PDF-"));
    }

    #[test]
    fn source_directory_imports_refresh_between_compilations() {
        let directory = tempfile::tempdir().unwrap();
        let chapter = directory.path().join("chapter.typ");
        std::fs::write(&chapter, "First imported chapter.").unwrap();
        let mut request = CompileRequest::new(13, "#include \"chapter.typ\"");
        request.source_root = Some(directory.path().to_path_buf());
        let first = proof(request.clone());
        std::fs::write(&chapter, "Second revised imported chapter.").unwrap();
        request.generation = 14;
        let second = proof(request);
        assert_ne!(first.pages[0].svg, second.pages[0].svg);
        assert_eq!(first.source_fingerprint, second.source_fingerprint);
        assert_ne!(first.generation, second.generation);
    }

    #[test]
    fn missing_resources_and_packages_report_offline_errors() {
        for (source, expected) in [
            ("#image(\"missing.png\")", "offline resource /missing.png"),
            (
                "#import \"@preview/missing:0.1.0\": *",
                "offline package @preview/missing:0.1.0",
            ),
        ] {
            let result = engine().compile(CompileRequest::new(15, source));
            assert!(result.proof.is_none());
            assert!(
                result.diagnostics.iter().any(|diagnostic| {
                    diagnostic.severity == DiagnosticSeverity::Error
                        && diagnostic.message.contains(expected)
                }),
                "{:#?}",
                result.diagnostics
            );
        }
    }

    #[test]
    fn explicitly_supplied_package_compiles_without_network() {
        let mut request =
            CompileRequest::new(16, "#import \"@local/example:0.1.0\": greeting\n#greeting");
        request.assets = vec![
            TypstAsset::new(
                "@local/example:0.1.0/typst.toml",
                &b"[package]\nname = \"example\"\nversion = \"0.1.0\"\nentrypoint = \"lib.typ\"\n"
                    [..],
            ),
            TypstAsset::new(
                "@local/example:0.1.0/lib.typ",
                &b"#let greeting = [A fully supplied offline package.]"[..],
            ),
        ];
        assert_eq!(proof(request).pages.len(), 1);
    }

    #[test]
    fn canonical_source_cannot_be_shadowed_by_assets() {
        let mut request = CompileRequest::new(17, "Canonical text.");
        request
            .assets
            .push(TypstAsset::new("/main.typ", &b"different"[..]));
        let result = engine().compile(request);
        assert!(result.proof.is_none());
        assert!(
            result.diagnostics[0]
                .message
                .contains("cannot replace the canonical source")
        );
    }

    #[test]
    fn unsupported_rendered_glyph_prevents_lossy_pdf() {
        let result = engine().compile(CompileRequest::new(
            18,
            "Visible unsupported text: \u{10ffff}",
        ));
        assert!(result.proof.is_none());
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.severity == DiagnosticSeverity::Error
                && is_missing_glyph(&diagnostic.message)
        }));
        // Unsupported characters in comments are not rendered and do not make
        // a valid manuscript fail a whole-source character coverage scan.
        assert!(
            engine()
                .compile(CompileRequest::new(19, "// \u{10ffff}\nVisible prose."))
                .proof
                .is_some()
        );
    }

    #[test]
    fn deterministic_date_is_validated_and_used() {
        let mut request = CompileRequest::new(20, "#datetime.today().display()");
        request.date = Some(CompileDate {
            year: 2026,
            month: 2,
            day: 30,
        });
        let invalid = engine().compile(request.clone());
        assert!(invalid.proof.is_none());
        assert!(
            invalid.diagnostics[0]
                .message
                .contains("invalid deterministic")
        );
        request.date = Some(CompileDate {
            year: 2026,
            month: 10,
            day: 4,
        });
        let first = proof(request.clone());
        let second = proof(request);
        assert_eq!(first.pages[0].svg, second.pages[0].svg);
        assert_eq!(first.pdf, second.pdf);
    }

    #[cfg(unix)]
    #[test]
    fn source_root_does_not_follow_symlinks_outside_workspace() {
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("outside.typ");
        std::fs::write(&secret, "Outside this source directory.").unwrap();
        std::os::unix::fs::symlink(secret, directory.path().join("linked.typ")).unwrap();
        let mut request = CompileRequest::new(21, "#include \"linked.typ\"");
        request.source_root = Some(directory.path().to_path_buf());
        let result = engine().compile(request);
        assert!(result.proof.is_none());
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.message.contains("access denied"))
        );
    }
}
