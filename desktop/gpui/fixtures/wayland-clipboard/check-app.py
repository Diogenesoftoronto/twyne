#!/usr/bin/env python3
"""Drive the ordinary Twyne executable on a new private Wayland compositor.

No test-only application switches, fixture transport, or mocked converter.
Imports an owned HTML file, uses real keyboard input and external clipboard
clients, and verifies the saved private library after a normal Ctrl+Q exit.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import time

FIXTURE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("twyne_owned_wayland", FIXTURE / "check-native.py")
owned = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owned)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=owned.PROJECT / "desktop/gpui/target/debug/twyne-desktop")
    parser.add_argument("--sway", default=owned.DEFAULT_SWAY)
    parser.add_argument("--swaymsg", default=str(Path(owned.DEFAULT_SWAY).with_name("swaymsg")))
    parser.add_argument("--wtype", default=owned.DEFAULT_WTYPE)
    parser.add_argument("--wl-copy", default="/home/diogenes/.nix-profile/bin/wl-copy")
    parser.add_argument("--wl-paste", default="/home/diogenes/.nix-profile/bin/wl-paste")
    parser.add_argument("--icd", default=owned.DEFAULT_ICD)
    parser.add_argument("--output", type=Path, default=Path("/tmp/twyne-wayland-app-report.json"))
    args = parser.parse_args()
    args.binary = args.binary.resolve()
    if not args.binary.is_file():
        raise SystemExit("Build the normal Twyne executable first; this driver never builds or installs tools.")
    compositor = owned.OwnedCompositor(args)
    checks = []
    report = {"kind": "ordinary Twyne private Wayland application acceptance",
              "binarySha256": hashlib.sha256(args.binary.read_bytes()).hexdigest(),
              "root": str(compositor.root), "testOnlyApplicationSwitches": False,
              "actualInput": "owned wtype", "actualClipboard": "owned wl-copy/wl-paste",
              "checks": checks}

    def check(name, condition, detail=None):
        assert condition, f"{name}: {detail}"
        checks.append({"name": name, "passed": True, "detail": detail})

    try:
        imported = "First local Wayland draft 🦊."
        source = compositor.root / "original.html"
        source.write_text(f"<p>{imported}</p>\n")
        source_bytes = source.read_bytes()
        library = compositor.root / "library"
        app = compositor.start([str(args.binary), "--data-dir", str(library), str(source)], "ordinary-twyne")

        def focused_app():
            if app.poll() is not None:
                raise AssertionError(f"Twyne exited {app.returncode}; see ordinary-twyne.log")
            def walk(node):
                if node.get("app_id") == "love.twyne.gpui" and node.get("focused"):
                    return node
                for child in node.get("nodes", []) + node.get("floating_nodes", []):
                    if result := walk(child):
                        return result
                return None
            return walk(compositor.ipc("get_tree", kind=True))

        window = owned.wait_for(focused_app, "ordinary Twyne keyboard-focused Wayland surface", seconds=20)
        check("normal application opens on owned Wayland surface", window.get("shell") == "xdg_shell", window.get("rect"))
        time.sleep(0.2)
        compositor.key("a")
        compositor.key("c")
        owned.wait_for(lambda: compositor.external_read("text/plain;charset=utf-8") == imported,
                       "ordinary editor exact rich Copy")
        copied = json.loads(compositor.external_read("application/x-twyne-rich-fragment+json"))
        check("normal host wires real rich Wayland clipboard", copied["text"] == imported
              and copied["html"] == f"<p>{imported}</p>", copied["html"])

        pasted = "New offline text 🦊 with literal <b>text</b>."
        compositor.external_copy(pasted, name="ordinary-foreign-plain")
        compositor.key("v")

        def saved_document():
            for path in (library / "manuscripts").glob("*.json"):
                value = owned.read_json(path) or {}
                html = ((value.get("workspace") or {}).get("content") or {}).get("html", "")
                if pasted.replace("<b>", "&lt;b&gt;").replace("</b>", "&lt;/b&gt;") in html:
                    return path, value
            return None

        # Preserve the foreign owner throughout asynchronous paste preflight.
        # The ordinary autosave is an observable acceptance boundary; polling
        # by Copy here would replace the clipboard and correctly reject Paste.
        owned.wait_for(saved_document, "ordinary paste and autosave through original semantic converter", seconds=20)
        compositor.key("a")
        compositor.key("c")
        owned.wait_for(lambda: compositor.external_read("text/plain;charset=utf-8") == pasted,
                       "ordinary accepted paste exact rich Copy")
        copied = json.loads(compositor.external_read("application/x-twyne-rich-fragment+json"))
        check("normal paste keeps advertised plain text literal", copied["text"] == pasted
              and "&lt;b&gt;text&lt;/b&gt;" in copied["html"] and "<b>text</b>" not in copied["html"], copied["html"])
        compositor.key("s")

        saved_path, saved = owned.wait_for(saved_document, "normal Ctrl+S files literal pasted document", seconds=20)
        check("normal local save preserves canonical source and rich projection", saved["revision"] > 0
              and bool(saved["workspace"]["content"].get("typstSource")), str(saved_path))
        survivor = "Foreign clipboard survives ordinary Twyne shutdown 🦊"
        compositor.external_copy(survivor, name="ordinary-foreign-survivor")
        compositor.key("q")
        check("normal Ctrl+Q exits without a leaked focused editor", app.wait(timeout=12) == 0)
        log = (compositor.root / "ordinary-twyne.log").read_text(errors="replace")
        check("normal application log has no shutdown panic", "panicked at" not in log and "Leaked handle" not in log, log[-2000:])
        check("normal shutdown preserves unrelated clipboard", compositor.external_read("text/plain;charset=utf-8") == survivor)
        check("import remains a copy and saved bytes survive shutdown", source.read_bytes() == source_bytes
              and owned.read_json(saved_path) == saved)
        report["completed"] = True
        report["remaining"] = ["physical devices/other compositors", "note popup pending-frame shutdown", "full visual parity"]
        print(f"{len(checks)}/{len(checks)} passed; report {args.output}; owned logs {compositor.root}")
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
        compositor.close()


if __name__ == "__main__":
    main()
