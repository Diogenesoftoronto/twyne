import Add from "reicon/icons/Add";
import AlignHSpacing from "reicon/icons/AlignHSpacing";
import ArrowDown from "reicon/icons/ArrowDown";
import ArrowLeft from "reicon/icons/ArrowLeft";
import ArrowRight from "reicon/icons/ArrowRight";
import ArrowUp from "reicon/icons/ArrowUp";
import BrowserTerminal from "reicon/icons/BrowserTerminal";
import Code from "reicon/icons/Code";
import Command from "reicon/icons/Command";
import CommentPlus from "reicon/icons/CommentPlus";
import Devices from "reicon/icons/Devices";
import Diagram from "reicon/icons/Diagram";
import FileCheck from "reicon/icons/FileCheck";
import Fullscreen from "reicon/icons/Fullscreen";
import Grid from "reicon/icons/Grid";
import Grid2 from "reicon/icons/Grid2";
import History from "reicon/icons/History";
import Image from "reicon/icons/Image";
import Iphone from "reicon/icons/Iphone";
import Keyboard from "reicon/icons/Keyboard";
import Layout from "reicon/icons/Layout";
import Link from "reicon/icons/Link";
import LinkBroken from "reicon/icons/LinkBroken";
import List3 from "reicon/icons/List3";
import Minus from "reicon/icons/Minus";
import OrderedList from "reicon/icons/OrderedList";
import Page from "reicon/icons/Page";
import QuoteDown from "reicon/icons/QuoteDown";
import Redo from "reicon/icons/Redo";
import RowHorizontal from "reicon/icons/RowHorizontal";
import RowVertical from "reicon/icons/RowVertical";
import Checklist from "reicon/icons/Checklist";
import Search from "reicon/icons/Search";
import TextalignCenter from "reicon/icons/TextalignCenter";
import TextalignJustifyleft from "reicon/icons/TextalignJustifyleft";
import TextalignLeft from "reicon/icons/TextalignLeft";
import TextalignRight from "reicon/icons/TextalignRight";
import Trash from "reicon/icons/Trash";
import Undo from "reicon/icons/Undo";
import UnorderedList from "reicon/icons/UnorderedList";
import type { IconFunction, IconWeight } from "reicon/createIcon";

const TWYNE_ICONS = {
  add: Add,
  "align-horizontal-spacing": AlignHSpacing,
  "arrow-down": ArrowDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  "browser-terminal": BrowserTerminal,
  code: Code,
  command: Command,
  "comment-add": CommentPlus,
  devices: Devices,
  diagram: Diagram,
  "file-check": FileCheck,
  fullscreen: Fullscreen,
  grid: Grid,
  "grid-2": Grid2,
  history: History,
  image: Image,
  iphone: Iphone,
  keyboard: Keyboard,
  layout: Layout,
  link: Link,
  "link-broken": LinkBroken,
  list: List3,
  "section-divider": Minus,
  "ordered-list": OrderedList,
  page: Page,
  quote: QuoteDown,
  redo: Redo,
  "row-horizontal": RowHorizontal,
  "row-vertical": RowVertical,
  checklist: Checklist,
  search: Search,
  "text-align-center": TextalignCenter,
  "text-align-justify": TextalignJustifyleft,
  "text-align-left": TextalignLeft,
  "text-align-right": TextalignRight,
  trash: Trash,
  undo: Undo,
  "unordered-list": UnorderedList,
} satisfies Record<string, IconFunction>;

export type TwyneIconName = keyof typeof TWYNE_ICONS;

/** Semantic editor controls must not reuse Twyne's ornamental fleuron. */
export const EDITOR_TOOL_ICONS = {
  bulletList: "unordered-list",
  numberedList: "ordered-list",
  checklist: "checklist",
  sectionBreak: "section-divider",
} as const satisfies Record<string, TwyneIconName>;

export const COMPOSITOR_ICONS = {
  undo: "undo",
  redo: "redo",
  quote: "quote",
  codeBlock: "code",
  alignLeft: "text-align-left",
  alignCenter: "text-align-center",
  alignRight: "text-align-right",
  justify: "text-align-justify",
  image: "image",
  table: "grid",
  diagram: "diagram",
  pageBreak: "page",
  comment: "comment-add",
  find: "search",
  grammar: "file-check",
  history: "history",
  outline: "list",
  keyboard: "keyboard",
  layout: "layout",
  zen: "fullscreen",
} as const satisfies Record<string, TwyneIconName>;

export interface TwyneIconOptions {
  size?: number;
  weight?: IconWeight;
  label?: string;
  className?: string;
}

/** SSR-safe Reicon renderer with Twyne's accessibility defaults. */
export function renderTwyneIconSvg(
  name: TwyneIconName,
  options: TwyneIconOptions = {},
): string {
  const label = options.label?.trim();
  return TWYNE_ICONS[name].toSvg({
    size: options.size ?? 16,
    weight: options.weight ?? "Outline",
    color: "currentColor",
    className: options.className,
    attrs: label
      ? { role: "img", "aria-label": label, focusable: "false" }
      : { "aria-hidden": "true", focusable: "false" },
  });
}
