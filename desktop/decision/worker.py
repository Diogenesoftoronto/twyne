# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["transformers==5.22.1", "torch==2.15.0", "torchvision==0.29.2", "pillow==13.0.0", "huggingface-hub==2.4.0"]
# [tool.uv.sources]
# torch = [{ index = "pytorch-cpu", marker = "sys_platform != 'darwin'" }]
# torchvision = [{ index = "pytorch-cpu", marker = "sys_platform != 'darwin'" }]
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Pinned d1 runtime. Download is explicit; inference only opens local files."""
import hashlib
import json
import os
from pathlib import Path
import sys

MANIFEST = json.loads(Path(__file__).with_name("model.json").read_text())
MODEL = MANIFEST["repo"]


def verify(folder):
    for entry in MANIFEST["files"]:
        path = folder / entry["path"]
        if not path.is_file() or path.stat().st_size != entry["size"]:
            raise ValueError("Incomplete model download")
        if entry["sha256"]:
            with path.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            if digest != entry["sha256"]:
                raise ValueError("Model checksum mismatch")


def main():
    folder = Path(sys.argv[2]).resolve()
    if sys.argv[1] == "--download":
        from huggingface_hub import snapshot_download
        snapshot_download(MODEL, revision=MANIFEST["revision"], local_dir=folder,
                          allow_patterns=[entry["path"] for entry in MANIFEST["files"]])
        verify(folder)
        (folder / ".twyne-ready").write_text(MANIFEST["revision"])
        return

    # Set before importing HF/Transformers. No hub lookup, telemetry or remote code
    # lookup is permitted at inference time, including on a cold application start.
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                      HF_HUB_DISABLE_TELEMETRY="1", DO_NOT_TRACK="1")
    verify(folder)
    import torch
    from transformers import AutoModel
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = torch.float32 if device == "cpu" else torch.bfloat16
    # Keep stdout reserved for the local IPC protocol, including model startup.
    protocol = sys.stdout
    sys.stdout = sys.stderr
    model = AutoModel.from_pretrained(str(folder), trust_remote_code=True,
                                     local_files_only=True, dtype=dtype).to(device).eval()
    print(json.dumps({"ready": True, "device": device}), file=protocol, flush=True)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            with torch.inference_mode():
                result = model.system_one(request["state"], request["questions"])
            result["model"] = MODEL
            print(json.dumps(result, allow_nan=False), file=protocol, flush=True)
        except Exception:
            # Never print the manuscript, questions or model exception to logs.
            print(json.dumps({"error": "Local decision failed"}), file=protocol, flush=True)


if __name__ == "__main__":
    main()
