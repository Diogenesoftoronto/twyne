# Films in the writing room

The landing page shows **The Room**, a 60-second introduction to the dossier,
editorial cast, rubric and local writing desk. The same locale-aware introduction
remains in [The Manual](https://www.twyne.love/docs/).

The manual also places short films and application walkthroughs at the opening
of the chapters they help explain. Each is optional: open its **Watch** row, then
press Play. Native controls support inline mobile playback, captions, seeking and
a direct download. Videos do not autoplay or preload their media. Starting a
second video pauses the first; closing a film, changing chapters or leaving the
manual stops playback. Switching browser tabs pauses it too.

## Follow the chapter

| Chapter                     | Film                                 | What it adds                                                      |
| --------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| Begin a piece               | **Newsreel** · 34 seconds            | An editorial introduction to the room and brief.                  |
| The dossier                 | **The Strike** · 15 seconds          | A portrait-format headline being typed and revised.               |
| The House & collections     | **The House** · 18 seconds           | A real application walkthrough of sample context and inheritance. |
| Your editors                | **Roll Call** · 46 seconds           | The five resident voices and their different lenses.              |
| Margin conversations        | **Edited** · 46 seconds              | A staged passage read and revised by the room.                    |
| Manuscript & source tools   | **Source & proof** · 7 seconds       | A real local source-workspace walkthrough.                        |
| Folios, export & publishing | **The room’s signature** · 6 seconds | The editorial films’ closing identity.                            |

The films introduce an idea. The numbered visual guides beneath them show the
current controls, with actual application screenshots, written instructions and
full-size views. Screen examples use sample work; staged editorial readings are
identified. Keyboard shortcuts use the same live registry as the desk.

## Language selection

`LaunchFilm` reads Twyne's existing `gt-qwik` locale. Choosing French in Preferences selects French narration, title cards, poster and captions. English selects the English edition. Other supported languages currently use English. Automatic follows the app's browser-language resolution; an explicit saved choice wins.

Changing the locale replaces the video element, stopping the previous edition. There is no separate video preference.

## Published assets

The web exports live in `public/assets/launch/`:

- `the-room-en.mp4` and `the-room-fr.mp4`: 1280 × 720 H.264/AAC, 30 fps, with fast-start metadata.
- Matching `.jpg` posters and `.vtt` caption files.

The English master is the existing HyperFrames **The Room** export under `launch-videos/renders/01-the-room.mp4`. French preserves its shots and scene timing, with translated on-screen text and new narration. The English voice is Gemini Gacrux. French uses OpenAI Onyx with `gpt-4o-mini-tts`; the original media provider's balance was exhausted. Both editions disclose AI narration. French word timings come from transcription of the generated audio; the translated script and timings are recorded in [the manifest](assets/launch-film-fr.json).

French narration is fitted to the scene windows, with pitch-preserving tempo adjustment available when needed. The music is carved against grouped French voice tracks. The French render uses HyperFrames 0.8.86, upgraded from the English project's 0.8.78, in a separate local production project. Raw production files stay local. The landing page keeps its single selected film; the manual ships separate web exports for the contextual films.

## Manual assets

Contextual films live in `public/assets/manual/`, with matching posters and
English WebVTT captions. The [media manifest](assets/manual-videos.json) records
sources, dimensions, durations and validation; the
[preparation record](assets/manual-media-preparation.md) explains the exports and
screen-recording boundaries. Other editorial films currently have English audio
or titles. They do not change language with the bilingual introduction.

`manual-video.tsx` provides the chapter players. `manual-films.ts` assigns their
placement and written descriptions. The guide data is divided into desk,
editorial-room and work chapters; each screenshot has dimensions, alternative
text and an instruction. Keep the landing film independent of these chapter
assets.

The server has an explicit media allowlist and responds to byte-range requests,
including suffix ranges and invalid-range responses. Add a new film to that
allowlist when adding its guide entry.

## Replacing the film

Keep the published filenames or update `src/components/landing/launch-film.tsx`. Supply both editions, posters and captions. Check desktop and narrow mobile layouts, explicit and automatic language choices, native playback, downloads and byte-range responses before release.
