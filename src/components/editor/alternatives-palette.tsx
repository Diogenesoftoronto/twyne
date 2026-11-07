/**
 * Alternatives: what the writer sees while a span is locked.
 *
 *   word      the Drum. The option being looked at stands in the sentence,
 *             with the previous and next faded above and below the word, so
 *             the eye never leaves the line.
 *   longer    the Margin. Options run down a column in the page margin,
 *             tied to the locked words by a leader line, with a box for
 *             steering them in the writer's own words. Without margin room
 *             (a phone, a narrow window) the column becomes a sheet beside
 *             the passage.
 *
 * Both start working when the lock opens: word lists and the model's
 * wordings are fetched at once, and more are fetched as the writer nears the
 * end, up to {@link MAX_MODEL_ROUNDS} model rounds per lock.
 */
import {
  $,
  component$,
  useSignal,
  useStore,
  useVisibleTask$,
} from "@qwik.dev/core";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { loadAiSettingsFromIdb } from "../../utils/idb";
import {
  hasConfiguredAiProvider,
  runClientAlternatives,
} from "../../utils/ai-client";
import { normalizeApplicationError } from "../../utils/application-errors";
import {
  alternativesPrompt,
  DRUM_GROUP_LABELS,
  drumGroup,
  drumOrder,
  LENS_LABELS,
  LENSES_FOR,
  lexiconQueries,
  MAX_DIRECTION_CHARS,
  MAX_MODEL_ROUNDS,
  MAX_STEERS,
  mergeOptions,
  MODEL_LENSES_FOR,
  parseAlternatives,
  parseLexicon,
  parsePartsOfSpeech,
  partOfSpeechQuery,
  roundSize,
  wordDelta,
  type AlternativeLens,
  type AlternativeOption,
  type AlternativesRequest,
} from "../../utils/alternatives";
import { sentenceWordDiff } from "../../utils/sentence-bench";
import {
  ALTERNATIVES_EVENT,
  ALTERNATIVES_REFUSED_EVENT,
  ALTERNATIVES_STEP_EVENT,
  alternativesController,
  alternativesSnapshot,
  motionAllowed,
  type AlternativesAnchor,
  type AlternativesRefusal,
  type AlternativesSnapshot,
} from "./extensions/alternatives";

type Filter = "all" | AlternativeLens;
type Fetching = "idle" | "loading" | "done" | "unavailable" | "error";

interface PaletteState {
  snapshot: AlternativesSnapshot | null;
  options: AlternativeOption[];
  /** null: the original is selected. */
  activeId: string | null;
  filter: Filter;
  lexicon: Fetching;
  model: Fetching;
  rounds: number;
  steers: number;
  /** The steer box's text. */
  direction: string;
  message: string;
  /** Where the span stood when the lock opened; a sheet follows scrolling only. */
  origin: { firstTop: number; bottom: number } | null;
  /** Which way the last step went, so the drum's faded words roll with it. */
  lastDir: 1 | -1 | 0;
  /** Counts steps; the drum's faded words redraw (and roll) on each. */
  steps: number;
  /** Model rounds that came back, as opposed to rounds started. */
  completed: number;
  /** The lock closed; the panel is on its way out. */
  leaving: boolean;
}

// ── Per-span memory ─────────────────────────────────────────────────────
// Reopening the same words in the same place shows what was already found
// and spends nothing. Browser-only, bounded.

interface CachedBrowse {
  options: AlternativeOption[];
  rounds: number;
  steers: number;
  model: Fetching;
  lexicon: Fetching;
}
const browseCache = new Map<string, CachedBrowse>();
const cacheKey = (s: AlternativesSnapshot) =>
  JSON.stringify([s.scale, s.text, s.before.slice(-80), s.after.slice(0, 80)]);
// Anything unfinished is remembered as not yet tried, so reopening resumes it.
const settled = (f: Fetching): Fetching => (f === "done" ? "done" : "idle");

function remember(state: PaletteState) {
  const s = state.snapshot;
  if (!s) return;
  const key = cacheKey(s);
  browseCache.delete(key);
  browseCache.set(key, {
    options: state.options.map((o) => ({ ...o })),
    // Only rounds that came back count: a round abandoned by closing the lock
    // is asked again when the same words are locked again.
    rounds: state.completed,
    steers: state.steers,
    model: settled(state.model),
    lexicon: settled(state.lexicon),
  });
  while (browseCache.size > 24)
    browseCache.delete(browseCache.keys().next().value!);
}

function addOptions(
  state: PaletteState,
  id: string,
  incoming: AlternativeOption[],
): number {
  if (state.snapshot?.id !== id || !incoming.length) return 0;
  const before = state.options.length;
  state.options = mergeOptions(state.options, incoming);
  return state.options.length - before;
}

// ── Layout ──────────────────────────────────────────────────────────────

const LEXICON_TIMEOUT_MS = 4500;
/** How long a closing panel takes to leave; matches the CSS. */
const LEAVE_MS = 150;
const MARGIN_WIDTH = 288;
const MARGIN_MIN = 232;
const MARGIN_GAP = 18;

