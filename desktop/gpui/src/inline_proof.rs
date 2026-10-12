//! Source-preserving, bounded rendering for native editor atoms.
//!
//! Run `render` on a background executor. LaTeX reuses the web's MathJax proof
//! SVG, not its KaTeX HTML Write renderer: KaTeX geometry parity remains open.
//! Generic RawTypst atoms should remain source-visible, as they do on the web.
//! Mermaid requires an explicitly supplied local renderer; a machine's Chrome
//! installation is never treated as an application dependency automatically.

use std::{
    collections::{HashMap, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use gpui_kit::{Image, ImageFormat};

use crate::{
    native_typst::{CompileRequest, TypstEngine, source_fingerprint},
    semantic_bridge::SemanticBridge,
};

const MAX_SOURCE_BYTES: usize = 64 * 1024;
const MAX_SVG_BYTES: usize = 8 * 1024 * 1024;
const MAX_CACHE_ENTRIES: usize = 128;
const MAX_CACHE_BYTES: usize = 32 * 1024 * 1024;
const MAX_CONCURRENT_RENDERS: usize = 2;
const MAX_DIMENSION_PX: f32 = 4096.0;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum AtomKind {
    LatexMath {
        block: bool,
    },
    /// Explicit standalone native Typst. This is not permission to evaluate
    /// every source-visible RawTypst node in the document automatically.
    Typst {
        block: bool,
    },
    Mermaid,
}

#[derive(Clone, Debug)]
pub struct AtomRenderRequest {
    pub kind: AtomKind,
    pub source: Arc<str>,
    pub font_size_px: f32,
    /// RGB, matching the native theme's ink token.
    pub color: u32,
    pub width_px: f32,
    pub generation: u64,
}

impl AtomRenderRequest {
    pub fn key(&self) -> Result<AtomRenderKey, AtomRenderError> {
        if self.source.len() > MAX_SOURCE_BYTES {
            return Err(AtomRenderError::new(
                AtomErrorKind::TooLarge,
                "Atom source exceeds 64 KiB.",
            ));
        }
        if !self.font_size_px.is_finite()
            || !(4.0..=192.0).contains(&self.font_size_px)
            || !self.width_px.is_finite()
            || !(1.0..=MAX_DIMENSION_PX).contains(&self.width_px)
            || self.color > 0xffffff
        {
            return Err(AtomRenderError::new(
                AtomErrorKind::InvalidStyle,
                "Invalid atom font size, ink color, or available width.",
            ));
        }
        Ok(AtomRenderKey {
            kind: self.kind,
            source_fingerprint: source_fingerprint(&self.source),
            font_size_bits: self.font_size_px.to_bits(),
            width_bits: self.width_px.to_bits(),
            color: self.color,
        })
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct AtomRenderKey {
    pub kind: AtomKind,
    pub source_fingerprint: String,
    font_size_bits: u32,
    width_bits: u32,
    pub color: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AtomFidelity {
    NativeTypst,
    /// Exact web proof renderer; KaTeX Write font/layout parity is unverified.
    WebMathJaxProof,
    /// Only an actual, explicitly supplied Mermaid backend can produce this.
    MermaidBackend,
}

#[derive(Clone)]
pub struct AtomRenderImage {
    pub image: Arc<Image>,
    pub svg: Arc<str>,
    pub width_px: f32,
    pub height_px: f32,
    /// Distance from the image's top edge to its text baseline.
    pub baseline_px: f32,
    /// True when supplied by the SVG renderer's vertical-align metric. This
    /// describes that SVG's geometry, not equivalence to the KaTeX Write view.
    /// Native paged Typst currently supplies no inline baseline metric.
    pub baseline_is_exact: bool,
    pub fidelity: AtomFidelity,
}

impl std::fmt::Debug for AtomRenderImage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AtomRenderImage")
            .field("width_px", &self.width_px)
            .field("height_px", &self.height_px)
            .field("baseline_px", &self.baseline_px)
            .field("baseline_is_exact", &self.baseline_is_exact)
            .field("fidelity", &self.fidelity)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AtomErrorKind {
    InvalidSource,
    InvalidStyle,
    InvalidSvg,
    TooLarge,
    Busy,
    RendererUnavailable,
    Compiler,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AtomRenderError {
    pub kind: AtomErrorKind,
    pub message: String,
}

impl AtomRenderError {
    pub fn new(kind: AtomErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(
            self.kind,
            AtomErrorKind::Busy | AtomErrorKind::RendererUnavailable
        )
    }
}

#[derive(Clone, Debug)]
pub struct AtomRenderResult {
    pub source: Arc<str>,
    pub generation: u64,
    pub key: Option<AtomRenderKey>,
    pub result: Result<AtomRenderImage, AtomRenderError>,
}

impl AtomRenderResult {
    pub fn matches(&self, request: &AtomRenderRequest) -> bool {
        self.generation == request.generation
            && self.source.as_ref() == request.source.as_ref()
            && self
                .key
                .as_ref()
                .is_some_and(|key| request.key().as_ref().is_ok_and(|current| current == key))
    }
}

/// Injectable actual renderer, useful for a packaged local Mermaid backend.
/// The returned SVG must be self-contained, with real viewBox geometry and
/// path/text labels, not browser-only foreignObject labels or remote resources.
pub trait InlineSvgBackend: Send + Sync {
    fn render(&self, kind: AtomKind, source: &str) -> Result<String, AtomRenderError>;
}

struct DocumentHelperBackend(Option<SemanticBridge>);

impl InlineSvgBackend for DocumentHelperBackend {
    fn render(&self, kind: AtomKind, source: &str) -> Result<String, AtomRenderError> {
        let Some(bridge) = &self.0 else {
            return Err(AtomRenderError::new(
                AtomErrorKind::RendererUnavailable,
                "The local atom renderer is unavailable. The authored source is preserved.",
            ));
        };
        let (kind_name, block) = match kind {
            AtomKind::LatexMath { block } => ("latex", block),
            AtomKind::Mermaid => ("mermaid", true),
            AtomKind::Typst { .. } => {
                return Err(AtomRenderError::new(
                    AtomErrorKind::Compiler,
                    "Typst belongs to the native compiler.",
                ));
            }
        };
        bridge
            .render_inline(kind_name, source, block)
            .map(|result| result.svg)
            .map_err(|error| {
                AtomRenderError::new(
                    if kind == AtomKind::Mermaid {
                        AtomErrorKind::RendererUnavailable
                    } else {
                        AtomErrorKind::InvalidSource
                    },
                    format!("{error:#}"),
                )
            })
    }
}

#[derive(Clone)]
pub struct InlineProofRenderer {
    state: Arc<RendererState>,
}

struct RendererState {
    engine: TypstEngine,
    backend: Arc<dyn InlineSvgBackend>,
    active: AtomicUsize,
    cache: Mutex<RenderCache>,
}

#[derive(Default)]
struct RenderCache {
    entries: HashMap<AtomRenderKey, (Result<AtomRenderImage, AtomRenderError>, usize)>,
    order: VecDeque<AtomRenderKey>,
    bytes: usize,
}

impl InlineProofRenderer {
    pub fn new(engine: TypstEngine, bridge: Option<SemanticBridge>) -> Self {
        Self::with_backend(engine, Arc::new(DocumentHelperBackend(bridge)))
    }

    pub fn with_backend(engine: TypstEngine, backend: Arc<dyn InlineSvgBackend>) -> Self {
        Self {
            state: Arc::new(RendererState {
                engine,
                backend,
                active: AtomicUsize::new(0),
                cache: Mutex::new(RenderCache::default()),
            }),
        }
    }

    /// A convenience for background initialization. Missing helpers are not
    /// fatal to native Typst rendering; affected atoms retain an explicit error.
    pub fn discover() -> anyhow::Result<Self> {
        Ok(Self::new(
            TypstEngine::new()?,
            SemanticBridge::discover().ok(),
        ))
    }

    pub fn cached(&self, request: &AtomRenderRequest) -> Option<AtomRenderResult> {
        self.cached_key(
            &request.key().ok()?,
            request.generation,
            request.source.clone(),
        )
    }

    /// Retain the key with the editor node to avoid hashing on every frame.
    pub fn cached_key(
        &self,
        key: &AtomRenderKey,
        generation: u64,
        source: Arc<str>,
    ) -> Option<AtomRenderResult> {
        let mut cache = self
            .state
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let result = cache.entries.get(key)?.0.clone();
        if let Some(index) = cache.order.iter().position(|candidate| candidate == key) {
            cache.order.remove(index);
        }
        cache.order.push_back(key.clone());
        Some(AtomRenderResult {
            source,
            generation,
            key: Some(key.clone()),
            result,
        })
    }

    pub fn clear_cache(&self) {
        *self
            .state
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = RenderCache::default();
    }

    /// Synchronous work for a background executor, with two concurrent jobs at
    /// most. Busy is retryable; no unbounded internal queue accumulates work.
    pub fn render(&self, request: AtomRenderRequest) -> AtomRenderResult {
        let key = match request.key() {
            Ok(key) => key,
            Err(error) => {
                return AtomRenderResult {
                    source: request.source,
                    generation: request.generation,
                    key: None,
                    result: Err(error),
                };
            }
        };
        if let Some(cached) = self.cached_key(&key, request.generation, request.source.clone()) {
            return cached;
        }
        #[allow(
            deprecated,
            reason = "Atomic::try_update requires Rust 1.95; this crate supports Rust 1.92"
        )]
        let admission =
            self.state
                .active
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                    (active < MAX_CONCURRENT_RENDERS).then_some(active + 1)
                });
        if admission.is_err() {
            return AtomRenderResult {
                source: request.source,
                generation: request.generation,
                key: Some(key),
                result: Err(AtomRenderError::new(
                    AtomErrorKind::Busy,
                    "Two atom renders are already running. Retry at the next idle boundary.",
                )),
            };
        }
        let _permit = RenderPermit(&self.state.active);
        let result = self.render_uncached(&request);
        if result.is_ok() || result.as_ref().is_err_and(|error| !error.retryable()) {
            self.store(key.clone(), result.clone());
        }
        AtomRenderResult {
            source: request.source,
            generation: request.generation,
            key: Some(key),
            result,
        }
    }

    fn store(&self, key: AtomRenderKey, result: Result<AtomRenderImage, AtomRenderError>) {
        let bytes = match &result {
            Ok(image) => {
                image.svg.len() * 2
                    + (image.width_px.ceil() as usize * image.height_px.ceil() as usize * 4)
            }
            Err(error) => error.message.len(),
        };
        if bytes > MAX_CACHE_BYTES {
            return;
        }
        let mut cache = self
            .state
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some((_, previous_bytes)) = cache.entries.remove(&key) {
            cache.bytes -= previous_bytes;
        }
        cache.order.retain(|candidate| candidate != &key);
        while cache.entries.len() >= MAX_CACHE_ENTRIES || cache.bytes + bytes > MAX_CACHE_BYTES {
            let Some(oldest) = cache.order.pop_front() else {
                break;
            };
            if let Some((_, previous_bytes)) = cache.entries.remove(&oldest) {
                cache.bytes -= previous_bytes;
            }
        }
        cache.bytes += bytes;
        cache.order.push_back(key.clone());
        cache.entries.insert(key, (result, bytes));
    }

    fn render_uncached(
        &self,
        request: &AtomRenderRequest,
    ) -> Result<AtomRenderImage, AtomRenderError> {
        if request.source.trim().is_empty() {
            return Err(AtomRenderError::new(
                AtomErrorKind::InvalidSource,
                "Enter source to render this atom.",
            ));
        }
        let (svg, fidelity) = match request.kind {
            AtomKind::Typst { block } => {
                let width = if block {
                    format!("{}pt", request.width_px * 0.75)
                } else {
                    "auto".into()
                };
                let prepared = format!(
                    "#set page(width: {width}, height: auto, margin: 0pt, fill: none)\n#set text(font: (\"Lora\", \"Libertinus Serif\"), size: {}pt, fill: rgb(\"#{:06x}\"))\n#set par(leading: 0pt)\n#show math.equation: set text(font: \"Libertinus Math\")\n{}",
                    request.font_size_px * 0.75,
                    request.color,
                    request.source,
                );
                let mut compile_request =
                    CompileRequest::new(request.generation, request.source.clone());
                compile_request.prepared_source = Some(prepared.into());
                let compiled = self.state.engine.compile(compile_request);
                let Some(proof) = compiled.proof else {
                    return Err(AtomRenderError::new(
                        AtomErrorKind::Compiler,
                        compiled
                            .diagnostics
                            .iter()
                            .map(|diagnostic| diagnostic.message.as_str())
                            .collect::<Vec<_>>()
                            .join("\n"),
                    ));
                };
                if proof.pages.len() != 1 {
                    return Err(AtomRenderError::new(
                        AtomErrorKind::TooLarge,
                        "A standalone atom must fit on one proof page.",
                    ));
                }
                (
                    proof.pages.into_iter().next().unwrap().svg,
                    AtomFidelity::NativeTypst,
                )
            }
            AtomKind::LatexMath { .. } => (
                self.state.backend.render(request.kind, &request.source)?,
                AtomFidelity::WebMathJaxProof,
            ),
            AtomKind::Mermaid => (
                self.state.backend.render(request.kind, &request.source)?,
                AtomFidelity::MermaidBackend,
            ),
        };
        image_from_svg(svg, request, fidelity)
    }
}

struct RenderPermit<'a>(&'a AtomicUsize);

impl Drop for RenderPermit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Release);
    }
}

