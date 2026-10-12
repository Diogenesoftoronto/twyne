# Twyne launch films

Six spots for the Twyne launch, built in [HyperFrames](https://hyperframes.heygen.com)
(HTML → MP4). Each folder is a standalone HyperFrames project; finished MP4s land in
`renders/`.

| # | Film | Length | Aspect | Register |
|---|------|--------|--------|----------|
| 01 | **The Room** (hero) | 60s | 16:9 | Cinematic launch film. Blank page → brief → five editors → rubric → your desk → wordmark. |
| 02 | **Roll Call** | 46s | 16:9 | Cool-jazz introduction of the five editors, each in their own voice with a signature note. |
| 03 | **Edited** | 46s | 16:9 | Meta-comedy: a generic AI-writing ad is typed on screen and the editors tear it apart live. |
| 04 | **Newsreel** | 34s | 16:9 | 1955 black-and-white newsreel announcing Twyne. Film flicker, fanfare, title cards. |
| 05 | **The Strike** | 15s | 9:16 | Vertical social cut: the landing page's typed-then-corrected headlines on a blank page. |
| 06 | **Sting** | 6s | 16:9 | Audio-logo / end card: the griffin mark and wordmark. |

## Brand system used

Taken from the app itself (`src/global.css`, `PRODUCT.md`, `src/utils/personas.ts`):

- **Type:** Libre Baskerville (display), Lora (body), DM Sans (UI), Special Elite (typewriter labels).
  Fonts are embedded from `_fonts/` so renders are deterministic.
- **Colour:** aged cream `#f4ecd8`, ink `#1f1b16`, vermilion `#c1272d` as the only saturated
  accent, plus the persona colours (sage, periwinkle, cobalt).
- **Voice:** editorial, exacting, literary. No generic AI-productivity claims.

## Generated media (`_gen/`)

All generative assets are reproducible from the prompt manifests in `_gen/prompts/` via the
scripts in `_gen/scripts/`. API keys are read from `skate` at runtime and never written to disk.

| Kind | Model | Script |
|------|-------|--------|
| Stills | OpenAI `gpt-image-2.5-sunburst` | `node _gen/scripts/gen-images.mjs [id…]` |
| Video | fal `bytedance/seedance-2.5/image-to-video` (animates the stills) | `node _gen/scripts/gen-videos.mjs [id…]` |
| Music | fal `google/lyria-3.5` | `node _gen/scripts/gen-audio.mjs music [id…]` |
| Voice | fal `google/gemini-3.8-flash-tts` | `node _gen/scripts/gen-audio.mjs voices [id…]` |
| Word timings | fal `fal-ai/elevenlabs/forced-alignment` | `node _gen/scripts/align-vo.mjs` |

Each script skips files that already exist; delete an output to regenerate it.

Voices: narrator *Gacrux*; Mlle. Sceptique *Kore*; Sœur Encourageante *Sulafat*;
Professeur Athenæum *Sadaltager*; M. Le Stylo *Algenib*; Le Lecteur *Achird*; newsreel
announcer *Fenrir*.

## Working on a film

```bash
rtk proxy npm --prefix launch-videos/01-the-room run dev -- --background
rtk proxy npm --prefix launch-videos/01-the-room run check
rtk proxy npm --prefix launch-videos/01-the-room run render -- --quality delivery -o ../renders/01-the-room.mp4
```

## Deliverables

Open `index.html` in this folder for a local gallery of all six exports. The finished MP4s are in `renders/`; the original generated media stays in `_gen/`.

Newsreel uses canonical Mono Fade and Film Artifacts treatments. Edited and Newsreel use dynamic music carving against their grouped dialogue tracks. The Strike is a 1080 × 1920 portrait export; the other five are 1920 × 1080. All are 30fps.

Checks and export measurements are recorded in `verification.json`. Composition checks cover runtime, layout and contrast. Remaining organizational warnings recommend splitting scene containers into sub-compositions; they do not prevent playback or rendering.

For caption playback, serve the gallery over HTTP from the repository root:

```bash
rtk proxy python3 -m http.server 4317 --bind 127.0.0.1 --directory launch-videos
```

Then open `http://127.0.0.1:4317/`. Caption tracks are optional and can be enabled in the player.

To rebuild the last three music beds from their saved masters:

```bash
rtk proxy python3 launch-videos/_gen/scripts/finish-music.py
```

The Newsreel render uses the bundled Chrome with the ANGLE GL backend supported by this Linux workstation. Its launch wrapper translates HyperFrames' GL-EGL flag to GL; it does not alter the composition or the film treatment.

```bash
rtk proxy python3 launch-videos/_gen/scripts/render-newsreel.py
```

Full browser-check output for the four completed compositions is in `checks/`. Encoded-frame review sheets are in `renders/review/`.
