#!/usr/bin/env python3
"""Build the last three music beds from saved masters, keeping their natural endings."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
for project, music, total, tail in [
    ("04-newsreel", "m-newsreel", 34, 7),
    ("05-the-strike", "m-strike", 15, 5),
    ("06-sting", "m-sting", 6, 4),
]:
    source = root / "_gen/audio/music" / f"{music}.mp3"
    target = root / project / "assets/audio" / f"{music}-cut.wav"
    duration = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "csv=p=0", str(source),
    ], text=True))
    fade = 0.7
    head = total - tail + fade
    graph = (
        f"[0:a]atrim=0:{head},asetpts=PTS-STARTPTS[a];"
        f"[0:a]atrim=start={duration-tail},asetpts=PTS-STARTPTS[b];"
        f"[a][b]acrossfade=d={fade},loudnorm=I=-19:TP=-1.5:LRA=11,"
        f"afade=t=out:st={total-0.5}:d=0.5[out]"
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-i", str(source),
        "-filter_complex", graph, "-map", "[out]", "-ar", "48000", str(target),
    ], check=True)
    print(f"{project}: {total}s")
