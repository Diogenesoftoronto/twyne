/**
 * Connected passages, gathered.
 *
 * A comparison sheet over the desk: every passage a note or thread
 * connects, quoted from the manuscript with its paragraph around it, in
 * reading order. Beside them, the whole manuscript in miniature, so the
 * lines run from where each passage sits to the passage itself. A margin
 * connection can also offer a writer-initiated move, copy or model review.
 */
import {
  $,
  component$,
  noSerialize,
  useSignal,
  useStore,
  useStyles$,
  useVisibleTask$,
  type NoSerialize,
} from "@qwik.dev/core";
import {
  connectionPlaces,
  excerptFromRange,
  orderPassages,
  PASSAGE_GATHER_EVENT,
  PROVENANCE_LABEL,
  revealPassage,
  sameRange,
  type ConnectionProvenance,
  type GatherRequest,
  type FolioExcerpt,
  type PassageMerge,
} from "../../utils/passage-gather";
import {
  mergeWhy,
  type MergeEvidence,
  type TextSpan,
} from "../../utils/passage-merge";
import { openInstrumentDock } from "../../utils/instrument-dock";
import { paragraphs } from "../../utils/flow-connections";
import { htmlToPlainText } from "../../utils/html-to-plain-text";
import type { TwyneEditorProps } from "../editor/editor-state";
import { renderMarkdownExcerpt } from "../../utils/markdown";
import styles from "./passage-gather.css?inline";

interface Shown {
  id: string;
  label: string;
  color: string;
  notes: string[];
  before: string;
  match: string;
  after: string;
  at: number;
  /** Sentences of `match` the other paragraph also says, once read. */
  repeats: TextSpan[];
}
/** A fold on offer: which gathered passage is which, and their names. */
interface Fold {
  advice: PassageMerge["advice"];
  passages: PassageMerge["passages"];
  names: PassageMerge["names"];
}
/** A connection's recorded reason, placed against the numbered passages. */
interface Reason {
  id: string;
  relation: string;
  explanation: string;
  provenance: ConnectionProvenance;
  between: string;
  stale: boolean;
}
interface GatherState {
  open: boolean;
  closing: boolean;
  title: string;
  note: string;
  notice: string;
  editing: boolean;
  complete: boolean;
  otherFolios: FolioExcerpt[];
  moveLabel: string;
  fold: Fold | null;
  /** Why the fold is advised, with what the evidence found. */
  why: string;
  /** What marks the highlighted sentences: a reading, or shared words. */
  evidence: MergeEvidence["source"] | "reading-now" | null;
  naming: boolean;
  transitions: boolean;
  name: string;
  busy: boolean;
  reasons: Reason[];
  passages: Shown[];
  /** The manuscript's blocks in miniature: top and height as fractions. */
  blocks: { top: number; height: number; width: number }[];
  view: { top: number; height: number };
  lines: { d: string; color: string }[];
}

const clip = (text: string, n: number) =>
  text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;

// Mutated in place: Qwik's handler segments cannot reassign module bindings.
/** A paragraph is in hand: Escape puts it back instead of closing the sheet. */
const carrying = { active: false };

/** A passage cut where its repeated sentences begin and end. */
function segments(
  text: string,
  repeats: readonly TextSpan[],
): { text: string; repeat: boolean }[] {
  const parts: { text: string; repeat: boolean }[] = [];
  let at = 0;
  for (const span of [...repeats].sort((a, b) => a.from - b.from)) {
    if (span.from < at || span.to > text.length) continue;
    if (span.from > at)
      parts.push({ text: text.slice(at, span.from), repeat: false });
    parts.push({ text: text.slice(span.from, span.to), repeat: true });
    at = span.to;
  }
  if (at < text.length) parts.push({ text: text.slice(at), repeat: false });
  return parts;
}

