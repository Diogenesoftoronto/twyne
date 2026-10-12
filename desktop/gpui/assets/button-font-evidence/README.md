# Original paper-button font evidence

The source `.btn-paper` uses DM Sans at 12px/600. The actual original Google
response is version 4.004. Its variable `opsz` axis defaults to 9; zero-network
Chrome 154 measurement proves auto optical sizing at 12px matches explicit
opsz 12. The actual native default static Sans family resolves a 600 request
to its 700 face: `native-before.json` records that selected FontId and width.

The embedded UI-only `Twyne Button Sans` face is derived from the existing
original variable font at opsz 12/wght 600. `theme::BUTTON_FONT` selects it only
for actual 12px/600 controls. Default Sans, document family attrs, and Typst
fonts remain unchanged. Original OFL/FONTLOG and exact source/output hashes
are recorded in `../button-font-provenance.json`.

For `Save note`, original-response Chrome measures 56.84375px. The old native
600 request paints the 700 face at 57.396px. The new actual native selected
face measures 56.832px, a 0.01175px difference. All source-derived glyph IDs and
advance units match exactly in the actual platform test. Static instancing,
CSS advance quantization and rasterization remain distinct.

The separate original Special Elite label `PLACE NOTE` uses 11.2px and 2.016px
tracking. Chrome measures 83.875px. Native full-run shaping measures 63.77109px
before tracking, or 83.93109px including ten trailing tracking advances.
This establishes the small raw advance difference; per-character flex-layout
rounding is a separate Root label-painter concern. No font-size adjustment was
introduced. These measurements do not prove other optical sizes/weights.

```sh
rtk proxy python3 desktop/gpui/tools/sync-button-font.py --check
rtk proxy env TWYNE_BUTTON_FONT_OUTPUT=desktop/gpui/assets/button-font-evidence bun desktop/gpui/tools/probe-button-fonts-web.ts
rtk proxy bun desktop/gpui/tools/sync-assets.ts --check
```

The probe reads the original owned response files from
`/tmp/twyne-original-web-fonts/`; it opens fresh headless Chrome with all network
requests blocked and never accesses the user's browser or desktop.
