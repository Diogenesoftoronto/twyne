"""Authored UNRUN parser guards using synthetic input, not browser/native proof.

Parent supplies the exact reviewed staged candidate through MATH_INLINE_ANALYZER.
The thirteen original tests are reused unchanged against that same candidate.
"""

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest

HERE = Path(__file__).resolve().parent
SPEC = json.loads((HERE / "patch-spec.json").read_text())
candidate_path = Path(os.environ.get("MATH_INLINE_ANALYZER", HERE.parent / "analyze.py"))
if hashlib.sha256(candidate_path.read_bytes()).hexdigest() != SPEC["candidateSha256"]:
    raise RuntimeError("Supply the exact reviewed candidate through MATH_INLINE_ANALYZER; no skip/old-parser success is allowed.")
module_spec = importlib.util.spec_from_file_location("admission_fragmentation_candidate", candidate_path)
candidate = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(candidate)
sys.modules["analyze"] = candidate  # Test process only; no production/shared file is changed.
sys.path.insert(0, str(HERE.parent))
from test_analyze import CASES, EXPECTED, synthetic, AdmissionTests as OriginalAdmissionTests  # noqa: E402,F401


class FragmentationTests(unittest.TestCase):
    def setUp(self):
        self.marker, self.ms = synthetic("markers", 100)
        self.control, self.cs = synthetic("control", 500)
        self.provenance = copy.deepcopy(EXPECTED)
        self.provenance.update(schemaVersion=1, bundleHashes={"client.js": "synthetic"})

    def result(self):
        return candidate.admit_pair(self.marker, self.ms, self.control, self.cs,
                                    CASES, self.provenance, EXPECTED)

    def refuses(self, code):
        result = self.result()
        self.assertEqual(result["status"], "NOT_ADMITTED", result)
        self.assertEqual(result["reasons"][0]["code"], code, result)
        self.assertNotIn("formBaselinePointFromTopCssPx", result["proseFirstLabelBaseline"])

    def role_node(self, observation, snapshot, name):
        node = next(item for item in observation["nodes"] if item["role"] == name)
        return snapshot["documents"][0]["nodes"]["backendNodeId"].index(node["backendNodeId"])

    def duplicate_layout(self, snapshot, node, identical=False):
        layout = snapshot["documents"][0]["layout"]
        index = layout["nodeIndex"].index(node)
        for key, values in layout.items():
            values.append(copy.deepcopy(values[index]))
        if not identical:
            layout["bounds"][-1][1] += 80
        return len(layout["nodeIndex"]) - 1

    def add_unselected_pseudo(self, copies=2):
        raw = self.ms["documents"][0]
        nodes, layout = raw["nodes"], raw["layout"]
        owner = self.role_node(self.marker, self.ms, "before-math")
        node = len(nodes["backendNodeId"])
        self.ms["strings"].extend(["::after", ""])
        for key, value in (("backendNodeId", max(nodes["backendNodeId"]) + 1),
                           ("parentIndex", owner), ("nodeType", 1),
                           ("nodeName", len(self.ms["strings"]) - 2),
                           ("nodeValue", len(self.ms["strings"]) - 1)):
            nodes[key].append(value)
        source = layout["nodeIndex"].index(owner)
        for i in range(copies):
            layout["nodeIndex"].append(node)
            layout["bounds"].append([222, 168, 4, 1] if i == 0 else [0, 0, 0, 0])
            layout["text"].append(-1)
            layout["styles"].append(copy.deepcopy(layout["styles"][source]))
        return node

    def test_unselected_marker_pseudo_fragments_do_not_poison_unique_selected_evidence(self):
        node = self.add_unselected_pseudo()
        result = self.result()
        self.assertEqual(result["status"], "PARTIAL_ADMISSION", result)
        raw = candidate.Snapshot(self.ms, self.marker["url"])
        self.assertIn(node, raw.fragmented_nodes)
        self.assertNotIn(node, raw.by_node)  # Neither first/last row is silently chosen.
        self.assertEqual(result["fieldTypography"]["status"], "NOT_ADMITTED")
        self.assertEqual(result["fieldPaintedCaret"]["status"], "NOT_ADMITTED")

    def test_third_unselected_fragment_still_has_no_chosen_layout(self):
        node = self.add_unselected_pseudo(copies=3)
        raw = candidate.Snapshot(self.ms, self.marker["url"])
        self.assertIn(node, raw.fragmented_nodes)
        self.assertNotIn(node, raw.by_node)
        self.assertEqual(self.result()["status"], "PARTIAL_ADMISSION")

    def test_every_selected_role_refuses_identical_or_conflicting_duplicate_rows(self):
        for role in candidate.ROLES + candidate.MARKER_NAMES:
            for identical in (True, False):
                with self.subTest(role=role, identical=identical):
                    self.setUp()
                    node = self.role_node(self.marker, self.ms, role)
                    self.duplicate_layout(self.ms, node, identical=identical)
                    self.refuses("SNAPSHOT_SELECTED_FRAGMENTATION")

    def test_direct_prose_and_first_label_text_refuse_fragmentation_without_merging(self):
        for owner_role in ("paragraph", "label"):
            with self.subTest(owner=owner_role):
                self.setUp()
                owner = self.role_node(self.marker, self.ms, owner_role)
                nodes = self.ms["documents"][0]["nodes"]
                text = next(i for i, parent in enumerate(nodes["parentIndex"])
                            if parent == owner and nodes["nodeType"][i] == 3)
                self.duplicate_layout(self.ms, text, identical=True)
                self.refuses("SNAPSHOT_SELECTED_FRAGMENTATION")

    def test_control_selected_fragmentation_is_also_refused(self):
        node = self.role_node(self.control, self.cs, "label")
        self.duplicate_layout(self.cs, node, identical=True)
        self.refuses("SNAPSHOT_SELECTED_FRAGMENTATION")

    def test_invalid_unselected_owner_is_never_tolerated_as_fragmentation(self):
        for invalid in (-1, 999999, 1.5, True):
            with self.subTest(owner=invalid):
                self.setUp()
                self.add_unselected_pseudo()
                self.ms["documents"][0]["layout"]["nodeIndex"][-1] = invalid
                self.refuses("SNAPSHOT_LAYOUT_OWNER")

    def test_unrelated_duplicates_do_not_relax_selected_text_range_coverage(self):
        self.add_unselected_pseudo()
        run = self.marker["proseTextRuns"][0]
        run["boxes"][0]["length"] -= 1
        raw = self.ms["documents"][0]["textBoxes"]
        index = raw["layoutIndex"].index(run["layoutIndex"])
        raw["length"][index] -= 1
        self.refuses("UTF16_LENGTH_OR_COVERAGE")

    def test_invalid_raw_text_box_owner_still_refuses_with_unrelated_duplicates(self):
        self.add_unselected_pseudo()
        self.ms["documents"][0]["textBoxes"]["layoutIndex"][0] = 999999
        self.refuses("SNAPSHOT_TEXT_OWNER")


if __name__ == "__main__":
    unittest.main()
