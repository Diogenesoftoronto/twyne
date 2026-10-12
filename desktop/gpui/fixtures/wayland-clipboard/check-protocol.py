#!/usr/bin/env python3
"""Compile the owned module directly against existing cached Rust libraries.

No Cargo, Devenv, dependency resolution, network, or compositor connection.
Outputs only under an owned temporary directory. This is pipe/protocol-state
proof, not actual Wayland interoperation or mounted editor action proof.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=Path("/tmp/twyne-wayland-protocol-report.json"))
parser.add_argument("--rustc", default=shutil.which("rustc"), help="Existing compiler matching the cached dependencies")
parser.add_argument("--linker", help="Existing native linker matching the cached system libraries")
parser.add_argument("--semantic", action="store_true", help="Also compile/run the adapter against the cached actual RichDocument library")
parser.add_argument("--native-library-dir", action="append", default=[], help="Existing native library directory for the semantic fixture (repeatable)")
args = parser.parse_args()
fixture = Path(__file__).resolve().parent
deps = fixture.parents[1] / "target/debug/deps"
rustc = args.rustc
if not rustc:
    raise SystemExit("A compatible existing rustc is required; this fixture never installs it.")
env = dict(os.environ)
for key in ["DISPLAY", "WAYLAND_DISPLAY", "WAYLAND_SOCKET"]:
    env.pop(key, None)
with tempfile.TemporaryDirectory(prefix="twyne-owned-wayland-protocol-") as directory:
    libraries = {}
    for name in ["anyhow", "calloop", "filedescriptor", "wayland_client", "log"]:
        candidates = sorted(deps.glob(f"lib{name}-*.rlib"), key=lambda path: path.stat().st_mtime, reverse=True)
        source = Path(directory) / "compatibility.rs"
        source.write_text(f"extern crate {name};\n")
        for path in candidates:
            compatible = subprocess.run([rustc, "--edition=2024", "--crate-type=lib", "--emit=metadata", str(source),
                "-L", f"dependency={deps}", "--extern", f"{name}={path}", "-o", str(Path(directory) / "compatibility.rmeta")],
                env=env, capture_output=True, text=True)
            if compatible.returncode == 0:
                libraries[name] = path
                break
        else:
            raise SystemExit(f"No compiler-compatible cached {name} library; use the existing matching --rustc or ask Root to schedule its normal build. Nothing was rebuilt or cleaned.")
    binary = Path(directory) / "protocol-tests"
    command = [rustc, "--edition=2024", "--test", str(fixture / "transport-probe.rs"), "-L", f"dependency={deps}", "-o", str(binary)]
    if args.linker:
        command.extend(["-C", f"linker={args.linker}"])
    for name, path in libraries.items():
        command.extend(["--extern", f"{name}={path}"])
    compiled = subprocess.run(command, env=env, capture_output=True, text=True)
    if compiled.returncode:
        raise SystemExit(compiled.stderr)
    result = subprocess.run([str(binary), "--nocapture", "--test-threads=1"], env=env, capture_output=True, text=True, timeout=20)
    semantic = None
    if args.semantic and result.returncode == 0:
        protocol_lib = Path(directory) / "libclipboard_protocol_fixture.rlib"
        library_command = [rustc, "--edition=2024", "--crate-name=clipboard_protocol_fixture", "--crate-type=lib", str(fixture / "protocol-lib.rs"), "-L", f"dependency={deps}", "-o", str(protocol_lib)]
        for name, path in libraries.items():
            library_command.extend(["--extern", f"{name}={path}"])
        library_compiled = subprocess.run(library_command, env=env, capture_output=True, text=True)
        if library_compiled.returncode:
            raise SystemExit(library_compiled.stderr)
        candidates = sorted(deps.glob("libtwyne_desktop-*.rlib"), key=lambda path: path.stat().st_mtime, reverse=True)
        source = Path(directory) / "compatibility.rs"
        source.write_text("extern crate twyne_desktop;\n")
        for path in candidates:
            compatible = subprocess.run([rustc, "--edition=2024", "--crate-type=lib", "--emit=metadata", str(source), "-L", f"dependency={deps}", "--extern", f"twyne_desktop={path}", "-o", str(Path(directory) / "compatibility.rmeta")], env=env, capture_output=True, text=True)
            if compatible.returncode == 0:
                model_lib = path
                break
        else:
            raise SystemExit("No compatible cached actual Twyne library; Root must schedule its normal build.")
        semantic_binary = Path(directory) / "semantic-tests"
        semantic_env = {**env, "CARGO_MANIFEST_DIR": str(fixture.parents[1])}
        semantic_command = [rustc, "--edition=2024", "--test", str(fixture / "semantic-probe.rs"), "-L", f"dependency={deps}", "--extern", f"gpui_linux={protocol_lib}", "--extern", f"twyne_desktop={model_lib}", "--extern", f"anyhow={libraries['anyhow']}", "-o", str(semantic_binary)]
        if args.linker:
            semantic_command.extend(["-C", f"linker={args.linker}"])
        for path in args.native_library_dir:
            semantic_command.extend(["-L", f"native={path}", "-C", f"link-arg=-Wl,-rpath,{path}"])
        semantic_compiled = subprocess.run(semantic_command, env=semantic_env, capture_output=True, text=True)
        if semantic_compiled.returncode:
            raise SystemExit(semantic_compiled.stderr)
        semantic = subprocess.run([str(semantic_binary), "--nocapture", "--test-threads=1"], env=env, capture_output=True, text=True, timeout=20)
    report = {"kind": "actual Rust transport pipe/state tests", "actualCompositor": False,
              "runtimeIntegrated": False, "cargoOrDevenv": False,
              "compiler": subprocess.check_output([rustc, "--version"], text=True).strip(),
              "linker": args.linker,
              "libraries": {name: str(path) for name, path in libraries.items()},
              "exitCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr,
              "compileWarnings": compiled.stderr,
              "semantic": None if semantic is None else {"modelLibrary": str(model_lib), "nativeLibraryDirs": args.native_library_dir, "exitCode": semantic.returncode, "stdout": semantic.stdout, "stderr": semantic.stderr}}
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(result.stdout, end="")
    if semantic is not None:
        print(semantic.stdout, end="")
    print(f"Report: {args.output}")
    raise SystemExit(result.returncode if semantic is None else semantic.returncode)
