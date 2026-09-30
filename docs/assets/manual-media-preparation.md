# Manual video preparation

Seven existing Twyne videos are ready for the contextual public guide. Each bundle lives directly in `public/assets/manual/`, using the shared `ManualVideo` convention `/assets/manual/${id}.{mp4,jpg,vtt}`. A companion `${id}.txt` contains copied dialogue-caption text or an explicitly labeled visual/action description.

The source and verification record is [manual-videos.json](manual-videos.json). It includes original and output SHA-256 hashes, complete FFprobe stream/format metadata, source ranges, caption cues and bounds, decode commands/results, MP4 atom offsets, sampled review timestamps, file sizes and suggested placement. These are prepared assets; UI integration belongs to the parent guide task.

| ID / MP4                                                            | Dimensions | Duration | MP4 size¹ | JPG dimensions / size¹ | English VTT                  | Context                                          |
| ------------------------------------------------------------------- | ---------- | -------- | --------- | ---------------------- | ---------------------------- | ------------------------------------------------ |
| [roll-call](../../public/assets/manual/roll-call.mp4)               | 1280 × 720 | 46 s     | 4.95 MB   | 960 × 540 / 29.1 kB    | 19 existing dialogue cues    | Beginning of Your editors (`room`)               |
| [edited](../../public/assets/manual/edited.mp4)                     | 1280 × 720 | 46 s     | 2.06 MB   | 960 × 540 / 26.1 kB    | 18 existing dialogue cues    | Beginning of Margin conversations (`marginalia`) |
| [newsreel](../../public/assets/manual/newsreel.mp4)                 | 1280 × 720 | 34 s     | 1.96 MB   | 960 × 540 / 14.0 kB    | 17 existing dialogue cues    | Beginning of Getting started                     |
| [the-strike](../../public/assets/manual/the-strike.mp4)             | 720 × 1280 | 15 s     | 0.81 MB   | 405 × 720 / 30.5 kB    | 2 new sound cues             | Beginning of The dossier                         |
| [sting](../../public/assets/manual/sting.mp4)                       | 1280 × 720 | 6 s      | 0.27 MB   | 960 × 540 / 26.7 kB    | 1 new music cue              | Publication ending (`folios`)                    |
| [house-context](../../public/assets/manual/house-context.mp4)       | 1152 × 720 | 17.60 s  | 0.60 MB   | 1152 × 720 / 88.7 kB   | 5 silent-action descriptions | Beginning of The House & collections             |
| [source-workspace](../../public/assets/manual/source-workspace.mp4) | 1152 × 720 | 6.72 s   | 0.35 MB   | 1152 × 720 / 80.0 kB   | 3 silent-action descriptions | Beginning of Manuscript & source tools           |

¹ Decimal units. All MP4s together are **11,005,079 bytes (11.01 MB)**, compared with 85,146,450 bytes of original requested videos. All posters together are 295,027 bytes; VTTs total 3,613 bytes and TXT companions total 5,933 bytes. Exact per-file sizes are in the manifest.

## Sources and encoding

The five complete film masters are `launch-videos/renders/02-roll-call.mp4`, `03-edited.mp4`, `04-newsreel.mp4`, `05-the-strike.mp4` and `06-sting.mp4`. They retain their original durations, 30 fps and aspect ratios. The Strike retains its 9:16 portrait orientation, with a 720-pixel short edge. The other films are 16:9.

The walkthrough sources are `artifacts/qa-recordings/2026-09-30/house-context-walkthrough.webm` and `source-tools-and-proof.webm`. Both are actual 1440 × 900, 25 fps local app captures with synthetic context/manuscript and no audio stream. Their prepared exports retain 8:5 framing at 1152 × 720 and 25 fps. Each uses one continuous source range at original speed; no crop, added overlay, reordered scene or fabricated UI was needed.

All videos use local FFmpeg/libx264, H.264 High profile level 3.1, `yuv420p`, square pixels, Lanczos scaling, CRF 24, medium preset, and `+faststart`. Film audio is AAC stereo at 96 kbit/s and 48 kHz. The silent walkthroughs remain video-only. Original identifying/container metadata is stripped from the exports with `-map_metadata -1`.

Roll Call, Edited, Newsreel and Sting posters are byte-for-byte copies of their existing JPGs. The Strike poster comes from 3.40 seconds of its prepared export and uses exact 9:16 framing. House and source-workspace posters come from 0.20 and 6.24 seconds of their respective prepared exports.

The manifest's `preparation.reproduce_encoding_argv` records the full shell-safe argument array for each final filename. A representative complete-film command is:

```sh
rtk proxy ffmpeg -nostdin -hide_banner -loglevel error -n \
  -i launch-videos/renders/02-roll-call.mp4 -t 46 \
  -map 0:v:0 -map 0:a:0 -c:a aac -b:a 96k -ar 48000 \
  -vf 'scale=1280:720:flags=lanczos,setsar=1' -filter_threads 2 \
  -c:v libx264 -threads 4 -preset medium -crf 24 \
  -profile:v high -level:v 3.1 -pix_fmt yuv420p -tag:v avc1 \
  -map_metadata -1 -movflags +faststart public/assets/manual/roll-call.mp4
```