fn image_from_svg(
    mut svg: String,
    request: &AtomRenderRequest,
    fidelity: AtomFidelity,
) -> Result<AtomRenderImage, AtomRenderError> {
    if svg.len() > MAX_SVG_BYTES {
        return Err(AtomRenderError::new(
            AtomErrorKind::TooLarge,
            "Rendered atom exceeds 8 MiB.",
        ));
    }
    let document = roxmltree::Document::parse(&svg).map_err(|error| {
        AtomRenderError::new(
            AtomErrorKind::InvalidSvg,
            format!("Invalid renderer SVG: {error}"),
        )
    })?;
    let root = document.root_element();
    if root.tag_name().name() != "svg"
        || root.tag_name().namespace() != Some("http://www.w3.org/2000/svg")
    {
        return Err(AtomRenderError::new(
            AtomErrorKind::InvalidSvg,
            "The renderer returned no standalone SVG.",
        ));
    }
    if document.descendants().any(|node| {
        node.is_element() && matches!(node.tag_name().name(), "foreignObject" | "script")
    }) {
        return Err(AtomRenderError::new(
            AtomErrorKind::InvalidSvg,
            "This SVG contains browser-only content. A native-compatible local renderer is required.",
        ));
    }
    if document
        .descendants()
        .flat_map(|node| node.attributes())
        .any(|attribute| {
            matches!(attribute.name(), "href" | "src")
                && !attribute.value().starts_with(['#'])
                && !attribute.value().starts_with("data:")
        })
    {
        return Err(AtomRenderError::new(
            AtomErrorKind::InvalidSvg,
            "Rendered atoms must contain their image resources locally.",
        ));
    }
    let viewbox: Vec<f32> = root
        .attribute("viewBox")
        .unwrap_or("")
        .split(|character: char| character.is_ascii_whitespace() || character == ',')
        .filter(|part| !part.is_empty())
        .map(str::parse)
        .collect::<Result<_, _>>()
        .map_err(|_| AtomRenderError::new(AtomErrorKind::InvalidSvg, "Invalid SVG viewBox."))?;
    if viewbox.len() != 4
        || viewbox.iter().any(|value| !value.is_finite())
        || viewbox[2] <= 0.0
        || viewbox[3] <= 0.0
    {
        return Err(AtomRenderError::new(
            AtomErrorKind::InvalidSvg,
            "SVG has no usable positive viewBox geometry.",
        ));
    }
    let fallback_width = viewbox[2];
    let fallback_height = viewbox[3];
    let mut width =
        svg_length(root.attribute("width"), request.font_size_px).unwrap_or(fallback_width);
    let mut height =
        svg_length(root.attribute("height"), request.font_size_px).unwrap_or(fallback_height);
    let style = root.attribute("style").unwrap_or("");
    let vertical_align = style.split(';').find_map(|property| {
        let (name, value) = property.split_once(':')?;
        (name.trim() == "vertical-align")
            .then(|| svg_length(Some(value.trim()), request.font_size_px))
            .flatten()
    });
    let baseline_exact = vertical_align.is_some();
    let mut baseline = (height + vertical_align.unwrap_or(0.0)).clamp(0.0, height);
    if matches!(request.kind, AtomKind::Mermaid) && width > request.width_px {
        let scale = request.width_px / width;
        width *= scale;
        height *= scale;
        baseline *= scale;
    }
    if !width.is_finite()
        || !height.is_finite()
        || width <= 0.0
        || height <= 0.0
        || width > MAX_DIMENSION_PX
        || height > MAX_DIMENSION_PX
    {
        return Err(AtomRenderError::new(
            AtomErrorKind::TooLarge,
            "Rendered atom exceeds the supported image dimensions.",
        ));
    }
    let mut replacements: Vec<_> = root
        .attributes()
        .filter(|attribute| matches!(attribute.name(), "width" | "height"))
        .map(|attribute| {
            (
                attribute.range_value(),
                format!(
                    "{}px",
                    if attribute.name() == "width" {
                        width
                    } else {
                        height
                    }
                ),
            )
        })
        .collect();
    if fidelity == AtomFidelity::WebMathJaxProof {
        // Adapt inherited ink only. Explicit colors deeper in the authored
        // equation remain untouched, including deliberately black text.
        for group in root
            .children()
            .filter(|node| node.is_element() && node.tag_name().name() == "g")
        {
            replacements.extend(
                group
                    .attributes()
                    .filter(|attribute| {
                        matches!(attribute.name(), "fill" | "stroke")
                            && attribute.value() == "#181818"
                    })
                    .map(|attribute| (attribute.range_value(), format!("#{:06x}", request.color))),
            );
        }
    }
    let root_start = root.range().start;
    let insertion = root_start
        + svg[root_start..]
            .char_indices()
            .find(|(index, character)| {
                *index > 0 && (character.is_ascii_whitespace() || matches!(character, '>' | '/'))
            })
            .map(|(index, _)| index)
            .ok_or_else(|| {
                AtomRenderError::new(AtomErrorKind::InvalidSvg, "Missing SVG opening tag.")
            })?;
    let add_width = root.attribute("width").is_none();
    let add_height = root.attribute("height").is_none();
    drop(document);
    replacements.sort_by_key(|(range, _)| std::cmp::Reverse(range.start));
    for (range, value) in replacements {
        svg.replace_range(range, &value);
    }
    let mut additional = String::new();
    if add_width {
        additional.push_str(&format!(" width=\"{width}px\""));
    }
    if add_height {
        additional.push_str(&format!(" height=\"{height}px\""));
    }
    svg.insert_str(insertion, &additional);
    Ok(AtomRenderImage {
        image: Arc::new(Image::from_bytes(ImageFormat::Svg, svg.as_bytes().to_vec())),
        svg: svg.into(),
        width_px: width,
        height_px: height,
        baseline_px: baseline,
        baseline_is_exact: baseline_exact,
        fidelity,
    })
}

