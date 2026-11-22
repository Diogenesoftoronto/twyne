"""Local d1 download manager; Python stdlib only until the writer downloads.

Run: python3 desktop/decision/server.py
Requires uv for the explicit install. The server never installs on startup.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import queue
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = Path(__file__).resolve().parent
MANIFEST = json.loads((HERE / "model.json").read_text())
MODEL = MANIFEST["repo"]
MODEL_BYTES = sum(entry["size"] for entry in MANIFEST["files"])


def terminate(process):
    if process is None or process.poll() is not None:
        return
    if os.name == "posix":
        os.killpg(process.pid, signal.SIGTERM)
    else:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        process.wait()


def read_result(process, timeout=110):
    result = queue.Queue()
    threading.Thread(target=lambda: result.put(process.stdout.readline()), daemon=True).start()
    try:
        return json.loads(result.get(timeout=timeout))
    except queue.Empty:
        raise RuntimeError("Local inference timed out")


def validate_request(data):
    if not isinstance(data, dict) or data.get("model") != MODEL:
        raise ValueError("Select LiquidAI/d1-2B")
    state, questions = data.get("state"), data.get("questions")
    if not isinstance(state, dict) or not all(isinstance(v, str) for v in state.values()):
        raise ValueError("Invalid state")
    if not isinstance(questions, dict) or not 1 <= len(questions) <= 64:
        raise ValueError("Invalid questions")
    for question in questions.values():
        if not isinstance(question, dict) or not isinstance(question.get("instructions"), str) or not question["instructions"].strip():
            raise ValueError("Invalid question")
        kind = question.get("type")
        if kind not in ("noul", "choice", "score"):
            raise ValueError("Unsupported question")
        if kind != "noul":
            criteria = question.get("criteria")
            expected = dict if kind == "choice" else list
            if not isinstance(criteria, expected) or not 2 <= len(criteria) <= 64:
                raise ValueError("Invalid criteria")
            if not all(isinstance(c, str) and c.strip() for c in criteria) or len(set(criteria)) != len(criteria):
                raise ValueError("Invalid criteria")
            if kind == "choice" and any(v is not None for v in criteria.values()):
                raise ValueError("Unsupported choice description")
    return {"state": state, "questions": questions}


class Runtime:
    def __init__(self, cache):
        self.cache = cache
        self.folder = cache / MANIFEST["revision"]
        self.lock = threading.Lock()
        self.phase = "not_downloaded"
        self.error = None
        self.worker = None
        self.download = None
        self.closed = False

    def installed(self):
        marker = self.folder / ".twyne-ready"
        return marker.is_file() and marker.read_text() == MANIFEST["revision"]

    def status(self):
        phase = self.phase
        if phase == "not_downloaded" and self.installed():
            phase = "downloaded"
        downloaded = sum((self.folder / e["path"]).stat().st_size
                         for e in MANIFEST["files"] if (self.folder / e["path"]).is_file())
        return {"model": MODEL, "revision": MANIFEST["revision"], "phase": phase,
                "downloadedBytes": downloaded, "totalBytes": MODEL_BYTES,
                "error": self.error, "offline": True}

    def command(self, mode):
        return [shutil.which("uv") or "uv", "run", "--frozen", *(["--offline"] if mode == "--serve" else []),
                "--script", str(HERE / "worker.py"), mode, str(self.folder)]

    def install(self):
        if not self.lock.acquire(blocking=False):
            raise RuntimeError("Local model is busy")
        try:
            if self.closed:
                raise RuntimeError("Local service is stopping")
            if not shutil.which("uv"):
                raise ValueError("Install uv first, then retry the download.")
            self.cache.mkdir(parents=True, exist_ok=True)
            # Includes Python dependencies, uv cache and float32 CPU runtime overhead.
            if shutil.disk_usage(self.cache).free < MODEL_BYTES + 6_000_000_000:
                raise ValueError("Free at least 10 GB on the model drive before downloading.")
            self.phase, self.error = "downloading", None
            def run():
                try:
                    if self.closed:
                        return
                    self.stop_worker()
                    self.download = subprocess.Popen(self.command("--download"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
                    if self.closed:
                        terminate(self.download)
                        return
                    code = self.download.wait()
                    if code or not self.installed():
                        raise RuntimeError("Download or verification failed. Check the connection and retry.")
                    self.phase = "downloaded"
                except Exception:
                    self.phase, self.error = "error", "Download or verification failed. Check disk space, uv and your connection, then retry."
                finally:
                    self.download = None
                    self.lock.release()
            threading.Thread(target=run, daemon=True).start()
        except Exception:
            self.lock.release()
            raise

    def stop_worker(self):
        if self.worker:
            terminate(self.worker)
            self.worker = None

    def ask(self, request):
        if not self.lock.acquire(blocking=False):
            raise RuntimeError("Local model is busy")
        try:
            deadline = time.monotonic() + 110
            if self.closed:
                raise RuntimeError("Local service is stopping")
            if not self.installed():
                raise ValueError("Download Local decisions first")
            if not self.worker or self.worker.poll() is not None:
                self.stop_worker()
                self.phase = "loading"
                env = {**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                       "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1"}
                self.worker = subprocess.Popen(self.command("--serve"), env=env, stdin=subprocess.PIPE,
                                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1, start_new_session=True)
                if not read_result(self.worker, max(0.1, deadline - time.monotonic())).get("ready"):
                    raise RuntimeError("Local runtime did not start")
            self.phase = "ready"
            self.worker.stdin.write(json.dumps(request) + "\n")
            self.worker.stdin.flush()
            result = read_result(self.worker, max(0.1, deadline - time.monotonic()))
            if "error" in result:
                raise RuntimeError("Local decision failed")
            return result
        except Exception:
            self.stop_worker()
            self.phase, self.error = "error", "Local inference failed. Check available memory and retry."
            raise RuntimeError(self.error)
        finally:
            self.lock.release()

    def close(self):
        self.closed = True
        if self.download:
            terminate(self.download)
        self.stop_worker()


def handler(runtime, origins, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # No manuscript, credentials or request logs.

        def allowed(self):
            return (self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}")
                    and self.headers.get("Origin") in origins)

        def reply(self, code, body):
            self.send_response(code)
            if self.allowed():
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
                self.send_header("Vary", "Origin")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())

        def do_OPTIONS(self):
            if not self.allowed():
                return self.reply(403, {"error": "Origin refused"})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")
            self.end_headers()

        def do_GET(self):
            if not self.allowed():
                return self.reply(403, {"error": "Origin refused"})
            self.reply(200, runtime.status()) if self.path == "/status" else self.reply(404, {})

        def do_POST(self):
            if not self.allowed():
                return self.reply(403, {"error": "Origin refused"})
            if self.headers.get("Content-Type") != "application/json":
                return self.reply(415, {"error": "JSON required"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 256_000:
                    return self.reply(413, {"error": "Request too large"})
                data = json.loads(self.rfile.read(size))
                if self.path == "/download":
                    runtime.install()
                    return self.reply(202, runtime.status())
                if self.path == "/v1/systemone":
                    return self.reply(200, runtime.ask(validate_request(data)))
                return self.reply(404, {})
            except ValueError as error:
                self.reply(422, {"error": str(error)})
            except RuntimeError as error:
                self.reply(503, {"error": str(error)})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--origin", action="append", default=["https://twyne.love"])
    parser.add_argument("--cache", type=Path, default=Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "twyne" / "decisions")
    args = parser.parse_args()
    runtime = Runtime(args.cache)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler(runtime, set(args.origin), args.port))
    print(f"Twyne local decisions: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        runtime.close()
        server.server_close()


if __name__ == "__main__":
    main()
