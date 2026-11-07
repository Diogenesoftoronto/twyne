/**
 * Alternatives: lock a span of the manuscript and browse replacements for it.
 *
 * The extension owns the manuscript side of the feature. It locks a range
 * (marked with a bracket, mapped through every edit), shows the option the
 * writer is looking at in place of the locked words without touching the
 * document, turns the wheel over the locked words into "next option", and
 * applies a pick as one undoable replacement. The palette
 * (`alternatives-palette.tsx`) follows the lock through a window event and
 * drives it through {@link alternativesController}.
 *
 * A lock ends when the writer uses an option, keeps the original, clicks away
 * or edits the locked words themselves.
 */
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import { sentenceWordDiff } from "../../../utils/sentence-bench";
import {
  alternativeCore,
  checkAlternativeSpan,
  LEAF_PLACEHOLDER,
  spanContext,
  wordAt,
  type AlternativeScale,
} from "../../../utils/alternatives";

export const ALTERNATIVES_EVENT = "twyne:alternatives";
export const ALTERNATIVES_STEP_EVENT = "twyne:alternatives-step";
/** Nothing could be locked; the palette shows why, at the caret. */
export const ALTERNATIVES_REFUSED_EVENT = "twyne:alternatives-refused";

export interface AlternativesRefusal {
  message: string;
  anchor: AlternativesAnchor;
}

export interface AlternativesAnchor {
  /** Viewport coordinates of the locked span. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Where the span's first line starts and its last line ends. */
  first?: { left: number; top: number; bottom: number };
  last?: { right: number; top: number; bottom: number };
  /** The page, and the area it scrolls in, for a column in its margin. */
  page?: { left: number; right: number };
  bounds?: { left: number; right: number; top: number; bottom: number };
}

export interface AlternativesSnapshot {
  /** Unique per lock; a new lock starts a new browse. */
  id: string;
  text: string;
  before: string;
  after: string;
  scale: AlternativeScale;
  words: number;
  anchor: AlternativesAnchor;
}

export type AlternativesOpenResult =
  | { ok: true; snapshot: AlternativesSnapshot }
  | { ok: false; message: string };

/** Which way the browse moved: 1 down the list, -1 up it, 0 a jump. */
export type AlternativesDirection = 1 | -1 | 0;

/** How long an applied wording stays inked before it reads as plain text. */
export const ALTERNATIVES_FLASH_MS = 900;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export interface AlternativesController {
  /** Lock the given range, or the selection, or the word at the caret. */
  open(range?: { from: number; to: number }): AlternativesOpenResult;
  preview(text: string | null, direction?: AlternativesDirection): void;
  /** The browse hit an end: the locked words give a small bump. */
  nudge(direction: 1 | -1): void;
  apply(text: string): { ok: true } | { ok: false; message: string };
  /** Release the lock and give the manuscript its focus back. */
  close(options?: { restoreSelection?: boolean }): void;
  /** Say at the caret why nothing was locked. */
  refuse(message: string): void;
  snapshot(): AlternativesSnapshot | null;
}

interface Lock {
  id: string;
  from: number;
  to: number;
  text: string;
  scale: AlternativeScale;
  /** The writer's selection when the lock opened, restored on Escape. */
  anchor: number;
  head: number;
}

interface Flash {
  from: number;
  to: number;
  seq: number;
}

interface PluginStateValue {
  lock: Lock | null;
  preview: string | null;
  /** The text the preview replaced and the way it moved, for the roll. */
  motion: { from: string; direction: AlternativesDirection } | null;
  /** Counts previews, so stepping back to a wording still redraws it. */
  seq: number;
  /** A just-applied wording, inked until {@link ALTERNATIVES_FLASH_MS}. */
  flash: Flash | null;
}

type Meta =
  | { type: "lock"; lock: Lock }
  | { type: "preview"; text: string | null; direction: AlternativesDirection }
  | { type: "release"; flash?: Flash }
  | { type: "flash-end"; seq: number };

