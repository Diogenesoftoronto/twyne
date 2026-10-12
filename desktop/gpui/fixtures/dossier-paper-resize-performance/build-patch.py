#!/usr/bin/env python3
"""Build a diagnostic-only proposal without writing any shared source."""

from pathlib import Path
import argparse
import difflib
import hashlib
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def replace_once(value: str, old: str, new: str) -> str:
    if value.count(old) != 1:
        raise SystemExit(f"Expected one current seam, found {value.count(old)}: {old[:90]!r}")
    return value.replace(old, new, 1)


def edit_function(value: str, signature: str, edit) -> str:
    start = value.index(signature)
    end = value.index("\n    }\n", start) + len("\n    }\n")
    old = value[start:end]
    return replace_once(value, old, edit(old))


def timing_start(kind: str, *, metrics=False, indent="        ") -> str:
    owner = "resize_diagnostics" if kind == "Paper" else "crate::dossier_paper::resize_diagnostics"
    constructor = (
        f"{owner}::Operation::for_metrics({owner}::Kind::{kind}, metrics)"
        if metrics
        else f"{owner}::Operation::for_window({owner}::Kind::{kind}, window)"
    )
    return f'{indent}#[cfg(feature = "ui-tests")]\n{indent}let mut diagnostic = {constructor};\n'


def mark(phase: str, indent="        ") -> str:
    return (
        f'{indent}#[cfg(feature = "ui-tests")]\n'
        f"{indent}diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::{phase});\n"
    )


def outcome(label: str, indent="        ") -> str:
    return f'{indent}#[cfg(feature = "ui-tests")]\n{indent}diagnostic.outcome("{label}");\n'


def paper(value: str) -> str:
    value = replace_once(
        value,
        "/// The exact Source selectors extracted in the owned source-contract fixture.\n",
        '#[cfg(feature = "ui-tests")]\n'
        '#[path = "../fixtures/dossier-paper-resize-performance/diagnostics.rs"]\n'
        'pub(crate) mod resize_diagnostics;\n\n'
        "/// The exact Source selectors extracted in the owned source-contract fixture.\n",
    )

    def edit(body):
        body = replace_once(body, "        let colors = PaperColors::from_palette(palette)?;\n", timing_start("Paper", metrics=True) + "        let colors = PaperColors::from_palette(palette)?;\n")
        body = replace_once(body, "        let mut cache = cache()\n", mark("Validation") + "        let mut cache = cache()\n")
        body = replace_once(body, "        if let Some(index) = cache.ready.iter().position(|paper| paper.key == key) {\n", mark("CacheWait") + '        #[cfg(feature = "ui-tests")]\n        diagnostic.cache_before(cache.ready.len());\n' + "        if let Some(index) = cache.ready.iter().position(|paper| paper.key == key) {\n")
        body = replace_once(body, "            return Ok(paper);\n", mark("CacheLookup", "            ") + outcome("cacheHit", "            ") + "            return Ok(paper);\n")
        body = replace_once(body, "        let svg: Arc<str> = background_svg(colors, metrics).into();\n", mark("CacheLookup") + "        let svg: Arc<str> = background_svg(colors, metrics).into();\n" + mark("SvgBuild"))
        body = replace_once(body, "        let parsed = renderer.parse_svg(svg.as_bytes())?;\n", "        let parsed = renderer.parse_svg(svg.as_bytes())?;\n" + mark("RendererAndParse"))
        body = replace_once(body, "        let paper = Arc::new(Self {\n", mark("RasterAndBgraConversion") + "        let paper = Arc::new(Self {\n")
        body = replace_once(body, "        cache.ready.truncate(CACHE_ENTRIES);\n", '        #[cfg(feature = "ui-tests")]\n        diagnostic.evictions(cache.ready.len().saturating_sub(CACHE_ENTRIES));\n' + "        cache.ready.truncate(CACHE_ENTRIES);\n" + mark("InstallAndEviction") + outcome("cacheMissPrepared"))
        return body

    return edit_function(value, "    pub fn prepare(palette: Palette, metrics: DossierPaperMetrics)", edit)


