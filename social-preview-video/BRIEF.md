---
workflow: general-video
flow: automation
storyboard: no
message: "Make room for your writing."
destination: local-preview
aspect: 1200x630
language: en
length: 6s
---

## Intent

Animate the selected writer's desk with fal's Seedance 2.5 image-to-video model.
Compose the real Twyne griffin and code-authored headline over the generated
footage, preserving the selected desk layout.

## Assets

- `../public/assets/social/twyne-writers-desk-background-v1.jpg`: the clean
  imagegen photograph selected by the user.
- `../public/assets/social/twyne-writers-desk-overlay.svg`: the real griffin and
  editable Libre Baskerville / DM Sans typography from the coded card.

## Customizations

- One continuous six-second scene with a locked overhead camera. Coffee steam,
  flower sprigs and leaf shadows move gently; the scene returns to the supplied
  opening image. The logo and typography remain fixed and readable throughout.
- Provider/model selected by the user: fal,
  `bytedance/seedance-2.5/image-to-video`. Generate at 720p with matching start
  and end images, silent audio, high bitrate and H.264 encoding.
- Silent, 30 fps H.264 MP4 served directly by the existing local image server.

## Notes

- User-selected: writer's desk, real logo, text composed in code, local serving.
- User follow-up replaces the previous camera movement with generated physical
  scene motion. Keep the existing 1200 × 630 card framing in the final export.
- The first provider submission was rejected with HTTP 403 because the fal
  account balance was exhausted. No generated scene or new delivery export is
  available yet; `seedance-job-v1.json` records the rejection for safe resumption.
