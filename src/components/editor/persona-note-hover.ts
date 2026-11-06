/** A highlight previews its note; crossing the margin must not dismiss it. */
export function bindPersonaNoteHover(
  manuscript: HTMLElement,
  options: {
    canOpen(): boolean;
    openId(): string | undefined;
    open(mark: HTMLElement): void;
    close(): void;
    canClose(): boolean;
    openDelay?: number;
    closeDelay?: number;
  },
) {
  const document = manuscript.ownerDocument;
  let opening: ReturnType<typeof setTimeout> | undefined;
  let closing: ReturnType<typeof setTimeout> | undefined;
  let pendingId: string | undefined;
  const cancelOpen = () => {
    clearTimeout(opening);
    pendingId = undefined;
  };
  const cancelClose = () => clearTimeout(closing);
  const cancel = () => {
    cancelOpen();
    cancelClose();
  };
  const closest = (target: EventTarget | null, selector: string) =>
    target && "closest" in target
      ? (target as Element).closest<HTMLElement>(selector)
      : null;
  const markFor = (target: EventTarget | null) => {
    const mark = closest(target, ".twyne-persona-note");
    if (mark && manuscript.contains(mark)) return mark;
    const chip = closest(target, '.twyne-mark-anchor[data-anchor-kind="note"]');
    return chip && manuscript.contains(chip)
      ? manuscript.querySelector<HTMLElement>(
          `.twyne-persona-note[data-persona-note-id="${CSS.escape(chip.dataset.anchorId ?? "")}"]`,
        )
      : null;
  };
  const cardFor = (target: EventTarget | null) =>
    closest(target, ".persona-note-card");
  const scheduleClose = () => {
    cancelClose();
    closing = setTimeout(() => {
      if (options.canClose() && !cardFor(document.activeElement))
        options.close();
    }, options.closeDelay ?? 450);
  };
  const onOver = (event: MouseEvent) => {
    if (cardFor(event.target)) {
      cancel();
      return;
    }
    const mark = markFor(event.target);
    if (!mark) return;
    cancelClose();
    const id = mark.dataset.personaNoteId;
    // Moving across bold/italic fragments of one highlight must not restart
    // the delay or replace a note that already contains a reply draft.
    if (!id || id === options.openId() || id === pendingId) return;
    cancelOpen();
    if (!options.canOpen()) return;
    pendingId = id;
    opening = setTimeout(() => {
      pendingId = undefined;
      if (mark.isConnected && options.canOpen()) options.open(mark);
    }, options.openDelay ?? 250);
  };
  const onOut = (event: MouseEvent) => {
    const mark = markFor(event.target);
    const card = cardFor(event.target);
    if (!mark && !card) return;
    const nextMark = markFor(event.relatedTarget);
    if (
      cardFor(event.relatedTarget) ||
      (nextMark &&
        (nextMark.dataset.personaNoteId === mark?.dataset.personaNoteId ||
          nextMark.dataset.personaNoteId === options.openId()))
    )
      return;
    cancelOpen();
    scheduleClose();
  };
  const onFocus = (event: FocusEvent) => {
    if (cardFor(event.target)) cancel();
  };
  const onBlur = (event: FocusEvent) => {
    if (cardFor(event.target) && !cardFor(event.relatedTarget)) scheduleClose();
  };
  document.addEventListener("mouseover", onOver);
  document.addEventListener("mouseout", onOut);
  document.addEventListener("focusin", onFocus);
  document.addEventListener("focusout", onBlur);
  return {
    cancel,
    destroy() {
      cancel();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    },
  };
}
