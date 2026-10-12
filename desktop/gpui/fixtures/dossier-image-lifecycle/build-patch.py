#!/usr/bin/env python3
"""Build an UNAPPLIED proposal; write only in this owned fixture directory."""
from pathlib import Path
import difflib
import hashlib
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError(f"Proposal anchor is not unique: {old[:100]!r}")
    return text.replace(old, new, 1)


changed = {}
path = "desktop/gpui/src/lib.rs"
before = (ROOT / path).read_text()
after = replace_once(before, 'pub mod dossier_filing;\n', 'pub mod dossier_filing;\n#[cfg(feature = "desktop")]\npub mod dossier_image_lifecycle;\n')
changed[path] = (before, after)

path = "desktop/gpui/src/dossier_view.rs"
before = (ROOT / path).read_text()
after = replace_once(before, '    dossier_paper::{DossierPaper, DossierPaperMetrics},\n', '    dossier_image_lifecycle::{DossierImageLease, DossierImageLifecycle},\n    dossier_paper::{DossierPaper, DossierPaperMetrics},\n')
after = replace_once(after, '    paper: Option<Arc<DossierPaper>>,\n', '    image_lease: Option<DossierImageLease>,\n    paper: Option<Arc<DossierPaper>>,\n')
after = replace_once(after, '            paper: None,\n', '            image_lease: None,\n            paper: None,\n')
methods = '''    /// The root attaches this before mounting a newly created form.
    pub fn attach_image_lifecycle(
        &mut self,
        lifecycle: &DossierImageLifecycle,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Result<()> {
        anyhow::ensure!(self.image_lease.is_none(), "Dossier images are already attached");
        let lease = lifecycle.lease(window, cx)?;
        lease.replace(&self.prepared_images(), window, cx)?;
        self.image_lease = Some(lease);
        Ok(())
    }

    pub fn image_lease(&self) -> Option<&DossierImageLease> {
        self.image_lease.as_ref()
    }

    fn prepared_images(&self) -> Vec<Arc<gpui_kit::RenderImage>> {
        let mut images = Vec::with_capacity(10);
        if let Some(paper) = &self.paper {
            images.push(paper.raster_image().clone());
        }
        if let Some(stamps) = &self.reviewed_stamps {
            for count in 0..crate::dossier_stamp::COUNT_VARIANTS {
                images.push(stamps.stamp(count).expect("Complete prepared stamp set").raster_image().clone());
            }
        }
        // Product multiply is currently unmounted. When integrated, include
        // its premultiplied_group() here ONLY as an optional tenth image.
        images
    }

    pub fn prepare_paper(&mut self, window: &Window, cx: &mut Context<Self>) {
        // A retained unmounted form is not a new consumer on a theme event.
        if self.image_lease.as_ref().is_some_and(|lease| !lease.is_current()) {
            return;
        }
        let previous_paper = self.paper.clone();
        let previous_stamps = self.reviewed_stamps.clone();
        self.prepare_paper_candidate(window, cx);
        if let Some(lease) = &self.image_lease {
            if let Err(error) = lease.replace(&self.prepared_images(), window, cx) {
                // Candidate preparation cannot upload. Preserve the accepted
                // pointers/lease on refusal, rather than paint untracked data.
                // Existing paint guards refuse a now-stale palette/DPR.
                self.paper = previous_paper;
                self.reviewed_stamps = previous_stamps;
                self.error = Some("The Dossier paper could not be prepared. Your answers remain here.".into());
                eprintln!("Could not track Dossier prepared images: {error:#}");
                cx.notify();
            }
        }
    }

    fn prepare_paper_candidate(&mut self, window: &Window, cx: &mut Context<Self>) {
'''
after = replace_once(after, '    pub fn prepare_paper(&mut self, window: &Window, cx: &mut Context<Self>) {\n', methods)
changed[path] = (before, after)

path = "desktop/gpui/src/app.rs"
before = (ROOT / path).read_text()
after = replace_once(before, '    dossier_view::{DossierEvent, DossierView},\n', '    dossier_image_lifecycle::DossierImageLifecycle,\n    dossier_view::{DossierEvent, DossierView},\n')
after = replace_once(after, '    dossier: Option<Entity<DossierView>>,\n', '    dossier_images: Option<DossierImageLifecycle>,\n    dossier: Option<Entity<DossierView>>,\n')
after = replace_once(after, '            dossier: None,\n', '''            dossier_images: DossierImageLifecycle::new(window, cx)
                .map_err(|error| eprintln!("Dossier image retirement is unavailable: {error:#}"))
                .ok(),
            dossier: None,
''')
after = replace_once(after, '                let view = cx.new(|cx| DossierView::new(session, window, cx));\n', '''                let view = cx.new(|cx| DossierView::new(session, window, cx));
                if let Some(lifecycle) = &self.dossier_images {
                    if let Err(error) = view.update(cx, |view, cx| {
                        view.attach_image_lifecycle(lifecycle, window, cx)
                    }) {
                        self.error = Some(format!("Could not prepare the Dossier: {error:#}"));
                        cx.notify();
                        return;
                    }
                }
''')
after = replace_once(after, '        self.sync_math_source_presence(cx);\n', '''        if let Some(lifecycle) = &self.dossier_images {
            // Same condition as the actual child mount below. Failed departure
            // still keeps the current form; retained old entities lose leases.
            let keep = self.dossier.as_ref()
                .filter(|_| !self.standalone_route())
                .and_then(|view| view.read(cx).image_lease().cloned());
            if let Err(error) = lifecycle.retain_only(keep.as_ref(), window, cx) {
                self.error = Some(format!("Could not update Dossier paper ownership: {error:#}"));
            }
        }
        self.sync_math_source_presence(cx);
''')
after = replace_once(after, '''                    .when_some(self.inline_margin_card(window, cx), |this, card| {
                        this.child(card)
                    })
            })
''', '''                    .when_some(self.inline_margin_card(window, cx), |this, card| {
                        this.child(card)
                    })
            })
            // Persistent, including after Dossier removal and on every route.
            .when_some(self.dossier_images.as_ref(), |this, lifecycle| {
                this.child(lifecycle.marker())
            })
''')
changed[path] = (before, after)

patch = []
pins = []
for path, (before, after) in changed.items():
    patch.extend(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile=f"a/{path}", tofile=f"b/{path}"))
    pins.append({"path": path, "baseSha256": hashlib.sha256(before.encode()).hexdigest(), "proposedSha256": hashlib.sha256(after.encode()).hexdigest()})
(HERE / "integration.patch").write_text("".join(patch))
(HERE / "patch-base.json").write_text(json.dumps({"applied": False, "files": pins}, indent=2) + "\n")
print(json.dumps({"applied": False, "files": len(changed), "patchBytes": sum(len(part.encode()) for part in patch)}))
