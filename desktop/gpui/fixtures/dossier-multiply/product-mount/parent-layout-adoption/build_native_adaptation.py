#!/usr/bin/env python3
"""Author separate unapplied observation/driver deltas, never alter originals."""
from pathlib import Path
import ast
import difflib
import hashlib
import json


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]
DRIVER = "desktop/gpui/fixtures/dossier-image-lifecycle/native-proof/check-native.py"
APP = "desktop/gpui/src/app.rs"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def replace_once(text, old, new):
    assert text.count(old) == 1, (old[:160], text.count(old))
    return text.replace(old, new, 1)


def diff(name, before, after):
    return "".join(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
        fromfile=f"a/{name}", tofile=f"b/{name}", n=4))


def main():
    app = (ROOT / APP).read_text()
    app_after = replace_once(app,
        '            "standaloneRoute": self.standalone_route(),\n        });\n        Some(snapshot)\n',
        '''            "standaloneRoute": self.standalone_route(),
        });
        // Observation only: no retained image Arc, upload, refresh or mutation.
        snapshot["foxing"] = self.dossier.as_ref().map_or(serde_json::Value::Null, |view| {
            let view = view.read(cx);
            let prepared = view.prepared_multiply();
            serde_json::json!({
                "prepared": prepared.is_some(),
                "transparent": prepared.map(|ready| ready.is_transparent()),
                "imageId": prepared.and_then(|ready| ready.premultiplied_group())
                    .map(|image| image.id.0.to_string()),
                "logicalWidth": prepared.map(|ready| ready.metrics().width()),
                "logicalHeight": prepared.map(|ready| ready.metrics().height()),
                "scaleFactor": prepared.map(|ready| ready.metrics().scale_factor()),
                "paintStatus": format!("{:?}", view.foxing_paint_status()),
                "supportsDestinationMultiply": window.supports_destination_multiply(),
            })
        });
        Some(snapshot)
''')
    (HERE / "native-observation.patch").write_text(diff(APP, app, app_after))
    original = (ROOT / DRIVER).read_text()
    driver = replace_once(original, "def owned_class(helper):\n", (HERE / "native_driver_helpers.py").read_text() +
        "\n\ndef owned_class(helper, expected_support):\n")
    driver = replace_once(driver,
        '    parser.add_argument("--output", type=Path, help="Fresh nonexistent private output directory")\n',
        '    parser.add_argument("--output", type=Path, help="Fresh nonexistent private output directory")\n'
        '    parser.add_argument("--expect-multiply", choices=("supported", "unsupported", "any"), default="supported",\n'
        '                        help="Observed Window backend policy; default requires actual supported product recording/upload")\n')
    driver = replace_once(driver, "        ui = owned_class(helper)(binary, output, fixture)\n",
        "        ui = owned_class(helper, args.expect_multiply)(binary, output, fixture)\n")
    driver = driver.replace('active=9', 'active="prepared"')
    driver = replace_once(driver,
        '                and (active is None or state["dossierImageLifecycle"]["activeCount"] == active)\n'
        '                and (active != 9 or sum(image["atlasPresent"] for image in state["dossierImageLifecycle"]["images"]) >= 2)\n',
        '                and (active is None or (prepared_mount_ready(state, expected_support) if active == "prepared"\n'
        '                     else state["dossierImageLifecycle"]["activeCount"] == active))\n')
    driver = replace_once(driver,
        '            return self.wait_state(f"actual resize {width}x{height}", lambda state:\n',
        '            self.wait_state(f"actual resize {width}x{height}", lambda state:\n')
    driver = replace_once(driver,
        '                        for image in state["dossierImageLifecycle"]["images"]))\n\n        def scroll_to',
        '                        for image in state["dossierImageLifecycle"]["images"]))\n'
        '            return self.ready_lifecycle("actual resized product preparation", active="prepared")\n\n        def scroll_to')
    driver = replace_once(driver,
        '        initial_ids = set(image_map(initial))\n',
        '        initial_ids = set(image_map(initial))\n'
        '        initial_group = observed_foxing(initial)["imageId"]\n'
        '        expected_initial_uploaded = expected_uploaded_ids(initial)\n')
    driver = replace_once(driver,
        '        passed("Actual form attaches nine prepared image IDs to the observed window; painted keys are distinct from CPU preparations")\n',
        '        passed("Actual form retains nine real ordinary preparations plus the observed optional foxing group; CPU refs and atlas uploads stay distinct",\n'
        '               {"foxing": observed_foxing(initial), "preparedCount": len(initial_ids),\n'
        '                "actualUploadedIds": sorted(uploaded_ids(initial))})\n')
    driver = replace_once(driver,
        '        state = ui.ready_lifecycle("all eight actual stamp variants uploaded", active="prepared", ids=initial_ids, painted=initial_ids)\n',
        '        state = ui.ready_lifecycle("all eight actual stamp variants uploaded", active="prepared", ids=initial_ids, painted=expected_initial_uploaded)\n'
        '        initial_uploaded = uploaded_ids(state["dossierImageLifecycle"])\n'
        '        require(initial_uploaded == expected_initial_uploaded, "Observed upload set must include all nine ordinary images and only the admitted optional group")\n')
    driver = replace_once(driver,
        '        old_paper, new_paper = initial_ids - new_ids, new_ids - initial_ids\n'
        '        require(len(old_paper) == len(new_paper) == 1, "Observed resize must change only the actual paper image at fixed DPR/palette")\n'
        '        resize_proof = ui.prove_retired(old_paper, sequence, old_paper)\n',
        '        old_viewport, new_viewport = initial_ids - new_ids, new_ids - initial_ids\n'
        '        resized_group = observed_foxing(resized["dossierImageLifecycle"])["imageId"]\n'
        '        require(len(old_viewport) == 1 + int(initial_group is not None)\n'
        '                and len(new_viewport) == 1 + int(resized_group is not None),\n'
        '                "Resize must replace paper plus the optional full-viewport group, preserving eight stamp IDs")\n'
        '        if initial_group is not None:\n'
        '            require(initial_group in old_viewport and resized_group in new_viewport, "Viewport group ID did not replace with paper")\n'
        '        resized_uploaded = uploaded_ids(resized["dossierImageLifecycle"])\n'
        '        resize_proof = ui.prove_retired(old_viewport, sequence, old_viewport & initial_uploaded)\n')
    driver = replace_once(driver,
        '        passed("Real resize retains stamp keys and removes the old uploaded paper only after qualified refresh/marker/deferred drop", resize_proof)\n',
        '        passed("Real resize retains all eight stamp keys and retires old paper/optional group after qualified marker/deferred drops", resize_proof)\n')
    driver = replace_once(driver,
        '        restored = ui.ready_lifecycle("same cached paper ID actually reuploaded", active="prepared", ids=initial_ids, painted=initial_ids)\n'
        '        resize_back = ui.prove_retired(new_paper, sequence, new_paper)\n',
        '        restored = ui.ready_lifecycle("same cached viewport IDs actually reuploaded", active="prepared", ids=initial_ids, painted=expected_initial_uploaded)\n'
        '        resize_back = ui.prove_retired(new_viewport, sequence, new_viewport & resized_uploaded)\n')
    driver = replace_once(driver,
        '        route_proof = ui.prove_retired(initial_ids, sequence, initial_ids)\n',
        '        route_proof = ui.prove_retired(initial_ids, sequence, initial_uploaded)\n')
    driver = replace_once(driver,
        '        "checks": [], "limits": [\n',
        '        "expectedMultiplyBackend": args.expect_multiply,\n'
        '        "productGroupProof": "Actual observed optional ID/count/status/upload/retirement; not Source radial raster equivalence",\n'
        '        "checks": [], "limits": [\n')
    driver = replace_once(driver,
        '            "DPR1 only; no occlusion/device recovery/multiwindow/global memory/sustained stress proof",\n',
        '            "DPR1 only; no occlusion/device recovery/multiwindow/global memory/sustained stress proof",\n'
        '            "Recorded is a scene admission observation, not a presentation/GPU-completion or exact Source foxing-raster receipt",\n')
    assert 'active=9' not in driver and 'active != 9' not in driver
    ast.parse(driver, filename=DRIVER)
    (HERE / "native-driver-adaptation.patch").write_text(diff(DRIVER, original, driver))
    (HERE / "native-adaptation-pins.json").write_text(json.dumps({
        "schema": 1, "status": "Unapplied independent post-mount observation/driver adaptation",
        "baseSha256": {APP: digest(app.encode()), DRIVER: digest(original.encode())},
        "proposedSha256": {APP: digest(app_after.encode()), DRIVER: digest(driver.encode())},
        "noSharedWrites": True, "realOrdinaryFontGateStillNine": True,
        "driverOrNativeExecuted": False,
    }, indent=2) + "\n")
    print(json.dumps({"observationPatchTarget": APP, "driverPatchTarget": DRIVER,
        "proposedDriverAst": "parsed", "sharedFilesWritten": False, "driverExecuted": False}, indent=2))


if __name__ == "__main__":
    main()
