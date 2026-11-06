import { afterEach, describe, expect, test } from "bun:test";
// @ts-expect-error — jsdom ships JS only; no @types/jsdom is installed.
import { JSDOM } from "jsdom";
import { bindPersonaNoteHover } from "./persona-note-hover";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const dom = new JSDOM(
    `<main><article><span class="twyne-persona-note" data-persona-note-id="one">A <strong>highlighted</strong> passage</span><p>Unmarked text</p></article><aside class="persona-note-card"><p>The note</p><textarea></textarea></aside></main>`,
  );
  const document: Document = dom.window.document;
  const manuscript = document.querySelector("article")!;
  const mark = manuscript.querySelector<HTMLElement>("span")!;
  const bold = mark.querySelector("strong")!;
  const gap = manuscript.querySelector("p")!;
  const card = document.querySelector<HTMLElement>("aside")!;
  let id: string | undefined;
  let opens = 0;
  let allow = true;
  let protectedNote = false;
  const hover = bindPersonaNoteHover(manuscript, {
    canOpen: () => allow,
    openId: () => id,
    open: (mark) => {
      id = mark.dataset.personaNoteId;
      opens++;
    },
    close: () => {
      id = undefined;
    },
    canClose: () => !protectedNote,
    openDelay: 10,
    closeDelay: 35,
  });
  cleanups.push(() => {
    hover.destroy();
    dom.window.close();
  });
  const over = (target: Element) =>
    target.dispatchEvent(
      new dom.window.MouseEvent("mouseover", { bubbles: true }),
    );
  const out = (target: Element, relatedTarget: Element) =>
    target.dispatchEvent(
      new dom.window.MouseEvent("mouseout", { bubbles: true, relatedTarget }),
    );
  return {
    dom,
    document,
    mark,
    bold,
    gap,
    card,
    hover,
    over,
    out,
    get id() {
      return id;
    },
    get opens() {
      return opens;
    },
    disarm() {
      allow = false;
    },
    protect() {
      protectedNote = true;
    },
  };
}
const settleOpen = () => Bun.sleep(20);
const settleClose = () => Bun.sleep(50);

describe("persona highlight hover", () => {
  test("a quick pass never opens a preview", async () => {
    const s = setup();
    s.over(s.mark);
    s.out(s.mark, s.gap);
    await settleOpen();
    expect(s.id).toBeUndefined();
  });
  test("crossing the gap into the note keeps it open", async () => {
    const s = setup();
    s.over(s.mark);
    await settleOpen();
    expect(s.id).toBe("one");
    s.out(s.mark, s.gap);
    expect(s.id).toBe("one");
    s.over(s.card);
    await settleClose();
    expect(s.id).toBe("one");
    s.out(s.card, s.gap);
    await settleClose();
    expect(s.id).toBeUndefined();
  });
  test("crossing text fragments or returning to a highlight preserves the note", async () => {
    const s = setup();
    s.over(s.mark);
    s.out(s.mark, s.bold);
    s.over(s.bold);
    await settleOpen();
    s.out(s.bold, s.gap);
    s.over(s.mark);
    await settleClose();
    expect(s.id).toBe("one");
    expect(s.opens).toBe(1);
  });
  test("a pending preview respects typing suppression and explicit cancellation", async () => {
    const s = setup();
    s.over(s.mark);
    s.disarm();
    await settleOpen();
    expect(s.id).toBeUndefined();
    const other = setup();
    other.over(other.mark);
    other.hover.cancel();
    await settleOpen();
    expect(other.id).toBeUndefined();
  });
  test("a focused reply and a protected conversation survive mouseout", async () => {
    const s = setup();
    s.over(s.mark);
    await settleOpen();
    s.document.querySelector("textarea")!.focus();
    s.out(s.card, s.gap);
    await settleClose();
    expect(s.id).toBe("one");
    s.document.querySelector("textarea")!.blur();
    s.protect();
    await settleClose();
    expect(s.id).toBe("one");
  });
  test("destroy cancels a pending opening", async () => {
    const s = setup();
    s.over(s.mark);
    s.hover.destroy();
    await settleOpen();
    expect(s.id).toBeUndefined();
  });
});
