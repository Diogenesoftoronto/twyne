#!/usr/bin/env python3
"""Actual Dossier atlas-key lifecycle on one freshly owned Xvfb/XTEST.

Authoring/syntax checks are not native execution receipts. Parent must review
and apply integration.patch, build a ui-tests binary, then run this driver.
"""

import argparse
import ctypes as C
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import traceback


HERE = Path(__file__).resolve().parent.parent
ROOT = HERE.parents[4]
HELPER = ROOT / "desktop/gpui/fixtures/dossier-native/check-native.py"
MAX_OBSERVED_EVENTS = 1024
MAX_WHEEL_STEPS = 18
TITLE = "atlas keeps this title!"
AUDIENCE = "local answers stay here\nthrough resize and refusal!"


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")


def load_helper():
    pins = json.loads((HERE / "source-pins.json").read_text(encoding="utf8"))
    key = str(HELPER.relative_to(ROOT))
    require(digest(HELPER) == pins["sourceSha256"][key], "Reviewed isolated-display helper changed; Parent must review the dependency, not silently accept it")
    spec = importlib.util.spec_from_file_location("twyne_dossier_isolated_helper", HELPER)
    require(spec is not None and spec.loader is not None, "Could not load the pinned owned-Xvfb helper")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def image_map(lifecycle):
    return {image["id"]: image for image in lifecycle["images"]}


def all_present(lifecycle, ids):
    images = image_map(lifecycle)
    return all(identifier in images and images[identifier]["atlasPresent"] for identifier in ids)


"""Unapplied pure predicates inserted into the existing native proof driver.

No native/window/atlas operation is performed by these helpers. Synthetic tests
exercise observation validation, never create a successful native receipt.
The original driver's require() is supplied by the insertion context.
"""


def observed_foxing(lifecycle):
    foxing = lifecycle.get("foxing")
    require(isinstance(foxing, dict), "Reviewed product foxing observation hook is absent")
    require(isinstance(foxing.get("supportsDestinationMultiply"), bool),
            "Backend support must be an actual Window observation")
    require(isinstance(foxing.get("prepared"), bool), "Missing actual preparation observation")
    return foxing


def prepared_mount_ready(state, expected_support):
    lifecycle = state["dossierImageLifecycle"]
    foxing = observed_foxing(lifecycle)
    if lifecycle["invalidationQueued"] or lifecycle["pendingCount"] != 0 or not foxing["prepared"]:
        return False
    require(isinstance(foxing.get("transparent"), bool), "Missing prepared transparency observation")
    if expected_support != "any":
        require(foxing["supportsDestinationMultiply"] is (expected_support == "supported"),
                "Actual backend support differs from the requested native proof lane")
    viewport = state["viewport"]
    if foxing["logicalWidth"] != viewport["width"] or foxing["logicalHeight"] != viewport["height"] \
            or foxing["scaleFactor"] != state["scaleFactor"]:
        return False
    images = image_map(lifecycle)
    identifier = foxing.get("imageId")
    if foxing["transparent"]:
        require(identifier is None, "Transparent preparation must not own a group image")
        if foxing["paintStatus"] != "Transparent":
            return False
    else:
        require(isinstance(identifier, str) and identifier, "Nontransparent preparation must expose its exact image ID")
        if identifier not in images or not images[identifier]["active"]:
            return False
        if foxing["supportsDestinationMultiply"]:
            if foxing["paintStatus"] != "Recorded" or not images[identifier]["atlasPresent"]:
                return False
        else:
            if foxing["paintStatus"] != "UnsupportedBackend":
                return False
            require(not images[identifier]["atlasPresent"],
                    "Unsupported product backend must not upload its premultiplied group")
    ordinary = {key: value for key, value in images.items() if key != identifier}
    # This REAL native lane never relaxes the original-font stamp gate.
    # Default NoopTextSystem test preparation is not admitted here.
    return len(ordinary) == 9 and lifecycle["activeCount"] == 9 + int(identifier is not None) \
        and all(image["active"] for image in ordinary.values()) \
        and sum(image["atlasPresent"] for image in ordinary.values()) >= 2


def expected_uploaded_ids(lifecycle):
    foxing = observed_foxing(lifecycle)
    identifiers = set(image_map(lifecycle))
    # Call only after the original real navigation uploads ALL eight stamp
    # variants. Before that, this is an expectation, not an upload observation.
    if not foxing["supportsDestinationMultiply"] and foxing.get("imageId") is not None:
        identifiers.remove(foxing["imageId"])
    return identifiers


