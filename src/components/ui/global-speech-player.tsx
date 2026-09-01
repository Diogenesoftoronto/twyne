import { component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { useSpeechPlayer } from "../../utils/use-speech-player";
import {
  currentSpeechSourceOffset,
  currentSpeechText,
  resumeSpeech,
  seekSpeech,
  speechState,
} from "../../utils/speech";
import {
  buildSpeechTimeline,
  type SpeechTimeline,
} from "../../utils/speech-follow-along";
import {
  alignmentRangeAtSourceOffset,
  alignmentRangeAtTime,
} from "../../utils/speech-alignment";

const SENTENCE_HIGHLIGHT = "twyne-speech-sentence";
const WORD_HIGHLIGHT = "twyne-speech-word";

interface SpeechTextSlice {
  node: Text;
  start: number;
  end: number;
}

interface SpeechTextMap {
  root: HTMLElement;
  text: string;
  slices: SpeechTextSlice[];
  timeline: SpeechTimeline;
  /** Location of the exact clip text inside the rendered target. */
  spokenStart: number;
  spokenEnd: number;
}

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

type HighlightConstructor = new (...ranges: Range[]) => unknown;

function speechHighlightApi(): {
  registry: HighlightRegistryLike;
  Highlight: HighlightConstructor;
} | null {
  const registry = (CSS as unknown as { highlights?: HighlightRegistryLike })
    .highlights;
  const Highlight = (window as unknown as { Highlight?: HighlightConstructor })
    .Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
}

function clearSpeechHighlights(): void {
  const api = speechHighlightApi();
  api?.registry.delete(WORD_HIGHLIGHT);
  api?.registry.delete(SENTENCE_HIGHLIGHT);
}

function buildSpeechTextMap(root: HTMLElement): SpeechTextMap {
  const slices: SpeechTextSlice[] = [];
  const parts: string[] = [];
  let length = 0;
  let previousBlock: Element | null = null;
  const blockTags = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DIV",
    "FIGCAPTION",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "P",
    "PRE",
    "SECTION",
  ]);
  const nearestBlock = (textNode: Text): Element => {
    let element: Element | null = textNode.parentElement;
    while (element && element !== root) {
      if (blockTags.has(element.tagName)) return element;
      element = element.parentElement;
    }
    return root;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (
        !parent ||
        parent.closest(
          'button, input, select, textarea, script, style, [aria-hidden="true"], [data-speech-ignore]',
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      if (
        !(node as Text).data.trim() &&
        parent === root &&
        root.children.length
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.textContent?.length
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const value = textNode.data;
    const block = nearestBlock(textNode);
    if (
      previousBlock &&
      block !== previousBlock &&
      !block.contains(previousBlock) &&
      !previousBlock.contains(block)
    ) {
      parts.push("\n\n");
      length += 2;
    }
    slices.push({ node: textNode, start: length, end: length + value.length });
    parts.push(value);
    length += value.length;
    previousBlock = block;
    node = walker.nextNode();
  }

  const text = parts.join("");
  let timeline = buildSpeechTimeline(text);
  let spokenStart = 0;
  let spokenEnd = text.length;
  const spokenText = currentSpeechText();
  if (root.dataset.speechSource === "plain" && spokenText) {
    const requestedStart = currentSpeechSourceOffset();
    const start =
      requestedStart !== null &&
      text.slice(requestedStart, requestedStart + spokenText.length) ===
        spokenText
        ? requestedStart
        : text.indexOf(spokenText);
    if (start >= 0) {
      spokenStart = start;
      spokenEnd = start + spokenText.length;
      const spokenTimeline = buildSpeechTimeline(spokenText);
      timeline = {
        totalWeight: spokenTimeline.totalWeight,
        words: spokenTimeline.words.map((word) => ({
          ...word,
          start: word.start + start,
          end: word.end + start,
          sentenceStart: word.sentenceStart + start,
          sentenceEnd: word.sentenceEnd + start,
        })),
      };
    }
  }
  return {
    root,
    text,
    slices,
    timeline,
    spokenStart,
    spokenEnd,
  };
}

function textRange(
  map: SpeechTextMap,
  start: number,
  end: number,
): Range | null {
  if (!map.slices.length || end <= start) return null;
  const startSlice =
    map.slices.find((slice) => start >= slice.start && start <= slice.end) ??
    map.slices[0];
  const endSlice =
    map.slices.find((slice) => end >= slice.start && end <= slice.end) ??
    map.slices[map.slices.length - 1];
  const range = document.createRange();
  range.setStart(
    startSlice.node,
    Math.max(0, Math.min(start - startSlice.start, startSlice.node.length)),
  );
  range.setEnd(
    endSlice.node,
    Math.max(0, Math.min(end - endSlice.start, endSlice.node.length)),
  );
  return range;
}

function caretOffsetFromPoint(
  map: SpeechTextMap,
  x: number,
  y: number,
): number | null {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (
      clientX: number,
      clientY: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
  };
  const position = documentWithCaret.caretPositionFromPoint?.(x, y);
  const fallback = position
    ? null
    : documentWithCaret.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? fallback?.startContainer;
  const offset = position?.offset ?? fallback?.startOffset;
  if (
    !(node instanceof Text) ||
    offset === undefined ||
    !map.root.contains(node)
  ) {
    return null;
  }
  const slice = map.slices.find((candidate) => candidate.node === node);
  return slice ? slice.start + offset : null;
}

function findSpeechTarget(id: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    `[data-speech-id="${CSS.escape(id)}"]`,
  );
  return (
    Array.from(candidates).find(
      (candidate) => candidate.getClientRects().length > 0,
    ) ?? null
  );
}

function scrollRangeIntoView(range: Range, root: HTMLElement): void {
  const rect = range.getBoundingClientRect();
  if (!rect.height) return;

  let scrollParent: HTMLElement | null = root.parentElement;
  while (scrollParent) {
    const style = window.getComputedStyle(scrollParent);
    if (
      /(auto|scroll)/u.test(style.overflowY) &&
      scrollParent.scrollHeight > scrollParent.clientHeight
    ) {
      break;
    }
    scrollParent = scrollParent.parentElement;
  }

  const bounds = scrollParent?.getBoundingClientRect();
  const top = bounds?.top ?? 0;
  const bottom = bounds?.bottom ?? window.innerHeight;
  if (rect.top >= top + 48 && rect.bottom <= bottom - 72) return;

  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  const delta = rect.top - (top + (bottom - top) * 0.42);
  if (scrollParent) scrollParent.scrollBy({ top: delta, behavior });
  else window.scrollBy({ top: delta, behavior });
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Persistent transport for every narration surface in the application. */
export const GlobalSpeechPlayer = component$(() => {
  const player = useSpeechPlayer();
  const local = useStore({ customVoice: "", customOpen: false });

  // Use native provider timing when it exists. Providers without alignment
  // get one honest clip-level highlight; elapsed duration is never converted
  // into manufactured word timing. The Highlight API preserves Markdown DOM.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      let activeMap: SpeechTextMap | null = null;
      let activeId = "";
      let activeMapDirty = false;
      let textObserver: MutationObserver | null = null;
      let lastSentence = "";
      let pointerId: number | null = null;
      let pointerType = "";
      let pointerStart = { x: 0, y: 0 };
      let resumeAfterSeek = false;
      let didSeek = false;

      const clearActive = () => {
        textObserver?.disconnect();
        textObserver = null;
        if (activeMap) {
          delete activeMap.root.dataset.speechActive;
          activeMap.root.classList.remove("is-speech-seeking");
        }
        activeMap = null;
        activeId = "";
        activeMapDirty = false;
        lastSentence = "";
        clearSpeechHighlights();
      };

      const sync = () => {
        const snapshot = speechState();
        if (
          !snapshot.id ||
          snapshot.status === "idle" ||
          snapshot.status === "error"
        ) {
          clearActive();
          return;
        }

        if (
          snapshot.id !== activeId ||
          !activeMap?.root.isConnected ||
          activeMapDirty
        ) {
          clearActive();
          const root = findSpeechTarget(snapshot.id);
          if (!root) return;
          activeMap = buildSpeechTextMap(root);
          activeId = snapshot.id;
          textObserver = new MutationObserver(() => {
            activeMapDirty = true;
          });
          textObserver.observe(root, {
            childList: true,
            characterData: true,
            subtree: true,
          });
          root.dataset.speechActive = snapshot.status;
        } else {
          activeMap.root.dataset.speechActive = snapshot.status;
        }

        if (!activeMap) {
          clearSpeechHighlights();
          return;
        }
        const api = speechHighlightApi();
        if (!api) return;
        clearSpeechHighlights();

        const native = alignmentRangeAtTime(
          snapshot.alignment,
          snapshot.currentTime,
        );
        const nativeStart = native
          ? activeMap.spokenStart + native.sourceStart
          : null;
        const nativeEnd = native
          ? activeMap.spokenStart + native.sourceEnd
          : null;
        const timelineWord =
          nativeStart === null
            ? null
            : (activeMap.timeline.words.find(
                (word) =>
                  nativeStart >= word.start && nativeStart < word.sentenceEnd,
              ) ?? null);
        const sentenceStart =
          timelineWord?.sentenceStart ?? activeMap.spokenStart;
        const sentenceEnd = timelineWord?.sentenceEnd ?? activeMap.spokenEnd;
        const sentence = textRange(activeMap, sentenceStart, sentenceEnd);
        const word =
          native?.precision === "word" &&
          nativeStart !== null &&
          nativeEnd !== null
            ? textRange(activeMap, nativeStart, nativeEnd)
            : null;
        if (sentence) {
          api.registry.set(SENTENCE_HIGHLIGHT, new api.Highlight(sentence));
        }
        if (word) api.registry.set(WORD_HIGHLIGHT, new api.Highlight(word));

        const sentenceKey = `${activeId}:${sentenceStart}`;
        if (sentence && sentenceKey !== lastSentence && pointerId === null) {
          lastSentence = sentenceKey;
          scrollRangeIntoView(sentence, activeMap.root);
        }
      };

      const seekFromPoint = (x: number, y: number) => {
        const snapshot = speechState();
        if (
          !activeMap ||
          snapshot.id !== activeId ||
          snapshot.duration <= 0 ||
          (snapshot.status !== "playing" && snapshot.status !== "paused")
        ) {
          return;
        }
        const offset = caretOffsetFromPoint(activeMap, x, y);
        if (offset === null) return;
        const native = alignmentRangeAtSourceOffset(
          snapshot.alignment,
          offset - activeMap.spokenStart,
        );
        if (!native) return;
        seekSpeech(native.audioStart);
        didSeek = true;
      };

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || pointerId !== null || !activeMap) return;
        const target = event.target instanceof Element ? event.target : null;
        const root = target?.closest<HTMLElement>("[data-speech-id]");
        if (
          root !== activeMap.root ||
          target?.closest("a, button, input, select, textarea")
        ) {
          return;
        }
        const snapshot = speechState();
        if (
          snapshot.id !== activeId ||
          snapshot.duration <= 0 ||
          snapshot.alignment.length === 0 ||
          (snapshot.status !== "playing" && snapshot.status !== "paused")
        ) {
          return;
        }

        pointerId = event.pointerId;
        pointerType = event.pointerType;
        pointerStart = { x: event.clientX, y: event.clientY };
        resumeAfterSeek = snapshot.status === "paused";
        didSeek = false;
        activeMap.root.classList.add("is-speech-seeking");
        if (pointerType !== "touch") {
          event.preventDefault();
          activeMap.root.setPointerCapture?.(event.pointerId);
          seekFromPoint(event.clientX, event.clientY);
        }
      };

      const onPointerMove = (event: PointerEvent) => {
        if (event.pointerId !== pointerId || pointerType === "touch") return;
        event.preventDefault();
        seekFromPoint(event.clientX, event.clientY);
      };

      const finishPointer = (event: PointerEvent, cancelled = false) => {
        if (event.pointerId !== pointerId) return;
        if (
          !cancelled &&
          pointerType === "touch" &&
          Math.hypot(
            event.clientX - pointerStart.x,
            event.clientY - pointerStart.y,
          ) < 8
        ) {
          seekFromPoint(event.clientX, event.clientY);
        }
        activeMap?.root.classList.remove("is-speech-seeking");
        if (resumeAfterSeek && didSeek) resumeSpeech();
        pointerId = null;
        pointerType = "";
        resumeAfterSeek = false;
        didSeek = false;
        sync();
      };
      const onPointerCancel = (event: PointerEvent) =>
        finishPointer(event, true);

      window.addEventListener("twyne:speech", sync);
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", finishPointer);
      document.addEventListener("pointercancel", onPointerCancel);
      sync();

      cleanup(() => {
        clearActive();
        window.removeEventListener("twyne:speech", sync);
        document.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", finishPointer);
        document.removeEventListener("pointercancel", onPointerCancel);
      });
    },
    { strategy: "document-ready" },
  );

  if (player.state.status === "idle") return null;

  const busy = player.state.status === "loading";
  const paused = player.state.status === "paused";
  const playing = player.state.status === "playing";
  const canGoBack = player.state.queueIndex > 0 || player.state.currentTime > 0;
  const canGoNext = player.state.queueIndex < player.state.queueLength - 1;
  const progressMax = Math.max(player.state.duration, 0);

  return (
    <aside
      class="fixed bottom-3 left-1/2 w-[min(44rem,calc(100vw-1rem))] -translate-x-1/2 border border-[var(--color-paper-3)] bg-[var(--color-paper)]"
      style={{
        zIndex: "var(--z-overlay)",
        borderRadius: "4px",
        boxShadow:
          "0 4px 8px color-mix(in srgb, var(--shade) 24%, transparent)",
      }}
      aria-label="Global narration player"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-2 px-2.5 py-2 sm:gap-3 sm:px-3">
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-baseline gap-2">
            <p
              class="truncate text-xs font-semibold text-[var(--color-ink)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {player.state.label || "Read aloud"}
            </p>
            {player.state.queueLength > 1 && (
              <span
                class="shrink-0 text-[0.6rem] text-[var(--color-ink-muted)]"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                {player.state.queueIndex + 1} of {player.state.queueLength}
              </span>
            )}
          </div>
          <p
            class="truncate text-[0.6rem] text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            {player.state.status === "error"
              ? player.state.error?.message || "Narration failed"
              : busy
                ? "Preparing voice…"
                : `${player.voiceMenu.provider || player.state.provider || "Voice"} · ${player.voiceMenu.model || player.state.model || "narration"}`}
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="tool-btn"
            aria-label="Previous passage"
            title="Previous passage"
            disabled={!canGoBack || busy}
            onClick$={player.previous$}
          >
            ↶
          </button>
          <button
            type="button"
            class="btn-press flex h-8 w-8 items-center justify-center p-0 disabled:opacity-50"
            aria-label={
              player.state.status === "error"
                ? "Retry narration"
                : playing
                  ? "Pause narration"
                  : "Resume narration"
            }
            title={
              player.state.status === "error"
                ? "Retry narration"
                : playing
                  ? "Pause narration"
                  : "Resume narration"
            }
            disabled={busy}
            onClick$={
              player.state.status === "error" ? player.retry$ : player.toggle$
            }
          >
            {busy ? "…" : playing ? "Ⅱ" : paused ? "▶" : "!"}
          </button>
          <button
            type="button"
            class="tool-btn"
            aria-label="Next passage"
            title="Next passage"
            disabled={!canGoNext || busy}
            onClick$={player.next$}
          >
            ↷
          </button>
        </div>

        <div
          class="order-last flex w-full min-w-32 items-center gap-2 sm:order-none sm:w-auto sm:flex-[1.25]"
          title={
            player.state.alignment.length
              ? "Drag the timeline, or choose an aligned word in the text, to seek"
              : "Drag the timeline to seek"
          }
        >
          <span
            class="w-8 text-right text-[0.58rem] tabular-nums text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            {formatClock(player.state.currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={progressMax || 1}
            step={0.1}
            value={Math.min(player.state.currentTime, progressMax || 1)}
            disabled={!progressMax || busy}
            onInput$={(_, el) => player.seek$(Number(el.value))}
            class="min-w-0 flex-1 accent-[var(--color-vermilion)]"
            aria-label="Narration position. Drag to seek."
          />
          <span
            class="w-8 text-[0.58rem] tabular-nums text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            {formatClock(player.state.duration)}
          </span>
        </div>

        {player.voiceMenu.options.length > 0 && (
          <div class="relative order-last w-full shrink-0 md:order-none md:w-auto">
            <label for="global-speech-voice" class="sr-only">
              Narration voice
            </label>
            <select
              id="global-speech-voice"
              class="w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2 py-1 text-[0.65rem] text-[var(--color-ink)] focus:border-[var(--color-vermilion)] focus:outline-none md:max-w-32"
              style={{
                fontFamily: "var(--font-typewriter)",
                borderRadius: "2px",
              }}
              value={
                local.customOpen ? "__custom__" : player.voiceMenu.selected
              }
              disabled={busy}
              onChange$={async (_, el) => {
                if (el.value === "__custom__") {
                  local.customOpen = true;
                  local.customVoice = "";
                  return;
                }
                local.customOpen = false;
                await player.changeVoice$(el.value);
              }}
              aria-label="Change narration voice and restart passage"
              title="Change voice and restart this passage"
            >
              {player.voiceMenu.options.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
              {player.voiceMenu.allowsCustom && (
                <option value="__custom__">Custom voice…</option>
              )}
            </select>
            {local.customOpen && (
              <div
                class="absolute bottom-full right-0 mb-2 flex w-64 gap-1 border border-[var(--color-paper-3)] bg-[var(--color-paper)] p-2"
                style={{ borderRadius: "3px" }}
              >
                <input
                  value={local.customVoice}
                  onInput$={(_, el) => {
                    local.customVoice = el.value;
                  }}
                  placeholder="Provider voice id"
                  class="min-w-0 flex-1 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2 py-1 text-xs focus:border-[var(--color-vermilion)] focus:outline-none"
                  aria-label="Custom provider voice id"
                />
                <button
                  type="button"
                  class="btn-press px-2 py-1 text-[0.65rem] disabled:opacity-40"
                  disabled={!local.customVoice.trim()}
                  onClick$={async () => {
                    await player.changeVoice$(local.customVoice);
                    local.customOpen = false;
                  }}
                >
                  Use
                </button>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          class="tool-btn shrink-0"
          aria-label="Stop narration and close player"
          title="Stop narration"
          onClick$={player.stop$}
        >
          ×
        </button>
      </div>
    </aside>
  );
});
