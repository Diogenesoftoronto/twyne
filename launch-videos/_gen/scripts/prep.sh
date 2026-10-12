#!/usr/bin/env bash
# Stage shared assets into a film project: fonts, brand marks, loudness-normalised audio.
# Usage: prep.sh <project-dir> [image|video|vo|music ids...]
#   ids are bare names, e.g. desk-typewriter v-desk hero-01 m-room
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
proj="$1"; shift
mkdir -p "$proj/assets/fonts" "$proj/assets/img" "$proj/assets/video" "$proj/assets/audio"

cp -u "$here/../_fonts/"*.woff2 "$proj/assets/fonts/"
cp -u "$here/shared/"griffin-*.svg "$proj/assets/img/"
mkdir -p "$proj/assets/js" && cp -u "$here/shared/twyne-kit.js" "$proj/assets/js/"
cp -u "$here/shared/twyne-base.css" "$proj/assets/" 2>/dev/null || true

for id in "$@"; do
  if [[ -f "$here/images/$id.png" ]]; then
    # Stills ship as high-quality JPEG; the PNG masters stay in _gen.
    [[ -f "$proj/assets/img/$id.jpg" ]] || \
      ffmpeg -v error -y -i "$here/images/$id.png" -q:v 2 "$proj/assets/img/$id.jpg"
  elif [[ -f "$here/video/$id.mp4" ]]; then
    ln -f "$here/video/$id.mp4" "$proj/assets/video/$id.mp4" 2>/dev/null || cp "$here/video/$id.mp4" "$proj/assets/video/"
  elif [[ -f "$here/audio/vo/$id.wav" ]]; then
    # Dialogue at -16 LUFS, trimmed of leading/trailing air.
    [[ -f "$proj/assets/audio/$id.wav" ]] || ffmpeg -v error -y -i "$here/audio/vo/$id.wav" \
      -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ar 48000 "$proj/assets/audio/$id.wav"
  elif [[ -f "$here/audio/music/$id.mp3" ]]; then
    # Music a little under dialogue so mixes start from sane levels.
    [[ -f "$proj/assets/audio/$id.wav" ]] || ffmpeg -v error -y -i "$here/audio/music/$id.mp3" \
      -af "loudnorm=I=-19:TP=-1.5:LRA=14" -ar 48000 "$proj/assets/audio/$id.wav"
  else
    echo "prep: no source for '$id'" >&2; exit 1
  fi
done
# Inline word timings for every staged voice line (captions never fetch at render time).
node -e '
const fs=require("fs"),path=require("path");const [gen,proj]=process.argv.slice(1);
const out={};for(const f of fs.readdirSync(path.join(proj,"assets/audio"))){const id=f.replace(/\.wav$/,"");
const w=path.join(gen,"audio/words",id+".json");if(fs.existsSync(w))out[id]=JSON.parse(fs.readFileSync(w,"utf8"));}
fs.writeFileSync(path.join(proj,"assets/js/words.js"),"window.WORDS = "+JSON.stringify(out)+";\n");' "$here" "$proj"
echo "prepped $proj"
