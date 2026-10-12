#!/usr/bin/env python3
"""Read-only consistency admission for the authored Source inline-form corpus.

No browser, image processing, runtime adoption, file output or network access.
Provided JSON can be checked for consistency; its authenticity is not established.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from urllib.parse import urlsplit

EPSILON = 0.000001  # Arithmetic noise only, not a golden/layout tolerance.
OBSERVATION_LIMIT = 8 * 1024 * 1024
SNAPSHOT_LIMIT = 16 * 1024 * 1024
ROLES = ("paragraph", "atom", "form", "label", "textarea", "preview", "actions", "save", "cancel")
MARKER_NAMES = ("prefix-start", "before-math", "after-math", "suffix-end")
RAW_STYLE_ORDER = ("display", "font-family", "font-size", "font-weight", "font-style", "line-height", "vertical-align")
LIMITS = [
    "Consistency of supplied original-Source scaffold JSON, not authenticated browser execution.",
    "No TeX, KaTeX glyph, font-ascent or native baseline is inferred from a wrapper, caret or ink box.",
    "No full field typography/caret, pixel, full-app route, IME, other-browser or other-OS admission.",
    "UTF-16 mapping is qualified only against the exact complete text in this bounded corpus.",
    "Marker/control comparison is between two opened selected variants, possibly separate captures.",
]


class EvidenceError(ValueError):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def require(condition, code, detail):
    if not condition:
        raise EvidenceError(code, detail)


def integer(value):
    return type(value) is int


def number(value):
    require(type(value) in (int, float) and math.isfinite(value) and abs(value) <= 10_000_000,
            "INVALID_GEOMETRY", "Expected a bounded finite CSS-pixel number.")
    return float(value)


def close(left, right):
    return abs(number(left) - number(right)) <= EPSILON


def vector_equal(left, right):
    return len(left) == len(right) and all(close(a, b) for a, b in zip(left, right))


def utf16(text):
    require(isinstance(text, str) and len(text) <= 512 * 1024,
            "INVALID_TEXT", "Expected bounded unchanged text.")
    try:
        return text.encode("utf-16-le", errors="strict")
    except UnicodeError as error:
        raise EvidenceError("UNPAIRED_SURROGATE", "Text contains an unpaired surrogate.") from error


def utf16_slice(text, start, length):
    encoded = utf16(text)
    require(integer(start) and integer(length) and start >= 0 and length >= 0
            and (start + length) * 2 <= len(encoded),
            "INVALID_UTF16_RANGE", "Text range is outside the exact UTF-16 content.")
    try:
        # No scalar/grapheme counting, normalization, or split-surrogate repair.
        encoded[:start * 2].decode("utf-16-le", errors="strict")
        encoded[(start + length) * 2:].decode("utf-16-le", errors="strict")
        return encoded[start * 2:(start + length) * 2].decode("utf-16-le", errors="strict")
    except UnicodeError as error:
        raise EvidenceError("UTF16_BOUNDARY", "A raw text-box/selection range splits a surrogate pair.") from error


def duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "DUPLICATE_JSON_KEY", "Duplicate JSON object key: " + key)
        result[key] = value
    return result


def parse_json(data):
    def invalid_constant(value):
        raise EvidenceError("NONFINITE_JSON_NUMBER", "Non-finite JSON number: " + value)
    value = json.loads(data, object_pairs_hook=duplicate_keys, parse_constant=invalid_constant)
    pending = [(value, 0)]
    visited = 0
    while pending:
        item, depth = pending.pop()
        visited += 1
        require(depth <= 64 and visited <= 1_000_000, "JSON_COMPLEXITY_LIMIT", "JSON nesting/item limit exceeded.")
        if isinstance(item, dict):
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
        elif isinstance(item, str):
            utf16(item)
        elif type(item) is float:
            require(math.isfinite(item), "NONFINITE_JSON_NUMBER", "Non-finite parsed JSON number.")
    return value


def load_json(path, limit):
    with Path(path).open("rb") as handle:
        data = handle.read(limit + 1)
    require(len(data) <= limit, "INPUT_BYTE_LIMIT", str(path) + " exceeds its input byte limit.")
    return parse_json(data), {"path": str(path), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def bounds(value):
    require(isinstance(value, list) and len(value) == 4, "INVALID_GEOMETRY", "Missing raw [x,y,width,height] bounds.")
    result = [number(item) for item in value]
    require(result[2] >= 0 and result[3] >= 0, "INVALID_GEOMETRY", "Negative extent.")
    return result


def rectangle(value):
    require(isinstance(value, dict), "MISSING_BOX", "Missing observed rectangle.")
    return bounds([value[key] for key in ("x", "y", "width", "height")])


def relative(value, origin):
    value = bounds(value)
    return [value[0] - origin[0], value[1] - origin[1], value[2], value[3]]


def node_box(node, part="border"):
    require(node.get("missing") is not True, "MISSING_NODE", "Missing selected node: " + node["role"])
    box = node.get("box", {})
    value = rectangle(box.get(part))
    expected = [value[0], value[1], value[0] + value[2], value[1],
                value[0] + value[2], value[1] + value[3], value[0], value[1] + value[3]]
    quad = box.get("quads", {}).get(part)
    require(isinstance(quad, list) and vector_equal(quad, expected),
            "UNSUPPORTED_OR_INCONSISTENT_QUAD", "Non-axis-aligned/mismatched " + node["role"] + " " + part + " quad.")
    return value


def fonts(node, allow_empty=False):
    items = node.get("fonts", {}).get("fonts") if isinstance(node.get("fonts"), dict) else None
    require(isinstance(items, list) and len(items) <= 32, "MISSING_SELECTED_FONTS", "Missing selected fonts for " + node["role"])
    require(allow_empty or bool(items), "MISSING_SELECTED_FONTS", "Empty selected fonts for " + node["role"])
    result = []
    for item in items:
        family, postscript = item.get("familyName"), item.get("postScriptName")
        count, custom = item.get("glyphCount"), item.get("isCustomFont")
        require(isinstance(family, str) and family and isinstance(postscript, str) and postscript
                and integer(count) and count > 0 and type(custom) is bool,
                "INVALID_SELECTED_FONT", "Incomplete selected-font record.")
        result.append((family, postscript, custom, count))
    require(len(set(result)) == len(result), "DUPLICATE_SELECTED_FONT", "Duplicate selected-font record.")
    return sorted(result)


class Snapshot:
    """Cross-check observation text against its provided raw DOMSnapshot."""
    def __init__(self, snapshot, url):
        documents = snapshot.get("documents")
        self.strings = snapshot.get("strings")
        require(isinstance(documents, list) and len(documents) == 1 and isinstance(self.strings, list)
                and len(self.strings) <= 200_000, "SNAPSHOT_DOCUMENT", "Exactly one bounded raw document is required.")
        self.doc = documents[0]
        self.nodes = self.doc["nodes"]
        self.layout = self.doc["layout"]
        self.text_boxes = self.doc["textBoxes"]
        count = len(self.nodes["backendNodeId"])
        require(count <= 200_000 and all(len(self.nodes[key]) == count for key in
                ("parentIndex", "nodeType", "nodeName", "nodeValue")),
                "SNAPSHOT_NODE_TABLE", "Raw node columns are inconsistent/oversized.")
        require(self.string(self.doc["documentURL"]) == url, "SNAPSHOT_URL", "Raw snapshot is from another document.")
        self.backend = {}
        self.children = {}
        for i, backend in enumerate(self.nodes["backendNodeId"]):
            require(integer(backend) and backend not in self.backend, "SNAPSHOT_BACKEND_ID", "Raw backend IDs must be unique.")
            self.backend[backend] = i
            parent = self.nodes["parentIndex"][i]
            require(integer(parent) and -1 <= parent < i, "SNAPSHOT_PARENT", "Invalid raw tree parent/order.")
            self.children.setdefault(parent, []).append(i)
        layout_count = len(self.layout["nodeIndex"])
        require(layout_count <= 200_000 and all(len(self.layout[key]) == layout_count for key in
                ("bounds", "text", "styles")), "SNAPSHOT_LAYOUT_TABLE", "Raw layout columns are inconsistent.")
        self.by_node = {}
        for i, node in enumerate(self.layout["nodeIndex"]):
            require(integer(node) and 0 <= node < count and node not in self.by_node,
                    "SNAPSHOT_LAYOUT_OWNER", "Duplicate/invalid layout owner; unsupported fragmentation.")
            self.by_node[node] = i
        box_count = len(self.text_boxes["layoutIndex"])
        require(box_count <= 200_000 and all(len(self.text_boxes[key]) == box_count for key in
                ("start", "length", "bounds")), "SNAPSHOT_TEXT_TABLE", "Raw text-box columns are inconsistent.")
        self.by_layout = {}
        for i, owner in enumerate(self.text_boxes["layoutIndex"]):
            require(integer(owner) and 0 <= owner < layout_count, "SNAPSHOT_TEXT_OWNER", "Invalid text-box owner.")
            self.by_layout.setdefault(owner, []).append(i)

    def string(self, index):
        require(integer(index) and 0 <= index < len(self.strings), "SNAPSHOT_STRING", "Invalid raw string-table index.")
        return self.strings[index]

    def index(self, node):
        require(node["backendNodeId"] in self.backend, "SNAPSHOT_NODE_MISSING", "Observed node absent from raw snapshot.")
        index = self.backend[node["backendNodeId"]]
        require(self.string(self.nodes["nodeName"][index]) == node["tag"], "SNAPSHOT_NODE_TAG", "Observed/raw node tag differs.")
        return index

    def node_bounds(self, node):
        index = self.index(node)
        require(index in self.by_node, "SNAPSHOT_LAYOUT_MISSING", "Observed node has no raw layout.")
        return bounds(self.layout["bounds"][self.by_node[index]])

    def verify_font_style(self, layout_index, observed):
        indices = self.layout["styles"][layout_index]
        require(isinstance(indices, list) and len(indices) == len(RAW_STYLE_ORDER),
                "SNAPSHOT_STYLE_COLUMNS", "Original observer raw computed-style order is required.")
        recorded = dict(zip(RAW_STYLE_ORDER, (self.string(index) for index in indices)))
        require(all(recorded[key] == observed.get(key) for key in RAW_STYLE_ORDER[1:6]),
                "SNAPSHOT_FONT_STYLE", "Raw text/node font styles differ from selected observation.")

    def direct_text(self, owner):
        result = []
        for index in self.children.get(self.index(owner), []):
            if self.nodes["nodeType"][index] != 3:
                continue
            require(index in self.by_node, "MISSING_TEXT_LAYOUT", "Direct text node has no raw layout.")
            layout_index = self.by_node[index]
            text = self.string(self.layout["text"][layout_index])
            require(text == self.string(self.nodes["nodeValue"][index]),
                    "TEXT_CONTENT_TRANSFORM", "Raw text differs from DOM content; no normalization is assumed.")
            boxes = [{"start": self.text_boxes["start"][i], "length": self.text_boxes["length"][i],
                      "bounds": self.text_boxes["bounds"][i]} for i in self.by_layout.get(layout_index, [])]
            result.append({"nodeIndex": index, "layoutIndex": layout_index, "text": text,
                           "layoutBounds": self.layout["bounds"][layout_index], "boxes": boxes})
        return result


def canonical_doc(selected):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": selected["prefix"]},
        {"type": "inlineMath", "attrs": {"source": selected["source"]}},
        {"type": "text", "text": selected["suffix"]},
    ]}]}


def prepare(observation, snapshot, variant, cases):
    require(observation.get("schemaVersion") == 1 and "status" not in observation,
            "FAILED_OR_UNKNOWN_RECEIPT", "A failure/unknown receipt cannot supply geometry admission.")
    report = observation["report"]
    sample = report["sample"]
    frames = observation["frames"]
    require(isinstance(frames, list) and len(frames) == 3 and all(integer(i) for i in frames)
            and 0 <= frames[0] < frames[1] < frames[2] == report["frame"]
            and report.get("heartbeatStopped") is False,
            "STALE_FRAME", "Three increasing coherent collector frames and a running reporter are required.")
    require(sample.get("ready") is True and sample.get("fontStatus") == "loaded"
            and sample.get("controlWidthMode") == "flow", "UNREADY_OR_INTRINSIC_CONTROL", "Only ready matched flow-width controls qualify.")
    scenario = next((item for item in cases["scenarios"] if item["id"] == observation["scenario"]["id"]), None)
    selected = next((item for item in cases["cases"] if scenario and item["id"] == scenario["caseId"]), None)
    require(scenario and selected and observation["scenario"] == sample["scenario"] == scenario
            and sample["selected"] == selected and sample["devicePixelRatio"] == scenario["dpr"],
            "CASE_OR_DPR_MISMATCH", "Exact frozen case, scenario and DPR must agree.")
    require(observation.get("blocked") == [], "EXTERNAL_REQUEST", "Blocked external requests disqualify the corpus.")
    requests = observation.get("requests")
    require(isinstance(requests, list) and len(requests) <= 1000 and bool(requests), "REQUEST_LOG_MISSING", "Bounded actual request log required.")
    for request in requests:
        parsed = urlsplit(request["url"])
        require(parsed.scheme == "http" and parsed.hostname == "127.0.0.1"
                and parsed.username is None and parsed.password is None,
                "EXTERNAL_REQUEST", "Only original task-local requests may be present.")
    viewport = observation["layoutMetrics"]["cssLayoutViewport"]
    visual = observation["layoutMetrics"]["cssVisualViewport"]
    require(close(viewport["clientWidth"], scenario["viewportWidth"])
            and close(viewport["clientHeight"], scenario["viewportHeight"])
            and close(visual["scale"], 1) and close(visual.get("zoom", 1), 1),
            "VIEWPORT_OR_ZOOM", "Scenario viewport and unzoomed coordinate contract must agree.")
    rows = [row for row in sample["rows"] if row.get("variant") == variant]
    require(len(rows) == 1, "REPORT_OWNER", "Exactly one selected report owner is required.")
    row = rows[0]
    require(row.get("unchangedHtml") is True and row["canonical"]["html"] == row["initialHtml"]
            and row["canonical"]["json"] == canonical_doc(selected),
            "CANONICAL_CHANGED", "Canonical HTML/JSON must retain the authored Unicode content and source.")
    position = 1 + len(utf16(selected["prefix"])) // 2
    require(row["mathPosition"] == position and row["sourceUtf16Length"] == len(utf16(selected["source"])) // 2,
            "SOURCE_POSITION", "Reported positions must retain the exact PM UTF-16 contract.")
    field = row.get("field")
    require(isinstance(field, dict), "FORM_NOT_OPEN", "The selected variant must have an actual opened field; a closed atom is not a control.")
    utf16_slice(field["value"], field["selectionStart"], field["selectionEnd"] - field["selectionStart"])
    require(field["rows"] == 2 and field["selectionDirection"] in ("forward", "backward", "none")
            and type(field["focused"]) is bool, "INVALID_FIELD_STATE", "Incomplete actual inline-field state.")
    nodes = {}
    for node in observation["nodes"]:
        if node.get("variant") == variant:
            require(node["role"] not in nodes, "DUPLICATE_ROLE", "Duplicate selected node role.")
            nodes[node["role"]] = node
    require(all(role in nodes for role in ROLES), "MISSING_ROLE", "Opened Source form/control roles are required.")
    paragraph = node_box(nodes["paragraph"])
    require(close(paragraph[2], scenario["contentWidth"]), "PARAGRAPH_WIDTH", "Authored paragraph width differs from its scenario.")
    raw = Snapshot(snapshot, observation["url"])
    raw_origin = raw.node_bounds(nodes["paragraph"])
    normalized = {}
    for role in ROLES:
        normalized[role] = {}
        for part in ("content", "padding", "border", "margin"):
            normalized[role][part] = relative(node_box(nodes[role], part), paragraph)
        require(vector_equal(relative(raw.node_bounds(nodes[role]), raw_origin), normalized[role]["border"]),
                "RAW_NODE_GEOMETRY", "Raw snapshot/quad normalized geometry differs for " + role)
        require(nodes[role].get("styles", {}).get("visibility") == "visible", "HIDDEN_ROLE", "Selected Source role is hidden.")
        raw.verify_font_style(raw.by_node[raw.index(nodes[role])], nodes[role]["styles"])
    for child, parent in (("atom", "paragraph"), ("form", "atom"), ("label", "form"),
                          ("textarea", "label"), ("preview", "form"), ("actions", "form"),
                          ("save", "actions"), ("cancel", "actions")):
        require(raw.nodes["parentIndex"][raw.index(nodes[child])] == raw.index(nodes[parent]),
                "FORM_TREE", "Actual Source child ownership differs: " + child)
    atom_style, form_style, label_style = (nodes[role]["styles"] for role in ("atom", "form", "label"))
    require(atom_style.get("display") == "inline-flex" and atom_style.get("align-items") == "baseline"
            and atom_style.get("vertical-align") == "baseline" and form_style.get("display") in ("flex", "inline-flex")
            and form_style.get("flex-direction") == "column" and label_style.get("display") == "flex"
            and label_style.get("flex-direction") == "column", "SOURCE_BASELINE_STYLE", "Original nested flex baseline styles are not observed.")
    raw_runs = raw.direct_text(nodes["paragraph"])
    reported = [{key: value for key, value in run.items() if key != "variant"}
                for run in observation["proseTextRuns"] if run["variant"] == variant]
    require(raw_runs == reported and [run["text"] for run in raw_runs] == [selected["prefix"], selected["suffix"]],
            "PROSE_SNAPSHOT_OR_CONTENT", "Reported prose must be exact direct raw paragraph leaves, not form/KaTeX text.")
    label_runs = raw.direct_text(nodes["label"])
    require(len(label_runs) == 1 and label_runs[0]["text"] == nodes["textarea"]["attrs"].get("aria-label")
            == "Inline LaTeX source", "FIRST_LABEL_CONTENT", "Actual first label text/field label differs.")
    for run in raw_runs:
        raw.verify_font_style(run["layoutIndex"], nodes["paragraph"]["styles"])
    for run in label_runs:
        raw.verify_font_style(run["layoutIndex"], nodes["label"]["styles"])
    form_children = raw.children[raw.index(nodes["form"])]
    label_children = raw.children[raw.index(nodes["label"])]
    require(form_children[0] == raw.index(nodes["label"]) and label_children[0] == label_runs[0]["nodeIndex"]
            and label_children[1] == raw.index(nodes["textarea"]), "FIRST_LABEL_TREE", "Label/text must remain the first actual flex children.")
    selected_fonts = {role: fonts(nodes[role]) for role in ("paragraph", "label", "save")}
    require(any(custom and family == "Lora" for family, _, custom, _ in selected_fonts["paragraph"]),
            "ORIGINAL_PROSE_FONT", "Actual custom Lora must be selected, not merely declared.")
    return {"observation": observation, "row": row, "field": field, "nodes": nodes, "raw": raw,
            "origin": paragraph, "rawOrigin": raw_origin, "boxes": normalized, "prose": raw_runs,
            "label": label_runs[0], "fonts": selected_fonts, "position": position,
            "selected": selected, "scenario": scenario}


def normalized_run(run, origin, pm_start=None):
    encoded_length = len(utf16(run["text"])) // 2
    result, end = [], 0
    require(0 < len(run["boxes"]) <= 4096, "MISSING_TEXT_BOXES", "Bounded visible text fragments are required.")
    for box in run["boxes"]:
        start, length = box["start"], box["length"]
        text = utf16_slice(run["text"], start, length)
        require(start == end and length > 0, "TEXT_RANGE_COVERAGE", "Raw ranges must cover the unchanged text without gaps/overlaps.")
        end = start + length
        item = {"startUtf16": start, "lengthUtf16": length, "text": text,
                "boundsRelativeToParagraphCss": relative(box["bounds"], origin)}
        if pm_start is not None:
            item["sourceStartUtf16"] = pm_start + start
        result.append(item)
    require(end == encoded_length, "UTF16_LENGTH_OR_COVERAGE", "Raw ranges do not qualify as complete UTF-16 text coverage.")
    return result


def same_fragments(left, right):
    require(len(left) == len(right), "TEXT_ROW_COUNT", "Marker/control visible fragment count differs.")
    for a, b in zip(left, right):
        require({key: value for key, value in a.items() if key != "boundsRelativeToParagraphCss"}
                == {key: value for key, value in b.items() if key != "boundsRelativeToParagraphCss"}
                and vector_equal(a["boundsRelativeToParagraphCss"], b["boundsRelativeToParagraphCss"]),
                "TEXT_FRAGMENT_OR_ROW", "Exact text range/content/normalized row geometry differs.")


def caret(row, position, side, origin):
    matches = [item for item in row["adjacentAtomCoords"] if item.get("position") == position and item.get("side") == side]
    require(len(matches) == 1 and "rect" in matches[0], "MISSING_CARET", "Actual adjacent Source caret rectangle is required.")
    item = matches[0]["rect"]
    value = bounds([item["left"], item["top"], number(item["right"]) - number(item["left"]),
                    number(item["bottom"]) - number(item["top"])])
    return relative(value, origin)


def inside_row(point, fragment):
    _, top, _, height = fragment["boundsRelativeToParagraphCss"]
    return top - EPSILON <= point[1] <= top + height + EPSILON


def admit_pair(markers, marker_snapshot, control, control_snapshot, cases, provenance, expected):
    """Pure checker. No receipt values are used as invented expected baselines."""
    output = {"schemaVersion": 1, "status": "NOT_ADMITTED", "reasons": [],
              "proseFirstLabelBaseline": {"status": "NOT_ADMITTED"},
              "fieldTypography": {"status": "NOT_ADMITTED", "reasons": ["NOT_ANALYZED"]},
              "fieldPaintedCaret": {"status": "NOT_ADMITTED", "reason": "NO_VISIBLE_FIELD_TEXT_AND_CARET_ROW_PROTOCOL"},
              "limits": LIMITS}
    try:
        require(provenance.get("schemaVersion") == 1, "PROVENANCE_VERSION", "Original Source provenance is required.")
        for key in ("originalCss", "versions", "bodyFontReplay"):
            require(provenance.get(key) == expected[key], "SOURCE_PROVENANCE_CHANGED", "Frozen original contract differs: " + key)
        require(provenance["originalCss"].get("candidateOverlay") is False,
                "CANDIDATE_SOURCE_OVERLAY", "Candidate Source CSS is outside admission.")
        for path, digest in expected["sourceHashes"].items():
            require(provenance.get("sourceHashes", {}).get(path) == digest,
                    "SOURCE_HASH_CHANGED", "Original/scaffold source hash differs: " + path)
        require(isinstance(provenance.get("bundleHashes"), dict) and bool(provenance["bundleHashes"]),
                "BUNDLE_PROVENANCE_MISSING", "Actual original client bundle digests must be retained.")
        left = prepare(markers, marker_snapshot, "markers", cases)
        right = prepare(control, control_snapshot, "control", cases)
        require(markers["url"] == control["url"] and markers["browser"] == control["browser"]
                and left["scenario"] == right["scenario"] and left["selected"] == right["selected"],
                "PAIR_CONTEXT", "Opened captures must share exact URL/browser/case/viewport/DPR context.")
        require(left["row"]["canonical"] == right["row"]["canonical"], "PAIR_CANONICAL", "Canonical marker/control content differs.")
        field_keys = ("value", "rows", "selectionStart", "selectionEnd", "selectionDirection")
        require(all(left["field"][key] == right["field"][key] for key in field_keys),
                "OPEN_FIELD_CONTEXT", "Opened raw field value/logical selection differs.")
        output["logicalField"] = {key: left["field"][key] for key in field_keys}
        output["logicalField"]["paintedCaretProven"] = False
        for role in ROLES:
            require(left["nodes"][role]["styles"] == right["nodes"][role]["styles"],
                    "COMPUTED_STYLE_MISMATCH", "Computed Source styles differ for " + role)
            for part in ("content", "padding", "border", "margin"):
                require(vector_equal(left["boxes"][role][part], right["boxes"][role][part]),
                        "NORMALIZED_GEOMETRY_MISMATCH", "Opened relative " + role + " " + part + " differs.")
        require(left["fonts"] == right["fonts"], "SELECTED_FONT_MISMATCH", "Paragraph/first-label/save selected font identities differ.")
        prose = []
        for index, pm_start in enumerate((1, left["position"] + 1)):
            a = normalized_run(left["prose"][index], left["rawOrigin"], pm_start)
            b = normalized_run(right["prose"][index], right["rawOrigin"], pm_start)
            same_fragments(a, b)
            prose.append(a)
        label = normalized_run(left["label"], left["rawOrigin"])
        same_fragments(label, normalized_run(right["label"], right["rawOrigin"]))
        associated = (prose[0][0], prose[0][-1], prose[1][0], prose[1][-1])
        expected_positions = (1, left["position"], left["position"] + 1,
                              left["position"] + 1 + len(utf16(left["selected"]["suffix"])) // 2)
        require(len(markers["markers"]) == 4 and {item["name"] for item in markers["markers"]} == set(MARKER_NAMES),
                "MARKER_SET", "Four unique source-bound marker records are required.")
        points = []
        for index, (name, fragment, position) in enumerate(zip(MARKER_NAMES, associated, expected_positions)):
            node = left["nodes"].get(name)
            require(node is not None, "MARKER_NODE", "Missing authored marker node: " + name)
            attrs, style = node["attrs"], node["styles"]
            require(attrs.get("data-probe-baseline") == name and attrs.get("data-probe-position") == str(position)
                    and attrs.get("aria-hidden") == "true" and attrs.get("contenteditable") == "false"
                    and "probe-baseline-marker" in attrs.get("class", "").split(),
                    "MARKER_ATTRIBUTES", "Marker identity/source attributes differ.")
            require(style.get("display") == "inline-block" and style.get("vertical-align") == "baseline"
                    and style.get("line-height") == "0px" and style.get("position") == "relative"
                    and all(style.get(kind + "-" + edge + suffix) == "0px"
                            for kind, suffix in (("margin", ""), ("padding", ""), ("border", "-width"))
                            for edge in ("top", "right", "bottom", "left")),
                    "MARKER_LAYOUT_STYLE", "Marker is not the authored zero-extent baseline point.")
            box = node_box(node)
            point = relative(box, left["origin"])
            require(close(point[2], 0) and close(point[3], 0), "MARKER_NONZERO", "A marker acquired layout extent.")
            require(left["raw"].nodes["parentIndex"][left["raw"].index(node)] == left["raw"].index(left["nodes"]["paragraph"])
                    and vector_equal(relative(left["raw"].node_bounds(node), left["rawOrigin"]), point),
                    "MARKER_SNAPSHOT_OWNER", "Marker raw owner/geometry differs.")
            marker_index = left["raw"].index(node)
            prefix_index, suffix_index = (run["nodeIndex"] for run in left["prose"])
            atom_index = left["raw"].index(left["nodes"]["atom"])
            ordered = (marker_index < prefix_index, prefix_index < marker_index < atom_index,
                       atom_index < marker_index < suffix_index, suffix_index < marker_index)
            require(ordered[index], "MARKER_TREE_AFFINITY", "Marker order differs from its exact source-side affinity.")
            record = next(item for item in markers["markers"] if item["name"] == name)
            require(record["sourcePositionUtf16"] == position and vector_equal(rectangle(record["border"]), box)
                    and close(record["baselineY"], box[1]), "MARKER_REPORT", "Marker point/report differs.")
            x, _, width, _ = fragment["boundsRelativeToParagraphCss"]
            edge_x = x + width if index in (1, 3) else x
            require(close(point[0], edge_x) and inside_row(point, fragment),
                    "MARKER_ROW_OR_EDGE", name + " is not on its exact matched prose fragment row/edge.")
            points.append({"name": name, "sourcePositionUtf16": position,
                           "pointRelativeToParagraphCss": point[:2], "proseFragment": fragment})
            other = right["nodes"].get(name)
            require(other is not None and other.get("missing") is True,
                    "CONTROL_HAS_MARKERS", "Control must not contain authored marker nodes.")
        atom = left["boxes"]["atom"]["border"]
        before, after = (points[index]["pointRelativeToParagraphCss"] for index in (1, 2))
        require(close(before[1], after[1]) and close(before[0], atom[0]) and close(after[0], atom[0] + atom[2])
                and inside_row(before, label[0]) and inside_row(after, label[0]),
                "FIRST_LABEL_ROW_NOT_QUALIFIED", "Observed atom-edge points do not share the first actual label text row.")
        caret_evidence = []
        for position, side, at_right in ((left["position"], 1, False), (left["position"] + 1, -1, True)):
            a = caret(left["row"], position, side, left["origin"])
            b = caret(right["row"], position, side, right["origin"])
            expected_caret = [atom[0] + (atom[2] if at_right else 0), atom[1], 0, atom[3]]
            require(vector_equal(a, b) and vector_equal(a, expected_caret),
                    "ATOM_CARET_FRAME", "Atom-owned Source caret does not qualify the quad/client coordinate frame.")
            caret_evidence.append({"positionUtf16": position, "side": side, "rectRelativeToParagraphCss": a})
        prose_carets = []
        for index, position, side in ((1, left["position"], -1), (2, left["position"] + 1, 1)):
            a = caret(left["row"], position, side, left["origin"])
            b = caret(right["row"], position, side, right["origin"])
            point = points[index]["pointRelativeToParagraphCss"]
            fragment = associated[index]["boundsRelativeToParagraphCss"]
            require(close(a[0], point[0]) and close(a[1], point[1]) and close(a[2], 0) and close(a[3], 0)
                    and close(b[0], point[0]) and close(b[2], 0) and close(b[1], fragment[1]) and close(b[3], fragment[3]),
                    "PROSE_CARET_ROW", "Preserved marker-point/control-text-caret distinction does not agree with actual rows.")
            prose_carets.append({"positionUtf16": position, "side": side, "markerRect": a, "controlRect": b,
                                 "baselineInferredFromControlCaret": False})
        field_fonts = []
        for item in (left, right):
            try:
                field_fonts.append(fonts(item["nodes"]["textarea"], allow_empty=True))
            except EvidenceError:
                field_fonts.append(None)
        field_reasons = ["NO_VISIBLE_FIELD_TEXT_AND_CARET_ROW_PROTOCOL"]
        if not all(field_fonts):
            field_reasons.append("MISSING_SELECTED_TEXTAREA_FONTS")
        elif field_fonts[0] != field_fonts[1]:
            field_reasons.append("SELECTED_TEXTAREA_FONT_MISMATCH")
        output["fieldTypography"] = {"status": "NOT_ADMITTED", "reasons": field_reasons,
                                     "selectedFontIdentityStatus": "ADMITTED_IDENTITY_ONLY" if all(field_fonts) and field_fonts[0] == field_fonts[1] else "NOT_ADMITTED",
                                     "reportedSelectedFonts": field_fonts}
        output["status"] = "PARTIAL_ADMISSION"
        output["proseFirstLabelBaseline"] = {
            "status": "ADMITTED_CONSISTENCY", "scenario": left["scenario"], "markerPoints": points,
            "proseFragments": prose, "firstLabelFragments": label, "selectedFonts": left["fonts"],
            "formBaselinePointFromTopCssPx": before[1] - left["boxes"]["form"]["border"][1],
            "atomOwnedCaretFrameChecks": caret_evidence, "proseCaretDifferences": prose_carets,
            "rawLayoutMinusQuadOriginCss": [[item["rawOrigin"][i] - item["origin"][i] for i in (0, 1)] for item in (left, right)],
            "glyphBaselineMeasured": False, "nativeAdoptionAuthorized": False,
        }
    except EvidenceError as error:
        output["reasons"].append({"code": error.code, "detail": error.detail})
    except (KeyError, IndexError, TypeError, ValueError, OverflowError) as error:
        output["reasons"].append({"code": "INCOMPLETE_OR_UNSUPPORTED_SCHEMA", "detail": type(error).__name__ + ": " + str(error)[:300]})
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("markers", "markers-snapshot", "control", "control-snapshot", "provenance"):
        parser.add_argument("--" + name, required=True)
    here = Path(__file__).resolve().parent
    parser.add_argument("--cases", default=str(here.parent / "cases.json"))
    parser.add_argument("--source-contract", default=str(here / "source-inputs.json"))
    args = parser.parse_args()
    inputs = {}
    try:
        loaded = {}
        for key, path in vars(args).items():
            loaded[key], inputs[key] = load_json(path, SNAPSHOT_LIMIT if key.endswith("snapshot") else OBSERVATION_LIMIT)
        require(inputs["cases"]["sha256"] == loaded["source_contract"]["casesSha256"],
                "CASES_HASH_CHANGED", "The authored case corpus changed.")
        result = admit_pair(loaded["markers"], loaded["markers_snapshot"], loaded["control"],
                            loaded["control_snapshot"], loaded["cases"], loaded["provenance"], loaded["source_contract"])
    except (EvidenceError, OSError, UnicodeError, json.JSONDecodeError) as error:
        result = {"schemaVersion": 1, "status": "NOT_ADMITTED", "reasons": [{
            "code": error.code if isinstance(error, EvidenceError) else "UNREADABLE_INPUT",
            "detail": str(error)[:300]}], "limits": LIMITS}
    result["inputHashes"] = inputs
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
    return 0 if result["status"] == "PARTIAL_ADMISSION" else 2


if __name__ == "__main__":
    raise SystemExit(main())
