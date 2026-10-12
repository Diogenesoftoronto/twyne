//! Uncompiled actual-GPUI acceptance probe. Parent must apply the frozen core
//! multiply patch first. No application backdrop is baked into an image.
//! Images here contain only tiny source groups or ordinary sprite test input.

#[cfg(any(target_os = "linux", target_os = "freebsd"))]
mod native {
    use anyhow::{Context as _, Result, ensure};
    use gpui_kit::component::input::{Input, InputEvent, InputState};
    use gpui_kit::prelude::*;
    use gpui_kit::{
        App, AppContext, Bounds, ContentMask, Context, DevicePixels, Entity, FocusHandle,
        Focusable, KeyBinding, Pixels, Render, RenderImage, Role, Subscription, SvgRenderer,
        TitlebarOptions, Window, WindowBackgroundAppearance, WindowBounds, WindowOptions, actions,
        canvas, div, point, px, rgb, rgba, size,
    };
    use image::{Frame, RgbaImage};
    use serde::Serialize;
    use serde_json::{Value, json};
    use std::{cell::RefCell, collections::BTreeMap, path::PathBuf, rc::Rc, sync::Arc};
    use twyne_desktop::{assets::TwyneAssets, theme};

    actions!(multiply_probe, [Quit]);
    const TILE_CSS: f32 = 4.;
    const OPACITY: f32 = 0.7;
    const WIDTH: f32 = 768.;
    const HEIGHT: f32 = 600.;

    #[derive(Clone, Copy, Debug, PartialEq, Serialize)]
    #[serde(rename_all = "kebab-case")]
    enum Mode {
        Baseline,
        Multiply,
        NormalAlpha,
        PerLayer,
        Beneath,
    }

    impl Mode {
        fn parse(value: &str) -> Result<Self> {
            match value {
                "baseline" => Ok(Self::Baseline),
                "multiply" => Ok(Self::Multiply),
                "normal-alpha" => Ok(Self::NormalAlpha),
                "per-layer" => Ok(Self::PerLayer),
                "beneath" => Ok(Self::Beneath),
                _ => anyhow::bail!("Unknown isolated multiply probe mode"),
            }
        }
    }

    #[derive(Clone)]
    struct ImageInput {
        image: Arc<RenderImage>,
        premultiplied: bool,
    }

    impl ImageInput {
        fn manifest(&self) -> Value {
            let dimensions = self.image.size(0);
            json!({
                "image_id": self.image.id.0,
                "device_width": dimensions.width.0,
                "device_height": dimensions.height.0,
                "premultiplied": self.premultiplied,
                "bgra": self.image.as_bytes(0).unwrap(),
            })
        }
    }

    struct Prepared {
        epoch: u64,
        scale: f32,
        theme: String,
        images: BTreeMap<String, ImageInput>,
        layers: BTreeMap<String, Vec<String>>,
    }

    fn frame(bytes: Vec<u8>, width: u32, height: u32) -> Result<Arc<RenderImage>> {
        let pixels = RgbaImage::from_raw(width, height, bytes)
            .context("Complete BGRA byte input is required")?;
        // RenderImage's public contract is BGRA; Frame's container type does not
        // change the byte order. No round-trip through ordinary SVG demultiply.
        Ok(Arc::new(RenderImage::new(vec![Frame::new(pixels)])))
    }

