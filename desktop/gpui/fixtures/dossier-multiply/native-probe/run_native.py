#!/usr/bin/env python3
"""Parent-only execution: one private Xvfb, five independent native clients.

Never runs Cargo/Devenv, never uses the user's display, never removes receipts.
Requires an already compiled probe and an explicitly saved runtime environment.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import time
from check_pixels import compare
from x11_driver import OwnedX11


ALLOWED_ENV = {
    "PATH", "LD_LIBRARY_PATH", "VK_ICD_FILENAMES", "VK_DRIVER_FILES", "XDG_DATA_DIRS",
    "LIBGL_ALWAYS_SOFTWARE", "MESA_VK_WSI_PRESENT_MODE", "FONTCONFIG_FILE", "FONTCONFIG_PATH",
}


def argv(command):
    return ["rtk", "proxy", *map(str, command)]


def run(command, env, **options):
    return subprocess.run(argv(command), env=env, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, **options).stdout


def wait(predicate, app=None, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if app is not None and app.poll() is not None:
            raise RuntimeError(f"Owned native probe exited early: {app.returncode}")
        try:
            value = predicate()
        except (subprocess.CalledProcessError, IndexError):
            value = None
        if value:
            return value
        time.sleep(0.05)
    raise TimeoutError("Owned probe condition timed out; all files are retained")


def observed(path):
    try:
        receipt = json.loads(path.read_text())
        return receipt if receipt.get("paint_submissions", 0) > 0 else None
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def capture(window_id, destination, env):
    xwd = destination.with_suffix(".xwd")
    run(["xwd", "-silent", "-id", window_id, "-out", xwd], env)
    run(["magick", xwd, "-depth", "8", destination], env)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--runtime-env", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not args.binary.resolve().is_file():
        parser.error("Root must compile the example before running this driver")
    if args.output.exists():
        parser.error("Use a NEW output directory; retained failures are never overwritten")
    args.output.mkdir(parents=True)
    runtime = json.loads(args.runtime_env.read_text())
    if not isinstance(runtime, dict) or any(key not in ALLOWED_ENV for key in runtime):
        parser.error("Runtime env must contain only the documented non-credential keys")
    env = {key: os.environ[key] for key in ["LANG", "LC_ALL", "PATH"] if key in os.environ}
    env.update({key: str(value) for key, value in runtime.items()})
    for folder, key in [("home", "HOME"), ("runtime", "XDG_RUNTIME_DIR"),
                        ("config", "XDG_CONFIG_HOME"), ("cache", "XDG_CACHE_HOME"),
                        ("data", "XDG_DATA_HOME")]:
        private = (args.output / folder).resolve()
        private.mkdir(mode=0o700)
        env[key] = str(private)
    private_runtime = Path(env["XDG_RUNTIME_DIR"])
    env.update({
        "XDG_SESSION_TYPE": "x11",
        "DBUS_SESSION_BUS_ADDRESS": f"unix:path={private_runtime / 'no-session-bus'}",
        "DBUS_SYSTEM_BUS_ADDRESS": f"unix:path={private_runtime / 'no-system-bus'}",
        "PULSE_SERVER": f"unix:{private_runtime / 'no-pulse'}",
        "PIPEWIRE_REMOTE": str(private_runtime / "no-pipewire"),
    })
    read_fd, write_fd = os.pipe()
    server_log = (args.output / "xvfb.log").open("wb")
    server = subprocess.Popen(argv(["Xvfb", "-displayfd", write_fd, "-screen", "0", "900x720x24", "-nolisten", "tcp"]),
                              pass_fds=(write_fd,), stdout=subprocess.DEVNULL, stderr=server_log,
                              start_new_session=True, env=env)
    os.close(write_fd)
    app = None
    x11 = None
    receipt = {"schema": 1, "scope": "actual private-X11 shader/framebuffer acceptance only",
               "executed": True, "binary_sha256": hashlib.sha256(args.binary.read_bytes()).hexdigest(),
               "cases": [], "failures": [], "source_radial_raster_parity": False,
               "framebuffer_alpha_measured": False, "atlas_adjacency_observed": False}
    baseline = None
    baseline_receipt = None
    try:
        if not select.select([read_fd], [], [], 8)[0]:
            raise TimeoutError("Private Xvfb did not supply its own display")
        number = os.read(read_fd, 64).decode().strip()
        if not number.isdigit():
            raise ValueError("Private displayfd protocol failed")
        display = f":{number}"
        env["DISPLAY"] = display
        env["TWYNE_MULTIPLY_OWNED_DISPLAY"] = display
        x11 = OwnedX11(env, args.output / "actual-x11-events.json")
        for mode in ["baseline", "multiply", "normal-alpha", "per-layer", "beneath"]:
            folder = args.output / mode
            folder.mkdir()
            manifest = folder / "native.json"
            log = (folder / "app.log").open("wb")
            app = subprocess.Popen(argv([args.binary.resolve(), display, mode, manifest.resolve()]),
                                   env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            case = {"mode": mode, "errors": []}
            try:
                ready = wait(lambda: observed(manifest), app)
                window_id = wait(lambda: x11.find_named_client(
                    "Twyne Multiply Probe", folder / "x11-discovery.json"), app)
                # Require two pixel-identical actual client captures. No font,
                # pixel-origin, device-size, or animation correction is applied.
                previous = None
                stable = 0
                for attempt in range(20):
                    shot = folder / f"candidate-{attempt}.png"
                    capture(window_id, shot, env)
                    digest = hashlib.sha256(run(["magick", shot, "-depth", "8", "rgb:-"], env)).hexdigest()
                    stable = stable + 1 if digest == previous else 0
                    previous = digest
                    if stable >= 1:
                        break
                    time.sleep(0.12)
                else:
                    raise RuntimeError("Actual live frame did not stabilize")
                final = folder / "frame.png"
                final.write_bytes(shot.read_bytes())
                ready = observed(manifest)
                if mode == "baseline":
                    baseline, baseline_receipt = final, ready
                    case["baseline_recorded"] = True
                else:
                    result = compare(baseline, baseline_receipt, final, ready, env=env)
                    (folder / "pixels.json").write_text(json.dumps(result, indent=2) + "\n")
                    passed = result["accepted_correct_multiply"] if mode == "multiply" else result["wrong_mode_detected"]
                    case["pixel_contract_passed"] = passed
                    if not passed:
                        case["errors"].append("Actual pixel contract failed; see pixels.json")
                if mode == "multiply":
                    # These are real retained GPUI controls, not synthetic view
                    # mutation. Interaction screenshots are separate from the
                    # unchanged-scene pixel comparisons above.
                    x11.click_control(ready, "live-button", window_id)
                    ready = wait(lambda: (value if value and value["counter"] == 1 else None)
                                 if (value := observed(manifest)) is not None else None, app)
                    x11.click_control(ready, "live-field", window_id)
                    ready = wait(lambda: (value if value and value["input_focused"] else None)
                                 if (value := observed(manifest)) is not None else None, app)
                    x11.press(window_id, "a", control=True)
                    x11.type_ascii(window_id, "LIVE FIELD CHECK")
                    ready = wait(lambda: (value if value and value["input_text"] == "LIVE FIELD CHECK" else None)
                                 if (value := observed(manifest)) is not None else None, app)
                    old_epoch = ready["epoch"]
                    x11.click_control(ready, "next-palette", window_id)
                    ready = wait(lambda: (value if value and value["epoch"] > old_epoch and value["theme"] == "nightpress" else None)
                                 if (value := observed(manifest)) is not None else None, app)
                    capture(window_id, folder / "nightpress-interaction.png", env)
                    x11.click_control(ready, "retire", window_id)
                    ready = wait(lambda: (value if value and value["pending_retired_preparations"] == 0 and value["atlas_retirement"] else None)
                                 if (value := observed(manifest)) is not None else None, app)
                    retired = [row for row in ready["atlas_retirement"] if "had_atlas_entry" in row]
                    if not any(row["had_atlas_entry"] for row in retired) or any(row["has_atlas_entry_after"] or row["error"] for row in retired):
                        case["errors"].append("Actual atlas entry retirement failed")
                    case["native_live_controls"] = {"counter": ready["counter"], "input_text": ready["input_text"],
                                                     "palette_epoch": ready["epoch"], "retired_entries": retired}
                    x11.resize(window_id, 820, 660)
                    ready = wait(lambda: (value if value and value["root_bounds"][2:] == [820, 660] else None)
                                 if (value := observed(manifest)) is not None else None, app)
                    capture(window_id, folder / "resized.png", env)
                    case["actual_resize"] = ready["root_bounds"]
                    case["dpr_transition_executed"] = False
                x11.focus(window_id)
                x11.press(window_id, "q", control=True)
                app.wait(timeout=8)
                case["exit_code"] = app.returncode
                if app.returncode != 0:
                    case["errors"].append("Native probe did not exit cleanly")
            except Exception as error:
                case["errors"].append(str(error))
            finally:
                if app.poll() is None:
                    case["forced_cleanup"] = True
                    os.killpg(app.pid, signal.SIGTERM)
                    try:
                        app.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        os.killpg(app.pid, signal.SIGKILL)
                        app.wait()
                log.close()
                app = None
            receipt["cases"].append(case)
            receipt["failures"].extend({"mode": mode, "message": error} for error in case["errors"])
    except Exception as error:
        receipt["failures"].append({"mode": "runner", "message": str(error)})
    finally:
        if x11 is not None:
            receipt["x11_protocol_errors"] = x11.close()
            if receipt["x11_protocol_errors"]:
                receipt["failures"].append({"mode": "runner", "message": "Actual X11 protocol errors; see actual-x11-events.json"})
        os.close(read_fd)
        os.killpg(server.pid, signal.SIGTERM)
        try:
            server.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(server.pid, signal.SIGKILL)
            server.wait()
        server_log.close()
        receipt["passed"] = not receipt["failures"] and len(receipt["cases"]) == 5
        (args.output / "acceptance.json").write_text(json.dumps(receipt, indent=2) + "\n")
    raise SystemExit(0 if receipt["passed"] else 1)


if __name__ == "__main__":
    main()