def uploaded_ids(lifecycle):
    return {identifier for identifier, image in image_map(lifecycle).items() if image["atlasPresent"]}


def owned_class(helper, expected_support):
    class AtlasNative(helper.Native):
        def __init__(self, binary, output, fixture):
            self.observed_events = []
            self.seen_sequence = 0
            self.proof_window = None
            self.last_sample = 0
            self.last_pulse = 0.0
            self.pulse_corner = False
            self.owned_window = None
            super().__init__(binary, output, fixture)
            self.x.XResizeWindow.argtypes = [C.c_void_p, C.c_ulong, C.c_uint, C.c_uint]

        def state(self):
            state = super().state()
            lifecycle = state.get("dossierImageLifecycle")
            require(isinstance(lifecycle, dict) and lifecycle.get("schemaVersion") == 1,
                    "ui-tests lifecycle observation hook is absent; do not infer atlas state from pixels/CPU refs")
            require(lifecycle.get("applicationQualified") is True and lifecycle.get("windowId") == state.get("windowId"),
                    "Lifecycle observation must belong to the captured real WindowId and App")
            require(state.get("scaleFactor") == 1, "This isolated XTEST driver admits only observed DPR1; it does not prove DPR transitions")
            require(not lifecycle["eventSequenceExhausted"] and not lifecycle["imagesTruncated"],
                    "Truncated or exhausted image observations cannot establish the requested key proof")
            require(lifecycle["eventLimit"] == 128 and lifecycle["imageLimit"] == 64
                    and len(lifecycle["events"]) <= 128 and len(lifecycle["images"]) <= 64,
                    "Diagnostic bound contract changed")
            require(lifecycle["trackedCount"] == len(lifecycle["images"])
                    and lifecycle["activeCount"] + lifecycle["pendingCount"] == lifecycle["trackedCount"],
                    "Observed active/pending accounting is inconsistent")
            require(not lifecycle["closed"] and not lifecycle["exhausted"], "Live registry is closed/exhausted")
            if self.proof_window is None:
                self.proof_window = lifecycle["windowId"]
            require(self.proof_window == lifecycle["windowId"], "Observed window owner changed within this process")
            sequence = int(state["captureSequence"])
            require(sequence >= self.last_sample, "Capture observation sequence moved backward")
            self.last_sample = sequence
            for event in lifecycle["events"]:
                current = int(event["sequence"])
                if current <= self.seen_sequence:
                    continue
                require(current == self.seen_sequence + 1,
                        "Lifecycle ring truncated an unobserved event; this run cannot prove ordering")
                require(event["windowQualified"] and event["windowId"] == self.proof_window
                        and event["registryWindowId"] == self.proof_window and not event["imagesTruncated"],
                        "Trace row lost real owner qualification or image coverage")
                require(len(self.observed_events) < MAX_OBSERVED_EVENTS, "Observed event corpus exceeded its explicit bound")
                self.seen_sequence = current
                retained = {"launch": self.launches, **event}
                self.observed_events.append(retained)
                with (self.output / "observed-lifecycle.jsonl").open("a", encoding="utf8") as stream:
                    stream.write(json.dumps(retained, ensure_ascii=False) + "\n")
            require(self.seen_sequence == int(lifecycle["latestEventSequence"]), "Capture omitted the latest real lifecycle event")
            return state

        def pulse(self):
            # Real harmless pointer motion only. No debug action, synthetic
            # frame receipt, forced refresh API or manual Window::draw.
            if time.monotonic() - self.last_pulse < 0.12 or not hasattr(self, "geometry"):
                return
            try:
                state = helper.json_file(self.geometry)
            except (FileNotFoundError, json.JSONDecodeError):
                return
            origin, viewport = state["windowOrigin"], state["viewport"]
            require(viewport["width"] >= 10 and viewport["height"] >= 10, "Owned viewport became too small")
            self.pulse_corner = not self.pulse_corner
            x = origin["x"] + (2 if self.pulse_corner else 5)
            y = origin["y"] + 2
            require(self.t.XTestFakeMotionEvent(self.connection, 0, round(x), round(y), 0), "Owned pointer pulse failed")
            self.x.XFlush(self.connection)
            self.last_pulse = time.monotonic()

        def wait(self, description, read, predicate=lambda value: bool(value)):
            deadline = time.monotonic() + helper.TIMEOUT
            while time.monotonic() < deadline:
                self.alive()
                self.pulse()
                try:
                    value = read()
                    if predicate(value):
                        return value
                except (FileNotFoundError, json.JSONDecodeError):
                    pass
                time.sleep(0.03)
            raise TimeoutError(f"20-second native deadline: {description}")

        def start(self, import_fixture=False):
            self.seen_sequence = self.last_sample = 0
            self.proof_window = None
            super().start(import_fixture)
            # Query this private display, never a caller/user desktop.
            root, parent = C.c_ulong(), C.c_ulong()
            children, count = C.POINTER(C.c_ulong)(), C.c_uint()
            require(self.x.XQueryTree(self.connection, self.x.XDefaultRootWindow(self.connection), C.byref(root),
                                     C.byref(parent), C.byref(children), C.byref(count)), "Owned window tree unavailable")
            matches = []
            try:
                for index in range(count.value):
                    name = C.c_void_p()
                    if self.x.XFetchName(self.connection, children[index], C.byref(name)) and name.value:
                        try:
                            if C.string_at(name.value) == b"Twyne":
                                matches.append(children[index])
                        finally:
                            self.x.XFree(name)
            finally:
                if children:
                    self.x.XFree(children)
            require(len(matches) == 1, "Exactly one owned native Twyne window is required")
            self.owned_window = matches[0]

        def visible(self, state, target):
            if not super().visible(state, target):
                return False
            # The original helper already checks Dossier scrollers. Extend
            # it to the actual drawer/settings scroller used by this lane.
            rect = target["rect"]
            for identifier in ("drawer-content", "settings-page", "house-page"):
                if f'Name("{identifier}")' not in target["path"]:
                    continue
                ancestor = self.node(state, identifier)
                require(ancestor is not None, f"Actual {identifier} clip is missing")
                clip = ancestor["rect"]
                if not (rect["x"] >= clip["x"] and rect["y"] >= clip["y"]
                        and rect["x"] + rect["width"] <= clip["x"] + clip["width"]
                        and rect["y"] + rect["height"] <= clip["y"] + clip["height"]):
                    return False
            return True

        def click_observed(self, description, locate):
            previous_sequence = previous_geometry = None
            stable = 0

            def settled(state):
                nonlocal previous_sequence, previous_geometry, stable
                target = locate(state)
                if not self.visible(state, target) or target.get("disabled") is True:
                    stable = 0
                    return False
                sequence = (self.launches, state["windowId"], state["captureSequence"])
                if sequence == previous_sequence:
                    return False
                previous_sequence = sequence
                question = self.node(state, "dossier-active-question")
                sheet = self.node(state, "dossier-question-sheet")
                current = (target["path"], target["rect"], state["windowOrigin"], state["viewport"],
                           question["rect"] if question else None, sheet["rect"] if sheet else None)
                stable = stable + 1 if current == previous_geometry else 1
                previous_geometry = current
                return stable >= 2

            state = self.wait_state(f"two fresh identical fully visible bounds for {description}", settled)
            target = locate(state)
            rect, origin = target["rect"], state["windowOrigin"]
            require(self.t.XTestFakeMotionEvent(self.connection, 0,
                    round(origin["x"] + rect["x"] + rect["width"] / 2),
                    round(origin["y"] + rect["y"] + rect["height"] / 2), 0), "Actual pointer target failed")
            require(self.t.XTestFakeButtonEvent(self.connection, 1, 1, 0)
                    and self.t.XTestFakeButtonEvent(self.connection, 1, 0, 0), "Actual click failed")
            self.x.XFlush(self.connection)
            time.sleep(0.07)

        def click(self, identifier):
            self.click_observed(str(identifier), lambda state: self.node(state, identifier))

        def click_menu(self, label):
            def locate(state):
                rows = [row for row in state["elements"] if row.get("role") == "MenuItem"
                        and row.get("label") == label and row.get("visible")]
                require(len(rows) <= 1, f"Ambiguous actual menu row {label}")
                return rows[0] if rows else None
            self.click_observed(label, locate)

        def resize(self, width, height):
            require(self.owned_window is not None and 800 <= width <= 1280 and 650 <= height <= 860,
                    "Resize is outside the bounded owned-screen fixture")
            self.x.XResizeWindow(self.connection, self.owned_window, width, height)
            self.x.XFlush(self.connection)
            self.wait_state(f"actual resize {width}x{height}", lambda state:
                state["viewport"] == {"width": width, "height": height}
                and not state["dossierImageLifecycle"]["invalidationQueued"]
                and state["dossierImageLifecycle"]["pendingCount"] == 0
                and any(image["active"] and image["pixelWidth"] == width
                        and image["pixelHeight"] == height and image["atlasPresent"]
                        for image in state["dossierImageLifecycle"]["images"]))
            return self.ready_lifecycle("actual resized product preparation", active="prepared")

        def scroll_to(self, identifier, scroller):
            for _ in range(MAX_WHEEL_STEPS):
                state = self.state()
                if self.visible(state, self.node(state, identifier)):
                    return
                target = self.node(state, scroller)
                require(self.visible(state, target), f"Actual scroll owner {scroller} is not visible")
                rect, origin = target["rect"], state["windowOrigin"]
                require(self.t.XTestFakeMotionEvent(self.connection, 0,
                    round(origin["x"] + rect["x"] + rect["width"] / 2),
                    round(origin["y"] + rect["y"] + rect["height"] / 2), 0), "Actual scroll pointer failed")
                for _ in range(3):
                    require(self.t.XTestFakeButtonEvent(self.connection, 5, 1, 0)
                            and self.t.XTestFakeButtonEvent(self.connection, 5, 0, 0), "Actual wheel failed")
                self.x.XFlush(self.connection)
                time.sleep(0.12)
            raise TimeoutError(f"Observed control {identifier} not reachable within {MAX_WHEEL_STEPS} actual wheel batches")

        def ready_lifecycle(self, description, active=None, ids=None, painted=()):
            return self.wait_state(description, lambda state:
                not state["dossierImageLifecycle"]["invalidationQueued"]
                and state["dossierImageLifecycle"]["pendingCount"] == 0
                and (active is None or (prepared_mount_ready(state, expected_support) if active == "prepared"
                     else state["dossierImageLifecycle"]["activeCount"] == active))
                and (ids is None or set(image_map(state["dossierImageLifecycle"])) == set(ids))
                and all_present(state["dossierImageLifecycle"], painted))

        def events_after(self, sequence):
            return [row for row in self.observed_events if row["launch"] == self.launches and int(row["sequence"]) > sequence]

        def no_retirement(self, before, after, sequence):
            first, second = before["dossierImageLifecycle"], after["dossierImageLifecycle"]
            require(first["epoch"] == second["epoch"] and first["consumerIds"] == second["consumerIds"],
                    "Canceled/refused operation changed the actual lease/epoch")
            require(image_map(first) == image_map(second), "Canceled/refused operation changed tracked IDs/key presence")
            require(not any(row["stage"] in {"mount_set_accepted", "prepared_set_accepted", "marker_receipt", "atlas_drop"}
                            for row in self.events_after(sequence)), "Canceled/refused operation advanced lifecycle retirement")

        def prove_retired(self, ids, sequence, uploaded):
            events = self.events_after(sequence)
            result = []
            for identifier in ids:
                drops = [row for row in events if row["stage"] == "atlas_drop" and row["details"]["imageId"] == identifier]
                require(len(drops) == 1, f"Expected exactly one real atlas drop for {identifier}, got {len(drops)}")
                drop = drops[0]
                epoch = drop["epoch"]
                require(drop["details"]["receipt"] == epoch and drop["details"]["dropSucceeded"] is True
                        and drop["details"]["presentAfter"] is False, "Real drop did not establish exact key absence")
                require(drop["details"]["presentBefore"] is (identifier in uploaded),
                        "Prepared-only and actually uploaded keys were conflated")
                relevant = [row for row in events if row["epoch"] == epoch and int(row["sequence"]) < int(drop["sequence"])]
                accepted = [row for row in relevant if row["stage"] in {"prepared_set_accepted", "mount_set_accepted"}
                            and identifier in image_map(row) and not image_map(row)[identifier]["active"]]
                refresh = [row for row in relevant if row["stage"] == "refresh_applied"]
                marker = [row for row in relevant if row["stage"] == "marker_receipt"
                          and row["details"]["receipt"] == epoch and identifier in image_map(row)]
                deferred = [row for row in relevant if row["stage"] == "deferred_retirement"
                            and row["details"]["receipt"] == epoch and identifier in row["details"]["removedImageIds"]]
                require(accepted and refresh and len(marker) == 1 and len(deferred) == 1,
                        f"Missing actual accepted/refresh/marker/deferred chain for image {identifier}")
                chain = [accepted[-1], refresh[-1], marker[0], deferred[0], drop]
                require([int(row["sequence"]) for row in chain] == sorted(int(row["sequence"]) for row in chain),
                        "Actual marker/defer chain is out of order")
                require(marker[0]["invalidatedEpoch"] == epoch and not marker[0]["invalidationQueued"]
                        and marker[0]["retirementQueued"] == epoch and not image_map(marker[0])[identifier]["active"]
                        and image_map(marker[0])[identifier]["atlasPresent"] is (identifier in uploaded),
                        "Key disappeared before the qualified actual marker receipt")
                result.append({"id": identifier, "epoch": epoch, "chainSequences": [row["sequence"] for row in chain],
                               "uploadedBefore": identifier in uploaded, "presentAfter": False})
            require({row["details"]["imageId"] for row in events if row["stage"] == "atlas_drop"} == set(ids),
                    "Transition evicted an unexpected active/shared key")
            return result

        def assert_answers(self):
            self.section(0)
            require(self.input(self.state(), "dossier-answer-0")["value"] == TITLE, "Working title changed")
            self.section(2)
            require(self.input(self.state(), "dossier-answer-2")["value"] == AUDIENCE, "Actual multiline answer changed")

    return AtlasNative


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True, help="Parent-reviewed ui-tests binary with this hook patch applied")
    parser.add_argument("--expected-binary-sha256", help="Optional immutable Parent binary pin; drift refuses before launch")
    parser.add_argument("--output", type=Path, help="Fresh nonexistent private output directory")
    parser.add_argument("--expect-multiply", choices=("supported", "unsupported", "any"), default="supported",
                        help="Observed Window backend policy; default requires actual supported product recording/upload")
    args = parser.parse_args()
    helper = load_helper()
    binary = args.binary.resolve(strict=True)
    require(binary.is_file() and os.access(binary, os.X_OK), "Use an actual executable ui-tests binary")
    if args.expected_binary_sha256:
        require(digest(binary) == args.expected_binary_sha256, "Parent binary hash changed")
    output = args.output.absolute() if args.output else Path(tempfile.mkdtemp(prefix="twyne-dossier-atlas-native-"))
    if args.output:
        output.mkdir(mode=0o700, parents=True, exist_ok=False)
    fixture = HERE / "retained.typ"
    fixture_bytes = fixture.read_bytes()
    (output / "original-source.typ").write_bytes(fixture_bytes)
    pins = json.loads((HERE / "source-pins.json").read_text(encoding="utf8"))
    receipt = {"status": "running", "scope": "actual isolated X11/WGPU Dossier atlas KEYS; no GPU completion/presentation/global VRAM claim",
        "binarySha256": digest(binary), "driverSha256": digest(Path(__file__).resolve()),
        "hookPatchSha256": digest(HERE / "integration.patch"), "fixtureSha256": digest(fixture),
        "isolatedHelperSha256": digest(HELPER), "sourcePins": pins,
        "display": "fresh owned Xvfb -displayfd -nolisten tcp, caller DISPLAY ignored",
        "input": "XTEST existing observed controls/real resize; two fresh identical bounds before clicks",
        "expectedMultiplyBackend": args.expect_multiply,
        "productGroupProof": "Actual observed optional ID/count/status/upload/retirement; not Source radial raster equivalence",
        "checks": [], "limits": [
            "Atlas contains/drop observations do not establish successful scene presentation, GPU idle or driver memory reclamation",
            "DPR1 only; no occlusion/device recovery/multiwindow/global memory/sustained stress proof",
            "Recorded is a scene admission observation, not a presentation/GPU-completion or exact Source foxing-raster receipt",
            "Settings has no observed activation control while Dossier is mounted; retained-form Settings→Back requires an independent mounted host gate",
            "Theme is driven through actual Settings after real Dossier cancellation; no injected theme event",
            "Window/app close is accepted only as clean process exit, not a post-close atlas or GPU receipt",
        ]}
    write_json(output / "acceptance.json", receipt)
    ui = None
    restored_fault = True
    recovery_path = recovery_bytes = None

    def passed(label, details=None):
        receipt["checks"].append({"label": label, "details": details})
        write_json(output / "acceptance.json", receipt)

    def unchanged(document, baseline):
        require(helper.source_values(document) == helper.source_values(baseline), "Canonical source/body/projected HTML changed during image transitions")
        require(document["workspace"]["provenance"] == baseline["workspace"]["provenance"], "Imported source/provenance changed")
        require(document["workspace"].get("brief") == baseline["workspace"].get("brief"), "Image proof accidentally filed Dossier metadata")

    try:
        ui = owned_class(helper, args.expect_multiply)(binary, output, fixture)
        ui.start(import_fixture=True)
        path, baseline = ui.wait("actual imported nonempty source copy", ui.document)
        require(baseline["body"].encode() == fixture_bytes
                and baseline["workspace"]["content"]["typstSource"].encode() == fixture_bytes
                and bytes(baseline["workspace"]["provenance"]["originalBytes"]) == fixture_bytes,
                "Actual CLI import did not retain the exact authored canonical source/provenance")
        (output / "imported-manuscript.json").write_bytes(path.read_bytes())
        state = ui.ready_lifecycle("real initial prepared set and uploaded paper/stamp", active="prepared")
        initial = state["dossierImageLifecycle"]
        initial_ids = set(image_map(initial))
        initial_group = observed_foxing(initial)["imageId"]
        expected_initial_uploaded = expected_uploaded_ids(initial)
        require(sum(image["atlasPresent"] for image in initial["images"]) >= 2,
                "Initial actual painted paper/stamp keys were never uploaded")
        passed("Actual form retains nine real ordinary preparations plus the observed optional foxing group; CPU refs and atlas uploads stay distinct",
               {"foxing": observed_foxing(initial), "preparedCount": len(initial_ids),
                "actualUploadedIds": sorted(uploaded_ids(initial))})

        ui.edit("dossier-answer-0", TITLE)
        ui.section(2)
        ui.edit("dossier-answer-2", AUDIENCE)
        recovery_path, recovery_record = ui.wait_recovery("create", baseline["id"], 0,
            {"workingTitle": TITLE, "audience": AUDIENCE})
        write_json(output / "actual-local-recovery.json", recovery_record)
        for reviewed in range(8):
            ui.section(reviewed)
            current = ui.wait_state(f"actual stamp {reviewed} / 7", lambda state:
                ui.node(state, "dossier-reviewed-stamp") is not None
                and (ui.node(state, "dossier-reviewed-stamp")["label"] or "").casefold() == f"{reviewed} / 7 reviewed")
            ui.retain_state(f"stamp-{reviewed}", current)
        state = ui.ready_lifecycle("all eight actual stamp variants uploaded", active="prepared", ids=initial_ids, painted=expected_initial_uploaded)
        initial_uploaded = uploaded_ids(state["dossierImageLifecycle"])
        require(initial_uploaded == expected_initial_uploaded, "Observed upload set must include all nine ordinary images and only the admitted optional group")
        require(state["dossierImageLifecycle"]["epoch"] == initial["epoch"], "Text/step changes unexpectedly replaced prepared images")
        passed("Existing section navigation paints all eight count variants without new prepared IDs/epochs or manuscript edits")

        sequence = ui.seen_sequence
        resized = ui.resize(1100, 780)
        new_ids = set(image_map(resized["dossierImageLifecycle"]))
        old_viewport, new_viewport = initial_ids - new_ids, new_ids - initial_ids
        resized_group = observed_foxing(resized["dossierImageLifecycle"])["imageId"]
        require(len(old_viewport) == 1 + int(initial_group is not None)
                and len(new_viewport) == 1 + int(resized_group is not None),
                "Resize must replace paper plus the optional full-viewport group, preserving eight stamp IDs")
        if initial_group is not None:
            require(initial_group in old_viewport and resized_group in new_viewport, "Viewport group ID did not replace with paper")
        resized_uploaded = uploaded_ids(resized["dossierImageLifecycle"])
        resize_proof = ui.prove_retired(old_viewport, sequence, old_viewport & initial_uploaded)
        require(all_present(resized["dossierImageLifecycle"], initial_ids & new_ids), "Resize evicted active shared stamp IDs")
        ui.retain_state("actual-resized-paper", resized)
        passed("Real resize retains all eight stamp keys and retires old paper/optional group after qualified marker/deferred drops", resize_proof)

        sequence = ui.seen_sequence
        restored = ui.resize(1280, 860)
        restored = ui.ready_lifecycle("same cached viewport IDs actually reuploaded", active="prepared", ids=initial_ids, painted=expected_initial_uploaded)
        resize_back = ui.prove_retired(new_viewport, sequence, new_viewport & resized_uploaded)
        ui.assert_answers()
        passed("Resize back reuses original CPU-cache ImageId and actually reuploads it; local title/multiline controls stay exact", resize_back)

        before = ui.state()
        sequence = ui.seen_sequence
        ui.click("file-menu")
        ui.wait_state("actual File menu", lambda state: ui.node(state, "popup-menu") is not None)
        ui.press("Escape")
        after = ui.wait_state("actual canceled menu leaves Dossier mounted", lambda state:
            ui.node(state, "popup-menu") is None and ui.node(state, "dossier-form") is not None)
        ui.no_retirement(before, after, sequence)
        passed("Canceling the actual departure menu retains the mounted lease, all uploaded keys and local answers")

        # Fault is an explicit malformed owned disk copy, never a fabricated
        # successful recovery/provider callback or a touched user manuscript.
        recovery_path, _ = ui.wait_recovery("create", baseline["id"], 0,
            {"workingTitle": TITLE, "audience": AUDIENCE})
        require(recovery_path.is_relative_to(ui.data), "Fault path escaped the owned library")
        recovery_bytes = recovery_path.read_bytes()
        (output / "recovery-before-explicit-fault.json").write_bytes(recovery_bytes)
        recovery_path.write_bytes(b'{"explicit-owned-fault":')
        restored_fault = False
        before = ui.state()
        sequence = ui.seen_sequence
        ui.press("Escape")
        refused = ui.wait_state("actual recovery-refused Cancel", lambda state:
            ui.node(state, "dossier-form") is not None and ui.node(state, ("dossier-error", 0)) is not None)
        require(ui.input(refused, "dossier-answer-2")["value"] == AUDIENCE, "Failed Cancel lost the actual answer field")
        ui.no_retirement(before, refused, sequence)
        ui.retain_state("actual-refused-cancel", refused)
        passed("Damaged owned recovery causes actual Cancel refusal and keeps its real uploaded keys/control value")

        before = ui.state()
        sequence = ui.seen_sequence
        ui.click("file-menu")
        ui.click_menu("Dossier & House context")
        refused = ui.wait_state("actual recovery-refused House departure", lambda state:
            ui.node(state, "popup-menu") is None and ui.node(state, "dossier-form") is not None
            and ui.node(state, "native-house") is None and ui.node(state, "dismiss-message") is not None
            and ui.node(state, "dismiss-message")["label"] == "Retry save")
        ui.no_retirement(before, refused, sequence)
        ui.retain_state("actual-refused-route", refused)
        passed("Actual File→House route refuses failed recovery before unmount/retirement; source and input remain intact")
        temporary = recovery_path.with_name(recovery_path.name + ".native-proof-restore")
        temporary.write_bytes(recovery_bytes)
        os.replace(temporary, recovery_path)
        restored_fault = True

        before = ui.state()
        sequence = ui.seen_sequence
        ui.click("file-menu")
        ui.click_menu("Dossier & House context")
        departed = ui.wait_state("actual mounted House and completed marker retirement", lambda state:
            ui.node(state, "native-house") is not None and ui.node(state, "dossier-form") is None
            and state["dossierImageLifecycle"]["activeCount"] == 0
            and state["dossierImageLifecycle"]["pendingCount"] == 0)
        route_proof = ui.prove_retired(initial_ids, sequence, initial_uploaded)
        ui.retain_state("actual-house-route-retired", departed)
        unchanged(ui.document()[1], baseline)
        passed("Successful existing House route actually unmounts the form and retires every uploaded old key after the real marker", route_proof)

        ui.click("house-desk")
        ui.click("create-dossier")
        reopened = ui.ready_lifecycle("actual same-cache Dossier reopen", active="prepared", ids=initial_ids)
        require(reopened["dossierImageLifecycle"]["consumerIds"] != before["dossierImageLifecycle"]["consumerIds"],
                "Reopen revived a retired consumer instead of allocating a fresh lease")
        require(sum(image["atlasPresent"] for image in reopened["dossierImageLifecycle"]["images"]) >= 2,
                "Actually painted cached paper/stamp did not reupload after route return")
        ui.assert_answers()
        passed("Real desk→Create Dossier recovers exact local answers with a fresh consumer and the same cached ImageIds, actually reuploaded when painted")

        def cancel_and_retire(label):
            before = ui.state()
            images = image_map(before["dossierImageLifecycle"])
            uploaded = {identifier for identifier, image in images.items() if image["atlasPresent"]}
            sequence = ui.seen_sequence
            ui.click("dossier-exit")
            after = ui.wait_state(label, lambda state: ui.node(state, "dossier-form") is None
                and state["dossierImageLifecycle"]["activeCount"] == 0
                and state["dossierImageLifecycle"]["pendingCount"] == 0)
            return after, ui.prove_retired(set(images), sequence, uploaded)

        _, cancel_proof = cancel_and_retire("successful real Dossier Cancel marker retirement")
        passed("Successful actual Cancel retires current keys while never-uploaded cached variants remain honestly absent", cancel_proof)

        def choose_theme(preset):
            state = ui.state()
            if ui.node(state, "drawer") is None:
                ui.click("toggle-library")
            ui.scroll_to("drawer-settings", "drawer-content")
            ui.click("drawer-settings")
            ui.wait_state("actual Settings route", lambda state: ui.node(state, "settings-page") is not None)
            prior_sample = int(ui.state()["captureSequence"])
            appearance_path = ui.data / "appearance.json"
            prior_generation = helper.json_file(appearance_path)["generation"] if appearance_path.exists() else 0
            ui.click(f"settings-preset-{preset}")
            ui.wait_state("actual accepted appearance status", lambda state:
                int(state["captureSequence"]) > prior_sample and ui.node(state, "settings-saved-status") is not None
                and ui.node(state, "settings-pending-status") is None)
            appearance = ui.wait("durable actual appearance choice", lambda: helper.json_file(appearance_path),
                lambda record: record["generation"] > prior_generation and record["preference"]["preset"] == preset)
            write_json(output / f"actual-{preset}-appearance.json", appearance)
            ui.click("settings-back")
            ui.click("create-dossier")
            return ui.ready_lifecycle(f"actual {preset} Dossier preparation", active="prepared")

        night = choose_theme("nightpress")
        night_ids = set(image_map(night["dossierImageLifecycle"]))
        require(night_ids.isdisjoint(initial_ids), "Actual palette change did not prepare distinct paper/stamp images")
        require(sum(image["atlasPresent"] for image in night["dossierImageLifecycle"]["images"]) >= 2,
                "Nightpress paper/stamp was not actually uploaded")
        ui.assert_answers()
        ui.retain_state("actual-nightpress-prepared", ui.state())
        passed("Actual Settings Nightpress choice is durable; fresh Dossier preparation uses distinct IDs and preserves recovered input")
        _, night_proof = cancel_and_retire("actual Nightpress Cancel retires current palette keys")
        passed("Nightpress uploaded keys leave only through actual Cancel marker/deferred retirement", night_proof)
        editorial = choose_theme("editorial")
        require(set(image_map(editorial["dossierImageLifecycle"])) == initial_ids,
                "Restoring actual Editorial within the two-entry CPU caches did not reuse the original image IDs")
        require(sum(image["atlasPresent"] for image in editorial["dossierImageLifecycle"]["images"]) >= 2,
                "Original cached image IDs did not actually reupload after palette return")
        ui.assert_answers()
        passed("Actual Settings Editorial return reuses original cached IDs and reuploads painted keys without losing answers")

        ui.press("s", control=True)
        ui.wait_recovery("create", baseline["id"], 0, {"workingTitle": TITLE, "audience": AUDIENCE})
        unchanged(ui.document()[1], baseline)
        ui.quit()
        unchanged(helper.json_file(path), baseline)
        write_json(output / "after-clean-quit-manuscript.json", helper.json_file(path))
        passed("Actual focused Ctrl-S and Ctrl-Q preserve canonical source/provenance, durable local answers, and exit zero without leak/panic diagnostics")
        ui.start(import_fixture=False)
        ui.wait_state("fresh process restores exact multiline answer", lambda state:
            ui.input(state, "dossier-answer-2") is not None and ui.input(state, "dossier-answer-2")["value"] == AUDIENCE)
        ui.assert_answers()
        unchanged(ui.document()[1], baseline)
        ui.retain_state("actual-fresh-process-recovered")
        ui.quit()
        unchanged(helper.json_file(path), baseline)
        passed("Fresh actual process restores the same copied folio and exact local controls, then exits cleanly again; no cross-process ImageId claim")
        receipt["status"] = "pass"
    except BaseException as error:
        receipt["status"] = "fail"
        receipt["error"] = f"{type(error).__name__}: {error}"
        (output / "failure.txt").write_text(traceback.format_exc(), encoding="utf8")
        if ui is not None:
            receipt["failureObservations"] = ui.retain_failure_observations(fixture_bytes)
        raise
    finally:
        if not restored_fault and recovery_path is not None:
            # Retain the fault AND restore only our own original disk copy.
            (output / "failed-owned-recovery-fault.txt").write_bytes(recovery_path.read_bytes())
            recovery_path.write_bytes(recovery_bytes)
            receipt["ownedRecoveryFaultRestored"] = True
        if ui is not None:
            try:
                ui.close()
                receipt["ownedChildrenCleaned"] = True
            except BaseException as error:
                receipt["status"] = "fail"
                receipt["ownedChildrenCleaned"] = False
                receipt["cleanupError"] = f"{type(error).__name__}: {error}"
                write_json(output / "acceptance.json", receipt)
                raise
        write_json(output / "acceptance.json", receipt)
        print(json.dumps({"status": receipt["status"], "checks": len(receipt["checks"]), "output": str(output)}))


if __name__ == "__main__":
    main()
