"""Authored synthetic observation checks, not native/GPU receipts.

Parent may run these independently. This lane only parses their Python syntax.
"""
from copy import deepcopy
from pathlib import Path
import runpy
import unittest


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def image_map(lifecycle):
    return {image["id"]: image for image in lifecycle["images"]}


HELPERS = runpy.run_path(str(Path(__file__).with_name("native_driver_helpers.py")), init_globals={
    "require": require, "image_map": image_map,
})
ready = HELPERS["prepared_mount_ready"]
expected_uploaded = HELPERS["expected_uploaded_ids"]
actual_uploaded = HELPERS["uploaded_ids"]


def observation(supported=True, transparent=False, ordinary_count=9):
    images = [{"id": f"ordinary-{index}", "active": True, "atlasPresent": index < 2}
              for index in range(ordinary_count)]
    group_id = None if transparent else "group-not-an-ordinary-image"
    if group_id is not None:
        images.append({"id": group_id, "active": True, "atlasPresent": supported})
    status = "Transparent" if transparent else "Recorded" if supported else "UnsupportedBackend"
    return {
        "viewport": {"width": 1280, "height": 860}, "scaleFactor": 1,
        "dossierImageLifecycle": {
            "invalidationQueued": False, "pendingCount": 0, "activeCount": len(images),
            "images": images,
            "foxing": {"supportsDestinationMultiply": supported, "prepared": True,
                "transparent": transparent, "imageId": group_id, "logicalWidth": 1280,
                "logicalHeight": 860, "scaleFactor": 1, "paintStatus": status},
        },
    }


class ObservationContracts(unittest.TestCase):
    def test_supported_tenth_group_requires_actual_recorded_uploaded_id(self):
        state = observation()
        self.assertTrue(ready(state, "supported"))
        lifecycle = state["dossierImageLifecycle"]
        self.assertEqual(len(expected_uploaded(lifecycle)), 10)
        self.assertEqual(len(actual_uploaded(lifecycle)), 3,
                         "Nine prepared ordinary IDs are not nine actual uploads yet")
        lifecycle["images"][-1]["atlasPresent"] = False
        self.assertFalse(ready(state, "supported"))

    def test_unsupported_tenth_group_stays_unuploaded_and_is_not_a_drop_upload(self):
        state = observation(supported=False)
        self.assertTrue(ready(state, "unsupported"))
        lifecycle = state["dossierImageLifecycle"]
        self.assertEqual(len(expected_uploaded(lifecycle)), 9)
        self.assertNotIn(lifecycle["foxing"]["imageId"], actual_uploaded(lifecycle))
        with self.assertRaises(AssertionError):
            ready(state, "supported")
        lifecycle["images"][-1]["atlasPresent"] = True
        with self.assertRaises(AssertionError):
            ready(state, "unsupported")

    def test_transparent_preparation_is_nine_without_an_image_or_recorded_status(self):
        state = observation(transparent=True)
        self.assertTrue(ready(state, "supported"))
        lifecycle = state["dossierImageLifecycle"]
        self.assertEqual(len(expected_uploaded(lifecycle)), 9)
        lifecycle["foxing"]["imageId"] = "invented-transparent-key"
        with self.assertRaises(AssertionError):
            ready(state, "supported")

    def test_noop_font_paper_plus_group_cannot_pass_real_native_stamp_gate(self):
        self.assertFalse(ready(observation(ordinary_count=1), "supported"))
        self.assertFalse(ready(observation(ordinary_count=8), "supported"))
        self.assertFalse(ready(observation(ordinary_count=10), "supported"))

    def test_stale_pending_or_only_prepared_group_cannot_satisfy_frame_readiness(self):
        baseline = observation()
        for key, value in [("logicalWidth", 1100), ("logicalHeight", 780),
                           ("scaleFactor", 2), ("paintStatus", "Prepared")]:
            state = deepcopy(baseline)
            state["dossierImageLifecycle"]["foxing"][key] = value
            self.assertFalse(ready(state, "supported"), key)
        for key, value in [("invalidationQueued", True), ("pendingCount", 1)]:
            state = deepcopy(baseline)
            state["dossierImageLifecycle"][key] = value
            self.assertFalse(ready(state, "supported"), key)

    def test_foreign_untracked_or_inactive_group_does_not_replace_scoped_identity(self):
        state = observation()
        state["dossierImageLifecycle"]["foxing"]["imageId"] = "not-in-the-observed-registry"
        self.assertFalse(ready(state, "supported"))
        state = observation()
        state["dossierImageLifecycle"]["images"][-1]["active"] = False
        self.assertFalse(ready(state, "supported"))
        state = observation()
        del state["dossierImageLifecycle"]["foxing"]
        with self.assertRaises(AssertionError):
            ready(state, "supported")


if __name__ == "__main__":
    unittest.main()
