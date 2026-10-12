"""Generate an UNAPPLIED proposal from exact pinned local sources; no shared writes."""
from pathlib import Path
import difflib
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
CORE = Path.home() / ".cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gpui-pre-0.3.7/src"
WGPU = ROOT / "desktop/gpui/vendor/gpui-pre-wgpu/src"


def replace_once(text, before, after):
    assert text.count(before) == 1, f"Expected one pinned seam: {before[:90]!r}"
    return text.replace(before, after, 1)


scene = (CORE / "scene.rs").read_text()
scene_after = replace_once(scene, """        self.polychrome_sprites
            .sort_by_key(|sprite| (sprite.order, sprite.tile.tile_id));""", """        if self.polychrome_sprites.iter().all(|sprite| {
            sprite.blend == PolychromeSpriteBlend::SourceOver
        }) {
            // Preserve the exact ordinary-image fast path and tile sorting.
            self.polychrome_sprites
                .sort_by_key(|sprite| (sprite.order, sprite.tile.tile_id));
        } else {
            self.polychrome_sprites.sort_by_key(|sprite| sprite.order);
            for group in self.polychrome_sprites.chunk_by_mut(|a, b| a.order == b.order) {
                if group.iter().all(|sprite| sprite.blend == PolychromeSpriteBlend::SourceOver) {
                    // Ordinary-only orders retain exactly their previous order.
                    group.sort_by_key(|sprite| sprite.tile.tile_id);
                }
                // A mixed-blend order keeps insertion order: source-over and
                // destination multiply do not commute. Public multiply paint
                // additionally creates a separate later layer/order barrier.
            }
        }""")
scene_after = replace_once(scene_after, """            PrimitiveKind::PolychromeSprite => {
                let texture_id = self.polychrome_sprites_iter.peek().unwrap().tile.texture_id;""", """            PrimitiveKind::PolychromeSprite => {
                let first = self.polychrome_sprites_iter.peek().unwrap();
                let texture_id = first.tile.texture_id;
                let blend = first.blend;""")
anchor = """                    .polychrome_sprites_iter
                    .next_if(|sprite| {
                        (sprite.order, batch_kind) < max_order_and_kind
                            && sprite.tile.texture_id == texture_id
                    })"""
scene_after = replace_once(scene_after, anchor, anchor.replace(
    "&& sprite.tile.texture_id == texture_id", "&& sprite.tile.texture_id == texture_id\n                            && sprite.blend == blend"))
scene_after = replace_once(scene_after, """#[derive(Copy, Clone, Debug)]
#[repr(C)]
#[expect(missing_docs)]
pub struct PolychromeSprite {
    pub order: DrawOrder,
    pub pad: u32,""", """/// Pinned polychrome sprite blend mode. The u32 occupies the former padding
/// word, preserving the 96-byte shader/Metal/WebGL transport layout.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
#[repr(u32)]
pub enum PolychromeSpriteBlend {
    /// Ordinary straight-alpha image rendering on every existing backend.
    #[default]
    SourceOver = 0,
    /// Premultiplied group, supported only by the patched Linux/FreeBSD WGPU
    /// image API. Requires an opaque backdrop and non-sRGB UNORM formats.
    DestinationMultiply = 1,
}

#[derive(Copy, Clone, Debug)]
#[repr(C)]
#[expect(missing_docs)]
pub struct PolychromeSprite {
    pub order: DrawOrder,
    pub blend: PolychromeSpriteBlend,""")
scene_after += (HERE / "scene-tests.rs").read_text()

window = (CORE / "window.rs").read_text()
window_after = replace_once(window,
    "PlatformDisplay, PlatformInput, PlatformInputHandler, PlatformWindow, Point, PolychromeSprite,",
    "PlatformDisplay, PlatformInput, PlatformInputHandler, PlatformWindow, Point, PolychromeSprite,\n    PolychromeSpriteBlend,")
# Only the two real PolychromeSprite initializers change; Mono/Subpixel pads stay.
import re
window_after, count = re.subn(
    r"(insert_primitive\(PolychromeSprite \{\s+order: 0,\s+)pad: 0,",
    r"\1blend: PolychromeSpriteBlend::SourceOver,", window_after)
assert count == 2
window_after = replace_once(window_after,
    "    /// Paint a surface into the scene for the next frame at the current z-index.",
    (HERE / "paint-multiply.rs").read_text()
    + "\n    /// Paint a surface into the scene for the next frame at the current z-index.")

renderer = (WGPU / "wgpu_renderer.rs").read_text()
renderer_after = replace_once(renderer,
    "ScaledPixels, Scene, Size, get_gamma_correction_ratios,",
    "ScaledPixels, Scene, Size, PolychromeSpriteBlend, get_gamma_correction_ratios,")
renderer_after = replace_once(renderer_after,
    "    poly_sprites: wgpu::RenderPipeline,",
    "    poly_sprites: wgpu::RenderPipeline,\n    poly_multiply: Option<wgpu::RenderPipeline>,")
renderer_after = replace_once(renderer_after,
    "    target_format: wgpu::TextureFormat,\n    max_texture_size: u32,",
    "    target_format: wgpu::TextureFormat,\n    destination_multiply_supported: bool,\n    max_texture_size: u32,")
