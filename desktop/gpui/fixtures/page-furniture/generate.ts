/** Regenerate: rtk proxy bun desktop/gpui/fixtures/page-furniture/generate.ts.
 * Execute the web layout, ornament and furniture contracts. CSS lengths are
 * read from the authoritative rules rather than a second native constants file.
 */
import {
  DEFAULT_LAYOUT,
  DOC_WIDTH_REM,
  resolveMargins,
  resolvePageSetup,
  type LayoutSettings,
} from "../../../../src/types";
import { pageBorderTileCounts } from "../../../../src/utils/page-ornaments";
import { computePageGeometry } from "../../../../src/components/editor/pagination-geometry";

// The Qwik component module requires build-time flags. Execute its two exact
// pure helpers without instantiating or substituting the browser component.
const editorSource = await Bun.file(
  new URL(
    "../../../../src/components/editor/page-furniture-editor.tsx",
    import.meta.url,
  ),
).text();
const helperStart = editorSource.indexOf(
  "export function normalizePageFurnitureValue",
);
const helperEnd = editorSource.indexOf(
  "export function createPageFurnitureChange",
);
if (helperStart < 0 || helperEnd <= helperStart)
  throw new Error("Page furniture helper boundaries changed");
const helperJs = new Bun.Transpiler({ loader: "ts" }).transformSync(
  editorSource.slice(helperStart, helperEnd),
);
const { pageFurnitureDisplayValue } = new Function(
  `${helperJs.replace(/\bexport\s+/g, "")}\nreturn { pageFurnitureDisplayValue };`,
)() as {
  pageFurnitureDisplayValue: (
    value: string | undefined,
    fallback: string,
  ) => string;
};

const css = await Bun.file(
  new URL("../../../../src/global.css", import.meta.url),
).text();
function rules(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, "g"))].map(
    (match) => match[1],
  );
}
function rem(rule: string, property: string) {
  const match = rule.match(new RegExp(`${property}:\\s*([.\\d]+)rem`));
  if (!match) throw new Error(`Missing ${property} in ${rule}`);
  return Number(match[1]) * 16;
}
const ruler = rules(".ruler")[0];
const plain = rules(".manuscript-border")[0];
const ornate = rules(".manuscript-border--ornate");
const clearances = rules(".page-canvas.has-ornate-border");
const zenRules = rules(".page-canvas.zen-mode:not(.is-paginated)");
const rulerHeight = rem(ruler, "height");
const rulerGap = Number(ruler.match(/margin:\s*0 auto ([.\d]+)rem/)![1]) * 16;
const plainInset = rem(plain, "inset");
const largeInset = rem(ornate[0], "inset");
const compactInset = rem(ornate[1], "inset");
const largeFrame = rem(ornate[0], "border");
const compactFrame = rem(ornate[1], "border-width");
const largeClearance = rem(clearances[0], "--ornament-clearance");
const smallClearance = rem(clearances[1], "--ornament-clearance");
const zenTop = rem(zenRules[0], "padding-top");
const zenBottom = rem(zenRules[0], "padding-bottom");
const smallZenTop = rem(zenRules[1], "padding-top");
const zenMax = rem(zenRules[0], "max-width");
const sideClamp = zenRules[0].match(
  /padding-inline:\s*clamp\(([.\d]+)rem, ([.\d]+)vw, ([.\d]+)rem\)/,
)!;