/** Marks every one of these sets shares. */
function commonMarks(sets: readonly (readonly Mark[])[]): readonly Mark[] {
  if (!sets.length) return [];
  return sets[0]!.filter((mark) => sets.every((set) => mark.isInSet(set)));
}

/**
 * The replacement as text nodes that keep the locked words' formatting.
 * Words the replacement keeps keep their own marks; new words take the marks
 * of the words they replace (all of them shared), or, where nothing was
 * removed, the marks the whole span shares. So `<em>old</em> house` becomes
 * `<em>aged</em> cottage`, not an italic phrase.
 */
export function replacementNodes(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  text: string,
): ProseMirrorNode[] {
  const chars: { ch: string; marks: readonly Mark[] }[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const start = Math.max(from, pos) - pos;
    const end = Math.min(to, pos + node.nodeSize) - pos;
    for (const ch of node.text!.slice(start, end))
      chars.push({ ch, marks: node.marks });
  });
  const original = chars.map((c) => c.ch).join("");
  const whole = commonMarks(chars.map((c) => c.marks));
  const runs: { text: string; marks: readonly Mark[] }[] = [];
  const add = (piece: string, marks: readonly Mark[]) => {
    if (!piece) return;
    const last = runs.at(-1);
    if (
      last &&
      last.marks.length === marks.length &&
      marks.every((m) => m.isInSet(last.marks))
    )
      last.text += piece;
    else runs.push({ text: piece, marks });
  };
  // Code points, the way the diff and the chars array both count.
  let at = 0;
  const parts = sentenceWordDiff(original, text);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const length = [...part.text].length;
    if (part.kind === "same") {
      for (const c of chars.slice(at, at + length)) add(c.ch, c.marks);
      at += length;
      continue;
    }
    // A change block: neighbouring removed and added parts in any order.
    let removed: readonly Mark[][] = [];
    const added: string[] = [];
    let j = i;
    for (; j < parts.length && parts[j]!.kind !== "same"; j++) {
      const p = parts[j]!;
      const n = [...p.text].length;
      if (p.kind === "removed") {
        removed = [
          ...removed,
          ...chars.slice(at, at + n).map((c) => [...c.marks]),
        ];
        at += n;
      } else added.push(p.text);
    }
    i = j - 1;
    const marks = removed.length ? commonMarks(removed) : whole;
    for (const piece of added) add(piece, marks);
  }
  return runs.map((run) => doc.type.schema.text(run.text, run.marks));
}

const EMPTY: PluginStateValue = {
  lock: null,
  preview: null,
  motion: null,
  seq: 0,
  flash: null,
};

