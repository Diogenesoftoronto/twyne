"""Transport/lifecycle tests with synthetic IPC, never model-quality evidence."""
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch, Mock
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

from server import Runtime, MODEL, MANIFEST, handler, validate_request
import worker


def request():
    return {"model": MODEL, "state": {"passage": "A synthetic test passage."}, "questions": {
        "condition": {"type": "noul", "instructions": "Is this a test?"},
        "selection": {"type": "choice", "instructions": "Pick a label", "criteria": {"one": None, "two": None}},
        "rating": {"type": "score", "instructions": "Rate it", "criteria": ["low", "high"]},
    }}


class LocalDecisionsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.runtime = Runtime(Path(self.temp.name))

    def tearDown(self):
        self.temp.cleanup()

    def test_accepts_existing_three_primitives(self):
        self.assertEqual(validate_request(request())["questions"], request()["questions"])

    def test_rejects_other_models_and_malformed_questions(self):
        for mutation in ({"model": "jev-latest"}, {"state": {"passage": 1}}, {"questions": {}},
                         {"questions": {"x": {"type": "text", "instructions": "extract"}}},
                         {"questions": {"x": {"type": "score", "instructions": "rate", "criteria": ["x", "x"]}}}):
            with self.assertRaises(ValueError):
                validate_request({**request(), **mutation})

    def test_status_does_not_install_or_load(self):
        with patch("server.subprocess.Popen") as spawn:
            self.assertEqual(self.runtime.status()["phase"], "not_downloaded")
            spawn.assert_not_called()

    def test_partial_download_is_not_installed(self):
        self.runtime.folder.mkdir()
        (self.runtime.folder / "config.json").write_text("{}")
        self.assertFalse(self.runtime.installed())

    def test_worker_rejects_corrupt_or_missing_model_files(self):
        import hashlib
        folder = Path(self.temp.name)
        entry = {"path": "test.bin", "size": 4, "sha256": hashlib.sha256(b"good").hexdigest()}
        with patch.object(worker, "MANIFEST", {"files": [entry]}):
            with self.assertRaisesRegex(ValueError, "Incomplete"):
                worker.verify(folder)
            (folder / "test.bin").write_bytes(b"evil")
            with self.assertRaisesRegex(ValueError, "checksum"):
                worker.verify(folder)
            (folder / "test.bin").write_bytes(b"good")
            worker.verify(folder)

    def test_insufficient_space_never_starts_download(self):
        with patch("server.shutil.which", return_value="uv"), patch("server.shutil.disk_usage", return_value=Mock(free=100)), patch("server.subprocess.Popen") as spawn:
            with self.assertRaisesRegex(ValueError, "10 GB"):
                self.runtime.install()
            spawn.assert_not_called()
            self.assertFalse(self.runtime.lock.locked())

    def test_busy_runtime_refuses_overlap(self):
        self.runtime.lock.acquire()
        with self.assertRaisesRegex(RuntimeError, "busy"):
            self.runtime.ask(validate_request(request()))
        with self.assertRaisesRegex(RuntimeError, "busy"):
            self.runtime.install()

    def test_inference_command_is_frozen_and_offline(self):
        command = self.runtime.command("--serve")
        self.assertIn("--offline", command)
        self.assertIn("--frozen", command)
        self.assertNotIn("--download", command)
        self.assertIn(MANIFEST["revision"], command[-1])

    def test_inference_uses_cached_worker_without_downloading(self):
        self.runtime.folder.mkdir()
        (self.runtime.folder / ".twyne-ready").write_text(MANIFEST["revision"])
        worker = Mock()
        worker.poll.return_value = None
        worker.stdout = io.StringIO('{"ready": true}\n' + json.dumps({"model": MODEL, "answers": {}, "usage": {"input_tokens": 1, "output_tokens": 0}}) + '\n')
        worker.stdin = io.StringIO()
        with patch("server.subprocess.Popen", return_value=worker) as spawn:
            result = self.runtime.ask(validate_request(request()))
            self.assertEqual(result["model"], MODEL)
            self.assertEqual(spawn.call_args.kwargs["env"]["HF_HUB_OFFLINE"], "1")
            self.assertEqual(spawn.call_count, 1)
            self.assertIn("--offline", spawn.call_args.args[0])
            self.assertNotIn("--download", spawn.call_args.args[0])
            self.assertEqual(json.loads(worker.stdin.getvalue())["state"], request()["state"])

    def test_worker_failure_is_explicit_and_cannot_launch_hosted(self):
        self.runtime.folder.mkdir()
        (self.runtime.folder / ".twyne-ready").write_text(MANIFEST["revision"])
        worker = Mock()
        worker.stdout = io.StringIO("")
        worker.poll.return_value = 1
        with patch("server.subprocess.Popen", return_value=worker) as spawn:
            with self.assertRaisesRegex(RuntimeError, "Local inference failed"):
                self.runtime.ask(validate_request(request()))
            self.assertEqual(spawn.call_count, 1)
            self.assertEqual(self.runtime.status()["phase"], "error")

    def test_http_origin_host_and_json_boundaries(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler(self.runtime, {"https://twyne.love"}, 0))
        port = server.server_port
        server.RequestHandlerClass = handler(self.runtime, {"https://twyne.love"}, port)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        def call(path, origin="https://twyne.love", data=None, headers=None):
            return urlopen(Request(f"http://127.0.0.1:{port}{path}", data=data,
                headers={"Origin": origin, **(headers or {})}), timeout=3)
        try:
            with call("/status") as response:
                self.assertEqual(json.load(response)["model"], MODEL)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://twyne.love")
            for origin in ("https://evil.example", "null", ""):
                with self.assertRaises(HTTPError) as error:
                    call("/status", origin)
                self.assertEqual(error.exception.code, 403)
            with self.assertRaises(HTTPError) as error:
                call("/status", headers={"Host": f"rebound.example:{port}"})
            self.assertEqual(error.exception.code, 403)
            with self.assertRaises(HTTPError) as error:
                call("/download", data=b"{}")
            self.assertEqual(error.exception.code, 415)
            with self.assertRaises(HTTPError) as error:
                call("/v1/systemone", data=b"{}", headers={"Content-Type": "application/json"})
            self.assertEqual(error.exception.code, 422)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
