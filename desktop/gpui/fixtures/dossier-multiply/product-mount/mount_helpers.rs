// Unapplied methods inserted within impl DossierView. No standalone execution.
    /// Preparation/atlas audit seam. Never mount this premultiplied image with
    /// ordinary img/paint_image; use the guarded final overlay below.
    pub fn prepared_multiply(&self) -> Option<&Arc<DossierMultiply>> {
        self.foxing.as_ref()
    }

    /// Recorded means a scene primitive was recorded, not presented. A
    /// retained form whose lease has retired is never an active image consumer.
    pub fn foxing_paint_status(&self) -> DossierFoxingPaintStatus {
        if self
            .foxing
            .as_ref()
            .is_some_and(|foxing| !foxing.is_transparent())
            && self
                .image_lease
                .as_ref()
                .is_none_or(|lease| !lease.is_current())
        {
            return DossierFoxingPaintStatus::Untracked;
        }
        self.foxing_paint.get().status
    }

    // Commit only after the accepted image lease replacement/resume succeeds.
    // An old canvas retains this same cell, so identity protects against its
    // uploading a retired image or overwriting a newer preparation receipt.
    fn commit_foxing_receipt(&self, window: &Window) {
        let (active_image, status) = match self.foxing.as_ref() {
            Some(foxing) if foxing.is_transparent() => {
                (None, DossierFoxingPaintStatus::Transparent)
            }
            Some(foxing) => (
                foxing.premultiplied_group().map(|image| image.id),
                DossierFoxingPaintStatus::Prepared,
            ),
            None => (None, DossierFoxingPaintStatus::Unprepared),
        };
        self.foxing_paint.set(DossierFoxingPaintReceipt {
            window: Some(window.window_handle().window_id()),
            active_image,
            status,
        });
    }

    // Constructor/theme/viewport/DPR/resume boundaries only, independently of
    // whether the ordinary paper preparation matched its existing cache key.
    fn prepare_multiply_candidate(
        &mut self,
        colors: theme::Palette,
        metrics: Option<DossierPaperMetrics>,
    ) {
        let Some(metrics) = metrics else {
            self.foxing = None;
            return;
        };
        if self
            .foxing
            .as_ref()
            .is_some_and(|foxing| foxing.matches(colors, metrics))
        {
            return;
        }
        match DossierMultiply::prepare(colors, metrics) {
            Ok(foxing) => self.foxing = Some(foxing),
            Err(error) => {
                self.foxing = None;
                eprintln!("Could not prepare Dossier foxing: {error:#}");
            }
        }
    }

    // Paint-only and LAST: no layout, hitbox, focus/accessibility node, text
    // capture, rasterization, cache lookup or atlas retirement occurs here.
    fn foxing_overlay(&self) -> Option<Canvas<()>> {
        let foxing = self.foxing.as_ref()?.clone();
        let image_id = foxing.premultiplied_group()?.id;
        let lease = self.image_lease.as_ref()?.clone();
        if !lease.is_current() {
            return None;
        }
        let receipt = self.foxing_paint.clone();
        Some(
            canvas(
                |_, _, _| (),
                move |bounds, (), window, cx| {
                    let current = receipt.get();
                    if current.window != Some(window.window_handle().window_id())
                        || !lease.is_current()
                        || current.active_image != Some(image_id)
                    {
                        return;
                    }
                    let record = |status| {
                        receipt.set(DossierFoxingPaintReceipt { status, ..current });
                    };
                    let metrics = foxing.metrics();
                    if f32::from(bounds.size.width).to_bits() != metrics.width().to_bits()
                        || f32::from(bounds.size.height).to_bits()
                            != metrics.height().to_bits()
                        || window.scale_factor().to_bits() != metrics.scale_factor().to_bits()
                        || !foxing.matches(*theme::palette(cx), metrics)
                    {
                        record(DossierFoxingPaintStatus::StalePreparation);
                        return;
                    }
                    if !window.supports_destination_multiply() {
                        record(DossierFoxingPaintStatus::UnsupportedBackend);
                        return;
                    }
                    let visible = bounds.intersect(&window.content_mask().bounds);
                    if visible.is_empty() {
                        record(DossierFoxingPaintStatus::Clipped);
                        return;
                    }
                    let result = window.with_content_mask(
                        Some(ContentMask { bounds: visible }),
                        |window| foxing.paint_on_opaque_backdrop(bounds, window, cx),
                    );
                    record(if result.is_ok() {
                        DossierFoxingPaintStatus::Recorded
                    } else {
                        // The core's opaque-window, ancestor opacity, mask and
                        // exact device-grid checks refuse before any upload.
                        // Refusal leaves ordinary descendants paintable.
                        DossierFoxingPaintStatus::PaintRefused
                    });
                },
            )
            .absolute()
            .inset_0()
            .size_full(),
        )
    }