/** Motion is decoration: none when the writer asks for less, or can't run. */
export function motionAllowed(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function animate(
  el: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) {
  if (typeof (el as HTMLElement).animate === "function")
    (el as HTMLElement).animate(keyframes, options);
}

/** Width of what currently shows for the lock: its preview, or its words. */
function shownWidth(root: ParentNode, id: string): number | null {
  let left = Infinity;
  let right = -Infinity;
  for (const el of root.querySelectorAll<HTMLElement>(
    `[data-alternatives-lock="${id}"]`,
  ))
    for (const rect of el.getClientRects()) {
      if (!rect.width) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }
  return right > left ? right - left : null;
}

/**
 * The preview that stands in for the locked words. A word rolls like a drum:
 * the old word leaves one way as the new one arrives from the other, and the
 * slot glides to the new width so the rest of the line doesn't jump. A longer
 * span keeps its unchanged words still and inks in the ones that changed.
 */
function ghostFor(
  view: EditorView,
  lock: Lock,
  text: string,
  motion: PluginStateValue["motion"],
): HTMLElement {
  const word = lock.scale === "word";
  const moving = !!motion && motionAllowed();
  const before = moving && word ? shownWidth(view.dom, lock.id) : null;
  const ghost = document.createElement("span");
  ghost.className = word
    ? "twyne-alt-ghost twyne-alt-ghost--word"
    : "twyne-alt-ghost";
  ghost.dataset.alternativesLock = lock.id;
  ghost.setAttribute("aria-hidden", "true");
  if (word) {
    if (moving && motion!.direction !== 0) {
      ghost.classList.add(
        motion!.direction > 0 ? "is-roll-down" : "is-roll-up",
      );
      const out = document.createElement("span");
      out.className = "twyne-alt-ghost__out";
      out.textContent = motion!.from;
      ghost.append(out);
    }
    const inner = document.createElement("span");
    inner.className = "twyne-alt-ghost__in";
    inner.textContent = text;
    ghost.append(inner);
    if (before !== null)
      requestAnimationFrame(() => {
        if (!ghost.isConnected) return;
        const after = ghost.getBoundingClientRect().width;
        if (Math.abs(after - before) > 0.5)
          animate(ghost, [{ width: `${before}px` }, { width: `${after}px` }], {
            duration: 170,
            easing: EASE,
          });
      });
    return ghost;
  }
  let changed = 0;
  for (const part of sentenceWordDiff(lock.text, text)) {
    if (part.kind === "removed") continue;
    if (part.kind === "added" && part.text.trim()) {
      const ink = document.createElement("span");
      ink.className = moving ? "twyne-alt-ghost__new" : "";
      ink.style.setProperty("--i", String(Math.min(changed++, 8)));
      ink.textContent = part.text;
      ghost.append(ink);
    } else ghost.append(document.createTextNode(part.text));
  }
  return ghost;
}

export const alternativesPluginKey = new PluginKey<PluginStateValue>(
  "twyneAlternatives",
);

let controller: AlternativesController | null = null;
let current: AlternativesSnapshot | null = null;

export function alternativesController(): AlternativesController | null {
  return controller;
}

export function alternativesSnapshot(): AlternativesSnapshot | null {
  return current;
}

function publish(snapshot: AlternativesSnapshot | null) {
  current = snapshot;
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new window.CustomEvent<AlternativesSnapshot | null>(ALTERNATIVES_EVENT, {
      detail: snapshot,
    }),
  );
}

export function lockedText(state: EditorState, lock: Lock): string {
  return state.doc.textBetween(lock.from, lock.to, " ", LEAF_PLACEHOLDER);
}

/** Resolve what to lock: the range, the selection, or the word at a caret. */
export function resolveLock(
  state: EditorState,
  range?: { from: number; to: number },
):
  | {
      ok: true;
      from: number;
      to: number;
      text: string;
      before: string;
      after: string;
      scale: AlternativeScale;
      words: number;
    }
  | { ok: false; message: string } {
  let from = range?.from ?? state.selection.from;
  let to = range?.to ?? state.selection.to;
  from = Math.max(0, Math.min(from, state.doc.content.size));
  to = Math.max(from, Math.min(to, state.doc.content.size));
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  const parent = $from.parent;
  if (!parent.isTextblock || !$from.sameParent($to))
    return {
      ok: false,
      message: "Select words within one paragraph to see alternatives.",
    };
  if (parent.type.spec.code)
    return { ok: false, message: "Alternatives are for prose, not code." };
  const start = $from.start();
  const paragraph = state.doc.textBetween(
    start,
    $from.end(),
    " ",
    LEAF_PLACEHOLDER,
  );
  let a = from - start;
  let b = to - start;
  if (a === b) {
    const word = wordAt(paragraph, a);
    if (!word)
      return {
        ok: false,
        message: "Put the caret in a word, or select a passage.",
      };
    a = word.start;
    b = word.end;
  } else {
    const core = alternativeCore(paragraph.slice(a, b));
    b = a + core.end;
    a = a + core.start;
  }
  const text = paragraph.slice(a, b);
  const checked = checkAlternativeSpan(text);
  if (!checked.ok) return checked;
  const context = spanContext(paragraph, a, b);
  return {
    ok: true,
    from: start + a,
    to: start + b,
    text,
    before: context.before,
    after: context.after,
    scale: checked.scale,
    words: checked.words,
  };
}

