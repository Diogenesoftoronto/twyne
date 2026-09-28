# The launch film

The landing page and `/docs/` each show one film: **The Room**, a 60-second introduction to the dossier, editorial cast, rubric and local writing desk. Playback starts with the reader's Play action. The page does not preload the video. The player uses native controls, supports inline mobile playback, and offers captions and a direct download.

## Language selection

`LaunchFilm` reads Twyne's existing `gt-qwik` locale. Choosing French in Preferences selects French narration, title cards, poster and captions. English selects the English edition. Other supported languages currently use English. Automatic follows the app's browser-language resolution; an explicit saved choice wins.

Changing the locale replaces the video element, stopping the previous edition. There is no separate video preference.

## Published assets

The web exports live in `public/assets/launch/`:

- `the-room-en.mp4` and `the-room-fr.mp4`: 1280 × 720 H.264/AAC, 30 fps, with fast-start metadata.
- Matching `.jpg` posters and `.vtt` caption files.

The English master is the existing HyperFrames **The Room** export under `launch-videos/renders/01-the-room.mp4`. French preserves its shots and scene timing, with translated on-screen text and new narration. The English voice is Gemini Gacrux. French uses OpenAI Onyx with `gpt-4o-mini-tts`; the original media provider's balance was exhausted. Both editions disclose AI narration. French word timings come from transcription of the generated audio; the translated script and timings are recorded in [the manifest](assets/launch-film-fr.json).

French narration is fitted to the scene windows, with pitch-preserving tempo adjustment available when needed. The music is carved against grouped French voice tracks. The French render uses HyperFrames 0.8.86, upgraded from the English project's 0.8.78, in a separate local production project. Raw production files and the five other films remain local. Only the selected web exports ship with the app.

## Replacing the film

Keep the published filenames or update `src/components/landing/launch-film.tsx`. Supply both editions, posters and captions. Check desktop and narrow mobile layouts, explicit and automatic language choices, native playback, downloads and byte-range responses before release.
