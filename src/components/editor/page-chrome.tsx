import { component$, type PropFunction } from "@qwik.dev/core";
import type { LayoutSettings } from "../../types";
import { PageFurnitureEditor } from "./page-furniture-editor";

export interface PageChromeProps {
  /** Number of sheets the engine says the manuscript occupies. */
  pageCount: number;
  /** Sheet height in CSS px. */
  pageH: number;
  /** Gap painted between two sheets, CSS px. */
  gap: number;
  /** Top page margin, CSS px — where the running header sits. */
  marginTop: number;
  /** Bottom page margin, CSS px — where the page number sits. */
  marginBottom: number;
  /** Left page margin, CSS px. */
  marginLeft: number;
  /** Right page margin, CSS px. */
  marginRight: number;
  layout: LayoutSettings;
  /** Shown in the running header, alongside the author. */
  title?: string;
  author?: string;
  headerText?: string;
  footerText?: string;
  onHeaderCommit$?: PropFunction<(value: string) => void>;
  onFooterCommit$?: PropFunction<(value: string) => void>;
  /** False when the engine fell back to a continuous column. */
  active: boolean;
  /** Faded out in zen mode, like the toolbar and the ruler. */
  zen?: boolean;
}

/**
 * The visible page furniture: sheet edges, running headers, page numbers.
 *
 * None of this is in the document. The pagination engine guarantees that page
 * *k*'s content top sits at exactly `k * (pageH + gap)`, which means every
 * position here is a multiply rather than a measurement — this component never
 * reads the DOM and never needs to know where a break actually landed.
 *
 * It renders *behind* the prose (`z-index: 0` against the editor's own stacking
 * context) and is inert to the pointer, so clicking a page number puts the
 * caret in the text underneath rather than stealing focus from the manuscript.
 *
 * The page numbers are real text nodes rather than CSS counters. That is
 * deliberate: `counter(page)` is only readable inside a `@page` margin box,
 * which Chrome does not implement, so a counter-based footer would print
 * blank. Taking the integer from the engine is what lets screen and paper
 * agree on what page seven is.
 */
export const PageChrome = component$<PageChromeProps>((props) => {
  if (!props.active || props.pageCount < 1) return null;

  const period = props.pageH + props.gap;
  const pages = Array.from({ length: props.pageCount }, (_, i) => i);
  const showHeader = props.layout.runningHeader === true;
  const showNumbers = props.layout.pageNumbers !== false;

  return (
    <div
      class={`twyne-page-chrome ${props.zen ? "zen" : ""}`}
      aria-label="Page headers and footers"
      style={{
        // Absolutely positioned against the page canvas's padding box, whose
        // top edge is page 0's sheet top and whose width is the full sheet.
        position: "absolute",
        left: "0",
        right: "0",
        top: "0",
        height: `${Math.max(0, props.pageCount * period - props.gap)}px`,
        pointerEvents: "none",
        zIndex: "0",
      }}
    >
      {pages.map((k) => (
        <div
          key={k}
          class="twyne-page-sheet"
          data-page={k + 1}
          style={{
            position: "absolute",
            left: "0",
            right: "0",
            top: `${k * period}px`,
            height: `${props.pageH}px`,
          }}
        >
          {showHeader && (
            <div
              class="twyne-page-running-header"
              style={{
                position: "absolute",
                left: `${props.marginLeft}px`,
                right: `${props.marginRight}px`,
                // Sit the header inside the top margin, clear of the text.
                top: `${Math.max(4, props.marginTop * 0.45)}px`,
              }}
            >
              <span class="twyne-page-header-title">
                <PageFurnitureEditor
                  kind="header"
                  value={props.headerText}
                  fallback={props.title || "Untitled"}
                  placeholder="Running header"
                  label={`Edit running header on page ${k + 1}`}
                  emitFolioEvent={false}
                  onCommit$={(change) => props.onHeaderCommit$?.(change.value)}
                />
              </span>
              {props.author && (
                <span class="twyne-page-header-author">{props.author}</span>
              )}
            </div>
          )}
          {(showNumbers || props.footerText) && (
            <div
              class="twyne-page-running-footer"
              style={{
                position: "absolute",
                left: `${props.marginLeft}px`,
                right: `${props.marginRight}px`,
                bottom: `${Math.max(4, props.marginBottom * 0.4)}px`,
              }}
            >
              <span class="twyne-page-footer-text">
                <PageFurnitureEditor
                  kind="footer"
                  value={props.footerText}
                  fallback=" "
                  placeholder="Running footer"
                  label={`Edit running footer on page ${k + 1}`}
                  emitFolioEvent={false}
                  onCommit$={(change) => props.onFooterCommit$?.(change.value)}
                />
              </span>
              {showNumbers && <span class="twyne-page-number">{k + 1}</span>}
              <span aria-hidden="true" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
});
