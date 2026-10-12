    /// Paint ONE already-composited premultiplied BGRA group using destination
    /// multiplication. The caller must have painted an opaque backdrop across
    /// the whole bounds first, and must paint this AFTER all live descendants.
    /// This is not general CSS blend-mode support for transparent backdrops.
    ///
    /// Supported only by the patched Linux/FreeBSD WGPU renderer, on non-sRGB
    /// BGRA8/RGBA8 UNORM target/atlas formats. Rasterization happens beforehand.
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    pub fn paint_multiply_image(
        &mut self,
        bounds: Bounds<Pixels>,
        data: Arc<RenderImage>,
        group_opacity: f32,
    ) -> Result<()> {
        self.invalidator.debug_assert_paint();
        anyhow::ensure!(
            group_opacity.is_finite() && (0. ..=1.).contains(&group_opacity),
            "multiply group opacity must be finite in 0..=1"
        );
        if group_opacity == 0. || bounds.is_empty() {
            return Ok(());
        }
        anyhow::ensure!(
            self.platform_window.background_appearance() == WindowBackgroundAppearance::Opaque,
            "destination-multiply refuses transparent windows"
        );
        anyhow::ensure!(
            self.element_opacity() == 1.,
            "destination-multiply requires an unfaded opaque ancestor (no group-isolation API)"
        );
        anyhow::ensure!(data.frame_count() == 1, "multiply expects one prepared group frame");
        let scale = self.scale_factor();
        anyhow::ensure!(
            [bounds.left().0, bounds.top().0, bounds.right().0, bounds.bottom().0]
                .into_iter().all(|edge| edge.is_finite() && (edge * scale).fract() == 0.),
            "multiply bounds must align exactly to the device grid"
        );
        let device_bounds = self.snap_bounds(bounds);
        let image_size = data.size(0);
        anyhow::ensure!(
            device_bounds.size.width.0 == image_size.width.0 as f32
                && device_bounds.size.height.0 == image_size.height.0 as f32,
            "multiply requires a freshly prepared 1:1 device-pixel image"
        );
        let mask = self.content_mask().bounds;
        anyhow::ensure!(
            [mask.left().0, mask.top().0, mask.right().0, mask.bottom().0]
                .into_iter().all(|edge| edge.is_finite() && (edge * scale).fract() == 0.),
            "multiply content mask must align exactly to the device grid"
        );
        let content_mask = self.snapped_content_mask();
        if device_bounds.intersect(&content_mask.bounds).is_empty() {
            return Ok(());
        }
        let tile = self.sprite_atlas.get_or_insert_with(
            RenderImageParams { image_id: data.id, frame_index: 0 }.into(),
            &mut || Ok(Some((image_size, Cow::Borrowed(data.as_bytes(0).unwrap())))),
        )?.expect("prepared multiply group provides its pixels");

        // A separate overlapping layer assigns a higher DrawOrder even inside
        // a parent's shared layer. Merely appending an image is insufficient:
        // core normally sorts equal-order primitives by kind/texture tile ID.
        self.paint_layer(bounds, |window| {
            window.next_frame.scene.insert_primitive(PolychromeSprite {
                order: 0,
                blend: PolychromeSpriteBlend::DestinationMultiply,
                grayscale: false.into(),
                opacity: group_opacity,
                bounds: device_bounds,
                content_mask,
                corner_radii: Default::default(),
                tile,
            });
        });
        Ok(())
    }