def multiply(value: str) -> str:
    def edit(body):
        body = replace_once(body, "        let key = MultiplyKey::new(palette, metrics)?;\n", timing_start("Multiply", metrics=True) + "        let key = MultiplyKey::new(palette, metrics)?;\n" + mark("Validation"))
        body = replace_once(body, "        if let Some(index) = cache.iter().position(|ready| ready.key == key) {\n", mark("CacheWait") + '        #[cfg(feature = "ui-tests")]\n        diagnostic.cache_before(cache.len());\n' + "        if let Some(index) = cache.iter().position(|ready| ready.key == key) {\n")
        body = replace_once(body, "            return Ok(ready);\n", mark("CacheLookup", "            ") + outcome("cacheHit", "            ") + "            return Ok(ready);\n")
        body = replace_once(body, "        let svg: Arc<str> = foxing_group_svg(palette, metrics)?.into();\n", mark("CacheLookup") + "        let svg: Arc<str> = foxing_group_svg(palette, metrics)?.into();\n" + mark("SvgBuild"))
        body = replace_once(body, "            let (width, height) = metrics.raster_size();\n", mark("RendererAndParse", "            ") + "            let (width, height) = metrics.raster_size();\n")
        body = replace_once(body, "            validate_premultiplied_bgra(premultiplied.as_bytes(0).unwrap())?;\n", mark("RasterAndBgraConversion", "            ") + "            validate_premultiplied_bgra(premultiplied.as_bytes(0).unwrap())?;\n" + mark("PremultipliedValidation", "            "))
        body = replace_once(body, "        cache.truncate(MULTIPLY_CACHE_ENTRIES);\n", '        #[cfg(feature = "ui-tests")]\n        diagnostic.evictions(cache.len().saturating_sub(MULTIPLY_CACHE_ENTRIES));\n' + "        cache.truncate(MULTIPLY_CACHE_ENTRIES);\n" + mark("InstallAndEviction") + outcome("cacheMissPrepared"))
        body = replace_once(body, '        diagnostic.outcome("cacheMissPrepared");\n', '        diagnostic.outcome(if palette.foxing_alpha == 0. { "cacheMissTransparent" } else { "cacheMissPrepared" });\n')
        return body

    return edit_function(value, "    pub fn prepare(palette: Palette, metrics: DossierPaperMetrics)", edit)