renderer_after = replace_once(renderer_after, "        let surfaces = create_pipeline(",
    (HERE / "multiply-pipeline.rs").read_text() + "\n        let surfaces = create_pipeline(")
renderer_after = replace_once(renderer_after, "            poly_sprites,\n            surfaces,",
    "            poly_sprites,\n            poly_multiply,\n            surfaces,")
# The exact core constructor already stores target_format; narrow named-field seam.
renderer_after = replace_once(renderer_after,
    "            target_format,\n            max_texture_size,",
    "            target_format,\n            destination_multiply_supported: matches!(\n                target_format, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm\n            ) && matches!(\n                context.color_texture_format(),\n                wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm\n            ),\n            max_texture_size,")
renderer_after = replace_once(renderer_after,
    """    ) -> Result<wgpu::SubmissionIndex> {
        let mut instance_offset = 0;""",
    """    ) -> Result<wgpu::SubmissionIndex> {
        // Fail before encoding: byte-channel CSS multiplication must not be
        // silently promoted to linear/sRGB or a different atlas representation.
        anyhow::ensure!(
            self.destination_multiply_supported
                || !scene.polychrome_sprites.iter().any(|sprite| {
                    sprite.blend == PolychromeSpriteBlend::DestinationMultiply
                }),
            "destination-multiply requires non-sRGB BGRA8/RGBA8 UNORM target and atlas"
        );
        let mut instance_offset = 0;""")
renderer_after = replace_once(renderer_after, """                    PrimitiveBatch::PolychromeSprites { texture_id, range } => {
                        self.draw_sprites(
                            &instance_bindings.polychrome_sprites,
                            texture_id,
                            &self.resources().pipelines.poly_sprites,
                            instance_range(range),
                            &mut pass,
                        )?;
                    }""", """                    PrimitiveBatch::PolychromeSprites { texture_id, range } => {
                        // Core batch iterator splits at every blend-mode change.
                        let pipeline = match scene.polychrome_sprites[range.start].blend {
                            PolychromeSpriteBlend::SourceOver => &self.resources().pipelines.poly_sprites,
                            PolychromeSpriteBlend::DestinationMultiply => self.resources()
                                .pipelines.poly_multiply.as_ref()
                                .context("destination-multiply pipeline unavailable")?,
                        };
                        self.draw_sprites(
                            &instance_bindings.polychrome_sprites,
                            texture_id,
                            pipeline,
                            instance_range(range),
                            &mut pass,
                        )?;
                    }""")

shader = (WGPU / "shaders.wgsl").read_text()
shader_after = replace_once(shader, "struct PolychromeSprite {\n    order: u32,\n    pad: u32,",
    "struct PolychromeSprite {\n    order: u32,\n    blend_mode: u32,")
shader_after = replace_once(shader_after, "// --- surfaces --- //",
    (HERE / "multiply-fragment.wgsl").read_text() + "\n// --- surfaces --- //")

svg = (CORE / "svg_renderer.rs").read_text()
svg_after = replace_once(svg,
    "    /// Renders the given bytes into an image buffer.",
    (HERE / "render-group.rs").read_text() + "\n    /// Renders the given bytes into an image buffer.")

changes = [
    ("desktop/gpui/vendor/gpui-pre/src/scene.rs", CORE / "scene.rs", scene, scene_after),
    ("desktop/gpui/vendor/gpui-pre/src/window.rs", CORE / "window.rs", window, window_after),
    ("desktop/gpui/vendor/gpui-pre/src/svg_renderer.rs", CORE / "svg_renderer.rs", svg, svg_after),
    ("desktop/gpui/vendor/gpui-pre-wgpu/src/wgpu_renderer.rs", WGPU / "wgpu_renderer.rs", renderer, renderer_after),
    ("desktop/gpui/vendor/gpui-pre-wgpu/src/shaders.wgsl", WGPU / "shaders.wgsl", shader, shader_after),
]
changes = [(target, source, before, subprocess.run(
    ["rtk", "proxy", "rustfmt", "--edition", "2024", "--config", "skip_children=true", "--emit", "stdout"],
    input=after, text=True, capture_output=True, check=True,
).stdout if target.endswith(".rs") else after) for target, source, before, after in changes]
patch = "".join("".join(difflib.unified_diff(
    before.splitlines(True), after.splitlines(True), fromfile=f"a/{target}", tofile=f"b/{target}", n=4
)) for target, _, before, after in changes)
(HERE / "integration.patch").write_text(patch)
(HERE / "patch-receipt.json").write_text(json.dumps({
    "status": "authored-unapplied-not-compiled",
    "requires": "Parent vendors gpui-pre 0.3.7 and adds its crates-io override before applying",
    "gpui": "gpui-pre 0.3.7", "wgpu": "29.0.4",
    "patchSha256": hashlib.sha256(patch.encode()).hexdigest(),
    "files": [{"target": target, "readFrom": str(source),
               "beforeSha256": hashlib.sha256(before.encode()).hexdigest(),
               "proposedSha256": hashlib.sha256(after.encode()).hexdigest()}
              for target, source, before, after in changes],
}, indent=2) + "\n")
print(f"Authored unapplied {len(changes)}-file proposal ({len(patch)} bytes); shared sources untouched")