/**
 * Where the locked span is on screen. Measured from the rendered lock (the
 * bracketed words, or the preview standing in for them, since the original is
 * hidden while previewing), falling back to document coordinates before the
 * decorations have drawn.
 */
function anchorFor(view: EditorView, lock: Lock): AlternativesAnchor {
  const span = spanAnchor(view, lock) ?? {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  };
  const canvas = view.dom.closest<HTMLElement>(".page-canvas");
  const page = (canvas ?? view.dom).getBoundingClientRect();
  const area = canvas?.parentElement?.getBoundingClientRect();
  return {
    ...span,
    page: { left: page.left, right: page.right },
    bounds: {
      left: Math.max(0, area?.left ?? 0),
      right: Math.min(window.innerWidth, area?.right ?? window.innerWidth),
      top: Math.max(0, area?.top ?? 0),
      bottom: Math.min(window.innerHeight, area?.bottom ?? window.innerHeight),
    },
  };
}

function spanAnchor(view: EditorView, lock: Lock): AlternativesAnchor | null {
  const rects: DOMRect[] = [];
  for (const el of view.dom.querySelectorAll<HTMLElement>(
    `[data-alternatives-lock="${lock.id}"]`,
  ))
    for (const rect of el.getClientRects())
      if (rect.width > 0 || rect.height > 0) rects.push(rect);
  if (rects.length) {
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    // Marks split a line into several rects; a line is the rects sharing it.
    const firstLine = rects.filter((r) => r.top - top < 3);
    const lastLine = rects.filter((r) => bottom - r.bottom < 3);
    const lastRight = Math.max(...lastLine.map((r) => r.right));
    const firstLeft = Math.min(...firstLine.map((r) => r.left));
    return {
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top,
      bottom,
      first: {
        left: firstLeft,
        top,
        bottom: Math.max(...firstLine.map((r) => r.bottom)),
      },
      last: {
        right: lastRight,
        top: Math.min(...lastLine.map((r) => r.top)),
        bottom,
      },
    };
  }
  try {
    const start = view.coordsAtPos(lock.from, 1);
    const end = view.coordsAtPos(lock.to, -1);
    return {
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
    };
  } catch {
    return null;
  }
}

const near = (a = 0, b = 0) => Math.abs(a - b) < 0.5;
const sameAnchor = (a: AlternativesAnchor, b: AlternativesAnchor) =>
  near(a.left, b.left) &&
  near(a.right, b.right) &&
  near(a.top, b.top) &&
  near(a.bottom, b.bottom) &&
  near(a.last?.right, b.last?.right) &&
  near(a.page?.left, b.page?.left) &&
  near(a.page?.right, b.page?.right);

function lockDecorations(
  state: EditorState,
  value: PluginStateValue,
): DecorationSet {
  const decorations: Decoration[] = [];
  const flash = value.flash;
  if (flash && flash.to > flash.from)
    decorations.push(
      Decoration.inline(flash.from, flash.to, {
        class: "twyne-alt-applied",
        "data-alternatives-applied": String(flash.seq),
      }),
    );
  const lock = value.lock;
  if (!lock) return DecorationSet.create(state.doc, decorations);
  const previewing = value.preview !== null;
  decorations.push(
    Decoration.inline(lock.from, lock.to, {
      class: previewing
        ? "twyne-alt-lock twyne-alt-lock--previewing"
        : "twyne-alt-lock",
      "data-alternatives-lock": lock.id,
    }),
  );
  if (previewing) {
    const text = value.preview!;
    const motion = value.motion;
    decorations.push(
      Decoration.widget(
        lock.from,
        (view) => ghostFor(view, lock, text, motion),
        // Each preview draws anew, so its motion plays; equal keys are reused.
        { side: -1, key: `alt-ghost:${lock.id}:${value.seq}` },
      ),
    );
  }
  return DecorationSet.create(state.doc, decorations);
}

