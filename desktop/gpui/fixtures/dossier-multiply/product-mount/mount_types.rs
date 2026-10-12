// Unapplied additions to dossier_view.rs; not a standalone production module.
// A scene recording receipt is deliberately distinct from GPU presentation.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DossierFoxingPaintStatus {
    #[default]
    Unprepared,
    Transparent,
    Prepared,
    Recorded,
    Untracked,
    UnsupportedBackend,
    StalePreparation,
    Clipped,
    PaintRefused,
}

#[derive(Clone, Copy, Default)]
struct DossierFoxingPaintReceipt {
    window: Option<WindowId>,
    active_image: Option<ImageId>,
    status: DossierFoxingPaintStatus,
}