    fn single_layers(svg: &str) -> Result<Vec<String>> {
        let tree = roxmltree::Document::parse(svg)?;
        let defs = tree
            .descendants()
            .find(|node| node.has_tag_name("defs"))
            .map(|node| &svg[node.range()])
            .unwrap_or("");
        Ok(tree.descendants().filter(|node| node.has_tag_name("rect"))
        .map(|node| format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"4\" height=\"4\" viewBox=\"0 0 4 4\" color-interpolation=\"sRGB\">{defs}{}</svg>",
            &svg[node.range()]
        )).collect())
    }

    impl Prepared {
        fn new(scale: f32, nightpress: bool, epoch: u64) -> Result<Arc<Self>> {
            ensure!(
                scale.is_finite() && (0.5..=4.).contains(&scale),
                "DPR outside probe bounds"
            );
            ensure!(
                (TILE_CSS * scale).fract() == 0.,
                "4px tile needs integral device extent"
            );
            // The half-tile mask deliberately tests a partial tile. Do not invent
            // a fractional mask sampling policy at DPR1.25, for example.
            ensure!(
                (2. * scale).fract() == 0.,
                "2px clip edge needs integral device coordinates"
            );
            let pixels = (TILE_CSS * scale) as u32;
            let renderer = SvgRenderer::new(Arc::new(TwyneAssets));
            let source = if nightpress {
                include_str!("../nightpress-4-group.svg")
            } else {
                include_str!("../editorial-4-group.svg")
            };
            let strong = include_str!("strong-group.svg");
            let mut images = BTreeMap::new();
            let mut layers = BTreeMap::new();
            for (name, svg) in [("source", source), ("strong", strong)] {
                let parsed = renderer.parse_svg(svg.as_bytes())?;
                let image = renderer.render_parsed_premultiplied(
                    &parsed,
                    size(DevicePixels(pixels as i32), DevicePixels(pixels as i32)),
                )?;
                ensure!(
                    image
                        .as_bytes(0)
                        .unwrap()
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .all(|pixel| pixel[..3].iter().all(|channel| *channel <= pixel[3])),
                    "Group raster must be premultiplied BGRA"
                );
                // Wrong-control input: straight color with .7 alpha applied once.
                // This remains ordinary source-over, never the multiply pipeline.
                let mut ordinary = image.as_bytes(0).unwrap().to_vec();
                for pixel in ordinary.as_chunks_mut::<4>().0 {
                    let alpha = pixel[3];
                    for channel in &mut pixel[..3] {
                        *channel = if alpha == 0 {
                            0
                        } else {
                            ((*channel as f32 * 255. / alpha as f32).round()).min(255.) as u8
                        };
                    }
                    pixel[3] = (alpha as f32 * OPACITY).round() as u8;
                }
                images.insert(
                    format!("{name}-normal"),
                    ImageInput {
                        image: frame(ordinary, pixels, pixels)?,
                        premultiplied: false,
                    },
                );
                images.insert(
                    name.into(),
                    ImageInput {
                        image,
                        premultiplied: true,
                    },
                );
                let mut names = Vec::new();
                for (index, layer) in single_layers(svg)?.into_iter().enumerate() {
                    let parsed = renderer.parse_svg(layer.as_bytes())?;
                    let image = renderer.render_parsed_premultiplied(
                        &parsed,
                        size(DevicePixels(pixels as i32), DevicePixels(pixels as i32)),
                    )?;
                    let id = format!("{name}-layer-{index}");
                    images.insert(
                        id.clone(),
                        ImageInput {
                            image,
                            premultiplied: true,
                        },
                    );
                    names.push(id);
                }
                layers.insert(name.into(), names);
            }
            let mut edge = vec![0; (pixels * pixels * 4) as usize];
            for y in 1..pixels.saturating_sub(1) {
                for x in 1..pixels.saturating_sub(1) {
                    let at = ((y * pixels + x) * 4) as usize;
                    edge[at..at + 4].copy_from_slice(&[16, 64, 32, 128]);
                }
            }
            images.insert(
                "edge".into(),
                ImageInput {
                    image: frame(edge, pixels, pixels)?,
                    premultiplied: true,
                },
            );
            for (name, pixel) in [
                ("ordinary", [208, 80, 16, 128]),
                ("hot", [255, 0, 255, 255]),
            ] {
                images.insert(
                    name.into(),
                    ImageInput {
                        image: frame(pixel.repeat((pixels * pixels) as usize), pixels, pixels)?,
                        premultiplied: false,
                    },
                );
            }
            Ok(Arc::new(Self {
                epoch,
                scale,
                theme: if nightpress {
                    "nightpress"
                } else {
                    "editorial"
                }
                .into(),
                images,
                layers,
            }))
        }
    }

    #[derive(Clone, Serialize)]
    struct Region {
        name: String,
        x: f32,
        y: f32,
        group: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        clip: Option<[f32; 4]>,
        kind: String,
    }

    impl Region {
        fn bounds(&self, origin: gpui_kit::Point<Pixels>) -> Bounds<Pixels> {
            Bounds::new(
                origin + point(px(self.x), px(self.y)),
                size(px(TILE_CSS), px(TILE_CSS)),
            )
        }
    }

    fn regions() -> Vec<Region> {
        let mut regions = Vec::new();
        for (column, name) in ["black", "white", "red", "green", "blue", "mixed"]
            .into_iter()
            .enumerate()
        {
            for (dx, group) in [(16., "source"), (48., "strong"), (72., "edge")] {
                regions.push(Region {
                    name: format!("{name}-{group}"),
                    x: 32. + column as f32 * 112. + dx,
                    y: 124.,
                    group: group.into(),
                    clip: None,
                    kind: "multiply".into(),
                });
            }
        }
        // A genuine Input and shaped text remain live under these tiny groups.
        for row in 0..6 {
            for column in 0..16 {
                regions.push(Region {
                    name: format!("live-field-{row}-{column}"),
                    x: 48. + column as f32 * 4.,
                    y: 240. + row as f32 * 4.,
                    group: "strong".into(),
                    clip: None,
                    kind: "multiply".into(),
                });
            }
        }
        // Plain bundled-font text keeps a known black foreground independently of
        // the component Input's editor-theme foreground. It remains shaped/live.
        for row in 0..6 {
            for column in 0..24 {
                regions.push(Region {
                    name: format!("live-text-{row}-{column}"),
                    x: 48. + column as f32 * 4.,
                    y: 340. + row as f32 * 4.,
                    group: "strong".into(),
                    clip: None,
                    kind: "multiply".into(),
                });
            }
        }
        for row in 0..4 {
            for column in 0..4 {
                regions.push(Region {
                    name: format!("translucent-child-{row}-{column}"),
                    x: 416. + column as f32 * 4.,
                    y: 244. + row as f32 * 4.,
                    group: "source".into(),
                    clip: None,
                    kind: "multiply".into(),
                });
            }
        }
        regions.push(Region {
            name: "partial-content-mask".into(),
            x: 32.,
            y: 416.,
            group: "strong".into(),
            clip: Some([34., 416., 2., 4.]),
            kind: "multiply".into(),
        });
        regions.push(Region {
            name: "ordinary-before-multiply".into(),
            x: 80.,
            y: 416.,
            group: "strong".into(),
            clip: None,
            kind: "multiply".into(),
        });
        regions.push(Region {
            name: "ordinary-after-multiply".into(),
            x: 128.,
            y: 416.,
            group: "strong".into(),
            clip: None,
            kind: "late-ordinary".into(),
        });
        regions.push(Region {
            name: "ordinary-unaffected".into(),
            x: 176.,
            y: 416.,
            group: "".into(),
            clip: None,
            kind: "unchanged".into(),
        });
        regions.push(Region {
            name: "hot-atlas-sentinel".into(),
            x: 224.,
            y: 416.,
            group: "".into(),
            clip: None,
            kind: "unchanged".into(),
        });
        regions
    }

    #[derive(Default)]
    struct PaintTrace {
        frames: u64,
        root: Option<[f32; 4]>,
        errors: Vec<String>,
        controls: BTreeMap<String, [f32; 4]>,
    }

    fn observe_control(id: &'static str, trace: Rc<RefCell<PaintTrace>>) -> gpui_kit::Canvas<()> {
        canvas(
            |_, _, _| (),
            move |bounds, (), _, _| {
                trace.borrow_mut().controls.insert(
                    id.into(),
                    [
                        f32::from(bounds.origin.x),
                        f32::from(bounds.origin.y),
                        f32::from(bounds.size.width),
                        f32::from(bounds.size.height),
                    ],
                );
            },
        )
        .absolute()
        .inset_0()
        .size_full()
    }

    fn normal_paint(window: &mut Window, bounds: Bounds<Pixels>, input: &ImageInput) -> Result<()> {
        ensure!(
            !input.premultiplied,
            "Ordinary primitives require straight BGRA input"
        );
        window.paint_image(
            bounds,
            bounds,
            Default::default(),
            input.image.clone(),
            0,
            false,
        )
    }

    fn paint_regions(
        bounds: Bounds<Pixels>,
        prepared: &Prepared,
        mode: Mode,
        regions: &[Region],
        window: &mut Window,
    ) -> Result<()> {
        ensure!(
            prepared.scale.to_bits() == window.scale_factor().to_bits(),
            "Stale DPR preparation"
        );
        if mode == Mode::Baseline {
            return Ok(());
        }
        window.with_content_mask(Some(ContentMask { bounds }), |window| {
            for region in regions.iter().filter(|region| region.kind != "unchanged") {
                let target = region.bounds(bounds.origin);
                let clip = region
                    .clip
                    .map(|clip| {
                        Bounds::new(
                            bounds.origin + point(px(clip[0]), px(clip[1])),
                            size(px(clip[2]), px(clip[3])),
                        )
                    })
                    .unwrap_or(bounds);
                window.with_content_mask(
                    Some(ContentMask { bounds: clip }),
                    |window| -> Result<()> {
                        match mode {
                            Mode::NormalAlpha if region.group != "edge" => normal_paint(
                                window,
                                target,
                                &prepared.images[&format!("{}-normal", region.group)],
                            ),
                            Mode::PerLayer if prepared.layers.contains_key(&region.group) => {
                                for layer in &prepared.layers[&region.group] {
                                    window.paint_multiply_image(
                                        target,
                                        prepared.images[layer].image.clone(),
                                        OPACITY,
                                    )?;
                                }
                                Ok(())
                            }
                            _ => window.paint_multiply_image(
                                target,
                                prepared.images[&region.group].image.clone(),
                                OPACITY,
                            ),
                        }
                    },
                )?;
            }
            Ok(())
        })
    }

    struct Probe {
        mode: Mode,
        receipt: PathBuf,
        focus: FocusHandle,
        input: Entity<InputState>,
        prepared: Arc<Prepared>,
        retired: Vec<Arc<Prepared>>,
        lifecycle: Vec<Value>,
        counter: u64,
        trace: Rc<RefCell<PaintTrace>>,
        subscriptions: Vec<Subscription>,
    }

    impl Probe {
        fn new(
            mode: Mode,
            receipt: PathBuf,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) -> Result<Self> {
            let input = cx.new(|cx| InputState::new(window, cx));
            input.update(cx, |input, cx| input.set_value("LIVE FIELD", window, cx));
            let prepared = Prepared::new(window.scale_factor(), false, 1)?;
            let subscriptions = vec![
                cx.observe_window_bounds(window, |this, window, cx| {
                    if this.prepared.scale.to_bits() != window.scale_factor().to_bits() {
                        this.replace_preparation(window, cx, this.prepared.theme == "nightpress");
                    }
                    cx.notify();
                }),
                cx.subscribe(&input, |_, _, _: &InputEvent, cx| cx.notify()),
            ];
            Ok(Self {
                mode,
                receipt,
                focus: cx.focus_handle(),
                input,
                prepared,
                retired: Vec::new(),
                lifecycle: Vec::new(),
                counter: 0,
                trace: Default::default(),
                subscriptions,
            })
        }

        fn replace_preparation(
            &mut self,
            window: &mut Window,
            cx: &mut Context<Self>,
            nightpress: bool,
        ) {
            match Prepared::new(window.scale_factor(), nightpress, self.prepared.epoch + 1) {
                Ok(next) => {
                    self.retired
                        .push(std::mem::replace(&mut self.prepared, next));
                    self.trace = Default::default();
                }
                Err(error) => self
                    .trace
                    .borrow_mut()
                    .errors
                    .push(format!("Preparation refused: {error:#}")),
            }
            cx.notify();
        }

        fn retire_after_current_frame(&mut self, window: &mut Window, cx: &mut Context<Self>) {
            let expected_epoch = self.prepared.epoch;
            let weak = cx.entity().downgrade();
            window.on_next_frame(move |window, cx| {
                let _ = weak.update(cx, |this, cx| {
                    if this.prepared.epoch != expected_epoch || this.trace.borrow().frames == 0 {
                        this.lifecycle.push(
                            json!({"refused": "Retirement epoch has not rendered or changed"}),
                        );
                        cx.notify();
                        return;
                    }
                    for old in this.retired.drain(..) {
                        for (name, input) in &old.images {
                            let before = window.has_image_atlas_entry(&input.image);
                            let result = window.drop_image(input.image.clone());
                            let after = window.has_image_atlas_entry(&input.image);
                            this.lifecycle.push(json!({
                            "retired_epoch": old.epoch, "name": name, "image_id": input.image.id.0,
                            "had_atlas_entry": before, "has_atlas_entry_after": after,
                            "error": result.err().map(|error| format!("{error:#}")),
                        }));
                        }
                    }
                    cx.notify();
                });
            });
            cx.notify();
        }

        fn write_receipt(&self, window: &Window, cx: &App) -> Result<()> {
            let trace = self.trace.borrow();
            let fields = gpui_kit::base::test_support::snapshots(window)
                .into_iter()
                .filter(|snapshot| {
                    snapshot.role() == Some(Role::TextInput)
                        && snapshot.label() == Some("Multiply live field")
                        && snapshot.visible()
                })
                .collect::<Vec<_>>();
            ensure!(fields.len() == 1, "Require one actual live input snapshot");
            let bounds = fields[0].bounds();
            let mut controls = trace.controls.clone();
            controls.insert(
                "live-field".into(),
                [
                    f32::from(bounds.origin.x),
                    f32::from(bounds.origin.y),
                    f32::from(bounds.size.width),
                    f32::from(bounds.size.height),
                ],
            );
            let value = json!({
                "schema": 1, "mode": self.mode, "opacity": OPACITY,
                "epoch": self.prepared.epoch, "scale": window.scale_factor(),
                "theme": self.prepared.theme, "counter": self.counter,
                "input_text": self.input.read(cx).text().to_string(),
                "input_focused": self.input.read(cx).focus_handle(cx).is_focused(window),
                "paint_submissions": trace.frames, "root_bounds": trace.root, "paint_errors": trace.errors,
                "observed_control_content_bounds": controls,
                "images": self.prepared.images.iter().map(|(name, input)| (name.clone(), input.manifest())).collect::<BTreeMap<_, _>>(),
                "regions": regions(), "per_layer_order": self.prepared.layers,
                "atlas_retirement": self.lifecycle, "pending_retired_preparations": self.retired.len(),
                "claims": {
                    "pixels_accepted": false, "source_radial_raster_parity": false,
                    "framebuffer_alpha_measured": false, "atlas_adjacency_observed": false,
                    "total_gpu_memory_measured": false,
                    "single_window_consumer": true,
                    "window_backdrop": "explicit opaque white plus live SourceOver descendants",
                    "required_format": "patched non-sRGB BGRA8/RGBA8 UNORM target and atlas",
                    "scope": "Linux/FreeBSD patched WGPU; actual X11 runner is Linux only",
                },
            });
            let temporary = self.receipt.with_extension("pending.json");
            std::fs::write(&temporary, serde_json::to_vec_pretty(&value)?)?;
            std::fs::rename(temporary, &self.receipt)?;
            Ok(())
        }
    }

    impl Render for Probe {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let _ = self.subscriptions.len(); // Retain the real input/bounds subscriptions.
            let weak = cx.entity().downgrade();
            window.on_next_frame(move |window, cx| {
                let _ = weak.update(cx, |this, cx| {
                    if let Err(error) = this.write_receipt(window, cx) {
                        eprintln!("Probe receipt: {error:#}");
                    }
                });
            });
            let prepared = self.prepared.clone();
            let trace = self.trace.clone();
            let mode = self.mode;
            let overlay = move || {
                let prepared = prepared.clone();
                let trace = trace.clone();
                canvas(
                    |_, _, _| (),
                    move |bounds, (), window, _| {
                        let result = paint_regions(bounds, &prepared, mode, &regions(), window);
                        let mut trace = trace.borrow_mut();
                        trace.frames += 1;
                        trace.root = Some([
                            f32::from(bounds.origin.x),
                            f32::from(bounds.origin.y),
                            f32::from(bounds.size.width),
                            f32::from(bounds.size.height),
                        ]);
                        if let Err(error) = result {
                            let message = format!("{error:#}");
                            if !trace.errors.contains(&message) {
                                trace.errors.push(message);
                            }
                        }
                    },
                )
                .absolute()
                .inset_0()
                .size_full()
            };
            let mut root = div()
                .id("multiply-probe-root")
                .relative()
                .size_full()
                .overflow_hidden()
                .bg(rgb(0xffffff))
                .text_color(rgb(0x000000))
                .font_family(theme::SANS_FONT)
                .text_size(px(16.))
                .line_height(px(22.))
                .track_focus(&self.focus)
                .key_context("MultiplyProbe")
                .on_action(|_: &Quit, _, cx| cx.quit())
                .child(
                    div()
                        .absolute()
                        .left(px(32.))
                        .top(px(24.))
                        .child("Destination multiply — actual live GPUI probe"),
                );
            if self.mode == Mode::Beneath {
                root = root.child(overlay());
            }
            for (column, (name, color)) in [
                ("black", 0x000000),
                ("white", 0xffffff),
                ("red", 0xff0000),
                ("green", 0x00ff00),
                ("blue", 0x0000ff),
                ("mixed", 0x804020),
            ]
            .into_iter()
            .enumerate()
            {
                root = root
                    .child(
                        div()
                            .absolute()
                            .left(px(32. + column as f32 * 112.))
                            .top(px(96.))
                            .w(px(96.))
                            .h(px(80.))
                            .bg(rgb(color)),
                    )
                    .child(
                        div()
                            .absolute()
                            .left(px(32. + column as f32 * 112.))
                            .top(px(70.))
                            .child(name),
                    );
            }
            root = root
                .child(
                    div()
                        .absolute()
                        .left(px(32.))
                        .top(px(222.))
                        .w(px(320.))
                        .h(px(72.))
                        .bg(rgb(0xffffff))
                        .child(
                            Input::new(&self.input)
                                .aria_label("Multiply live field")
                                .min_h(px(72.))
                                .appearance(false)
                                .bordered(false)
                                .focus_bordered(false)
                                .p(px(16.))
                                .text_size(px(18.))
                                .font_weight(gpui_kit::FontWeight::BOLD)
                                .text_color(rgb(0x000000)),
                        )
                        .child(observe_control("live-field", self.trace.clone())),
                )
                .child(
                    div()
                        .absolute()
                        .left(px(400.))
                        .top(px(222.))
                        .w(px(272.))
                        .h(px(72.))
                        .bg(rgb(0xffffff))
                        .child(
                            div()
                                .absolute()
                                .left(px(16.))
                                .top(px(16.))
                                .w(px(64.))
                                .h(px(36.))
                                .bg(rgba(0x2080c080)),
                        )
                        .child("Translucent live child"),
                )
                .child(
                    div()
                        .absolute()
                        .left(px(32.))
                        .top(px(304.))
                        .child("All groups are overlays, not screenshots of these descendants."),
                );
            root = root.child(
                div()
                    .absolute()
                    .left(px(48.))
                    .top(px(340.))
                    .font_family(theme::SANS_FONT)
                    .font_weight(gpui_kit::FontWeight::BOLD)
                    .text_size(px(18.))
                    .line_height(px(24.))
                    .text_color(rgb(0x000000))
                    .child("BLACK INK"),
            );
            let prepared = self.prepared.clone();
            root = root.child(
                canvas(
                    |_, _, _| (),
                    move |bounds, (), window, _| {
                        for (x, key) in [(80., "ordinary"), (176., "ordinary"), (224., "hot")] {
                            let target = Bounds::new(
                                bounds.origin + point(px(x), px(416.)),
                                size(px(4.), px(4.)),
                            );
                            if let Err(error) = normal_paint(window, target, &prepared.images[key])
                            {
                                eprintln!("Ordinary sprite probe: {error:#}");
                            }
                        }
                    },
                )
                .absolute()
                .inset_0()
                .size_full(),
            );
            if self.mode != Mode::Beneath {
                root = root.child(overlay());
            }
            let prepared = self.prepared.clone();
            root = root.child(
                canvas(
                    |_, _, _| (),
                    move |bounds, (), window, _| {
                        let target = Bounds::new(
                            bounds.origin + point(px(128.), px(416.)),
                            size(px(4.), px(4.)),
                        );
                        // Explicit later painter layer: mixed ordinary/multiply batches
                        // must return to the untouched SourceOver sprite pipeline.
                        window.paint_layer(target, |window| {
                            if let Err(error) =
                                normal_paint(window, target, &prepared.images["ordinary"])
                            {
                                eprintln!("Later ordinary sprite probe: {error:#}");
                            }
                        });
                    },
                )
                .absolute()
                .inset_0()
                .size_full(),
            );
            root.child(div().absolute().left(px(32.)).top(px(480.)).flex().gap(px(16.))
            .child(div().id("multiply-probe-live-button").relative().border_1().p(px(8.)).cursor_pointer()
                .child(format!("Live button {}", self.counter))
                .child(observe_control("live-button", self.trace.clone()))
                .on_click(cx.listener(|this, _, _, cx| { this.counter += 1; cx.notify(); })))
            .child(div().id("multiply-probe-next-group").relative().border_1().p(px(8.)).cursor_pointer()
                .child("Next source palette")
                .child(observe_control("next-palette", self.trace.clone()))
                .on_click(cx.listener(|this, _, window, cx| {
                    this.replace_preparation(window, cx, this.prepared.theme != "nightpress");
                })))
            .child(div().id("multiply-probe-retire").relative().border_1().p(px(8.)).cursor_pointer()
                .child("Retire previous atlas entries")
                .child(observe_control("retire", self.trace.clone()))
                .on_click(cx.listener(|this, _, window, cx| this.retire_after_current_frame(window, cx)))))
            .child(div().absolute().left(px(32.)).top(px(548.))
                .child("Ctrl-Q closes only this isolated probe. RGB capture is not alpha/radial-raster proof."))
        }
    }

    pub fn run() -> Result<()> {
        let mut args = std::env::args().skip(1);
        let display = args.next().context("Use an explicit owned :DISPLAY")?;
        let mode = Mode::parse(&args.next().context("Need probe mode")?)?;
        let receipt = PathBuf::from(args.next().context("Need owned receipt path")?);
        ensure!(args.next().is_none(), "Unexpected probe argument");
        ensure!(
            display.starts_with(':'),
            "Only an explicit owned display is allowed"
        );
        ensure!(
            std::env::var("DISPLAY").ok().as_deref() == Some(display.as_str())
                && std::env::var("TWYNE_MULTIPLY_OWNED_DISPLAY")
                    .ok()
                    .as_deref()
                    == Some(display.as_str()),
            "The probe must inherit its runner's private display token"
        );
        gpui_kit::application()
            .with_assets(TwyneAssets)
            .run(move |cx| {
                gpui_kit::init(cx);
                assert_eq!(
                    cx.compositor_name(),
                    "X11",
                    "Use only the runner's owned X11 surface"
                );
                theme::apply(cx).expect("Existing bundled font initialization");
                cx.bind_keys([KeyBinding::new("ctrl-q", Quit, Some("MultiplyProbe"))]);
                let (_, view) = gpui_kit::open_window(
                    WindowOptions {
                        titlebar: Some(TitlebarOptions {
                            title: Some("Twyne Multiply Probe".into()),
                            ..Default::default()
                        }),
                        window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                            point(px(8.), px(8.)),
                            size(px(WIDTH), px(HEIGHT)),
                        ))),
                        window_background: WindowBackgroundAppearance::Opaque,
                        app_id: Some("love.twyne.multiply-probe".into()),
                        ..Default::default()
                    },
                    cx,
                    |window, cx| {
                        cx.new(|cx| {
                            let probe = Probe::new(mode, receipt, window, cx)
                                .expect("Explicit fresh group preparation");
                            window.set_window_title("Twyne Multiply Probe");
                            window.focus(&probe.focus, cx);
                            probe
                        })
                    },
                )
                .expect("Open isolated native probe");
                // Keep only the window root's entity, not an extra detached strong view.
                drop(view);
                cx.on_window_closed(|cx, _| {
                    if cx.windows().is_empty() {
                        cx.quit();
                    }
                })
                .detach();
                cx.activate(true);
            });
        Ok(())
    }
}

#[cfg(any(target_os = "linux", target_os = "freebsd"))]
fn main() -> anyhow::Result<()> {
    native::run()
}

#[cfg(not(any(target_os = "linux", target_os = "freebsd")))]
fn main() -> anyhow::Result<()> {
    anyhow::bail!("This unexecuted probe targets the proposed Linux/FreeBSD WGPU API only")
}