const TRANSITION_REQUEST =
  "Imagine placing these passages together in the order shown. Offer up to three one-sentence transitions in the writer’s voice. Try a callback to a specific detail, a contrast, or a step from example to claim where the text supports it. If the break already works, say why. Use only details from the passages.";

interface PassageGatherProps {
  folioId?: string | null;
  folioName?: string;
  readOnly?: boolean;
  onCopyPassages$?: TwyneEditorProps["onCopyPassages$"];
}

export const PassageGather = component$<PassageGatherProps>((props) => {
  useStyles$(styles);
  const sheet = useSignal<HTMLElement>();
  const live = useSignal<
    NoSerialize<{
      move?: () => boolean;
      merge?: PassageMerge;
      evidence?: MergeEvidence | null;
      ranges: Map<string, Range>;
      resolvers: Map<string, () => Range | null>;
      goes: Map<string, () => void>;
      opener: HTMLElement | null;
      openerKey: string | null;
    }>
  >();
  const state = useStore<GatherState>({
    open: false,
    closing: false,
    title: "",
    editing: false,
    complete: false,
    otherFolios: [],
    moveLabel: "",
    fold: null,
    why: "",
    evidence: null,
    naming: false,
    transitions: false,
    name: "",
    busy: false,
    note: "",
    notice: "",
    reasons: [],
    passages: [],
    blocks: [],
    view: { top: 0, height: 0 },
    lines: [],
  });

  const restoreFocus = useSignal(false);

  // Run after Qwik commits the closing render, when the margin controls
  // have been restored and any replaced opener has its final DOM node.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const open = track(() => state.open);
    if (open || !restoreFocus.value) return;
    restoreFocus.value = false;
    const opener = live.value?.opener;
    const openerKey = live.value?.openerKey;
    const current = openerKey
      ? document.querySelector<HTMLElement>(
          `[data-gather-opener="${CSS.escape(openerKey)}"]`,
        )
      : null;
    const target =
      current ??
      (opener?.isConnected ? opener : null) ??
      document.querySelector<HTMLElement>(".flow-dock__chip, .ProseMirror");
    target?.focus({ preventScroll: true });
  });

  const close = $((then?: () => void) => {
    if (!state.open || state.closing || state.busy) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    state.closing = true;
    restoreFocus.value = !then;
    setTimeout(
      () => {
        state.open = false;
        state.closing = false;
        state.lines = [];
        delete document.documentElement.dataset.gathering;
        if (then) then();
      },
      still ? 0 : 180,
    );
  });

  const go = $((id: string) => {
    const custom = live.value?.goes.get(id);
    const resolve = live.value?.resolvers.get(id);
    let range = resolve ? resolve() : live.value?.ranges.get(id);
    const shown = state.passages.find((passage) => passage.id === id);
    const matches = () =>
      !!range &&
      !!shown &&
      document.contains(range.commonAncestorContainer) &&
      range.toString() === shown.match;
    if (!matches()) {
      state.notice =
        "This passage changed. Close and reopen this view to follow it.";
      return;
    }
    void close(() => {
      // A remote edit or decoration render can arrive during closing too.
      if (resolve) range = resolve();
      if (!matches()) return;
      if (custom) custom();
      else revealPassage(range!);
    });
  });

  /** Fold one paragraph into the other and leave the writer on the result. */
  const fold = $((keep: "here" | "other") => {
    const session = live.value;
    if (!session?.merge || state.busy || state.closing) return;
    if (
      !session.merge.apply(keep === "here" ? 0 : 1, session.evidence ?? null)
    ) {
      state.notice =
        "The draft has changed. Reopen the comparison to merge these paragraphs.";
      state.fold = null;
      return;
    }
    void close(() =>
      document
        .querySelector<HTMLElement>(".ProseMirror")
        ?.focus({ preventScroll: true }),
    );
  });

  /**
   * Pick one of the two paragraphs up by its heading and let it go on the
   * other: the one it lands on stays, and takes in what only this one says.
   */
  const carry = $((id: string, event: PointerEvent, handle: HTMLElement) => {
    const offer = state.fold;
    if (!offer || !live.value?.merge || event.button > 0 || state.busy) return;
    const onto =
      id === offer.passages.here
        ? "other"
        : id === offer.passages.other
          ? "here"
          : null;
    const source = handle.closest<HTMLElement>("[data-gather-passage]");
    const target =
      onto &&
      handle
        .closest("[role=dialog]")
        ?.querySelector<HTMLElement>(
          `[data-gather-passage="${CSS.escape(offer.passages[onto])}"]`,
        );
    if (!onto || !source || !target) return;
    const start = { x: event.clientX, y: event.clientY };
    let ghost: HTMLElement | null = null;
    let over = false;
    const move = (e: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
        ghost = handle.cloneNode(true) as HTMLElement;
        ghost.className = "passage-gather__ghost";
        document.body.append(ghost);
        source.classList.add("is-carried");
        carrying.active = true;
      }
      e.preventDefault();
      ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
      over =
        document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest("[data-gather-passage]") === target;
      target.classList.toggle("is-drop-target", over);
    };
    const end = (e: Event) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("keydown", cancel, true);
      const carried = !!ghost;
      ghost?.remove();
      ghost = null;
      carrying.active = false;
      source.classList.remove("is-carried");
      target.classList.remove("is-drop-target");
      if (carried && over && e.type === "pointerup") void fold(onto);
    };
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape puts the paragraph back; it does not also close the sheet.
      e.preventDefault();
      e.stopImmediatePropagation();
      end(e);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("keydown", cancel, true);
  });

  const workOnPassages = $(async (action: "copy" | "transitions") => {
    if (
      props.readOnly ||
      !props.folioId ||
      state.busy ||
      state.closing ||
      !state.complete
    )
      return;
    const session = live.value;
    if (!session) return;
    state.busy = true;
    state.notice = "";
    try {
      // Check an archived excerpt against its folio, using the same text
      // conversion as the archive. Check the live editor after those reads.
      for (const excerpt of state.otherFolios) {
        const { loadFolioContentFromIdb } = await import("../../utils/idb");
        const html = await loadFolioContentFromIdb(excerpt.folioId);
        if (!paragraphs(htmlToPlainText(html), 1).includes(excerpt.text)) {
          state.complete = false;
          state.notice = `The passage in ${excerpt.name} has changed.`;
          return;
        }
      }
      if (live.value !== session || !sheet.value?.isConnected) return;
      let previous: Range | undefined;
      const fresh = state.passages.every((p) => {
        const resolve = session.resolvers.get(p.id);
        const range = resolve ? resolve() : session.ranges.get(p.id);
        if (
          !range ||
          !document.contains(range.commonAncestorContainer) ||
          range.toString() !== p.match ||
          (previous &&
            previous.compareBoundaryPoints(Range.START_TO_START, range) > 0)
        )
          return false;
        previous = range;
        return true;
      });
      if (!fresh) {
        state.complete = false;
        state.notice = "A passage has changed. Reopen the comparison.";
        return;
      }
      const texts = [
        ...state.passages.map((p) => p.match),
        ...state.otherFolios.map((f) => f.text),
      ];
      if (action === "copy") {
        if (!state.name.trim() || !props.onCopyPassages$) return;
        const opened = await props.onCopyPassages$(
          props.folioId,
          state.name.trim(),
          texts,
        );
        if (!opened) {
          state.complete = false;
          state.notice = `Saved “${state.name.trim()}”. You can open it from the folio drawer.`;
        }
      } else {
        const text = texts.map((p, i) => `Passage ${i + 1}\n${p}`).join("\n\n");
        state.busy = false;
        void close(() =>
          openInstrumentDock("tasks", text, undefined, TRANSITION_REQUEST),
        );
      }
    } catch {
      state.notice =
        action === "copy"
          ? "The folio could not be created. Try again."
          : "The passages could not be opened in Task desk. Try again.";
    } finally {
      state.busy = false;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    let pending: (GatherRequest & { from: Map<string, DOMRect> }) | null = null;
    const onGather = (event: Event) => {
      const request = (event as CustomEvent<GatherRequest>).detail;
      const doc = document.querySelector<HTMLElement>(
        "#twyne-editor-mount .ProseMirror, .ProseMirror",
      );
      if (!request?.passages.length || !doc || state.open) return;
      const ordered = orderPassages(
        request.passages.filter((p) =>
          doc.contains(p.range.commonAncestorContainer),
        ),
      );
      if (!ordered.length) return;
      const ranges = new Map(ordered.map((p) => [p.id, p.range]));
      // Where each passage stands now, before anything on the page moves.
      const from = new Map(
        ordered.map((p) => [p.id, p.range.getBoundingClientRect()]),
      );
      const opener =
        request.opener ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      live.value = noSerialize({
        ranges,
        move: request.editing?.move?.apply,
        merge: request.editing?.merge ?? undefined,
        resolvers: new Map(
          ordered.flatMap((p) =>
            p.resolveRange ? [[p.id, p.resolveRange] as const] : [],
          ),
        ),
        goes: new Map(
          ordered.flatMap((p) => (p.go ? [[p.id, p.go] as const] : [])),
        ),
        opener,
        openerKey: opener?.dataset.gatherOpener ?? null,
      });
      state.editing = !!request.editing && !props.readOnly;
      state.otherFolios = request.editing?.otherFolios ?? [];
      state.complete =
        !!request.editing?.complete &&
        ordered.length + state.otherFolios.length >= 2;
      state.moveLabel = request.editing?.move?.label ?? "";
      state.naming = false;
      state.transitions = false;
      state.name = props.folioName
        ? `Passages from ${props.folioName}`
        : "Collected passages";
      state.busy = false;
      state.title = request.title;
      state.note = clip(request.note ?? "", 320);
      state.notice =
        request.editing && !request.editing.complete
          ? "A passage has changed since this connection was found."
          : "";
      state.passages = ordered.map((p) => ({
        id: p.id,
        label: p.label,
        color: p.color,
        notes: p.notes ?? [],
        repeats: [],
        ...excerptFromRange(p.range, doc),
      }));
      const merge =
        state.editing && state.complete ? request.editing?.merge : null;
      const offered: Fold | null = merge
        ? {
            advice: merge.advice,
            passages: merge.passages,
            names: merge.names,
          }
        : null;
      // A pair nothing has read for meaning is offered only once the
      // evidence finds a sentence one paragraph repeats from the other.
      state.fold = merge && !merge.needsRepeat ? offered : null;
      state.why = merge
        ? mergeWhy(merge.advice, merge.names, merge.texts, null)
        : "";
      state.evidence = state.fold ? "reading-now" : null;
      if (merge) {
        const session = live.value;
        void merge.evidence().then((evidence) => {
          if (live.value !== session || !session || !state.open) return;
          session.evidence = evidence;
          const repeats =
            !!evidence && evidence.here.length + evidence.other.length > 0;
          if (merge.needsRepeat && !repeats) return;
          state.fold = offered;
          state.evidence = evidence?.source ?? null;
          if (!evidence) return;
          state.why = mergeWhy(
            merge.advice,
            merge.names,
            merge.texts,
            evidence,
          );
          state.passages = state.passages.map((p) => {
            const spans =
              p.id === merge.passages.here
                ? evidence.here
                : p.id === merge.passages.other
                  ? evidence.other
                  : [];
            // Evidence is measured on the paragraph's trimmed text.
            const lead = p.match.length - p.match.trimStart().length;
            return {
              ...p,
              repeats: spans.map((span) => ({
                from: span.from + lead,
                to: span.to + lead,
              })),
            };
          });
        });
      }
      // A passage's number is its place once twins are merged, so find it
      // by its span, not by the id it was gathered under.
      const numberOf = (id: string) => {
        const range = request.passages.find((p) => p.id === id)?.range;
        return range
          ? ordered.findIndex((p) => sameRange(p.range, range)) + 1
          : 0;
      };
      state.reasons = (request.connections ?? []).flatMap((c) => {
        const places = connectionPlaces(
          c,
          c.passageIds.map(numberOf).filter((n) => n > 0),
        );
        return places
          ? [
              {
                id: c.id,
                relation: c.relation,
                explanation: c.explanation,
                provenance: c.provenance,
                ...places,
              },
            ]
          : [];
      });
      // The manuscript in miniature: one bar per block, as long as its text.
      const docRect = doc.getBoundingClientRect();
      const height = Math.max(1, docRect.height);
      state.blocks = Array.from(doc.children)
        .slice(0, 400)
        .map((block) => {
          const r = block.getBoundingClientRect();
          return {
            top: (r.top - docRect.top) / height,
            height: Math.max(r.height / height, 0.002),
            width: Math.min(1, 0.25 + (block.textContent?.length ?? 0) / 600),
          };
        })
        .filter((b) => b.top >= 0 && b.top <= 1);
      const scroller = doc.closest<HTMLElement>(".page-canvas")?.parentElement;
      const sRect = scroller?.getBoundingClientRect() ?? {
        top: 0,
        height: window.innerHeight,
      };
      state.view = {
        top: Math.max(0, (sRect.top - docRect.top) / height),
        height: Math.min(1, sRect.height / height),
      };
      state.closing = false;
      state.open = true;
      // Panels outside this stacking context step back while it is open.
      document.documentElement.dataset.gathering = "";
      pending = { ...request, passages: ordered, from };
      schedule();
    };
    window.addEventListener(PASSAGE_GATHER_EVENT, onGather);
    cleanup(() => window.removeEventListener(PASSAGE_GATHER_EVENT, onGather));

    // After the sheet renders: draw its lines, move focus in, and let each
    // passage travel from its place in the page.
    const settle = () => {
      const el = document.querySelector<HTMLElement>(
        "[data-passage-gather] [role=dialog]",
      );
      if (!el || !state.open) return;
      const body = el.querySelector<HTMLElement>(".passage-gather__body");
      if (!body) return;
      if (observedBody !== body) {
        bodySize.disconnect();
        bodySize.observe(body);
        observedBody = body;
      }
      const box = body.getBoundingClientRect();
      state.lines = state.passages.flatMap((p) => {
        const tick = el.querySelector(
          `[data-gather-tick="${CSS.escape(p.id)}"]`,
        );
        const item = el.querySelector(
          `[data-gather-passage="${CSS.escape(p.id)}"]`,
        );
        if (!tick || !item) return [];
        const a = tick.getBoundingClientRect();
        const b = item.getBoundingClientRect();
        const x1 = a.right - box.left,
          y1 = a.top + a.height / 2 - box.top;
        // A passage scrolled out of the list keeps its line, to the edge.
        const list = item.parentElement!.getBoundingClientRect();
        const x2 = b.left - box.left,
          y2 =
            Math.min(
              Math.max(Math.min(b.top + 22, b.bottom - 8), list.top + 4),
              list.bottom - 4,
            ) - box.top;
        const bend = Math.max(12, (x2 - x1) / 2);
        return [
          {
            d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
            color: p.color,
          },
        ];
      });
      if (!pending) return;
      const request = pending;
      pending = null;
      el.querySelector<HTMLElement>(".passage-gather__close")?.focus({
        preventScroll: true,
      });
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (still || request.animate === false) return;
      for (const p of request.passages) {
        const item = el.querySelector<HTMLElement>(
          `[data-gather-passage="${CSS.escape(p.id)}"]`,
        );
        if (!item) continue;
        const to = item.getBoundingClientRect();
        const from = request.from.get(p.id);
        if (!from?.height) continue;
        const y = Math.min(
          Math.max(from.top, -40),
          window.innerHeight + 40 - to.height,
        );
        item.animate(
          [
            {
              transform: `translate(${from.left - to.left}px, ${y - to.top}px) scale(0.97)`,
              opacity: 0.35,
            },
            { transform: "none", opacity: 1 },
          ],
          { duration: 460, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
        );
      }
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => requestAnimationFrame(settle));
    };
    window.addEventListener("resize", schedule);
    let observedBody: HTMLElement | null = null;
    const bodySize = new ResizeObserver(schedule);
    // The map and excerpt list share a row which changes height when details
    // or editing controls open. The observer is attached in settle().

    // The list scrolls inside the sheet; its lines follow.
    const onScroll = (event: Event) => {
      if (
        (event.target as Element)?.classList?.contains("passage-gather__list")
      )
        schedule();
    };
    document.addEventListener("scroll", onScroll, true);

    // Escape belongs to the sheet while it is open, before the editor's
    // focus or instrument handlers see it. Tab stays inside the sheet.
    const onKey = (event: KeyboardEvent) => {
      if (!state.open || carrying.active) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void close();
        return;
      }
      // Read the live sheet: a ref can still name the previous opening's node.
      const dialog = document.querySelector<HTMLElement>(
        "[data-passage-gather] [role=dialog]",
      );
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), summary, input:not([disabled])",
        ),
      ).filter((element) => element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    cleanup(() => {
      delete document.documentElement.dataset.gathering;
      cancelAnimationFrame(frame);
      bodySize.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey, true);
    });
  });

  if (!state.open) return null;
  const count = state.passages.length + state.otherFolios.length;
  return (
    <div
      class={["passage-gather", { "is-closing": state.closing }]}
      data-passage-gather
    >
      <div
        class="passage-gather__scrim"
        aria-hidden="true"
        onClick$={() => close()}
      />
      <section
        ref={sheet}
        class="passage-gather__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="passage-gather-title"
      >
        <header class="passage-gather__head">
          <div>
            <p class="passage-gather__kicker">
              {count} {state.editing ? "passage" : "connected passage"}
              {count === 1 ? "" : "s"}
              {!state.editing && " · read only"}
            </p>
            <h2 id="passage-gather-title" class="passage-gather__title">
              {state.title}
            </h2>
            {state.note && <p class="passage-gather__note">{state.note}</p>}
            {state.reasons.length > 0 && (
              <details class="passage-gather__details" open={!state.editing}>
                <summary>Connection details</summary>
                <section
                  class="passage-gather__why"
                  aria-label="Why these passages are linked"
                >
                  <ul class="passage-gather__reasons">
                    {state.reasons.map((r) => (
                      <li
                        key={r.id}
                        class="passage-gather__reason"
                        data-provenance={r.provenance}
                      >
                        <p class="passage-gather__reason-head">
                          <strong>{r.relation}</strong>{" "}
                          <span class="passage-gather__source">
                            {PROVENANCE_LABEL[r.provenance]}
                          </span>{" "}
                          <span class="passage-gather__between">
                            {r.between}
                          </span>
                        </p>
                        <p class="passage-gather__reason-text">
                          {r.explanation}
                        </p>
                        {r.stale && (
                          <p class="passage-gather__reason-stale">
                            The other passage has changed since this connection
                            was found.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              </details>
            )}
            {state.fold && (state.why || state.evidence) && (
              <p class="passage-gather__advice" aria-live="polite">
                {state.why}{" "}
                <span class="passage-gather__legend">
                  {state.evidence === "reading-now"
                    ? "Reading both paragraphs…"
                    : state.passages.some((p) => p.repeats.length)
                      ? state.evidence === "reading"
                        ? "Highlighted sentences make the same point in both."
                        : "Highlighted sentences share most of their words."
                      : state.evidence
                        ? "No sentence here repeats the other."
                        : ""}{" "}
                  Drag {state.fold.names.here} or {state.fold.names.other} onto
                  the other to merge them.
                </span>
              </p>
            )}
            {state.notice && (
              <p class="passage-gather__notice" role="status">
                {state.notice}
              </p>
            )}
          </div>
          <button
            type="button"
            class="btn-paper in-flow-mini passage-gather__close"
            onClick$={() => close()}
            aria-keyshortcuts="Escape"
          >
            Close <kbd>Esc</kbd>
          </button>
        </header>
        <div class="passage-gather__body">
          <nav
            class="passage-gather__map"
            aria-label="Where these passages sit in the manuscript"
          >
            <div class="passage-gather__page" aria-hidden="true">
              {state.blocks.map((b, i) => (
                <i
                  key={i}
                  style={{
                    top: `${b.top * 100}%`,
                    height: `${b.height * 100}%`,
                    width: `${b.width * 100}%`,
                  }}
                />
              ))}
              <span
                class="passage-gather__view"
                style={{
                  top: `${state.view.top * 100}%`,
                  height: `${state.view.height * 100}%`,
                }}
              />
            </div>
            {state.passages.map((p, i) => (
              <button
                type="button"
                key={p.id}
                data-gather-tick={p.id}
                class="passage-gather__tick"
                style={{ top: `${p.at * 100}%`, "--gather-color": p.color }}
                aria-label={`Go to passage ${i + 1}: ${clip(p.match, 80)}`}
                onClick$={() => go(p.id)}
              >
                {i + 1}
              </button>
            ))}
          </nav>
          <svg class="passage-gather__lines" aria-hidden="true">
            {state.lines.map((line, i) => (
              <path key={i} d={line.d} style={{ stroke: line.color }} />
            ))}
          </svg>
          <ol class="passage-gather__list">
            {state.passages.length > 0 &&
              state.passages.map((p, i) => (
                <li
                  key={p.id}
                  data-gather-passage={p.id}
                  class="passage-gather__passage"
                  style={{ "--gather-color": p.color }}
                >
                  <p
                    class="passage-gather__label"
                    data-carry={
                      state.fold &&
                      (p.id === state.fold.passages.here ||
                        p.id === state.fold.passages.other)
                        ? ""
                        : undefined
                    }
                    title={
                      state.fold
                        ? "Drag onto the other paragraph to merge into it"
                        : undefined
                    }
                    onPointerDown$={(event, el) => carry(p.id, event, el)}
                  >
                    <span class="passage-gather__num">{i + 1}</span>
                    {p.label}
                    {!state.editing && (
                      <span class="passage-gather__where">
                        {Math.round(p.at * 100)}% through
                      </span>
                    )}
                  </p>
                  <blockquote
                    class={[
                      "passage-gather__text",
                      { "is-whole": !p.before && !p.after },
                    ]}
                  >
                    {p.before}
                    <mark>
                      {segments(p.match, p.repeats).map((part, n) =>
                        part.repeat ? (
                          <span key={n} class="passage-gather__repeat">
                            {part.text}
                          </span>
                        ) : (
                          part.text
                        ),
                      )}
                    </mark>
                    {p.after}
                  </blockquote>
                  {p.notes.length > 0 && (
                    <ul class="passage-gather__notes">
                      {p.notes.map((note, n) => (
                        <li
                          key={n}
                          class="comment-markdown"
                          dangerouslySetInnerHTML={renderMarkdownExcerpt(
                            note,
                            240,
                          )}
                        />
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    class="passage-gather__go"
                    onClick$={() => go(p.id)}
                  >
                    Go to passage
                  </button>
                </li>
              ))}
            {state.otherFolios.map((f, i) => (
              <li
                key={`${f.folioId}:${i}`}
                class="passage-gather__passage"
                style={{ "--gather-color": "var(--color-ink-light)" }}
              >
                <p class="passage-gather__label">
                  <span class="passage-gather__num">
                    {state.passages.length + i + 1}
                  </span>
                  {f.name} · Saved excerpt
                </p>
                <blockquote class="passage-gather__text">{f.text}</blockquote>
              </li>
            ))}
          </ol>
        </div>
        {state.editing && state.complete && (
          <footer class="passage-gather__actions">
            {state.naming ? (
              <form
                class="passage-gather__name"
                preventdefault:submit
                onSubmit$={() => workOnPassages("copy")}
              >
                <label>
                  New folio name
                  <input
                    autoFocus
                    required
                    maxLength={160}
                    value={state.name}
                    disabled={state.busy}
                    onInput$={(_, el) => {
                      state.name = el.value;
                    }}
                  />
                </label>
                <button
                  class="btn-paper in-flow-mini"
                  type="submit"
                  title={`Copy the wording of ${count} passages`}
                  disabled={!state.name.trim() || state.busy}
                >
                  {state.busy ? "Copying…" : "Create and open folio"}
                </button>
                <button
                  class="flow-link"
                  type="button"
                  disabled={state.busy}
                  onClick$={() => {
                    state.naming = false;
                    requestAnimationFrame(() =>
                      sheet.value
                        ?.querySelector<HTMLElement>("[data-copy-passages]")
                        ?.focus(),
                    );
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                {state.fold &&
                  (state.fold.advice === "fold-there"
                    ? (["other", "here"] as const)
                    : (["here", "other"] as const)
                  ).map((keep) => (
                    <button
                      key={keep}
                      type="button"
                      class="btn-paper in-flow-mini"
                      data-merge={keep}
                      data-advised={
                        state.fold?.advice ===
                        (keep === "here" ? "fold-here" : "fold-there")
                          ? ""
                          : undefined
                      }
                      disabled={state.busy}
                      title={`Keep ${state.fold!.names[keep]} and fold the other into it`}
                      onClick$={() => fold(keep)}
                    >
                      Merge into {state.fold!.names[keep]}
                    </button>
                  ))}
                {state.moveLabel && (
                  <button
                    type="button"
                    class="btn-paper in-flow-mini"
                    onClick$={() => {
                      if (!live.value?.move?.()) {
                        state.notice =
                          "The draft has changed. Reopen the comparison to move these paragraphs.";
                        state.moveLabel = "";
                        return;
                      }
                      void close(() =>
                        document
                          .querySelector<HTMLElement>(".ProseMirror")
                          ?.focus({ preventScroll: true }),
                      );
                    }}
                  >
                    {state.moveLabel}
                  </button>
                )}
                {props.onCopyPassages$ && (
                  <button
                    type="button"
                    class="btn-paper in-flow-mini"
                    data-copy-passages
                    disabled={state.busy}
                    onClick$={() => {
                      state.naming = true;
                      requestAnimationFrame(() =>
                        sheet.value?.querySelector("input")?.select(),
                      );
                    }}
                  >
                    Copy to new folio…
                  </button>
                )}
                <button
                  type="button"
                  class="flow-link"
                  aria-expanded={state.transitions}
                  onClick$={() => {
                    state.transitions = !state.transitions;
                  }}
                >
                  Transition ideas
                </button>
                {state.transitions && (
                  <div class="passage-gather__transitions">
                    <ul>
                      <li>
                        <strong>Callback.</strong> Pick up a word or image from
                        the earlier passage.
                      </li>
                      <li>
                        <strong>Contrast.</strong> Open with the detail that has
                        changed.
                      </li>
                      <li>
                        <strong>Development.</strong> Follow the example with
                        the point it supports.
                      </li>
                    </ul>
                    <button
                      type="button"
                      class="flow-link"
                      disabled={state.busy}
                      onClick$={() => workOnPassages("transitions")}
                    >
                      Draft options in Task desk…
                    </button>
                  </div>
                )}
              </>
            )}
          </footer>
        )}
      </section>
    </div>
  );
});
