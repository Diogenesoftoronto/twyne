/** Regenerate with `rtk proxy bun desktop/gpui/fixtures/compositor/generate.ts`.
 * This fixture executes the web's public control contracts without a browser,
 * persistence adapter, compiler, or provider.
 */
import { COMPOSITOR_TABS } from "../../../../src/utils/compositor-toolbar";
import {
  DEFAULT_MANUSCRIPT_FONT_LABEL,
  DEFAULT_MANUSCRIPT_FONT_SIZE_LABEL,
  FONT_CHOICES,
  FONT_SIZES,
  LINE_SPACINGS,
  PARAGRAPH_SPACINGS,
  recase,
} from "../../../../src/utils/typography-options";
import {
  HIGHLIGHT_SWATCHES,
  TEXT_SWATCHES,
  normalizeHex,
} from "../../../../src/utils/palette";
import { DEFAULT_LAYOUT, MARGIN_RANGE } from "../../../../src/types";

const pairs = (options: readonly { label: string; value: string | number }[]) =>
  options.map(({ label, value }) => [label, String(value)]);
const source = "THE  OLD FOX AND the SEA";
const colors = [
  " #C27 ",
  "456789",
  "#ff",
  "var(--color-ink)",
  "#１２３",
  "#c1272d",
];
await Bun.write(
  new URL("web-contract.json", import.meta.url),
  `${JSON.stringify(
    {
      generatedBy:
        "src/utils/compositor-toolbar.ts, typography-options.ts, palette.ts, and src/types/index.ts",
      tabs: COMPOSITOR_TABS,
      fonts: [
        [DEFAULT_MANUSCRIPT_FONT_LABEL, ""],
        ...FONT_CHOICES.map(({ label, stack }) => [label, stack]),
      ],
      sizes: [[DEFAULT_MANUSCRIPT_FONT_SIZE_LABEL, ""], ...pairs(FONT_SIZES)],
      lineSpacings: pairs(LINE_SPACINGS),
      paragraphSpacings: [["Default", ""], ...pairs(PARAGRAPH_SPACINGS)],
      highlights: HIGHLIGHT_SWATCHES.map(({ label, hex }) => [label, hex]),
      textColors: TEXT_SWATCHES.map(({ label, hex }) => [label, hex]),
      colors: colors.map((raw) => ({ raw, normalized: normalizeHex(raw) })),
      defaultLayout: DEFAULT_LAYOUT,
      marginRange: MARGIN_RANGE,
      case: {
        source,
        title: recase(source, "title"),
        upper: recase(source, "upper"),
      },
    },
    null,
    2,
  )}\n`,
);