type MarginLayout = {
  kind: "margin";
  side: "right" | "left";
  left: number;
  width: number;
  top: number;
  maxHeight: number;
};
type SheetLayout = {
  kind: "sheet";
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};
type Layout = { kind: "drum" } | MarginLayout | SheetLayout;

function layoutFor(state: PaletteState): Layout {
  const s = state.snapshot!;
  if (s.scale === "word") return { kind: "drum" };
  const a = s.anchor;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const page = a.page ?? { left: a.left, right: a.right };
  const bounds = a.bounds ?? { left: 0, right: vw, top: 0, bottom: vh };
  const firstTop = a.first?.top ?? a.top;
  const rightRoom = bounds.right - page.right - MARGIN_GAP - 12;
  const leftRoom = page.left - bounds.left - MARGIN_GAP - 12;
  const side =
    rightRoom >= MARGIN_MIN ? "right" : leftRoom >= MARGIN_MIN ? "left" : null;
  if (side) {
    const width = Math.min(
      MARGIN_WIDTH,
      side === "right" ? rightRoom : leftRoom,
    );
    const top = Math.max(bounds.top + 8, Math.min(firstTop - 8, vh - 240));
    return {
      kind: "margin",
      side,
      width,
      left:
        side === "right"
          ? page.right + MARGIN_GAP
          : page.left - MARGIN_GAP - width,
      top,
      maxHeight: Math.max(200, Math.min(540, vh - top - 12)),
    };
  }
  // No margin: a sheet beside the passage. Below it, it keeps the place it
  // took when the lock opened and moves only with scrolling, so a longer
  // preview never slides it under the pointer.
  const width = Math.min(420, vw - 16);
  const center = (a.left + a.right) / 2;
  const left = Math.max(8, Math.min(vw - width - 8, center - width / 2));
  const origin = state.origin ?? { firstTop, bottom: a.bottom };
  const below = origin.bottom + (firstTop - origin.firstTop) + 10;
  if (vh - below >= 240 || vh - below >= firstTop)
    return {
      kind: "sheet",
      left,
      width,
      top: below,
      maxHeight: Math.max(180, Math.min(440, vh - below - 12)),
    };
  return {
    kind: "sheet",
    left,
    width,
    bottom: vh - firstTop + 10,
    maxHeight: Math.max(180, Math.min(440, firstTop - 22)),
  };
}

/** The dashed line from the locked words to the option in the margin. */
function leaderPath(
  anchor: AlternativesAnchor,
  layout: MarginLayout,
  item: DOMRect,
  list: DOMRect,
): string {
  const y2 = Math.max(
    list.top + 6,
    Math.min(list.bottom - 6, item.top + Math.min(item.height / 2, 14)),
  );
  const page = anchor.page ?? { left: anchor.left, right: anchor.right };
  if (layout.side === "right") {
    const x1 = (anchor.last?.right ?? anchor.right) + 2;
    const y1 = (anchor.last?.bottom ?? anchor.bottom) + 1;
    const edge = Math.max(x1, page.right - 6);
    const x2 = layout.left - 1;
    return `M${x1} ${y1} L${edge} ${y1} C${edge + 12} ${y1} ${x2 - 10} ${y2} ${x2} ${y2}`;
  }
  const x1 = (anchor.first?.left ?? anchor.left) - 2;
  const y1 = (anchor.first?.bottom ?? anchor.bottom) + 1;
  const edge = Math.min(x1, page.left + 6);
  const x2 = layout.left + layout.width + 1;
  return `M${x1} ${y1} L${edge} ${y1} C${edge - 12} ${y1} ${x2 + 10} ${y2} ${x2} ${y2}`;
}

function refusalBox({ anchor }: { anchor: AlternativesAnchor }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(352, vw - 16);
  const center = (anchor.left + anchor.right) / 2;
  const left = Math.max(8, Math.min(vw - width - 8, center - width / 2));
  const below = vh - anchor.bottom >= 120;
  return {
    left,
    width,
    top: below ? anchor.bottom + 10 : undefined,
    bottom: below ? undefined : vh - anchor.top + 10,
  };
}

// ── Navigation ──────────────────────────────────────────────────────────
// Keyboard, wheel and swipe steps run synchronously against the store: two
// quick presses must move two places, which a lazily loaded handler cannot
// promise.

function visibleOptions(state: PaletteState): AlternativeOption[] {
  const snapshot = state.snapshot;
  if (!snapshot) return [];
  if (snapshot.scale === "word") return drumOrder(state.options);
  return state.filter === "all"
    ? state.options
    : state.options.filter((o) => o.lens === state.filter);
}

// Option ids are whole wordings ("go now!" and "go now?" are both options), so
// each gets a number of its own for its DOM id. Cleared when a lock opens.
const domKeys = new Map<string, number>();
const optionDomId = (lock: string, id: string | null) => {
  if (id === null) return `alternatives-option-${lock}-original`;
  let key = domKeys.get(id);
  if (key === undefined) domKeys.set(id, (key = domKeys.size));
  return `alternatives-option-${lock}-${key}`;
};