export const Alternatives = Extension.create({
  name: "alternatives",

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    let lockCounter = 0;
    let liveView: EditorView | null = null;
    let lastAnchor: AlternativesAnchor | null = null;
    let touchY: number | null = null;
    const step = (delta: number) =>
      window.dispatchEvent(
        new window.CustomEvent<number>(ALTERNATIVES_STEP_EVENT, {
          detail: delta,
        }),
      );

    const pluginState = () =>
      alternativesPluginKey.getState(editor.state) ?? EMPTY;
    let flashSeq = 0;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    /** The lock's highlight sweeps in, in reading order, as it opens. */
    const sweep = (id: string) => {
      if (!motionAllowed()) return;
      requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        for (const el of editor.view.dom.querySelectorAll(
          `.twyne-alt-lock[data-alternatives-lock="${id}"]`,
        ))
          animate(
            el,
            [
              { backgroundSize: "0% 100%, 0% 1px" },
              { backgroundSize: "100% 100%, 100% 1px" },
            ],
            { duration: 280, easing: EASE },
          );
      });
    };

    const dispatch = (meta: Meta, tr?: Transaction) => {
      if (editor.isDestroyed) return;
      const next = (tr ?? editor.state.tr).setMeta(alternativesPluginKey, meta);
      if (!tr) next.setMeta("addToHistory", false);
      editor.view.dispatch(next);
    };

    const release = () => {
      lastAnchor = null;
      if (current) publish(null);
    };

    const refreshAnchor = () => {
      const lock = pluginState().lock;
      if (!lock || !current || !liveView) return;
      const anchor = anchorFor(liveView, lock);
      if (lastAnchor && sameAnchor(anchor, lastAnchor)) return;
      lastAnchor = anchor;
      publish({ ...current, anchor });
    };

    controller = {
      open(range) {
        const resolved = resolveLock(editor.state, range);
        if (!resolved.ok) return resolved;
        const selection = editor.state.selection;
        const lock: Lock = {
          id: `alt-${Date.now().toString(36)}-${++lockCounter}`,
          from: resolved.from,
          to: resolved.to,
          text: resolved.text,
          scale: resolved.scale,
          anchor: selection.anchor,
          head: selection.head,
        };
        dispatch({ type: "lock", lock });
        // The selection's own highlight would cover the lock and its motion;
        // closing puts the selection back.
        window.getSelection?.()?.removeAllRanges();
        sweep(lock.id);
        const anchor = anchorFor(editor.view, lock);
        lastAnchor = anchor;
        const snapshot: AlternativesSnapshot = {
          id: lock.id,
          text: resolved.text,
          before: resolved.before,
          after: resolved.after,
          scale: resolved.scale,
          words: resolved.words,
          anchor,
        };
        publish(snapshot);
        return { ok: true, snapshot };
      },
      preview(text, direction = 0) {
        const value = pluginState();
        if (!value.lock || value.preview === text) return;
        dispatch({ type: "preview", text, direction });
      },
      nudge(direction) {
        const lock = pluginState().lock;
        if (!lock || editor.isDestroyed || !motionAllowed()) return;
        const shown = [
          ...editor.view.dom.querySelectorAll<HTMLElement>(
            `[data-alternatives-lock="${lock.id}"]`,
          ),
        ].filter((el) => el.getClientRects().length > 0);
        for (const el of shown) {
          // Only a word's preview is a box that can move; text just dims.
          if (el.classList.contains("twyne-alt-ghost--word"))
            animate(
              el,
              [
                { transform: "translateY(0)" },
                { transform: `translateY(${-direction * 0.16}em)` },
                { transform: `translateY(${direction * 0.05}em)` },
                { transform: "translateY(0)" },
              ],
              { duration: 280, easing: "ease-out" },
            );
          else
            animate(el, [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], {
              duration: 240,
              easing: "ease-out",
            });
        }
      },
      apply(text) {
        const lock = pluginState().lock;
        if (!lock || editor.isDestroyed)
          return {
            ok: false,
            message: "The lock was released. Select the words again.",
          };
        if (lockedText(editor.state, lock) !== lock.text)
          return {
            ok: false,
            message: "The locked words changed. Select them again.",
          };
        const nodes = replacementNodes(
          editor.state.doc,
          lock.from,
          lock.to,
          text,
        );
        // A step of its own in the undo history: typing just before the lock
        // stays its own step, and so does typing just after the apply.
        const tr = closeHistory(
          editor.state.tr.replaceWith(lock.from, lock.to, nodes),
        );
        tr.setSelection(
          TextSelection.create(tr.doc, lock.from + text.length),
        ).setMeta("twyne:alternatives", { action: "apply" });
        // The new wording stays inked a moment, then dries to plain text.
        const seq = ++flashSeq;
        dispatch(
          {
            type: "release",
            flash: { from: lock.from, to: lock.from + text.length, seq },
          },
          tr,
        );
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => {
          if (!editor.isDestroyed && pluginState().flash?.seq === seq)
            dispatch({ type: "flash-end", seq });
        }, ALTERNATIVES_FLASH_MS);
        if (!editor.isDestroyed)
          editor.view.dispatch(closeHistory(editor.state.tr));
        release();
        editor.view.focus();
        return { ok: true };
      },
      close(options) {
        const lock = pluginState().lock;
        if (!lock) {
          release();
          return;
        }
        if (editor.isDestroyed) {
          release();
          return;
        }
        const tr = editor.state.tr;
        if (options?.restoreSelection !== false) {
          // The selection as the writer left it: a caret stays a caret, a
          // backward selection stays backward, trimmed edges come back.
          const size = tr.doc.content.size;
          const clamp = (n: number) => Math.max(0, Math.min(n, size));
          try {
            tr.setSelection(
              TextSelection.create(
                tr.doc,
                clamp(lock.anchor),
                clamp(lock.head),
              ),
            );
          } catch {
            tr.setSelection(TextSelection.create(tr.doc, lock.from, lock.to));
          }
        }
        tr.setMeta("addToHistory", false);
        dispatch({ type: "release" }, tr);
        release();
        editor.view.focus();
      },
      refuse(message) {
        if (editor.isDestroyed) return;
        let anchor: AlternativesAnchor = {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
        };
        try {
          const at = editor.view.coordsAtPos(editor.state.selection.head);
          anchor = {
            left: at.left,
            right: at.right,
            top: at.top,
            bottom: at.bottom,
          };
        } catch {
          /* keep the fallback */
        }
        window.dispatchEvent(
          new window.CustomEvent<AlternativesRefusal>(
            ALTERNATIVES_REFUSED_EVENT,
            {
              detail: { message, anchor },
            },
          ),
        );
      },
      snapshot: () => current,
    };

    const onScroll = () => {
      if (current) requestAnimationFrame(refreshAnchor);
    };

    return [
      new Plugin<PluginStateValue>({
        key: alternativesPluginKey,
        state: {
          init: () => EMPTY,
          apply(tr, value) {
            const meta = tr.getMeta(alternativesPluginKey) as Meta | undefined;
            let next = value;
            if (meta?.type === "lock")
              next = { ...EMPTY, lock: meta.lock, flash: value.flash };
            else if (meta?.type === "release")
              next = { ...EMPTY, flash: meta.flash ?? value.flash };
            else if (meta?.type === "flash-end")
              next =
                value.flash?.seq === meta.seq
                  ? { ...value, flash: null }
                  : value;
            else if (meta?.type === "preview" && value.lock)
              next = {
                ...value,
                preview: meta.text,
                motion:
                  meta.text === null
                    ? null
                    : {
                        from: value.preview ?? value.lock.text,
                        direction: meta.direction,
                      },
                seq: value.seq + 1,
              };
            // A release that applied text already carries its own positions.
            if (!tr.docChanged || meta?.type === "release") return next;
            const map = (from: number, to: number) => ({
              // Words typed at either edge stay outside.
              from: tr.mapping.map(from, 1),
              to: tr.mapping.map(to, -1),
            });
            return {
              ...next,
              lock: next.lock
                ? {
                    ...next.lock,
                    ...map(next.lock.from, next.lock.to),
                    anchor: tr.mapping.map(next.lock.anchor),
                    head: tr.mapping.map(next.lock.head),
                  }
                : null,
              flash: next.flash
                ? { ...next.flash, ...map(next.flash.from, next.flash.to) }
                : null,
            };
          },
        },
        props: {
          decorations(state) {
            const value = alternativesPluginKey.getState(state);
            return value ? lockDecorations(state, value) : null;
          },
          handleDOMEvents: {
            wheel(view, event) {
              const value = alternativesPluginKey.getState(view.state);
              if (!value?.lock) return false;
              const target = event.target as HTMLElement | null;
              if (!target?.closest?.("[data-alternatives-lock]")) return false;
              if (Math.abs(event.deltaY) < 1) return false;
              event.preventDefault();
              step(event.deltaY > 0 ? 1 : -1);
              return true;
            },
            // On touch, a vertical swipe on the locked words turns them, the
            // way a picker wheel does: up for the next option.
            touchstart(view, event) {
              const value = alternativesPluginKey.getState(view.state);
              const target = event.target as HTMLElement | null;
              touchY =
                value?.lock && target?.closest?.("[data-alternatives-lock]")
                  ? (event.touches[0]?.clientY ?? null)
                  : null;
              return false;
            },
            touchmove(_view, event) {
              if (touchY === null) return false;
              const y = event.touches[0]?.clientY ?? touchY;
              event.preventDefault();
              if (Math.abs(y - touchY) >= 28) {
                step(y < touchY ? 1 : -1);
                touchY = y;
              }
              return true;
            },
            touchend() {
              touchY = null;
              return false;
            },
            mousedown(view, event) {
              const value = alternativesPluginKey.getState(view.state);
              if (!value?.lock) return false;
              const target = event.target as HTMLElement | null;
              if (target?.closest?.("[data-alternatives-lock]")) {
                // A click on the locked words keeps the lock and its palette.
                event.preventDefault();
                return true;
              }
              controller?.close({ restoreSelection: false });
              return false;
            },
          },
        },
        view(view) {
          liveView = view;
          document.addEventListener("scroll", onScroll, true);
          window.addEventListener("resize", onScroll);
          return {
            update(view, previous) {
              liveView = view;
              const value = alternativesPluginKey.getState(view.state);
              const before = alternativesPluginKey.getState(previous);
              if (!value?.lock) {
                if (before?.lock) release();
                return;
              }
              if (!current || current.id !== value.lock.id) return;
              // The writer edited the locked words: the options no longer
              // describe them, so the lock goes.
              if (lockedText(view.state, value.lock) !== value.lock.text) {
                // Close this lock only: a newer one may open before the
                // microtask runs.
                const id = value.lock.id;
                queueMicrotask(() => {
                  const now = pluginState().lock;
                  if (
                    now?.id === id &&
                    lockedText(editor.state, now) !== now.text
                  )
                    controller?.close({ restoreSelection: false });
                });
                return;
              }
              // A preview reflows the span: the drum recentres on it and the
              // margin's leader line follows its last line. Neither moves
              // with the span's end, which a hovering pointer could chase.
              requestAnimationFrame(refreshAnchor);
            },
            destroy() {
              clearTimeout(flashTimer);
              document.removeEventListener("scroll", onScroll, true);
              window.removeEventListener("resize", onScroll);
              liveView = null;
              release();
            },
          };
        },
      }),
    ];
  },

  onDestroy() {
    controller = null;
    if (current) publish(null);
  },
});
