#!/usr/bin/env python3
"""Cross-process proof on a newly owned Xvfb; never inherits DISPLAY."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

PROBE = Path(__file__).resolve().parents[2] / "target/debug/examples/twyne-clipboard-probe"
XVFB = shutil.which("Xvfb")
XCLIP = shutil.which("xclip") or "/usr/bin/xclip"
if not XVFB:
    raise SystemExit("Run this bounded fixture inside devenv shell (Xvfb required).")
if not PROBE.exists():
    raise SystemExit("Build --example twyne-clipboard-probe first.")

processes = []
results = []
with tempfile.TemporaryDirectory(prefix="twyne-owned-clipboard-") as directory:
    root = Path(directory)
    with (root / "xvfb.log").open("wb") as log:
        xvfb = subprocess.Popen([XVFB, "-displayfd", "1", "-screen", "0", "1024x768x24", "-nolisten", "tcp"], stdout=subprocess.PIPE, stderr=log)
        display = ":" + xvfb.stdout.readline().decode().strip()
        if display == ":":
            raise RuntimeError("Owned Xvfb did not allocate a display")
        env = {**os.environ, "DISPLAY": display}
        env.pop("WAYLAND_DISPLAY", None)
        env.pop("GPUI_HEADLESS", None)
        env["GPUI_X11_SCALE_FACTOR"] = "1"
        env["XDG_RUNTIME_DIR"] = str(root)
        if env.get("TWYNE_GPUI_RENDER_ICD"):
            env["VK_DRIVER_FILES"] = env["TWYNE_GPUI_RENDER_ICD"]

        def wait(path, process=None):
            until = time.monotonic() + 10
            while not path.exists():
                if process is not None and process.poll() is not None:
                    raise RuntimeError(f"Provider exited before ready: {process.stderr.read().decode()}")
                if time.monotonic() >= until:
                    raise RuntimeError(f"Timed out waiting for {path.name}")
                time.sleep(0.01)

        def provider(name, offer=None, mode="publish"):
            file = root / f"{name}.json"
            file.write_text(json.dumps(offer or {}), encoding="utf8")
            ready = root / f"{name}.ready"
            stop = root / f"{name}.stop"
            process = subprocess.Popen([str(PROBE), mode, display, str(file), str(ready), str(stop)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            processes.append((process, stop))
            wait(ready, process)
            return process

        def external(target, data):
            # -quiet keeps the owner in this tracked process, with no daemon
            # escaping cleanup onto any display.
            process = subprocess.Popen([XCLIP, "-display", display, "-selection", "clipboard", "-target", target, "-in", "-quiet"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            processes.append((process, None))
            process.stdin.write(data)
            process.stdin.close()
            time.sleep(0.08)
            return process

        def read(name, success=True, seconds=8):
            file = root / f"read-{name}.json"
            start = time.monotonic()
            result = subprocess.run([str(PROBE), "read", display, str(file)], env=env, capture_output=True, timeout=seconds)
            elapsed = time.monotonic() - start
            if success:
                assert result.returncode == 0, result.stderr.decode()
                return json.loads(file.read_text()), elapsed
            assert result.returncode != 0, "A guarded clipboard was unexpectedly accepted"
            return result.stderr.decode(), elapsed

        def native_view(name, race=""):
            config = root / f"ui-{name}.json"
            output = root / f"ui-{name}-result.json"
            config.write_text(json.dumps({"output": str(output), "race": race}))
            result = subprocess.run([str(PROBE), "ui", display, str(config)], env=env, capture_output=True, timeout=20)
            assert result.returncode == 0, result.stderr.decode()
            proof = json.loads(output.read_text())
            assert proof["backend"] == "X11" and proof["canonical_context_unchanged"]
            return proof

        try:
            rich = '<p>Copy <strong>🦊é</strong><span data-comment-id="review" data-future-comment="keep">東京</span><span data-type="inline-math" data-latex="E=mc^2" data-future-math="keep"></span><sup data-type="endnote" data-endnote-text="Authored note" data-future-note="keep"></sup><span data-type="raw-typst-inline" data-typst-source="#keep[原稿]" data-future-source="keep"></span>.</p>'
            provider("native-rich", {"html": rich}, "publish-rich")
            native, _ = read("native-rich")
            assert native["kind"] == "rich" and native["fragment_html"] == rich
            assert native["native_metadata"] and native["owner_current"]
            for target, expected in [("text/html", native["html"]), ("UTF8_STRING", native["text"]), ("application/x-twyne-rich-fragment+json", native["native_metadata"])]:
                result = subprocess.run([XCLIP, "-display", display, "-selection", "clipboard", "-out", "-target", target], env=env, capture_output=True, timeout=8)
                assert result.returncode == 0 and result.stdout.decode() == expected, (target, result.stderr.decode())
            results.append("Native producer → separate native consumer + xclip HTML/plain/native MIME; marks, source atoms, notes, comments and unknown metadata exact")

            web = json.loads((Path(__file__).parent / "clipboard-web-reference.json").read_text())
            html = web["cases"][0]["html"]
            external("text/html", html.encode())
            received, _ = read("external-html")
            assert received["kind"] == "rich" and "data-pm-slice" not in received["fragment_html"]
            assert 'data-comment-id="comment-1"' in received["fragment_html"]
            assert 'data-typst-source="#keep[原稿]"' in received["fragment_html"]
            results.append("xclip original-browser PM HTML → separate native consumer; actual source/mark/note metadata retained")

            large = '<p data-future="keep">' + ("🦊東京 " * 240_000) + '</p>'
            external("text/html", large.encode())
            received, _ = read("external-incr")
            assert received["html"] == large and received["kind"] == "rich"
            assert received["incremental_transfers"] >= 1
            assert received["fragment_html"] == large.removeprefix('<p data-future="keep">').removesuffix('</p>')
            provider("native-incr", {"html": large}, "publish-rich")
            result = subprocess.run([XCLIP, "-display", display, "-selection", "clipboard", "-out", "-target", "text/html"], env=env, capture_output=True, timeout=8)
            assert result.returncode == 0 and len(result.stdout) > 64 * 1024
            received, _ = read("native-incr")
            assert received["incremental_transfers"] >= 1
            assert result.stdout.decode() == received["html"] and received["fragment_html"] == large
            results.append(f"{len(large.encode()):,}-byte Unicode HTML transported in both directions through real bounded INCR (including xclip's empty size hint)")

            external("UTF8_STRING", "Plain 🦊東京\r\nnext".encode())
            received, _ = read("plain")
            assert received["kind"] == "plain" and received["text"] == "Plain 🦊東京\r\nnext"
            results.append("External UTF-8 plain-text fallback retained")

            native_html = '<p data-pm-slice="1 1 []"><strong>🦊東京</strong><sup data-type="endnote" data-endnote-text="Authored note" data-future-note="keep"></sup></p>'
            external("text/html", native_html.encode())
            proof = native_view("paste-undo")
            assert proof["error"] is None and proof["can_undo"]
            assert '<strong>🦊東京</strong>' in proof["pasted_html"]
            assert 'data-future-note="keep"' in proof["pasted_html"]
            assert proof["undo_html"] == proof["initial_html"]
            assert proof["redo_html"] == proof["pasted_html"]
            assert proof["copy"]["html"] == proof["copy"]["external_html"]
            assert "#let preserved = [Keep]" in proof["converted_source"]
            results.append("Actual GPUI X11 Paste/Copy/Undo/Redo actions: original canonical preflight, one undo, authored preamble retained, separate xclip HTML consumer exact")

            for race in ["selection", "editor", "read-only", "focus", "owner"]:
                external("text/html", native_html.encode())
                proof = native_view(race, race)
                expected = "<p>Replacement editor</p>" if race == "editor" else proof["initial_html"]
                assert proof["current_html"] == expected and not proof["can_undo"], (race, proof)
                results.append(f"Actual native late-{race} preflight race discarded without pasted content/history/source mutation")

            # Byte attributes fit the native HTML/tree limits but the original
            # image serializer duplicates source enough to exceed 5m UTF-16.
            canonical_overflow = '<figure data-type="image"><img src="data:image/png;base64,' + ("A" * 3_000_000) + '"></figure>'
            external("text/html", canonical_overflow.encode())
            proof = native_view("canonical-bound")
            assert proof["error"] and "5 MB" in proof["error"], {"error": proof["error"], "canonical_context_unchanged":proof["canonical_context_unchanged"]}
            assert proof["current_html"] == proof["initial_html"] and not proof["can_undo"]
            assert proof["converted_source"] is None
            results.append("Actual original canonical 5m source rejection preserved native tree, history and exact authored source before insertion")

            result_file = root / "owner-check.json"
            ready = root / "owner-check.ready"
            release = root / "owner-check.release"
            checker = subprocess.Popen([str(PROBE), "owner-check", display, str(result_file), str(ready), str(release)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            processes.append((checker, release))
            wait(ready, checker)
            external("UTF8_STRING", b"New selection owner")
            release.touch()
            _, error = checker.communicate(timeout=8)
            assert checker.returncode == 0, error.decode()
            assert json.loads(result_file.read_text())["owner_current"] is False
            results.append("Clipboard owner replacement invalidated an already-read snapshot")

            external("text/rtf", b"{\\rtf1 RTF only}")
            error, _ = read("rtf", False)
            assert "RTF import is not yet available" in error
            results.append("RTF-only input rejected explicitly")

            provider("oversized", mode="oversized-incr")
            error, elapsed = read("oversized", False)
            assert "size limit" in error and elapsed < 2
            results.append("Advertised 64 MiB + 1 INCR rejected before allocation")
            provider("stalled", mode="stalled-incr")
            error, elapsed = read("stalled", False)
            assert "timed out" in error and 3.5 <= elapsed < 6
            results.append("Unresponsive INCR peer timed out at four seconds")
            print(json.dumps({"owned_display": display, "cases": results}, indent=2))
        finally:
            for process, stop in reversed(processes):
                if stop is not None:
                    stop.touch()
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            xvfb.terminate()
            xvfb.wait(timeout=3)
