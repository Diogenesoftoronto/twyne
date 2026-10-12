#!/usr/bin/env python3
"""Emit the exact unapplied candidate to stdout; never import/run it or write files."""

import hashlib
import json
from pathlib import Path


def main():
    here = Path(__file__).resolve().parent
    spec = json.loads((here / "patch-spec.json").read_text())
    base = here.parent / "analyze.py"
    data = base.read_bytes()
    if hashlib.sha256(data).hexdigest() != spec["baseSha256"]:
        raise SystemExit("Frozen base changed; refuse to manufacture another candidate.")
    candidate = data.decode("utf-8")
    for change in spec["changes"]:
        if candidate.count(change["old"]) != 1:
            raise SystemExit("Exact parser anchor missing/ambiguous.")
        candidate = candidate.replace(change["old"], change["new"], 1)
    if hashlib.sha256(candidate.encode()).hexdigest() != spec["candidateSha256"]:
        raise SystemExit("Candidate digest mismatch.")
    print(candidate, end="")


if __name__ == "__main__":
    main()