function activate(state: PaletteState, id: string | null) {
  const snapshot = state.snapshot;
  if (!snapshot || state.activeId === id) return;
  const ids = [null, ...visibleOptions(state).map((o) => o.id)];
  const from = ids.indexOf(state.activeId);
  const to = ids.indexOf(id);
  const dir = from < 0 || to < 0 ? 0 : to > from ? 1 : -1;
  const browsing = state.activeId !== null;
  state.activeId = id;
  state.lastDir = dir;
  state.steps++;
  const option = id ? state.options.find((o) => o.id === id) : null;
  // Back on the original after browsing, the original shows as a preview
  // too, so it rolls back into place like any other option.
  alternativesController()?.preview(
    option ? option.text : browsing ? snapshot.text : null,
    dir,
  );
  if (snapshot.scale !== "word")
    document
      .getElementById(optionDomId(snapshot.id, id))
      ?.scrollIntoView({ block: "nearest" });
}

/** Move the selection; returns how many options remain after it. */
function stepBy(state: PaletteState, delta: number): number {
  const ids = [null, ...visibleOptions(state).map((o) => o.id)];
  const at = Math.max(0, ids.indexOf(state.activeId));
  const next = Math.max(0, Math.min(ids.length - 1, at + delta));
  // At an end the locked words bump instead.
  if (next === at && delta !== 0)
    alternativesController()?.nudge(delta > 0 ? 1 : -1);
  else activate(state, ids[next] ?? null);
  return ids.length - 1 - next;
}

/** Drum only: jump to the start of the next or previous kind of word. */
function jumpGroup(state: PaletteState, dir: 1 | -1): number {
  const options = visibleOptions(state);
  const at = state.activeId
    ? options.findIndex((o) => o.id === state.activeId)
    : -1;
  const groupAt = (i: number) => drumGroup(options[i]!);
  let target: number | null = null;
  if (dir > 0) {
    const next = options.findIndex(
      (o, i) => i > at && (at < 0 || drumGroup(o) !== groupAt(at)),
    );
    if (next >= 0) target = next;
  } else if (at > 0) {
    let start = at;
    while (start > 0 && groupAt(start - 1) === groupAt(at)) start--;
    if (start < at) target = start;
    else {
      let prev = start - 1;
      while (prev > 0 && groupAt(prev - 1) === groupAt(start - 1)) prev--;
      target = prev;
    }
  }
  if (dir < 0 && target === null) activate(state, null);
  else if (target !== null) activate(state, options[target]!.id);
  const index = state.activeId
    ? options.findIndex((o) => o.id === state.activeId)
    : -1;
  return options.length - 1 - index;
}

function filtersFor(state: PaletteState): Filter[] {
  const s = state.snapshot;
  if (!s || s.scale === "word") return [];
  const steered =
    state.filter === "steered" ||
    state.options.some((o) => o.lens === "steered");
  return [
    "all",
    ...LENSES_FOR[s.scale],
    ...(steered ? (["steered"] as Filter[]) : []),
  ];
}

/** Switch kinds; returns true when the new kind is empty and worth a round. */
function selectFilter(state: PaletteState, filter: Filter): boolean {
  const snapshot = state.snapshot;
  if (!snapshot) return false;
  state.filter = filter;
  const shown = visibleOptions(state);
  if (state.activeId && !shown.some((o) => o.id === state.activeId))
    activate(state, null);
  document
    .querySelector<HTMLElement>(
      `[data-alternatives-palette="${snapshot.id}"] [data-lens="${filter}"]`,
    )
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  return (
    filter !== "all" &&
    filter !== "steered" &&
    !shown.length &&
    (state.model === "done" || state.model === "idle") &&
    MODEL_LENSES_FOR[snapshot.scale].includes(filter)
  );
}

function tagFor(option: AlternativeOption): string {
  if (option.lens === "steered" && option.direction)
    return `“${option.direction}”`;
  return LENS_LABELS[option.lens].toLocaleLowerCase();
}

/** Focus the open lock's list once Qwik has rendered it. */
function focusList(id: string, tries = 12) {
  const list = document.querySelector<HTMLElement>(
    `[data-alternatives-palette="${id}"] [role="listbox"]`,
  );
  if (list) list.focus({ preventScroll: true });
  else if (tries > 0) requestAnimationFrame(() => focusList(id, tries - 1));
}