fn svg_length(value: Option<&str>, font_size: f32) -> Option<f32> {
    let value = value?.trim();
    let (number, scale) = if let Some(number) = value.strip_suffix("ex") {
        (number, font_size * 0.5)
    } else if let Some(number) = value.strip_suffix("em") {
        (number, font_size)
    } else if let Some(number) = value.strip_suffix("pt") {
        (number, 4.0 / 3.0)
    } else if let Some(number) = value.strip_suffix("px") {
        (number, 1.0)
    } else {
        (value, 1.0)
    };
    Some(number.parse::<f32>().ok()? * scale)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{Condvar, OnceLock, mpsc},
        thread,
        time::Duration,
    };

    fn engine() -> TypstEngine {
        static ENGINE: OnceLock<TypstEngine> = OnceLock::new();
        ENGINE.get_or_init(|| TypstEngine::new().unwrap()).clone()
    }

    fn request(source: &str) -> AtomRenderRequest {
        AtomRenderRequest {
            kind: AtomKind::LatexMath { block: false },
            source: source.into(),
            font_size_px: 18.0,
            color: 0x1f1b16,
            width_px: 640.0,
            generation: 1,
        }
    }

    const SIMPLE_SVG: &str = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 10' width='20px' height='10px'><path d='M0 0L20 10'/></svg>";

    struct CountingBackend {
        calls: AtomicUsize,
        fail: bool,
    }

    impl InlineSvgBackend for CountingBackend {
        fn render(&self, _: AtomKind, _: &str) -> Result<String, AtomRenderError> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            if self.fail {
                Err(AtomRenderError::new(
                    AtomErrorKind::InvalidSource,
                    "Fixture syntax error.",
                ))
            } else {
                Ok(SIMPLE_SVG.into())
            }
        }
    }

    #[test]
    fn actual_latex_helper_has_real_mathjax_geometry_and_preserves_source() {
        let renderer =
            InlineProofRenderer::new(engine(), Some(SemanticBridge::discover().unwrap()));
        let request = request("\\frac{a}{b}");
        let source = request.source.clone();
        let output = renderer.render(request.clone());
        assert!(output.matches(&request));
        assert!(Arc::ptr_eq(&source, &output.source));
        let image = output.result.unwrap();
        assert_eq!(image.fidelity, AtomFidelity::WebMathJaxProof);
        assert!(image.svg.contains("data-mml-node=\"mfrac\""));
        assert!(image.svg.contains("<path"));
        // Recorded from the real installed MathJax 3.2.2 SVG for this fixture.
        assert!((image.width_px - 16.578).abs() < 0.002);
        assert!((image.height_px - 21.555).abs() < 0.002);
        assert!((image.baseline_px - 14.373).abs() < 0.002);
        assert!(image.baseline_is_exact);
        let parsed = roxmltree::Document::parse(&image.svg).unwrap();
        assert_eq!(parsed.root_element().attribute("width"), Some("16.578px"));
    }

    #[test]
    fn malformed_latex_is_an_error_atom_with_unchanged_source() {
        let renderer =
            InlineProofRenderer::new(engine(), Some(SemanticBridge::discover().unwrap()));
        let request = request(" \\frac{a}{\r\n");
        let source = request.source.clone();
        let output = renderer.render(request.clone());
        assert!(output.matches(&request));
        assert!(Arc::ptr_eq(&source, &output.source));
        assert_eq!(output.source.as_bytes(), source.as_bytes());
        assert_eq!(
            output.result.unwrap_err().kind,
            AtomErrorKind::InvalidSource
        );
    }

    #[test]
    fn native_typst_equation_produces_sized_real_svg() {
        let renderer = InlineProofRenderer::new(engine(), None);
        let mut request = request("$ sum_(k=1)^n k = (n(n+1))/2 $");
        request.kind = AtomKind::Typst { block: true };
        let source = request.source.clone();
        let output = renderer.render(request);
        assert!(Arc::ptr_eq(&source, &output.source));
        let image = output.result.unwrap();
        assert_eq!(image.fidelity, AtomFidelity::NativeTypst);
        assert!((image.width_px - 640.0).abs() < 0.01);
        assert!(image.height_px > 18.0);
        assert!(image.svg.contains("<path"));
        assert!(!image.baseline_is_exact);
    }

    #[test]
    fn generation_and_style_guards_reject_stale_images() {
        let backend = Arc::new(CountingBackend {
            calls: AtomicUsize::new(0),
            fail: false,
        });
        let renderer = InlineProofRenderer::with_backend(engine(), backend);
        let mut request = request("x^2");
        let output = renderer.render(request.clone());
        assert!(output.matches(&request));
        request.generation += 1;
        assert!(!output.matches(&request));
        request.generation -= 1;
        request.color = 0xf8f2e5;
        assert!(!output.matches(&request));
        request.color = 0x1f1b16;
        request.source = "x^3".into();
        assert!(!output.matches(&request));
    }

    #[test]
    fn cached_images_are_shared_but_use_current_source_allocation_and_generation() {
        let backend = Arc::new(CountingBackend {
            calls: AtomicUsize::new(0),
            fail: false,
        });
        let renderer = InlineProofRenderer::with_backend(engine(), backend.clone());
        let first = renderer.render(request("x^2"));
        let mut second_request = request("x^2");
        second_request.generation = 42;
        let current_source = second_request.source.clone();
        let second = renderer.render(second_request.clone());
        assert_eq!(backend.calls.load(Ordering::Relaxed), 1);
        assert!(Arc::ptr_eq(
            &first.result.unwrap().image,
            &second.result.as_ref().unwrap().image
        ));
        assert!(Arc::ptr_eq(&current_source, &second.source));
        assert!(second.matches(&second_request));
    }

    #[test]
    fn invalid_source_errors_are_cached_and_can_be_cleared() {
        let backend = Arc::new(CountingBackend {
            calls: AtomicUsize::new(0),
            fail: true,
        });
        let renderer = InlineProofRenderer::with_backend(engine(), backend.clone());
        assert!(renderer.render(request("invalid")).result.is_err());
        assert!(renderer.render(request("invalid")).result.is_err());
        assert_eq!(backend.calls.load(Ordering::Relaxed), 1);
        renderer.clear_cache();
        assert!(renderer.render(request("invalid")).result.is_err());
        assert_eq!(backend.calls.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn invalid_style_and_large_sources_never_reach_a_renderer() {
        let backend = Arc::new(CountingBackend {
            calls: AtomicUsize::new(0),
            fail: false,
        });
        let renderer = InlineProofRenderer::with_backend(engine(), backend.clone());
        let mut invalid = request("x");
        invalid.width_px = f32::NAN;
        assert_eq!(
            renderer.render(invalid).result.unwrap_err().kind,
            AtomErrorKind::InvalidStyle
        );
        let oversized = request(&"x".repeat(MAX_SOURCE_BYTES + 1));
        assert_eq!(
            renderer.render(oversized).result.unwrap_err().kind,
            AtomErrorKind::TooLarge
        );
        assert_eq!(backend.calls.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn two_background_jobs_bound_work_and_busy_is_retryable() {
        struct BlockingBackend {
            started: mpsc::Sender<()>,
            release: Arc<(Mutex<bool>, Condvar)>,
        }
        impl InlineSvgBackend for BlockingBackend {
            fn render(&self, _: AtomKind, _: &str) -> Result<String, AtomRenderError> {
                self.started.send(()).unwrap();
                let (mutex, condition) = &*self.release;
                let mut released = mutex.lock().unwrap();
                while !*released {
                    released = condition.wait(released).unwrap();
                }
                Ok(SIMPLE_SVG.into())
            }
        }
        let (started, receiver) = mpsc::channel();
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let renderer = InlineProofRenderer::with_backend(
            engine(),
            Arc::new(BlockingBackend {
                started,
                release: release.clone(),
            }),
        );
        let jobs: Vec<_> = ["first", "second"]
            .into_iter()
            .map(|source| {
                let renderer = renderer.clone();
                thread::spawn(move || renderer.render(request(source)))
            })
            .collect();
        receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        let error = renderer.render(request("third")).result.unwrap_err();
        assert_eq!(error.kind, AtomErrorKind::Busy);
        assert!(error.retryable());
        *release.0.lock().unwrap() = true;
        release.1.notify_all();
        for job in jobs {
            assert!(job.join().unwrap().result.is_ok());
        }
        assert!(renderer.render(request("third")).result.is_ok());
    }

    #[test]
    fn cache_evicts_old_atoms_and_stays_within_limits() {
        let backend = Arc::new(CountingBackend {
            calls: AtomicUsize::new(0),
            fail: false,
        });
        let renderer = InlineProofRenderer::with_backend(engine(), backend);
        for index in 0..MAX_CACHE_ENTRIES + 8 {
            assert!(
                renderer
                    .render(request(&format!("x_{index}")))
                    .result
                    .is_ok()
            );
        }
        assert!(renderer.cached(&request("x_0")).is_none());
        assert!(
            renderer
                .cached(&request(&format!("x_{}", MAX_CACHE_ENTRIES + 7)))
                .is_some()
        );
        let cache = renderer.state.cache.lock().unwrap();
        assert_eq!(cache.entries.len(), MAX_CACHE_ENTRIES);
        assert!(cache.bytes <= MAX_CACHE_BYTES);
    }

    #[test]
    fn mermaid_unavailability_never_substitutes_a_fake_diagram() {
        let renderer =
            InlineProofRenderer::new(engine(), Some(SemanticBridge::discover().unwrap()));
        let mut request = request("flowchart LR\n  Draft --> Proof");
        request.kind = AtomKind::Mermaid;
        let source = request.source.clone();
        let result = renderer.render(request);
        assert!(Arc::ptr_eq(&source, &result.source));
        assert_eq!(
            result.result.unwrap_err().kind,
            AtomErrorKind::RendererUnavailable
        );
    }

    #[test]
    fn browser_only_svg_and_remote_image_resources_are_rejected() {
        for svg in [
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><foreignObject/></svg>",
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><image href='https://example.test/image.png'/></svg>",
        ] {
            assert_eq!(
                image_from_svg(svg.into(), &request("x"), AtomFidelity::MermaidBackend)
                    .unwrap_err()
                    .kind,
                AtomErrorKind::InvalidSvg
            );
        }
    }

    #[test]
    fn actual_mermaid_fixtures_match_headless_web_geometry() {
        let mut request = request("Mermaid fixture source is unchanged.");
        request.kind = AtomKind::Mermaid;
        for (svg, expected_width, expected_height) in [
            (
                include_str!("../fixtures/inline-proof/mermaid-flowchart.svg"),
                440.109_38,
                100.984375,
            ),
            (
                include_str!("../fixtures/inline-proof/mermaid-sequence.svg"),
                450.0,
                271.0,
            ),
        ] {
            let image = image_from_svg(svg.into(), &request, AtomFidelity::MermaidBackend).unwrap();
            // Chromium quantizes CSS layout to 1/64 px; the SVG viewBox
            // retains the renderer's full geometry (101 rather than 100.984375).
            // Native image sizing must retain that viewBox, within one CSS unit.
            assert!((image.width_px - expected_width).abs() <= 1.0 / 64.0 + 0.001);
            assert!((image.height_px - expected_height).abs() <= 1.0 / 64.0 + 0.001);
            assert!(image.svg.contains("Lora"));
            assert!(image.svg.contains("#f4ecd8"));
            let original = roxmltree::Document::parse(svg).unwrap();
            let rendered = roxmltree::Document::parse(&image.svg).unwrap();
            let labels = |document: &roxmltree::Document<'_>| {
                document
                    .descendants()
                    .filter(|node| node.is_element() && node.tag_name().name() == "text")
                    .map(|node| {
                        node.descendants()
                            .filter_map(|child| child.text().filter(|_| child.is_text()))
                            .collect::<String>()
                    })
                    .collect::<Vec<_>>()
            };
            assert_eq!(labels(&original), labels(&rendered));
        }
    }

    #[test]
    fn inherited_ink_adapts_without_changing_authored_equation_colors() {
        let renderer =
            InlineProofRenderer::new(engine(), Some(SemanticBridge::discover().unwrap()));
        let mut request = request("\\textcolor{#181818}{x}+y");
        request.color = 0xf8f2e5;
        let image = renderer.render(request).result.unwrap();
        let document = roxmltree::Document::parse(&image.svg).unwrap();
        let first_group = document
            .root_element()
            .children()
            .find(|node| node.is_element())
            .unwrap();
        assert_eq!(first_group.attribute("fill"), Some("#f8f2e5"));
        assert!(
            first_group
                .descendants()
                .any(|node| node.attribute("fill") == Some("#181818"))
        );
    }
}
