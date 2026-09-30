# Twyne social preview

Selected artwork: the writer's desk. The photograph is generated with imagegen; Twyne's real griffin and typography are composed separately in code. Final asset: `public/assets/social/twyne-writers-desk-v2.jpg` (1200 × 630 JPEG). The versioned URL is shared by Open Graph, Twitter cards, and homepage structured data. These changes are served locally; production has not been deployed.

## Local preview and editable source

- `http://localhost:8765/desk-preview.html` — responsive preview of the still artwork while the Seedance scene is pending; it switches to the generated scene after the final MP4 is exported.
- `public/assets/social/twyne-writers-desk-background-v1.jpg` — clean photograph with no brand headline or wordmark.
- `public/assets/social/twyne-writers-desk-overlay.svg` — actual griffin and editable SVG text, with embedded Libre Baskerville and DM Sans fonts.
- `public/assets/social/twyne-writers-desk-v2.jpg` — crawler-ready composite; PNG and self-contained SVG exports also sit alongside it.
- `public/assets/social/font-licenses.txt` — licenses for the embedded fonts.

Copy and placement live in `scripts/build-social-preview.ts`. Rebuild with Bun and ImageMagick:

```sh
rtk proxy bun scripts/build-social-preview.ts
```

The JPEG rasterizes the photograph and SVG with `@resvg/resvg-js`, so link crawlers receive a complete image. The video composition holds the SVG logo and text over generated desk footage. The local preview uses a native video player once that MP4 is exported. The default Open Graph metadata remains the still image.

## Seedance scene generation

The user selected fal's [`bytedance/seedance-2.5/image-to-video`](https://fal.ai/models/bytedance/seedance-2.5/image-to-video/api). `scripts/generate-social-desk-video.ts` submits only the clean desk photograph. The shot has a locked overhead camera, gentle coffee steam, flower movement and fluttering leaf shadows. The same image supplies the starting and ending frames. Requested settings: six seconds, 720p, automatic aspect ratio, high bitrate, H.264 and no audio.

The first submission was rejected with HTTP 403: the fal account is locked because its balance is exhausted. No Seedance scene has been generated or downloaded. `social-preview-video/seedance-job-v1.json` records that provider rejection. After the balance is restored, rerunning the script submits the rejected job; accepted requests are saved and resumed without another submission. Credentials stay in the local process and are never written into the assets or job record.

The HyperFrames project is `social-preview-video/`, pinned to CLI `0.8.93`. Its brief and design spec preserve the selected card layout. `scripts/build-social-video.ts` stages the generated video and shared SVG overlay; it adds no camera transforms. HyperFrames owns native video playback, and the branding stays fixed. `scripts/render-social-video.py` runs checks or the delivery export with this workstation's working Chrome GL backend. Both scripts require the generated scene before replacing the earlier composition or rendering a new export.

Rebuild from the repository root:

```sh
rtk proxy bun scripts/build-social-preview.ts
rtk proxy bun scripts/generate-social-desk-video.ts
rtk proxy bun scripts/build-social-video.ts
rtk proxy python3 scripts/render-social-video.py check
rtk proxy python3 scripts/render-social-video.py render
rtk proxy bun scripts/build-social-preview.ts
```

Intended outputs, pending generation:

- `public/assets/social/twyne-writers-desk-seedance-background-v1.mp4` — raw fal scene without branding.
- `public/assets/social/twyne-writers-desk-seedance-v1.mp4` — final 1200 × 630 branded composition at 30 fps.
- `social-preview-video/seedance-check.json` — the new composition's check report.

Provider generation, visual review of the generated motion, composition checks and the final delivery render remain pending. The earlier camera-motion export is preserved at `public/assets/social/twyne-writers-desk-loop-v1.mp4`; its old `check.json`, `verification.json` and contact sheet describe that earlier export only. The local preview no longer uses the shifting-image effect.

## Background edit prompt

Edited `public/assets/social/twyne-writers-desk-v1.jpg` with the built-in imagegen tool. The generated original is preserved at `/home/diogenes/.codex/generated_images/01a0eefd-acc3-7f01-a57d-1f767284796b/exec-b78c7ea1-e8ac-4b68-9779-26241282d0db.png`; the reusable background is resized to 1200 × 630 and exported as a JPEG.

Edit the supplied Twyne writer's desk image into a clean reusable photographic BACKGROUND. Remove ONLY the large printed red 'Twyne' wordmark, the large black headline 'Make room for your writing.' and the small 'twyne.love' footer from the ivory paper on the left. Seamlessly replace those letters with uninterrupted natural ivory paper texture, preserving the beautiful soft leaf shadows and warm light. Keep the same overhead composition, camera angle, crop, realistic photography, right-side annotated manuscripts, fountain pen, red pencil, espresso cup, old books, flowers and crumpled paper. Keep the small incidental handwriting and red editing marks on the right manuscripts. The entire left area must be clear of brand typography, logos and promotional text, with ample quiet space for code-rendered overlays added later. Do not redesign the scene. No new text, no watermark. Landscape 1200:630 aspect ratio.

## Original option prompt

Create a premium editorial photography Open Graph card for Twyne, landscape 1200:630 ratio. A warmly lit authentic writer's desk seen overhead, tactile ivory manuscript pages with restrained red proofreading marks, a fountain pen and red pencil, espresso in small ceramic cup at far right. Compose the objects across the right half, with left half clear ivory paper for large elegant deep vermilion serif wordmark 'Twyne' and a crisp black serif headline exactly 'Make room for your writing.' Small footer exactly 'twyne.love'. Natural afternoon light, subtle shadows, analog intimacy, warm paper black ink vermilion palette, realistic beautiful photography, editorial and restrained. No laptop, no extra readable text, no badges, no watermark. Typography very legible with generous safe margins.
