#!/usr/bin/env python3
"""Vendor the matching licensed DejaVu 2.37 Mono italic from its pinned release.

No runtime fetch is needed. Normal asset sync checks the embedded hashes.
Use --archive PATH to reproduce from a local verified upstream archive.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

URL = "https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.tar.bz2"
ARCHIVE_SHA = "fa9ca4d13871dd122f61258a80d01751d603b4d3ee14095d65453b4e846e17d7"
ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "desktop/gpui/assets"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--archive", type=Path)
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if args.archive:
    archive = args.archive.read_bytes()
else:
    with urllib.request.urlopen(URL, timeout=30) as response:
        archive = response.read(6 * 1024 * 1024 + 1)
if hashlib.sha256(archive).hexdigest() != ARCHIVE_SHA:
    raise SystemExit("The DejaVu archive does not match the pinned upstream checksum.")
with tarfile.open(fileobj=io.BytesIO(archive), mode="r:bz2") as package:
    def member(name):
        return package.extractfile(f"dejavu-fonts-ttf-2.37/{name}").read()

    regular = member("ttf/DejaVuSansMono.ttf")
    if regular != (ROOT / "src/assets/typst/DejaVuSansMono.ttf").read_bytes():
        raise SystemExit("Upstream regular Mono does not match Twyne's existing font.")
    files = {
        "fonts/DejaVuSansMono-Oblique.ttf": member("ttf/DejaVuSansMono-Oblique.ttf"),
        "licenses/dejavu-LICENSE.txt": member("LICENSE"),
    }
provenance = {
    "source": URL,
    "archiveSha256": ARCHIVE_SHA,
    "version": "2.37",
    "originalRegularFont": "src/assets/typst/DejaVuSansMono.ttf",
    "originalRegularSha256": hashlib.sha256(regular).hexdigest(),
    "regularBytesMatchOriginal": True,
    "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
}
files["mono-oblique-provenance.json"] = (json.dumps(provenance, indent=2) + "\n").encode()
for name, data in files.items():
    destination = ASSETS / name
    if args.check:
        if not destination.exists() or destination.read_bytes() != data:
            raise SystemExit(f"Stale supplemental native font: {destination}")
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
print("Verified" if args.check else "Vendored", "matching DejaVu Sans Mono Oblique 2.37 and upstream license.")