`-n` refuses to overwrite an existing file. Source-workspace uses input seek `-ss 4.16`, output duration `-t 6.72`, scaling to 1152 × 720 and `-an`. House uses `-ss 4.8` and `-t 17.6` with the same silent-video settings.

## Captions and written descriptions

Roll Call, Edited and Newsreel VTTs were copied byte-for-byte from the existing render sidecars. Their TXT files reproduce that dialogue-caption text with its original timestamps. No new transcription or alignment is claimed. The supplied VTTs contain one small adjacent-cue overlap each: Roll Call 40 ms, Edited 60 ms and Newsreel 20 ms. These valid WebVTT overlaps are preserved and recorded; every cue remains inside the corresponding film duration.

The Strike source declares an instrumental music bed, two typing effects and two whoosh effects. Its background video is muted, and it has no narration track. Sting declares only its instrumental music bed. The saved music prompts specify instrumental/no vocals. Their manifest entries identify and probe the exact audio source files and hash the inspected compositions and prompt source. No new listening review is claimed.

The new Strike VTT describes music, typing and swooshing effects from 0–10.8 seconds, then continuing music through 15 seconds. Sting has an instrumental-music cue from 0–6 seconds. Their TXT files label the exact onscreen words as visual text, including the Strike's two replacements and the brand close. They do not present those words as spoken dialogue.

House and source-workspace VTTs describe sampled visible actions in the silent footage. The companion TXT files expand those actions and explain the synthetic local demonstration. They do not claim authenticated cloud sync, production OAuth, generated editorial decisions or funded model execution. The source-workspace export retains the app's real local-writing/sign-in notice until the captured dismissal; no sign-in occurs. The manifest labels these VTTs as descriptions of silent actions and includes the corresponding public text URLs as accessible written fallbacks.

The five films are stylized promotional material. Roll Call introduces editorial perspectives; Edited stages a sample critique; Newsreel introduces the room and brief; The Strike introduces editorial replacements; Sting closes with the brand. They do not establish live provider behavior.

## Footage review and exclusions

Source walkthroughs were sampled at startup, approximately every second, the final frames and denser transition points. Encoded walkthroughs were reviewed again at startup, approximately every second and their final frame. Eight encoded frames per film were inspected across the complete duration. Exact reviewed timestamps are in the manifest. Capture fixtures establish the synthetic House, folios and manuscript; no keys or personal data were observed in the reviewed frames. No browser console or development badge appears in the reviewed prepared footage.

| Source                           | Excluded source interval | Exact reason                                                                                                                                                                                                 |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `house-context-walkthrough.webm` | `[0, 4.80)` s            | Blank/loading startup and the bottom-right `Click-to-Source: Alt` development badge. The accepted range begins after the badge disappears.                                                                   |
| `source-tools-and-proof.webm`    | `[0, 4.16)` s            | Blank/loading startup with the same development badge; omitted through the settled manuscript view.                                                                                                          |
| `source-tools-and-proof.webm`    | `[10.88, 14.20)` s       | Programmatic theme change, then a 390 × 844 mobile viewport padded with a large gray area inside the 1440 × 900 capture. Unsuitable for this continuous desktop guide excerpt; no privacy leak was observed. |

House retains `[4.80, 22.40)` seconds of the original recording. Source-workspace retains `[4.16, 10.88)` seconds. The synthetic House Engine room remains visible as an actual product surface; its decision log is empty. No requested source was excluded entirely. Omitted footage remains intact in the originals.

## Verification and ownership

All seven final MP4s passed complete video/audio decode using FFmpeg with `-xerror -err_detect explode`; all seven JPGs passed decode. FFprobe checked full stream/format metadata, exact dimensions, duration, frame rate, H.264/`yuv420p`, square pixels and expected audio presence. Binary top-level MP4 atom inspection confirmed `moov` occurs before `mdat` in every export. Every VTT passed cue timestamp syntax, ordering and duration bounds. Copied dialogue VTTs and copied posters were checked for byte equality with their originals. SHA-256 comparisons verified all seven masters/recordings and the original film JPG/VTT sidecars remained unchanged.

Complete decode verifies media integrity. Privacy/content suitability is based on the listed sampled visual review and inspected capture fixtures; it is not a full-frame privacy audit. No new listening review or browser/player/track integration test is claimed.

Final writes for this task are only the 28 root-level media/sidecar files and these two documentation assets. Other workers' `public/assets/manual/desk/`, `editorial/`, `work/` directories and guide data were left untouched. No UI/server code, originals, deployment, commit or environment configuration was changed. The HyperFrames entry-point skill was read for applicability; this operation used existing exports and installed local tools, with no HyperFrames render/update, provider call, new composition, media generation or network fee.