def view(value: str) -> str:
    value = replace_once(
        value,
        "        subscriptions.push(cx.observe_window_bounds(window, |this, window, cx| {\n            this.prepare_paper(window, cx);\n        }));\n",
        "        subscriptions.push(cx.observe_window_bounds(window, |this, window, cx| {\n"
        + timing_start("BoundsObserver", indent="            ")
        + "            this.prepare_paper(window, cx);\n"
        + outcome("returned", "            ")
        + "        }));\n",
    )
    value = replace_once(
        value,
        "            |this, window, cx| {\n                this.prepare_paper(window, cx);\n            },\n",
        "            |this, window, cx| {\n"
        + timing_start("PaletteObserver", indent="                ")
        + "                this.prepare_paper(window, cx);\n"
        + outcome("returned", "                ")
        + "            },\n",
    )

    def host(body):
        body = replace_once(body, "        // A retained unmounted form is not a new consumer on a theme event.\n", timing_start("HostPreparation") + "        // A retained unmounted form is not a new consumer on a theme event.\n")
        body = replace_once(body, "            return;\n", outcome("retiredLeaseSkipped", "            ") + "            return;\n") if body.count("            return;\n") == 1 else replace_once(body, "        {\n            return;\n        }\n", "        {\n" + outcome("retiredLeaseSkipped", "            ") + "            return;\n        }\n")
        body = replace_once(body, "                eprintln!(\"Could not track Dossier prepared images: {error:#}\");\n", outcome("leaseRefused", "                ") + "                eprintln!(\"Could not track Dossier prepared images: {error:#}\");\n")
        body = replace_once(
            body,
            "            if let Err(error) = lease.replace(&self.prepared_images(), window, cx) {\n",
            '            #[cfg(feature = "ui-tests")]\n'
            '            let lease_started = std::time::Instant::now();\n'
            '            let replacement = lease.replace(&self.prepared_images(), window, cx);\n'
            '            #[cfg(feature = "ui-tests")]\n'
            '            diagnostic.measure_since(crate::dossier_paper::resize_diagnostics::Phase::LeaseReplacement, lease_started);\n'
            '            if let Err(error) = replacement {\n',
        )
        body = replace_once(body, "        self.commit_foxing_receipt(window);\n", "        self.commit_foxing_receipt(window);\n" + outcome("returned"))
        return body

    value = edit_function(value, "    pub fn prepare_paper(&mut self, window: &Window, cx: &mut Context<Self>)", host)

    def candidate(body):
        body = replace_once(body, "        self.prepare_reviewed_stamps(window, cx);\n", timing_start("CandidatePreparation") + "        self.prepare_reviewed_stamps(window, cx);\n")
        body = replace_once(body, "            return;\n", outcome("paperKeyMatched", "            ") + "            return;\n")
        body = replace_once(body, "        cx.notify();\n", outcome("returned") + "        cx.notify();\n")
        return body

    value = edit_function(value, "    fn prepare_paper_candidate(&mut self, window: &Window, cx: &mut Context<Self>)", candidate)

    def stamps(body):
        body = replace_once(body, "        let color = theme::palette(cx).vermilion;\n", timing_start("StampBoundary") + "        let color = theme::palette(cx).vermilion;\n")
        body = replace_once(body, "            return;\n", outcome("retainedKeyMatched", "            ") + "            return;\n")
        body = replace_once(body, "            Ok(set) => self.reviewed_stamps = Some(set),\n", '            Ok(set) => {\n' + outcome("prepareReturnedSet", "                ") + '                self.reviewed_stamps = Some(set);\n            }\n')
        body = replace_once(body, "            Err(error) => {\n", "            Err(error) => {\n" + outcome("failed", "                "))
        return body

    return edit_function(value, "    fn prepare_reviewed_stamps(&mut self, window: &Window, cx: &mut Context<Self>)", stamps)


def capture(value: str) -> str:
    return replace_once(
        value,
        '        "scaleFactor": window.scale_factor(),\n',
        '        "scaleFactor": window.scale_factor(),\n'
        '        "dossierPreparationCpu": twyne_desktop::dossier_paper::resize_diagnostic_snapshot(),\n',
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    files = {
        "desktop/gpui/src/dossier_paper.rs": paper,
        "desktop/gpui/src/dossier_multiply.rs": multiply,
        "desktop/gpui/src/dossier_view.rs": view,
        "desktop/gpui/src/capture_geometry.rs": capture,
    }
    diffs = []
    pins = []
    for path, transform in files.items():
        before = (ROOT / path).read_text()
        after = transform(before)
        if path.endswith("dossier_paper.rs"):
            seam = '\n/// The exact Source selectors extracted in the owned source-contract fixture.\n'
            after = replace_once(after, seam, '\n#[cfg(feature = "ui-tests")]\npub fn resize_diagnostic_snapshot() -> serde_json::Value {\n    resize_diagnostics::snapshot()\n}\n' + seam)
        diffs.extend(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile="a/" + path, tofile="b/" + path))
        pins.append({"path": path, "sha256": sha(before.encode()), "proposedSha256": sha(after.encode())})
    patch = "".join(diffs)
    base = json.dumps({"schemaVersion": 1, "status": "unapplied_uncompiled_unexecuted", "sharedInputs": pins}, indent=2) + "\n"
    outputs = {"instrumentation.patch": patch, "patch-base.json": base}
    if args.check:
        for name, value in outputs.items():
            if (HERE / name).read_text() != value:
                raise SystemExit(f"Current source/patch drift: {name}")
        print("Current four-file diagnostic proposal matches shared read-only inputs")
    else:
        for name, value in outputs.items():
            (HERE / name).write_text(value)
        print("Wrote unapplied diagnostic proposal within exclusive fixture ownership")


if __name__ == "__main__":
    main()
