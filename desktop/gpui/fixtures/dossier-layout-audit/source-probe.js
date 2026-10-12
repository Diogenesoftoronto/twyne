/**
 * UNEXECUTED Parent-only read probe for an OWNED anonymous original Dossier.
 * Invoke in that fixture's existing page.evaluate context. Does not navigate,
 * focus, scroll, mutate controls, call a provider, or create probe nodes.
 * Parent must select/record the actual state separately. Never use a user tab.
 */
export function captureDossierLayout() {
  const properties = [
    "display", "position", "box-sizing", "width", "height", "min-width",
    "min-height", "max-width", "max-height", "grid-template-columns",
    "grid-template-rows", "grid-auto-rows", "align-content", "align-items",
    "flex", "flex-direction", "flex-shrink", "gap", "overflow-x",
    "overflow-y", "overscroll-behavior", "padding-top", "padding-right",
    "padding-bottom", "padding-left", "margin-top", "margin-bottom",
    "border-top-width", "border-right-width", "border-bottom-width",
    "border-left-width", "font-family", "font-size", "font-weight",
    "line-height", "letter-spacing", "font-style", "font-feature-settings",
    "text-transform", "white-space",
    "overflow-wrap", "word-break", "background-color", "opacity",
    "transform", "box-shadow", "animation-name", "animation-duration",
    "-webkit-line-clamp",
  ];
  const selectors = [
    "main.paper-sheet", "main.paper-sheet > div.mx-auto",
    ".dossier-folio-frame", ".dossier-folio-frame > div:first-child",
    ".dossier-folio-frame > div.grid", ".dossier-folio-frame > div.grid > div",
    ".folio-column", ".folio-column.flex-1 > div", ".folio-column .my-auto",
    "#atr-title", "#atr-question", "#atr-hint", ".folio-column dl",
    ".folio-column dl > button", ".folio-column dl dt", ".folio-column dl dd",
    ".type-caret", ".carriage-input", "textarea", "nav[aria-label='Folio sections']",
    ".folio-rail-step", ".btn-paper", ".btn-press", ".dossier-filed-confirmation",
    ".dossier-filed-confirmation__paper",
  ];
  const rect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const rows = selectors.flatMap((selector) =>
    [...document.querySelectorAll(selector)].map((element, index) => {
      const style = getComputedStyle(element);
      const contentRange = document.createRange();
      contentRange.selectNodeContents(element);
      const result = {
        selector, index, id: element.id || null,
        rect: rect(element.getBoundingClientRect()),
        clientSize: [element.clientWidth, element.clientHeight],
        scrollSize: [element.scrollWidth, element.scrollHeight],
        scrollPosition: [element.scrollLeft, element.scrollTop],
        offsetSize: [element.offsetWidth, element.offsetHeight],
        styles: Object.fromEntries(properties.map((key) => [key, style.getPropertyValue(key)])),
        contentRects: [...contentRange.getClientRects()].map(rect),
        focused: document.activeElement === element,
        disabled: "disabled" in element ? element.disabled : null,
        inputValue: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.value : null,
        current: element.getAttribute("aria-current"),
        filingState: element.getAttribute("data-filing-state"),
        animations: element.getAnimations().map((a) => ({
          state: a.playState, time: a.currentTime, pending: a.pending,
        })),
      };
      contentRange.detach();
      return result;
    }),
  );
  return {
    proof: "Actual read-only DOM measurement only when Parent executes in owned fixture",
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    visualViewport: visualViewport && {
      width: visualViewport.width, height: visualViewport.height,
      scale: visualViewport.scale, offsetTop: visualViewport.offsetTop,
    },
    theme: document.documentElement.getAttribute("data-theme"),
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    documentScroll: [scrollX, scrollY],
    documentSize: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    fontStatus: document.fonts.status,
    compatMode: document.compatMode,
    pathname: location.pathname,
    rows,
  };
}
