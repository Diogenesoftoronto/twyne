"""Authored UNRUN synthetic consistency/negative tests; not browser/native proof."""

import copy
import json
from pathlib import Path
import unittest

from analyze import (EvidenceError, MARKER_NAMES, RAW_STYLE_ORDER, admit_pair,
                     canonical_doc, parse_json, utf16, utf16_slice)

HERE = Path(__file__).resolve().parent
CASES = json.loads((HERE.parent / "cases.json").read_text())
EXPECTED = json.loads((HERE / "source-inputs.json").read_text())
SELECTED = CASES["cases"][0]
SCENARIO = CASES["scenarios"][0]
URL = "http://127.0.0.1:5199/inline-geometry/?scenario=wide-ordinary&controlWidth=flow"


def synthetic(variant, top):
    """Deliberately authored numbers, not measured/golden Source geometry."""
    strings = []
    def string(value):
        if value not in strings:
            strings.append(value)
        return strings.index(value)

    base_style = {"display": "block", "font-family": "Lora, serif", "font-size": "18px",
                  "font-weight": "400", "font-style": "normal", "line-height": "32.4px",
                  "vertical-align": "baseline", "visibility": "visible"}
    doc = {"documentURL": string(URL), "scrollOffsetX": 0, "scrollOffsetY": 40,
           "nodes": {key: [] for key in ("backendNodeId", "parentIndex", "nodeType", "nodeName", "nodeValue")},
           "layout": {key: [] for key in ("nodeIndex", "bounds", "text", "styles")},
           "textBoxes": {key: [] for key in ("layoutIndex", "start", "length", "bounds")}}
    nodes, raw_roles, prose = [], {}, []

    def add(parent, tag, box=None, text=None, style=None, fragments=None):
        index = len(doc["nodes"]["backendNodeId"])
        for key, value in (("backendNodeId", index + 100), ("parentIndex", parent),
                           ("nodeType", 3 if text is not None else 1), ("nodeName", string(tag)),
                           ("nodeValue", string(text or ""))):
            doc["nodes"][key].append(value)
        if box is not None:
            layout = len(doc["layout"]["nodeIndex"])
            # This synthetic snapshot intentionally uses document != quad origin.
            raw_box = [box[0], box[1] + 40, box[2], box[3]]
            for key, value in (("nodeIndex", index), ("bounds", raw_box),
                               ("text", string(text) if text is not None else -1),
                               ("styles", [string((style or base_style)[key]) for key in RAW_STYLE_ORDER])):
                doc["layout"][key].append(value)
            run = {"nodeIndex": index, "layoutIndex": layout, "text": text,
                   "layoutBounds": raw_box, "boxes": []}
            for start, length, fragment in fragments or []:
                raw_fragment = [fragment[0], fragment[1] + 40, fragment[2], fragment[3]]
                for key, value in (("layoutIndex", layout), ("start", start), ("length", length), ("bounds", raw_fragment)):
                    doc["textBoxes"][key].append(value)
                run["boxes"].append({"start": start, "length": length, "bounds": raw_fragment})
            return index, run
        return index, None

    document, _ = add(-1, "#document")
    def element(role, parent, tag, box, overrides=None, attrs=None, font_items=None):
        style = dict(base_style, **(overrides or {}))
        index, _ = add(parent, tag, box, style=style)
        x, y, width, height = box
        quad = [x, y, x + width, y, x + width, y + height, x, y + height]
        rect = dict(zip(("x", "y", "width", "height"), box))
        node = {"variant": variant, "role": role, "backendNodeId": index + 100, "tag": tag,
                "attrs": attrs or {}, "styles": style,
                "box": {**{part: copy.deepcopy(rect) for part in ("content", "padding", "border", "margin")},
                        "quads": {part: list(quad) for part in ("content", "padding", "border", "margin")}}}
        if font_items is not None:
            node["fonts"] = {"fonts": font_items}
        nodes.append(node)
        raw_roles[role] = index
        return index

    def lora(count):
        return [{"familyName": "Lora", "postScriptName": "Lora-Regular", "isCustomFont": True, "glyphCount": count}]

    paragraph = element("paragraph", document, "P", [24, top, 704, 236], font_items=lora(53))
    position = 1 + len(utf16(SELECTED["prefix"])) // 2
    marker_specs = {"prefix-start": (1, 24, top + 28), "before-math": (position, 224, top + 28),
                    "after-math": (position + 1, 576, top + 28),
                    "suffix-end": (position + 1 + len(utf16(SELECTED["suffix"])) // 2, 168, top + 226)}
    marker_records = []
    def marker(name):
        if variant == "control":
            nodes.append({"variant": variant, "role": name, "missing": True})
            return
        source_position, x, y = marker_specs[name]
        style = {"display": "inline-block", "position": "relative", "line-height": "0px"}
        for kind, suffix in (("margin", ""), ("padding", ""), ("border", "-width")):
            for edge in ("top", "right", "bottom", "left"):
                style[kind + "-" + edge + suffix] = "0px"
        element(name, paragraph, "SPAN", [x, y, 0, 0], style,
                {"class": "probe-baseline-marker", "data-probe-baseline": name,
                 "data-probe-position": str(source_position), "aria-hidden": "true", "contenteditable": "false"})
        marker_records.append({"name": name, "sourcePositionUtf16": source_position,
                               "border": {"x": x, "y": y, "width": 0, "height": 0}, "baselineY": y})

    marker("prefix-start")
    _, prefix = add(paragraph, "#text", [24, top + 10, 200, 23], text=SELECTED["prefix"],
                    fragments=[(0, len(utf16(SELECTED["prefix"])) // 2, [24, top + 10, 200, 23])])
    prose.append(dict(prefix, variant=variant))
    marker("before-math")
    atom = element("atom", paragraph, "SPAN", [224, top, 352, 200],
                   {"display": "inline-flex", "align-items": "baseline"})
    form = element("form", atom, "FORM", [224, top, 352, 200], {"display": "flex", "flex-direction": "column"})
    label_style = {"display": "flex", "flex-direction": "column", "font-size": "12.8px",
                   "font-weight": "600", "line-height": "23.04px"}
    label = element("label", form, "LABEL", [236, top + 12, 328, 85], label_style, font_items=lora(19))
    add(label, "#text", [236, top + 15, 120, 17], text="Inline LaTeX source",
        style=dict(base_style, **label_style), fragments=[(0, 19, [236, top + 15, 120, 17])])
    element("textarea", label, "TEXTAREA", [236, top + 40, 328, 57],
            {"font-family": "ui-monospace, monospace", "font-size": "14px", "line-height": "19.6px"},
            {"aria-label": "Inline LaTeX source", "rows": "2"}, font_items=[])
    element("preview", form, "DIV", [236, top + 105, 328, 45])
    actions = element("actions", form, "SPAN", [236, top + 158, 328, 34])
    element("save", actions, "BUTTON", [300, top + 158, 160, 34], font_items=lora(15))
    element("cancel", actions, "BUTTON", [466, top + 158, 78, 34])
    marker("after-math")
    _, suffix = add(paragraph, "#text", [24, top + 10, 704, 221], text=SELECTED["suffix"], fragments=[
        (0, 19, [576, top + 10, 152, 23]),
        (19, len(utf16(SELECTED["suffix"])) // 2 - 19, [24, top + 208, 144, 23]),
    ])
    prose.append(dict(suffix, variant=variant))
    marker("suffix-end")

    def caret(pos, side, x, y, height):
        return {"position": pos, "side": side, "rect": {"left": x, "right": x, "top": y, "bottom": y + height}}
    point = variant == "markers"
    row = {"variant": variant, "initialHtml": "<p>synthetic unchanged canonical</p>",
           "canonical": {"html": "<p>synthetic unchanged canonical</p>", "json": canonical_doc(SELECTED)},
           "unchangedHtml": True, "mathPosition": position, "sourceUtf16Length": 3,
           "field": {"value": "x+1", "rows": 2, "selectionStart": 3, "selectionEnd": 3,
                     "selectionDirection": "forward", "focused": True},
           "adjacentAtomCoords": [caret(position, -1, 224, top + (28 if point else 10), 0 if point else 23),
                                  caret(position, 1, 224, top, 200), caret(position + 1, -1, 576, top, 200),
                                  caret(position + 1, 1, 576, top + (28 if point else 10), 0 if point else 23)]}
    observation = {"schemaVersion": 1, "url": URL, "scenario": SCENARIO, "phase": "synthetic-open-" + variant,
                   "frames": [1, 2, 3], "report": {"frame": 3, "heartbeatStopped": False,
                   "sample": {"ready": True, "fontStatus": "loaded", "controlWidthMode": "flow", "scenario": SCENARIO,
                              "selected": SELECTED, "devicePixelRatio": 1, "rows": [row]}},
                   "browser": {"product": "SYNTHETIC_NOT_A_BROWSER_RECEIPT"}, "blocked": [],
                   "requests": [{"url": URL, "type": "document"}],
                   "layoutMetrics": {"cssLayoutViewport": {"clientWidth": 1280, "clientHeight": 860},
                                     "cssVisualViewport": {"scale": 1, "zoom": 1}},
                   "nodes": nodes, "proseTextRuns": prose, "markers": marker_records}
    return observation, {"documents": [doc], "strings": strings}


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.marker, self.ms = synthetic("markers", 100)
        self.control, self.cs = synthetic("control", 500)
        self.provenance = copy.deepcopy(EXPECTED)
        self.provenance.update(schemaVersion=1, bundleHashes={"client.js": "synthetic"})

    def result(self):
        return admit_pair(self.marker, self.ms, self.control, self.cs, CASES, self.provenance, EXPECTED)

    def refuses(self, code):
        result = self.result()
        self.assertEqual(result["status"], "NOT_ADMITTED", result)
        self.assertEqual(result["reasons"][0]["code"], code, result)
        self.assertNotIn("formBaselinePointFromTopCssPx", result["proseFirstLabelBaseline"])

    def role(self, observation, name):
        return next(node for node in observation["nodes"] if node["role"] == name)

    def test_partial_baseline_does_not_certify_empty_textarea_fonts_or_caret(self):
        result = self.result()
        self.assertEqual(result["status"], "PARTIAL_ADMISSION", result)
        self.assertEqual(result["proseFirstLabelBaseline"]["status"], "ADMITTED_CONSISTENCY")
        self.assertIn("MISSING_SELECTED_TEXTAREA_FONTS", result["fieldTypography"]["reasons"])
        self.assertEqual(result["fieldPaintedCaret"]["status"], "NOT_ADMITTED")
        self.assertFalse(result["logicalField"]["paintedCaretProven"])
        self.assertFalse(result["proseFirstLabelBaseline"]["nativeAdoptionAuthorized"])
        prefix = result["proseFirstLabelBaseline"]["proseFragments"][0][0]
        self.assertEqual(prefix["lengthUtf16"], 21)
        self.assertEqual(len(prefix["text"]), 20)  # Astral thread is two UTF-16 units.
        self.assertIn("e\u0301", prefix["text"])  # Combining sequence is not NFC-rewritten.
        self.assertEqual(result["proseFirstLabelBaseline"]["rawLayoutMinusQuadOriginCss"], [[0, 40], [0, 40]])

    def test_closed_control_is_never_an_open_form_baseline_control(self):
        self.control["report"]["sample"]["rows"][0]["field"] = None
        self.refuses("FORM_NOT_OPEN")

    def test_equal_paragraph_dimensions_cannot_hide_a_different_text_row(self):
        run = self.control["proseTextRuns"][1]
        run["boxes"][1]["bounds"][1] += 1
        layout = run["layoutIndex"]
        raw = self.cs["documents"][0]["textBoxes"]
        index = [i for i, owner in enumerate(raw["layoutIndex"]) if owner == layout][1]
        raw["bounds"][index][1] += 1
        self.refuses("TEXT_FRAGMENT_OR_ROW")

    def test_surrogate_split_cannot_be_silently_scalar_mapped(self):
        run = self.marker["proseTextRuns"][0]
        run["boxes"][0]["length"] = 12  # Ends halfway through U+1F9F5 at units 11..13.
        raw = self.ms["documents"][0]["textBoxes"]
        index = raw["layoutIndex"].index(run["layoutIndex"])
        raw["length"][index] = 12
        self.refuses("UTF16_BOUNDARY")

    def test_wrong_snapshot_text_owner_is_refused_even_if_observation_is_plausible(self):
        paragraph = self.role(self.marker, "paragraph")
        raw = self.ms["documents"][0]["nodes"]
        index = raw["backendNodeId"].index(paragraph["backendNodeId"])
        raw["backendNodeId"][index] = 99999
        self.refuses("SNAPSHOT_NODE_MISSING")

    def test_selected_first_label_face_mismatch_blocks_baseline_consistency(self):
        self.role(self.control, "label")["fonts"]["fonts"][0]["postScriptName"] = "Lora-Bold"
        self.refuses("SELECTED_FONT_MISMATCH")

    def test_a_self_consistent_marker_receipt_on_another_row_is_still_refused(self):
        node = self.role(self.marker, "before-math")
        for part in ("content", "padding", "border", "margin"):
            node["box"][part]["y"] += 50
            for i in (1, 3, 5, 7):
                node["box"]["quads"][part][i] += 50
        raw = self.ms["documents"][0]
        index = raw["nodes"]["backendNodeId"].index(node["backendNodeId"])
        layout = raw["layout"]["nodeIndex"].index(index)
        raw["layout"]["bounds"][layout][1] += 50
        record = next(item for item in self.marker["markers"] if item["name"] == "before-math")
        record["border"]["y"] += 50
        record["baselineY"] += 50
        self.refuses("MARKER_ROW_OR_EDGE")

    def test_same_geometry_cannot_hide_different_held_field_input(self):
        self.control["report"]["sample"]["rows"][0]["field"].update(value="y+1")
        self.refuses("OPEN_FIELD_CONTEXT")

    def test_field_font_difference_is_reported_without_overclaiming_independent_baseline(self):
        font = {"familyName": "Example Mono", "postScriptName": "ExampleMono", "isCustomFont": False, "glyphCount": 3}
        self.role(self.marker, "textarea")["fonts"] = {"fonts": [font]}
        self.role(self.control, "textarea")["fonts"] = {"fonts": [dict(font, postScriptName="OtherMono")]}
        result = self.result()
        self.assertEqual(result["status"], "PARTIAL_ADMISSION", result)
        self.assertIn("SELECTED_TEXTAREA_FONT_MISMATCH", result["fieldTypography"]["reasons"])

    def test_raw_label_computed_style_contradiction_blocks_admission(self):
        raw = self.cs["documents"][0]
        role = self.role(self.control, "label")
        node = raw["nodes"]["backendNodeId"].index(role["backendNodeId"])
        layout = raw["layout"]["nodeIndex"].index(node)
        self.cs["strings"].append("17px")
        raw["layout"]["styles"][layout][2] = len(self.cs["strings"]) - 1
        self.refuses("SNAPSHOT_FONT_STYLE")

    def test_source_overlay_or_source_hash_change_is_refused(self):
        self.provenance["sourceHashes"]["src/components/editor/math/math.css"] = "changed"
        self.refuses("SOURCE_HASH_CHANGED")

    def test_failure_receipt_and_stale_frame_cannot_supply_geometry(self):
        self.marker["status"] = "FAILED_NOT_ADMITTED"
        self.refuses("FAILED_OR_UNKNOWN_RECEIPT")
        del self.marker["status"]
        self.marker["frames"] = [1, 1, 3]
        self.refuses("STALE_FRAME")

    def test_strict_json_refuses_duplicates_nonfinite_and_unpaired_surrogates(self):
        for data, code in ((b'{"x":1,"x":2}', "DUPLICATE_JSON_KEY"),
                           (b'{"x":NaN}', "NONFINITE_JSON_NUMBER"),
                           (b'{"x":"\\ud800"}', "UNPAIRED_SURROGATE")):
            with self.subTest(code=code), self.assertRaises(EvidenceError) as caught:
                parse_json(data)
            self.assertEqual(caught.exception.code, code)
        self.assertEqual(utf16_slice("e\u0301東京🧵", 2, 4), "東京🧵")


if __name__ == "__main__":
    unittest.main()
