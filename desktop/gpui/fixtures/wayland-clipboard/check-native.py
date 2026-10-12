#!/usr/bin/env python3
"""Private Sway/pixman clipboard acceptance; never attaches to a user display.

Root must first apply/review integration.patch and build the fixture binary.
--smoke runs only owned-compositor/external-tool checks, with no GPUI claim.
No Cargo, Devenv, dependency installation, profile mutation, or network.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import tempfile
import time

FIXTURE = Path(__file__).resolve().parent
PROJECT = FIXTURE.parents[3]
# Headless tests need no session bus. The Nix session wrapper starts DBus,
# whose host configuration can drift under a saved development environment.
DEFAULT_SWAY = "/nix/store/ay76ixjw3dlg6zvfkwix0rnjvs4n9lqr-sway-unwrapped-1.12/bin/sway"
DEFAULT_WTYPE = "/nix/store/cwzg3yii4xv6hk1yn3jjgw14cxzy98qa-wtype-0.4/bin/wtype"
DEFAULT_ICD = "/nix/store/gqpsfqzgbcbwbh12n3sjxk2x4gqgy8lq-mesa-26.1.3/share/vulkan/icd.d/lvp_icd.x86_64.json"


def wait_for(predicate, label, seconds=10):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.025)
    raise AssertionError(f"Timed out: {label}")


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


class OwnedCompositor:
    def __init__(self, args):
        self.args = args
        self.root = Path(tempfile.mkdtemp(prefix="twyne-owned-wayland-"))
        self.root.chmod(0o700)
        self.runtime = self.root / "runtime"
        self.runtime.mkdir(mode=0o700)
        (self.runtime / ".twyne-owned-wayland").write_text("New owned Sway fixture, never an inherited display\n")
        self.processes = []
        self.log_handles = []
        self.env = dict(os.environ)
        for key in ("DISPLAY", "WAYLAND_DISPLAY", "WAYLAND_SOCKET", "SWAYSOCK", "I3SOCK",
                    "DBUS_SESSION_BUS_ADDRESS", "DBUS_STARTER_ADDRESS", "DBUS_STARTER_BUS_TYPE"):
            self.env.pop(key, None)
        self.env.update({"XDG_RUNTIME_DIR": str(self.runtime), "WLR_BACKENDS": "headless",
                         "WLR_RENDERER": "pixman", "WLR_LIBINPUT_NO_DEVICES": "1",
                         "XDG_SESSION_TYPE": "wayland", "XDG_CURRENT_DESKTOP": "sway",
                         "XDG_CONFIG_HOME": str(self.root / "config"),
                         "XDG_DATA_HOME": str(self.root / "data"),
                         "XDG_CACHE_HOME": str(self.root / "cache"),
                         "TWYNE_LOCAL_DATA_DIR": str(self.root / "local-data"),
                         "VK_DRIVER_FILES": args.icd})
        config = self.root / "sway.conf"
        config.write_text("xwayland disable\noutput HEADLESS-1 mode 1280x860\nseat seat0 fallback true\n"
                          "focus_follows_mouse no\ndefault_border pixel 0\n")
        try:
            self.launch(config)
        except BaseException:
            self.close()
            raise

    def launch(self, config):
        args = self.args
        self.sway = self.start([args.sway, "--unsupported-gpu", "-c", str(config)], "sway")
        self.display = wait_for(lambda: next((p.name for p in self.runtime.glob("wayland-*")
                                             if stat.S_ISSOCK(p.stat().st_mode)), None), "private Wayland socket")
        self.socket = wait_for(lambda: next((str(p) for p in self.runtime.glob("sway-ipc*.sock")
                                            if stat.S_ISSOCK(p.stat().st_mode)), None), "private Sway IPC")
        self.env.update({"WAYLAND_DISPLAY": self.display, "SWAYSOCK": self.socket})
        outputs = self.ipc("get_outputs", kind=True)
        assert any(o["name"] == "HEADLESS-1" and o["active"] and o["current_mode"]["width"] == 1280
                   and o["current_mode"]["height"] == 860 for o in outputs), outputs
        self.outputs = outputs
        # Keep one virtual keyboard present between injections so removing an
        # ephemeral wtype client does not accidentally turn a held-preflight
        # freshness case into a seat-capability/focus-loss case.
        self.keyboard = self.start([args.wtype, "-s", "300000"], "virtual-keyboard-keeper")
        def keyboard_inputs():
            inputs = self.ipc("get_inputs", kind=True)
            return inputs if any(i.get("type") == "keyboard" for i in inputs) else None
        self.inputs = wait_for(keyboard_inputs, "owned virtual keyboard")

    def start(self, command, name, stdin=None):
        log = (self.root / f"{name}.log").open("wb")
        self.log_handles.append(log)
        process = subprocess.Popen(command, env=self.env, cwd=PROJECT, stdin=stdin or subprocess.DEVNULL,
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        self.processes.append(process)
        return process

    def ipc(self, command, kind=False):
        argv = [self.args.swaymsg, "-s", self.socket, "-r"]
        if kind:
            argv += ["-t", command]
        else:
            argv += [command]
        result = subprocess.run(argv, env=self.env, capture_output=True, timeout=5, check=True)
        response = json.loads(result.stdout)
        if not kind:
            assert all(item.get("success") for item in response), response
        return response

    def key(self, letter, control=True, shift=False):
        argv = [self.args.wtype]
        if control:
            argv += ["-M", "ctrl"]
        if shift:
            argv += ["-M", "shift"]
        argv += ["-k", letter]
        if shift:
            argv += ["-m", "shift"]
        if control:
            argv += ["-m", "ctrl"]
        argv += ["-s", "150"]
        subprocess.run(argv, env=self.env, check=True, capture_output=True, timeout=5)

    def external_copy(self, value, mime="text/plain;charset=utf-8", name="external"):
        path = self.root / f"{name}.payload"
        path.write_bytes(value.encode("utf-8"))
        with path.open("rb") as data:
            process = self.start([self.args.wl_copy, "--foreground", "--type", mime], name, stdin=data)
        wait_for(lambda: mime in self.external_types(), "external selection offer")
        return process

    def external_types(self):
        result = subprocess.run([self.args.wl_paste, "--list-types"], env=self.env, capture_output=True, timeout=5)
        return result.stdout.decode("utf-8").splitlines() if result.returncode == 0 else []

    def external_read(self, mime):
        result = subprocess.run([self.args.wl_paste, "--no-newline", "--type", mime], env=self.env,
                                capture_output=True, timeout=8, check=True)
        return result.stdout.decode("utf-8")

    def close(self):
        for process in reversed(self.processes):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
        for process in reversed(self.processes):
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=3)
        for handle in self.log_handles:
            handle.close()


class Native:
    def __init__(self, compositor, name, **config):
        self.compositor = compositor
        self.name = name
        self.output = compositor.root / f"{name}.json"
        self.command = compositor.root / f"{name}.command.json"
        self.generation = 0
        self.app_id = "twyne-owned-wayland-" + name
        self.config = {"mode": "transport", "app_id": self.app_id, "output": str(self.output),
                       "command_file": str(self.command), "html": "<p>Native</p>", **config}
        path = compositor.root / f"{name}.config.json"
        path.write_text(json.dumps(self.config, ensure_ascii=False))
        self.process = compositor.start([str(compositor.args.binary), str(compositor.runtime), compositor.display, str(path)], name)
        wait_for(lambda: self.value().get("ready"), f"native {name} ready")
        assert self.value()["backend"] == "Wayland"
        self.focus()

    def value(self):
        if self.process.poll() is not None:
            raise AssertionError(f"Native fixture exited {self.process.returncode}: {self.name}.log")
        return read_json(self.output) or {}

    def focus(self):
        self.compositor.ipc(f'[app_id="{self.app_id}"] focus')
        def focused():
            def walk(node):
                if node.get("app_id") == self.app_id and node.get("focused"):
                    return True
                return any(walk(child) for child in node.get("nodes", []) + node.get("floating_nodes", []))
            return walk(self.compositor.ipc("get_tree", kind=True))
        wait_for(focused, f"real {self.name} keyboard focus")
        # Offer delivery precedes keyboard enter but foreground fixture action
        # dispatch also needs one rendered focus update.
        time.sleep(0.1)

    def control(self, command, **values):
        self.generation += 1
        temporary = self.command.with_suffix(".tmp")
        temporary.write_text(json.dumps({"generation": self.generation, "command": command, **values}))
        temporary.replace(self.command)

    def publish(self):
        self.focus()
        previous = self.value().get("operations", 0)
        self.compositor.key("c")
        value = wait_for(lambda: (v if (v := self.value()).get("operations", 0) > previous
                                 and not (v.get("publication") or {}).get("pending", True) else None), "real keyboard publication")
        assert value["error"] is None, value
        assert value["publication"]["flushed_request"] and isinstance(value["publication"]["input_serial"], int), value
        return value

    def read(self):
        self.focus()
        previous = self.value().get("operations", 0)
        self.compositor.key("v")
        return wait_for(lambda: (v if (v := self.value()).get("operations", 0) > previous
                                and not (v.get("read") or {}).get("pending", True) else None), "real keyboard read")

    def quit(self):
        self.control("quit")
        assert self.process.wait(timeout=8) == 0, f"Native close failed: {self.name}.log"
        log = (self.compositor.root / f"{self.name}.log").read_text(errors="replace")
        assert "leak" not in log.lower() and "panicked at" not in log, log[-4000:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=PROJECT / "desktop/gpui/target/debug/examples/twyne-wayland-clipboard-probe")
    parser.add_argument("--sway", default=DEFAULT_SWAY)
    parser.add_argument("--swaymsg", default=str(Path(DEFAULT_SWAY).with_name("swaymsg")))
    parser.add_argument("--wtype", default=DEFAULT_WTYPE)
    parser.add_argument("--wl-copy", default="/home/diogenes/.nix-profile/bin/wl-copy")
    parser.add_argument("--wl-paste", default="/home/diogenes/.nix-profile/bin/wl-paste")
    parser.add_argument("--icd", default=DEFAULT_ICD)
    parser.add_argument("--output", type=Path, default=Path("/tmp/twyne-wayland-native-report.json"))
    parser.add_argument("--smoke", action="store_true", help="Owned Sway/external utility proof only, not native integration")
    args = parser.parse_args()
    for tool in (args.sway, args.swaymsg, args.wtype, args.wl_copy, args.wl_paste):
        if not Path(tool).is_file():
            raise SystemExit(f"Existing test tool missing: {tool}; this driver never installs tools.")
    if not args.smoke and not args.binary.is_file():
        raise SystemExit("Root must first review/apply integration.patch and build the native probe; existing runtime was not changed.")
    checks = []
    compositor = OwnedCompositor(args)
    def check(name, condition, detail=None):
        assert condition, f"{name}: {detail}"
        checks.append({"name": name, "passed": True, "detail": detail})
    try:
        check("private compositor", compositor.sway.poll() is None and stat.S_IMODE(compositor.runtime.stat().st_mode) == 0o700,
              {"root": str(compositor.root), "outputs": compositor.outputs, "inputs": compositor.inputs})
        foreign = "<p><strong>Actual foreign HTML 🦊</strong></p>"
        compositor.external_copy(foreign, "text/html", "initial-foreign")
        check("external HTML through owned Sway", compositor.external_read("text/html") == foreign)
        if not args.smoke:
            negative = Native(compositor, "no-input-serial", startup_publish=True)
            v = wait_for(lambda: (v if (v := negative.value()).get("error") else None), "missing real serial error")
            check("missing input serial rejects publication", not v["publication"].get("flushed_request", False)
                  and ("serial" in v["error"] or "focused" in v["error"]), v["error"])
            check("rejected copy retains foreign clipboard", compositor.external_read("text/html") == foreign)
            negative.quit()

            html = (FIXTURE / "rich.html").read_text().strip()
            producer = Native(compositor, "native-producer", html=html)
            published = producer.publish()
            mimes = wait_for(lambda: (types if "application/x-twyne-rich-fragment+json" in (types := compositor.external_types()) else None), "native rich MIME")
            exported_html = compositor.external_read("text/html")
            exported_text = compositor.external_read("text/plain;charset=utf-8")
            metadata = compositor.external_read("application/x-twyne-rich-fragment+json")
            envelope = json.loads(metadata)
            check("native copy offers real HTML/text/envelope", "text/html" in mimes and exported_text == envelope["text"]
                  and "<strong>" in exported_html, published["publication"])
            consumer = Native(compositor, "native-consumer")
            idle = consumer.value()
            check("keyboard focus alone triggers no clipboard action", idle["operations"] == 0
                  and idle["publication"] is None and idle["read"] is None)
            result = consumer.read()
            check("two native processes preserve exact rich envelope", result["error"] is None and result["read"]["kind"] == "rich"
                  and result["read"]["html"] == exported_html and result["read"]["native_metadata"] == metadata
                  and result["read"]["fragment_html"] == envelope["html"], result.get("error"))
            for marker in ('data-comment-id="review"', 'data-future-math="keep"', 'data-endnote-text="Authored note"',
                           'data-typst-source="#keep[原稿]"', 'data-image-src="data:image/png;base64,Kept"'):
                check("rich payload preserves " + marker.split("=")[0], marker in result["read"]["fragment_html"])

            producer.focus()
            producer.control("publish")
            v = wait_for(lambda: (v if (v := producer.value()).get("error") else None), "new focus epoch without press")
            check("focus return cannot reuse old press serial", "serial" in v["error"] and not v["publication"].get("flushed_request", False), v["error"])
            serial_cut = Native(compositor, "focus-return-cut", mode="editor", html="<p>Protected cut</p>", selection_start=0, selection_end=13)
            compositor.key("c")
            wait_for(lambda: compositor.external_read("text/plain;charset=utf-8") == "Protected cut", "current-keyboard copy before focus loss")
            consumer.focus()
            serial_cut.focus()
            protected_cut = serial_cut.value()["editor"]["html"]
            serial_cut.control("cut")
            v = wait_for(lambda: (v if (v := serial_cut.value())["editor"]["error"] else None), "Cut refused without current-epoch press")
            check("focus-loss Cut refusal preserves text and history", "serial" in v["editor"]["error"]
                  and v["editor"]["html"] == protected_cut and not v["editor"]["can_undo"], v["editor"]["error"])
            serial_cut.quit()

            compositor.external_copy(foreign, "text/html", "foreign-html")
            result = consumer.read()
            check("foreign HTML uses actual advertised representation", result["error"] is None and result["read"]["kind"] == "rich"
                  and result["read"]["html"] == foreign and result["read"]["native_metadata"] is None
                  and result["read"]["text"] == compositor.external_read("text/plain;charset=utf-8")
                  and "<strong>Actual foreign HTML 🦊</strong>" in result["read"]["fragment_html"])
            large = ("literal <b>🦊</b>\r\n原稿\n" * 40000)
            compositor.external_copy(large, "text/plain;charset=utf-8", "foreign-large")
            result = consumer.read()
            check("large UTF8 transfer stays literal with exact CRLF bytes", result["error"] is None and result["read"]["kind"] == "plain"
                  and result["read"]["text"] == large and result["read"]["html"] is None and result["read"]["fragment_html"] is None,
                  {"bytes": len(large.encode("utf-8"))})

            malformed = json.dumps({"format": "twyne.rich-fragment", "version": 1, "html": "<p>block</p>",
                                    "text": "block", "inline": True, "open_start": True, "open_end": True})
            bad = Native(compositor, "malformed-producer", text="block", offer_html="<p>fallback</p>", native_metadata=malformed)
            bad.publish()
            result = consumer.read()
            check("recognized malformed envelope rejects before import", result["error"] is not None, result["error"])
            bad.quit()
            producer.publish()

            initial = "<p>LeftRight</p>"
            preflight = compositor.root / "editor-preflight.html"
            editor = Native(compositor, "editor-actions", mode="editor", html=initial, selection_start=4, preflight_file=str(preflight))
            before = editor.value()["editor"]["html"]
            compositor.key("v")
            pasted = wait_for(lambda: (v if (v := editor.value())["editor"]["revision"] > 0
                                      or v["editor"]["error"] else None), "native paste with actual semantic preflight")
            check("real native paste preflights original converter", pasted["editor"]["error"] is None and pasted["editor"]["can_undo"]
                  and preflight.with_suffix(".typ").is_file(), pasted["editor"]["error"])
            pasted_html = pasted["editor"]["html"]
            compositor.key("z")
            wait_for(lambda: editor.value()["editor"]["html"] == before, "one native Undo")
            check("one native Undo restores exact document", editor.value()["editor"]["html"] == before)
            compositor.key("z", shift=True)
            wait_for(lambda: editor.value()["editor"]["html"] == pasted_html, "one native Redo")
            check("one native Redo restores exact rich insertion", editor.value()["editor"]["html"] == pasted_html)
            length = editor.value()["editor"]["text_len"]
            editor.control("selection", start=0, end=length)
            wait_for(lambda: editor.value()["editor"]["selection"]["head"] == length, "actual copy selection")
            compositor.key("c")
            wait_for(lambda: compositor.external_read("application/x-twyne-rich-fragment+json") != metadata, "actual editor copy")
            copied = json.loads(compositor.external_read("application/x-twyne-rich-fragment+json"))
            check("actual editor Copy reaches external consumer", copied["html"] == pasted_html)
            compositor.key("x")
            wait_for(lambda: editor.value()["editor"]["html"] != pasted_html, "native cut after serial publication")
            compositor.key("z")
            wait_for(lambda: editor.value()["editor"]["html"] == pasted_html, "one native cut Undo")
            check("native Cut waits for publication and has one Undo", json.loads(compositor.external_read("application/x-twyne-rich-fragment+json"))["html"] == pasted_html)
            editor.quit()

            for race in ("owner", "typing", "selection", "read-only", "replace-editor", "blur"):
                producer.publish()
                released = compositor.root / f"race-{race}.release"
                preflight = compositor.root / f"race-{race}.preflight.html"
                view = Native(compositor, "race-" + race, mode="editor", html=initial, selection_start=4,
                              preflight_file=str(preflight), release_file=str(released))
                compositor.key("v")
                wait_for(preflight.is_file, "held original preflight for " + race)
                if race == "owner":
                    compositor.external_copy("Replacement owner", name="race-owner-replacement")
                    wait_for(lambda: compositor.external_read("text/plain;charset=utf-8") == "Replacement owner", "replacement owner")
                elif race == "typing":
                    compositor.key("x", control=False)
                    wait_for(lambda: "LeftxRight" in view.value()["editor"]["text"], "native typing during paste")
                elif race == "selection":
                    view.control("selection", start=0, end=0)
                    wait_for(lambda: view.value()["editor"]["selection"]["head"] == 0, "selection changed")
                elif race == "read-only":
                    view.control("read-only")
                    wait_for(lambda: view.value()["editor"]["read_only"], "read-only changed")
                elif race == "replace-editor":
                    view.control("replace-editor")
                    wait_for(lambda: "Replacement editor" in view.value()["editor"]["text"], "editor changed")
                else:
                    view.control("blur")
                    time.sleep(0.15)
                protected = view.value()["editor"]["html"]
                released.write_text("release actual converter preflight\n")
                time.sleep(0.8)
                check("stale " + race + " paste cannot mutate live document", view.value()["editor"]["html"] == protected)
                view.quit()

            survivor = "Foreign selection survives native shutdown 🦊"
            compositor.external_copy(survivor, name="foreign-survivor")
            consumer.quit()
            producer.quit()
            check("normal native shutdown preserves unrelated clipboard", compositor.external_read("text/plain;charset=utf-8") == survivor)
        args.output.write_text(json.dumps({"kind": "private Sway actual clipboard acceptance", "runtimeIntegrated": not args.smoke,
                                           "actualCompositor": True, "nativeRuntimeTested": not args.smoke,
                                           "root": str(compositor.root), "checks": checks,
                                           "remaining": ["other compositors/devices", "primary-selection unchanged path not independently exercised",
                                                         "actual malicious slow/oversized compositor source (pipe limits tested separately)"]}, indent=2) + "\n")
        print(f"{len(checks)}/{len(checks)} passed; report {args.output}; owned logs {compositor.root}")
    except Exception as error:
        args.output.write_text(json.dumps({"actualCompositor": True, "nativeRuntimeTested": not args.smoke,
                                           "root": str(compositor.root), "checks": checks, "error": str(error)}, indent=2) + "\n")
        raise
    finally:
        compositor.close()


if __name__ == "__main__":
    main()