export const AlternativesPalette = component$(() => {
  const auth = useAuth();
  const client = useConvexClient();
  const list = useSignal<HTMLDivElement>();
  const refusal = useSignal<AlternativesRefusal | null>(null);
  const leader = useSignal("");
  /** The active row's place in the list, for the cursor that glides to it. */
  const cursor = useSignal<{ top: number; height: number } | null>(null);
  const listScroll = useSignal(0);
  const state = useStore<PaletteState>({
    snapshot: null,
    options: [],
    activeId: null,
    filter: "all",
    lexicon: "idle",
    model: "idle",
    rounds: 0,
    steers: 0,
    direction: "",
    message: "",
    origin: null,
    lastDir: 0,
    steps: 0,
    leaving: false,
    completed: 0,
  });

  const fetchLexicon = $(async (snapshot: AlternativesSnapshot) => {
    if (snapshot.scale !== "word") return;
    const on = () => state.snapshot?.id === snapshot.id;
    state.lexicon = "loading";
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), LEXICON_TIMEOUT_MS);
    const get = async (url: string): Promise<unknown> => {
      const res = await fetch(url, { signal: abort.signal });
      if (!res.ok) throw new Error(`Word list ${res.status}`);
      return res.json();
    };
    try {
      const host = location.host;
      const queries = lexiconQueries(snapshot, host);
      const [parts, ...bodies] = await Promise.allSettled([
        get(partOfSpeechQuery(snapshot.text, host)),
        ...queries.map((q) => get(q.url)),
      ]);
      if (!on()) return;
      const pos =
        parts.status === "fulfilled" ? parsePartsOfSpeech(parts.value) : [];
      let found: AlternativeOption[] = [];
      bodies.forEach((body, i) => {
        if (body.status !== "fulfilled") return;
        const query = queries[i]!;
        const parsed = parseLexicon(body.value, query, snapshot.text, pos);
        found = mergeOptions(found, parsed.slice(0, query.keep));
      });
      addOptions(state, snapshot.id, found);
      state.lexicon = bodies.some((b) => b.status === "fulfilled")
        ? "done"
        : "error";
    } catch {
      if (on()) state.lexicon = "error";
    } finally {
      clearTimeout(timer);
      if (on()) remember(state);
    }
  });

  const fetchModel = $(
    async (
      snapshot: AlternativesSnapshot,
      lenses: AlternativeLens[],
      direction?: string,
    ) => {
      if (state.model === "loading") return;
      if (!direction && state.rounds >= MAX_MODEL_ROUNDS) return;
      const id = snapshot.id;
      const on = () => state.snapshot?.id === id;
      state.model = "loading";
      state.message = "";
      const request: AlternativesRequest = {
        text: snapshot.text,
        before: snapshot.before,
        after: snapshot.after,
        scale: snapshot.scale,
        lenses,
        count: direction ? 6 : roundSize(snapshot.scale, state.rounds),
        exclude: state.options.map((o) => o.text).slice(0, 40),
        direction,
      };
      if (!direction) state.rounds++;
      const tagged = (options: AlternativeOption[]) =>
        direction ? options.map((o) => ({ ...o, direction })) : options;
      let added = 0;
      try {
        const settings = await loadAiSettingsFromIdb();
        if (!on()) return;
        if (settings && hasConfiguredAiProvider(settings)) {
          const { system, prompt } = alternativesPrompt(request);
          const text = await runClientAlternatives(
            {
              system,
              prompt,
              scale: snapshot.scale,
              onText: (partial) => {
                added += addOptions(
                  state,
                  id,
                  tagged(
                    parseAlternatives(partial, request, { partial: true }),
                  ),
                );
              },
            },
            settings,
          );
          if (!on()) return;
          if (text === null) {
            state.model = "error";
            state.message =
              "Your model did not answer. Check its provider in Settings, or press More to try again.";
            return;
          }
          added += addOptions(
            state,
            id,
            tagged(parseAlternatives(text, request)),
          );
        } else if (
          auth.value.provider === "convex" &&
          auth.value.user &&
          client.value
        ) {
          const result = await client.value.action(api.alternatives.suggest, {
            text: request.text,
            before: request.before,
            after: request.after,
            scale: request.scale,
            lenses: request.lenses,
            count: request.count,
            exclude: request.exclude,
            direction,
          });
          if (!on()) return;
          added += addOptions(state, id, tagged(result.options));
        } else {
          if (!direction) state.rounds--;
          state.model = "unavailable";
          return;
        }
        state.model = "done";
        if (!direction) state.completed++;
        if (!added && (state.rounds > 1 || direction))
          state.message = direction
            ? "Nothing new came back for that direction. Try other words."
            : "No new wordings this time.";
      } catch (error) {
        if (!on()) return;
        state.model = "error";
        state.message = normalizeApplicationError(error, {
          source: "provider",
          metadata: { feature: "alternatives" },
        }).message;
      } finally {
        if (on()) remember(state);
      }
    },
  );

  const setActive = $((id: string | null) => activate(state, id));

  const close = $((restoreSelection: boolean) => {
    alternativesController()?.preview(null);
    alternativesController()?.close({ restoreSelection });
  });

  const use = $((id: string | null) => {
    const option = id ? state.options.find((o) => o.id === id) : null;
    if (!option) {
      alternativesController()?.preview(null);
      alternativesController()?.close({ restoreSelection: true });
      return;
    }
    const result = alternativesController()?.apply(option.text) ?? {
      ok: false as const,
      message: "The manuscript is no longer open.",
    };
    if (!result.ok) state.message = result.message;
  });

  /** Near the end, ask for more within the lock's budget. */
  const more = $(async (remaining: number) => {
    const snapshot = state.snapshot;
    if (!snapshot || remaining > 2) return;
    if (state.model !== "done" || state.rounds >= MAX_MODEL_ROUNDS) return;
    if (state.filter === "steered") return;
    await fetchModel(
      snapshot,
      state.filter === "all"
        ? MODEL_LENSES_FOR[snapshot.scale]
        : [state.filter],
    );
  });

  const choose = $(async (filter: Filter) => {
    if (selectFilter(state, filter) && state.snapshot)
      await fetchModel(state.snapshot, [filter as AlternativeLens]);
  });

  const steer = $(async () => {
    const snapshot = state.snapshot;
    const direction = state.direction.trim().slice(0, MAX_DIRECTION_CHARS);
    if (!snapshot || !direction) return;
    if (state.model === "loading") {
      state.message = "Still writing the last round. Steer again in a moment.";
      return;
    }
    if (state.steers >= MAX_STEERS) {
      state.message =
        "That was the last steer for this lock. Lock the words again to steer more.";
      return;
    }
    state.steers++;
    state.direction = "";
    state.filter = "steered";
    activate(state, null);
    await fetchModel(snapshot, ["steered"], direction);
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      let leaveTimer: ReturnType<typeof setTimeout> | undefined;
      const clear = () => {
        clearTimeout(leaveTimer);
        state.snapshot = null;
        state.options = [];
        state.activeId = null;
        state.leaving = false;
        cursor.value = null;
      };
      const begin = (snapshot: AlternativesSnapshot) => {
        clearTimeout(leaveTimer);
        state.leaving = false;
        state.lastDir = 0;
        cursor.value = null;
        refusal.value = null;
        domKeys.clear();
        const cached = browseCache.get(cacheKey(snapshot));
        state.snapshot = snapshot;
        state.options = cached?.options.map((o) => ({ ...o })) ?? [];
        state.rounds = cached?.rounds ?? 0;
        state.completed = state.rounds;
        state.steers = cached?.steers ?? 0;
        state.model = cached?.model ?? "idle";
        state.lexicon = cached?.lexicon ?? "idle";
        state.activeId = null;
        state.filter = "all";
        state.direction = "";
        state.message = "";
        state.origin = {
          firstTop: snapshot.anchor.first?.top ?? snapshot.anchor.top,
          bottom: snapshot.anchor.bottom,
        };
        // Lists and the model start together: the word lists land first,
        // the model's wordings for this sentence stream in behind them.
        if (state.lexicon === "idle") void fetchLexicon(snapshot);
        if (state.completed === 0 || state.model === "idle")
          void fetchModel(snapshot, MODEL_LENSES_FOR[snapshot.scale]);
        focusList(snapshot.id);
      };
      const follow = (event: Event) => {
        const next = (event as CustomEvent<AlternativesSnapshot | null>).detail;
        if (!next) {
          remember(state);
          leader.value = "";
          if (!state.snapshot) return;
          if (!motionAllowed()) return clear();
          // Keep the last frame on screen while it animates out.
          state.leaving = true;
          clearTimeout(leaveTimer);
          leaveTimer = setTimeout(clear, LEAVE_MS);
          return;
        }
        // Same lock, new position: the page scrolled or a preview reflowed.
        if (state.snapshot?.id === next.id) state.snapshot = next;
        else begin(next);
      };
      const step = (delta: number) => void more(stepBy(state, delta));
      const onStep = (event: Event) => {
        if (state.snapshot && !state.leaving)
          step((event as CustomEvent<number>).detail);
      };
      // Native, so arrow keys and Enter are stopped before the list scrolls
      // or the editor's own shortcuts see them.
      const onKey = (event: KeyboardEvent) => {
        const snapshot = state.snapshot;
        const target = event.target as HTMLElement | null;
        if (
          !snapshot ||
          state.leaving ||
          !target?.closest?.("[data-alternatives-palette]")
        )
          return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const key = event.key;
        const stop = () => {
          event.preventDefault();
          event.stopPropagation();
        };
        if (key === "Escape") {
          stop();
          void close(true);
          return;
        }
        // The steer box keeps its own keys; Enter submits it.
        if (target.closest("input, textarea")) return;
        const onTab = target.getAttribute("role") === "tab";
        if (key === "ArrowDown") {
          stop();
          step(1);
        } else if (key === "ArrowUp") {
          stop();
          step(-1);
        } else if (key === "PageDown") {
          stop();
          step(6);
        } else if (key === "PageUp") {
          stop();
          step(-6);
        } else if (key === "Home" && !onTab) {
          stop();
          activate(state, null);
        } else if (key === "End" && !onTab) {
          stop();
          step(state.options.length + 1);
        } else if (key === "ArrowRight" || key === "ArrowLeft") {
          stop();
          const dir = key === "ArrowRight" ? 1 : -1;
          if (snapshot.scale === "word") {
            void more(jumpGroup(state, dir));
            return;
          }
          const tabs = filtersFor(state);
          const at = tabs.indexOf(state.filter);
          const next = tabs[(at + dir + tabs.length) % tabs.length]!;
          if (selectFilter(state, next))
            void fetchModel(snapshot, [next as AlternativeLens]);
        } else if (key === "Enter" && !target.closest("button")) {
          stop();
          void use(state.activeId);
        }
      };
      let refusalTimer: ReturnType<typeof setTimeout> | undefined;
      const onRefused = (event: Event) => {
        refusal.value = (event as CustomEvent<AlternativesRefusal>).detail;
        clearTimeout(refusalTimer);
        refusalTimer = setTimeout(() => (refusal.value = null), 4000);
      };
      const onPointer = (event: PointerEvent) => {
        refusal.value = null;
        if (!state.snapshot || state.leaving) return;
        const target = event.target as HTMLElement | null;
        // Clicks in the manuscript are the extension's to judge.
        if (
          target?.closest?.("[data-alternatives-palette]") ||
          target?.closest?.(".ProseMirror")
        )
          return;
        void close(false);
      };
      window.addEventListener(ALTERNATIVES_EVENT, follow);
      window.addEventListener(ALTERNATIVES_STEP_EVENT, onStep);
      window.addEventListener(ALTERNATIVES_REFUSED_EVENT, onRefused);
      document.addEventListener("keydown", onKey, true);
      document.addEventListener("pointerdown", onPointer, true);
      const open = alternativesSnapshot();
      if (open) begin(open);
      cleanup(() => {
        window.removeEventListener(ALTERNATIVES_EVENT, follow);
        window.removeEventListener(ALTERNATIVES_STEP_EVENT, onStep);
        window.removeEventListener(ALTERNATIVES_REFUSED_EVENT, onRefused);
        clearTimeout(refusalTimer);
        clearTimeout(leaveTimer);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("pointerdown", onPointer, true);
      });
      // Renders nothing until a lock opens, so it cannot wait to be seen.
    },
    { strategy: "document-ready" },
  );

  // The leader line is measured from the rendered column.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track, cleanup }) => {
      track(() => state.snapshot);
      track(() => state.activeId);
      track(() => state.options.length);
      track(() => state.filter);
      track(() => state.message);
      track(() => listScroll.value);
      track(() => state.leaving);
      const frame = requestAnimationFrame(() => {
        const snapshot = state.snapshot;
        if (!snapshot || snapshot.scale === "word" || state.leaving) {
          leader.value = "";
          return;
        }
        const layout = layoutFor(state);
        const item = document.getElementById(
          optionDomId(snapshot.id, state.activeId),
        );
        if (item && list.value?.contains(item))
          cursor.value = { top: item.offsetTop, height: item.offsetHeight };
        if (layout.kind !== "margin" || !item || !list.value) {
          leader.value = "";
          return;
        }
        leader.value = leaderPath(
          snapshot.anchor,
          layout,
          item.getBoundingClientRect(),
          list.value.getBoundingClientRect(),
        );
      });
      cleanup(() => cancelAnimationFrame(frame));
    },
    { strategy: "document-ready" },
  );

  const snapshot = state.snapshot;
  if (!snapshot) {
    const note = refusal.value;
    if (!note) return null;
    const box = refusalBox(note);
    return (
      <p
        class="alt-refusal"
        role="status"
        style={{
          left: `${box.left}px`,
          maxWidth: `${box.width}px`,
          top: box.top === undefined ? undefined : `${box.top}px`,
          bottom: box.bottom === undefined ? undefined : `${box.bottom}px`,
        }}
      >
        {note.message}
      </p>
    );
  }

  const options = visibleOptions(state);
  const loading = state.lexicon === "loading" || state.model === "loading";
  const layout = layoutFor(state);

  // ── Drum ──────────────────────────────────────────────────────────
  if (layout.kind === "drum") {
    const a = snapshot.anchor;
    const ids = [null, ...options.map((o) => o.id)];
    const at = Math.max(0, ids.indexOf(state.activeId));
    const textAt = (i: number) =>
      i === 0 ? snapshot.text : options[i - 1]!.text;
    const prev = at > 0 ? textAt(at - 1) : "";
    const next = at < ids.length - 1 ? textAt(at + 1) : loading ? "…" : "";
    const current = at > 0 ? options[at - 1]! : null;
    const group = current ? drumGroup(current) : "original";
    const roll =
      state.lastDir > 0
        ? "is-roll-down"
        : state.lastDir < 0
          ? "is-roll-up"
          : "";
    const caption = current
      ? `${DRUM_GROUP_LABELS[drumGroup(current)]} · ${at} of ${options.length}`
      : options.length
        ? `${options.length} alternatives · ↓ or scroll`
        : loading
          ? "finding words…"
          : state.message ||
            (state.model === "unavailable"
              ? "no word lists right now, and no model connected"
              : "nothing found for this word");
    const cx = (a.left + a.right) / 2;
    const vh = window.innerHeight;
    return (
      <div
        class={["alt-drum", state.leaving ? "is-leaving" : ""]}
        data-alternatives-palette={snapshot.id}
      >
        <div
          ref={list}
          role="listbox"
          tabIndex={0}
          class="alt-drum__options"
          aria-label={`Alternatives for “${snapshot.text}”. Arrow keys turn through them; Enter uses one; Escape keeps the original.`}
          aria-activedescendant={optionDomId(snapshot.id, state.activeId)}
        >
          <div
            id={optionDomId(snapshot.id, null)}
            role="option"
            aria-selected={state.activeId === null}
          >
            {snapshot.text}, original
          </div>
          {options.length > 0
            ? options.map((option) => (
                <div
                  key={option.id}
                  id={optionDomId(snapshot.id, option.id)}
                  role="option"
                  aria-selected={state.activeId === option.id}
                >
                  {option.text}, {DRUM_GROUP_LABELS[drumGroup(option)]}
                </div>
              ))
            : null}
        </div>
        <div
          class="alt-drum__above"
          style={{ left: `${cx}px`, bottom: `${vh - a.top + 2}px` }}
          aria-hidden="true"
        >
          {prev ? (
            <button
              key={`up-${state.steps}`}
              type="button"
              tabIndex={-1}
              class={["alt-drum__pill", roll]}
              preventdefault:mousedown
              onClick$={() => {
                void more(stepBy(state, -1));
              }}
            >
              {prev}
            </button>
          ) : null}
        </div>
        <div
          class={[
            "alt-drum__below",
            cx > window.innerWidth * 0.6 ? "alt-drum__below--flip" : "",
          ]}
          style={{ left: `${cx}px`, top: `${a.bottom + 2}px` }}
          aria-hidden="true"
        >
          {next ? (
            <button
              key={`down-${state.steps}`}
              type="button"
              tabIndex={-1}
              class={["alt-drum__pill", roll, next === "…" ? "is-pending" : ""]}
              preventdefault:mousedown
              onClick$={() => {
                void more(stepBy(state, 1));
              }}
            >
              {next}
            </button>
          ) : null}
          <span key={group} class="alt-drum__caption" data-group={group}>
            {caption}
          </span>
        </div>
      </div>
    );
  }

  // ── Margin, or a sheet when there is no margin ────────────────────
  const filters = filtersFor(state);
  const counts = new Map<AlternativeLens, number>();
  for (const o of state.options)
    counts.set(o.lens, (counts.get(o.lens) ?? 0) + 1);
  const activeIndex = state.activeId
    ? options.findIndex((o) => o.id === state.activeId)
    : -1;
  const empty = !options.length;
  const steerable = state.model !== "unavailable" && state.steers < MAX_STEERS;
  const emptyText =
    state.model === "unavailable"
      ? "Rewordings need a model. Connect one in Settings, or sign in to use Twyne’s."
      : loading
        ? state.filter === "steered"
          ? "Steering…"
          : "Finding alternatives…"
        : state.filter === "steered"
          ? "Nothing came back for that direction. Try other words."
          : state.filter !== "all"
            ? `No ${LENS_LABELS[state.filter].toLocaleLowerCase()} wordings yet.`
            : "Nothing fits this span yet.";
  const side = layout.kind === "margin" ? layout.side : "sheet";
  const top = layout.kind === "margin" ? layout.top : layout.top;
  const bottom = layout.kind === "sheet" ? layout.bottom : undefined;

  return (
    <>
      {layout.kind === "margin" && leader.value ? (
        <svg
          class={["alt-leader", state.model === "loading" ? "is-busy" : ""]}
          aria-hidden="true"
        >
          {/* The CSS `d` lets supporting browsers glide between rows. */}
          <path d={leader.value} style={`d: path("${leader.value}")`} />
        </svg>
      ) : null}
      <div
        class={[
          "alt-margin",
          `alt-margin--${side}`,
          state.leaving ? "is-leaving" : "",
        ]}
        style={{
          left: `${layout.left}px`,
          width: `${layout.width}px`,
          top: top === undefined ? undefined : `${top}px`,
          bottom: bottom === undefined ? undefined : `${bottom}px`,
          maxHeight: `${layout.maxHeight}px`,
        }}
        role="dialog"
        aria-label={`Alternatives for “${snapshot.text.slice(0, 60)}”`}
        data-alternatives-palette={snapshot.id}
      >
        <header class="alt-margin__head">
          <p class="alt-margin__kicker">
            Alternatives
            <span>about {snapshot.words} words, like the original</span>
          </p>
          <button
            type="button"
            class="alt-margin__close"
            aria-label="Keep the original and close"
            title="Keep the original (Esc)"
            onClick$={() => close(true)}
          >
            ×
          </button>
        </header>

        <div
          class="alt-margin__chips"
          role="tablist"
          aria-label="Kinds of alternative"
        >
          {filters.map((lens) => {
            const n =
              lens === "all"
                ? state.options.length
                : (counts.get(lens as AlternativeLens) ?? 0);
            return (
              <button
                key={lens}
                type="button"
                role="tab"
                tabIndex={-1}
                aria-selected={state.filter === lens}
                aria-controls={`alternatives-list-${snapshot.id}`}
                data-lens={lens}
                class={state.filter === lens ? "is-on" : ""}
                onClick$={() => choose(lens)}
              >
                {lens === "all" ? "All" : LENS_LABELS[lens as AlternativeLens]}
                {n > 0 && (
                  <span key={n} class="alt-margin__count">
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div
          ref={list}
          id={`alternatives-list-${snapshot.id}`}
          class="alt-margin__list"
          role="listbox"
          tabIndex={0}
          aria-label="Alternatives, original first"
          aria-activedescendant={optionDomId(snapshot.id, state.activeId)}
          onScroll$={(_, el) => {
            listScroll.value++;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24)
              void more(0);
          }}
        >
          {cursor.value ? (
            <span
              class="alt-margin__cursor"
              aria-hidden="true"
              style={{
                translate: `0 ${cursor.value.top}px`,
                height: `${cursor.value.height}px`,
              }}
            />
          ) : null}
          <div
            id={optionDomId(snapshot.id, null)}
            role="option"
            aria-selected={state.activeId === null}
            class={[
              "alt-margin__option",
              "alt-margin__option--original",
              state.activeId === null ? "is-active" : "",
            ]}
            onMouseEnter$={() => setActive(null)}
            onClick$={() => use(null)}
          >
            <span class="alt-margin__text">{snapshot.text}</span>
            <span class="alt-margin__meta">original</span>
          </div>

          {options.length > 0
            ? options.map((option, index) => {
                const delta = wordDelta(option, snapshot.text);
                return (
                  <div
                    key={option.id}
                    style={`--i:${Math.min(index, 10)}`}
                    id={optionDomId(snapshot.id, option.id)}
                    role="option"
                    aria-selected={state.activeId === option.id}
                    class={[
                      "alt-margin__option",
                      state.activeId === option.id ? "is-active" : "",
                    ]}
                    onMouseEnter$={() => setActive(option.id)}
                    onClick$={() => use(option.id)}
                  >
                    <span class="alt-margin__text">
                      {sentenceWordDiff(snapshot.text, option.text)
                        .filter((part) => part.kind !== "removed")
                        .map((part, i) =>
                          part.kind === "added" && part.text.trim() ? (
                            <em key={i}>{part.text}</em>
                          ) : (
                            <span key={i}>{part.text}</span>
                          ),
                        )}
                    </span>
                    <span class="alt-margin__meta">
                      {state.filter === "all" || option.lens === "steered" ? (
                        <span>{tagFor(option)}</span>
                      ) : null}
                      {delta !== 0 ? (
                        <span
                          title={`${Math.abs(delta)} ${Math.abs(delta) === 1 ? "word" : "words"} ${delta > 0 ? "longer" : "shorter"} than the original`}
                        >
                          {delta > 0 ? `+${delta}` : `−${-delta}`}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })
            : null}

          {empty && loading && state.model !== "unavailable" ? (
            <div class="alt-margin__skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : null}
          {empty ? (
            <p class="alt-margin__empty" role="status">
              {emptyText}
            </p>
          ) : null}
          {!empty && state.model === "loading" ? (
            <p class="alt-margin__more" role="status">
              {state.filter === "steered" ? "Steering…" : "Finding more…"}
            </p>
          ) : null}
          {!empty &&
          state.filter !== "steered" &&
          (state.model === "done" || state.model === "error") &&
          state.rounds < MAX_MODEL_ROUNDS ? (
            <button
              type="button"
              tabIndex={-1}
              class="alt-margin__more alt-margin__more--button"
              onClick$={() => {
                state.model = "done";
                return fetchModel(
                  snapshot,
                  state.filter === "all"
                    ? MODEL_LENSES_FOR[snapshot.scale]
                    : [state.filter],
                );
              }}
            >
              More
            </button>
          ) : null}
        </div>

        {state.message ? (
          <p class="alt-margin__notice" role="status">
            {state.message}
          </p>
        ) : null}

        <form
          class={[
            "alt-margin__steer",
            state.model === "loading" && state.filter === "steered"
              ? "is-busy"
              : "",
          ]}
          preventdefault:submit
          onSubmit$={steer}
        >
          <input
            type="text"
            value={state.direction}
            maxLength={MAX_DIRECTION_CHARS}
            placeholder={
              steerable ? "make it… lonelier" : "steering needs a model"
            }
            aria-label="Steer the wordings in your own words, then press Enter"
            disabled={!steerable}
            onInput$={(_, el) => {
              state.direction = el.value;
            }}
          />
        </form>

        <p class="alt-margin__keys" aria-hidden="true">
          <span>↑↓ preview</span>
          <span>↵ use</span>
          <span>←→ kind</span>
          <span>esc keep</span>
          {activeIndex >= 0 ? (
            <span class="alt-margin__position">
              {activeIndex + 1} of {options.length}
            </span>
          ) : null}
        </p>
      </div>
    </>
  );
});