type Case = {
  name: string;
  layout: LayoutSettings;
  available: number;
  viewport: number;
  zen: boolean;
};
const cases: Case[] = [
  {
    name: "current continuous default",
    layout: DEFAULT_LAYOUT,
    available: 984,
    viewport: 1280,
    zen: false,
  },
  {
    name: "legacy coarse margins",
    layout: {
      width: "narrow",
      margin: "tight",
      runningHeader: false,
      pageNumbers: true,
    },
    available: 984,
    viewport: 1280,
    zen: false,
  },
  {
    name: "legacy independent sides",
    layout: {
      width: "wide",
      margin: "roomy",
      marginX: 1.75,
      marginLeft: 2.25,
      runningHeader: true,
      pageNumbers: false,
    },
    available: 1100,
    viewport: 1500,
    zen: false,
  },
  {
    name: "ornate frame and clearance",
    layout: { ...DEFAULT_LAYOUT, pageBorder: "botanical" },
    available: 984,
    viewport: 1280,
    zen: false,
  },
  {
    name: "compact canvas, desktop viewport",
    layout: { ...DEFAULT_LAYOUT, pageBorder: "engraved" },
    available: 480,
    viewport: 1280,
    zen: false,
  },
  {
    name: "mobile ornament clearance",
    layout: { ...DEFAULT_LAYOUT, pageBorder: "illuminated" },
    available: 480,
    viewport: 639,
    zen: false,
  },
  {
    name: "zen uses full desk",
    layout: { ...DEFAULT_LAYOUT, pageBorder: "botanical" },
    available: 984,
    viewport: 1280,
    zen: true,
  },
  {
    name: "zen maximum width",
    layout: DEFAULT_LAYOUT,
    available: 2400,
    viewport: 2400,
    zen: true,
  },
  {
    name: "mobile zen",
    layout: DEFAULT_LAYOUT,
    available: 600,
    viewport: 639,
    zen: true,
  },
];

const continuous = cases.map((item) => {
  const { layout, available, viewport, zen } = item;
  const mobile = viewport <= 639;
  const width = zen
    ? mobile
      ? available
      : Math.min(zenMax, available - 32)
    : Math.min(available, DOC_WIDTH_REM[layout.width] * 16);
  const margins = resolveMargins(layout);
  const guides = Object.fromEntries(
    Object.entries(margins).map(([key, value]) => [key, value * 16]),
  );
  const border = zen ? "none" : (layout.pageBorder ?? "plain");
  const isOrnate = !["none", "plain"].includes(border);
  const clearance = isOrnate ? (mobile ? smallClearance : largeClearance) : 0;
  const sides = mobile
    ? 16
    : Math.min(
        Number(sideClamp[3]) * 16,
        Math.max(
          Number(sideClamp[1]) * 16,
          (Number(sideClamp[2]) * viewport) / 100,
        ),
      );
  const padding = zen
    ? {
        left: sides,
        right: sides,
        top: mobile ? smallZenTop : zenTop,
        bottom: zenBottom,
      }
    : Object.fromEntries(
        Object.entries(guides).map(([key, value]) => [
          key,
          Math.max(clearance, value),
        ]),
      );
  return {
    ...item,
    expected: {
      width,
      padding,
      guides,
      border,
      inset: isOrnate && width >= 512 ? largeInset : plainInset,
      frame: isOrnate ? (width < 512 ? compactFrame : largeFrame) : 1,
      rulerSpace: zen || viewport <= 640 ? 0 : rulerHeight + rulerGap,
    },
  };
});

const physical = (
  [
    { paper: "letter", orientation: "portrait" },
    { paper: "a4", orientation: "landscape" },
    { paper: "legal", orientation: "portrait" },
  ] as const
).map((setup) => {
  const layout: LayoutSettings = {
    ...DEFAULT_LAYOUT,
    ...setup,
    pageBorder: "botanical",
    pagination: "paginated",
  };
  const page = resolvePageSetup(layout);
  return {
    layout,
    width: page.widthIn * 96,
    height: page.heightIn * 96,
    tiles: pageBorderTileCounts(layout),
    geometry: computePageGeometry(layout, 16),
  };
});
const furniture = [
  { custom: undefined, fallback: "Untitled" },
  { custom: " \t\n ", fallback: "A title" },
  { custom: "  Café — a running head  ", fallback: "Untitled" },
].map(({ custom, fallback }) => ({
  custom,
  fallback,
  displayed: pageFurnitureDisplayValue(custom, fallback),
}));

await Bun.write(
  new URL("web-contract.json", import.meta.url),
  `${JSON.stringify(
    {
      generatedBy:
        "Executed src/types, page-ornaments, pagination-geometry, page-furniture-editor and parsed src/global.css",
      css: {
        rulerHeight,
        rulerGap,
        plainInset,
        largeInset,
        compactInset,
        largeFrame,
        compactFrame,
        largeClearance,
        smallClearance,
      },
      continuous,
      physical,
      furniture,
    },
    null,
    2,
  )}\n`,
);
