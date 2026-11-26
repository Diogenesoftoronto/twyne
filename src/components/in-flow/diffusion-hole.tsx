import { $, component$, useSignal, useStyles$, useVisibleTask$, type QRL } from "@qwik.dev/core";
import styles from "./diffusion-hole.css?inline";

export type DiffusionHoleVariant = "blank" | "cutout" | "bracket";

export type DiffusionHoleState = "masked" | "seeded" | "editing" | "denoising" | "settled";

export interface DiffusionHoleProps {
  variant?: DiffusionHoleVariant;
  state?: DiffusionHoleState;
  slotsBefore?: number;
  slotsAfter?: number;
  /** Words the writer typed inside the gap. They hold still while the rest resolves. */
  seedText?: string;
  /** The passage the gap resolves to. */
  settledText?: string;
  showControls?: boolean;
}

const MAX_SLOTS_AFTER = 6;
const WORD_STAGGER_MS = 70;
const WORD_ENTER_MS = 300;

/* 16-unit icons, 1.5 stroke to sit beside 400–500 weight serif text. */
const ICON_PROPS = {
  class: "dh-icon",
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
} as const;

const IconAperture = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M2.5 5.5V3.5a1 1 0 0 1 1-1h2" />
    <path d="M10.5 2.5h2a1 1 0 0 1 1 1v2" />
    <path d="M13.5 10.5v2a1 1 0 0 1-1 1h-2" />
    <path d="M5.5 13.5h-2a1 1 0 0 1-1-1v-2" />
    <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
  </svg>
));

const IconPencil = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M11.3 2.7a1.5 1.5 0 0 1 2.1 2.1L5.8 12.4 2.5 13.5l1.1-3.3 7.7-7.5Z" />
  </svg>
));

const IconSpark = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M8 2v2.4M8 11.6V14M2 8h2.4M11.6 8H14M4.1 4.1l1.5 1.5M10.4 10.4l1.5 1.5M11.9 4.1l-1.5 1.5M5.6 10.4l-1.5 1.5" />
  </svg>
));

const IconMinus = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M3.5 8h9" />
  </svg>
));

const IconPlus = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
));

const IconUndo = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M3.5 6.5H10a3 3 0 1 1 0 6H7.5" />
    <path d="M5.8 4.2 3.5 6.5l2.3 2.3" />
  </svg>
));

export const IconPin = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M6 2.5h4l-.8 4.2 2.3 2.3H4.5l2.3-2.3L6 2.5Z" />
    <path d="M8 9v4.5" />
  </svg>
));

export const IconInsertCaret = component$(() => (
  <svg {...ICON_PROPS}>
    <path d="M8 3v6M5.5 6.5 8 9l2.5-2.5" />
    <path d="M4 12.5h8" />
  </svg>
));

const SLUG_WIDTHS = [24, 38, 28, 44, 32, 22, 40, 30];

/** Purely visual: the count is carried in text by the badge beside it. */
const SlotIndicator = component$<{ variant: DiffusionHoleVariant; count: number; offset?: number }>(
  ({ variant, count, offset = 0 }) => {
    if (count <= 0) return null;
    const indices = Array.from({ length: count }, (_, i) => i);

    if (variant === "bracket") {
      return (
        <span class="dh-slots dh-slots--dots" aria-hidden="true">
          {indices.map((i) => (
            <span key={i} class="dh-dot" />
          ))}
        </span>
      );
    }

    return (
      <span class="dh-slots" aria-hidden="true">
        {indices.map((i) => (
          <span
            key={i}
            class={variant === "cutout" ? "dh-slug" : "dh-bar"}
            style={{ width: `${SLUG_WIDTHS[(i + offset) % SLUG_WIDTHS.length]}px` }}
          />
        ))}
      </span>
    );
  },
);

interface ResolvedWord {
  text: string;
  kept: boolean;
  /** Position in the reveal order. Deliberately not left to right. */
  order: number;
}

const normalize = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * A diffusion pass settles words all over the gap at once rather than left to
 * right, and the writer's own words never move. The order is a fixed
 * permutation so a given passage always resolves the same way.
 */
function resolveWords(passage: string, seed: string): ResolvedWord[] {
  const kept = new Set(seed.split(/\s+/).map(normalize).filter(Boolean));
  const words = passage.split(/\s+/).filter(Boolean);
  const open = words.map((w, i) => (kept.has(normalize(w)) ? -1 : i)).filter((i) => i >= 0);
  const step = open.length > 2 ? Math.max(2, Math.floor(open.length / 2) + 1) : 1;
  const rank = new Map<number, number>();
  let cursor = 0;
  for (let n = 0; n < open.length; n++) {
    while (rank.has(open[cursor % open.length])) cursor++;
    rank.set(open[cursor % open.length], n);
    cursor += step;
  }
  return words.map((text, i) => ({ text, kept: !rank.has(i), order: rank.get(i) ?? 0 }));
}

export const DiffusionHole = component$<DiffusionHoleProps>((props) => {
  useStyles$(styles);

  const variant = props.variant ?? "blank";
  const showControls = props.showControls ?? true;
  const passage = props.settledText ?? "fastened the iron latch shut tight";

  const holeState = useSignal<DiffusionHoleState>(props.state ?? "masked");
  const beforeCount = useSignal(props.slotsBefore ?? 2);
  const afterCount = useSignal(props.slotsAfter ?? 2);
  const seed = useSignal(props.seedText ?? "");
  const draftInput = useSignal(props.seedText ?? "");

  const rootRef = useSignal<HTMLElement>();
  /** Where focus should land after the next state change, so it never drops to <body>. */
  const focusTarget = useSignal<"" | "input" | "seed" | "write" | "reopen">("");

  const totalSlots = beforeCount.value + afterCount.value;
  const canShrink = afterCount.value > 0 || beforeCount.value > 1;
  const canGrow = afterCount.value < MAX_SLOTS_AFTER;

  // eslint-disable-next-line qwik/no-use-visible-task -- focus management needs the live DOM
  useVisibleTask$(({ track, cleanup }) => {
    const target = track(() => focusTarget.value);
    if (!target) return;
    // The target is rendered by the same state change, so it may not be in the DOM yet.
    let tries = 0;
    let frame = 0;
    const land = () => {
      const el = rootRef.value?.querySelector<HTMLElement>(`[data-dh-focus="${target}"]`);
      if (el) {
        el.focus();
        if (el instanceof HTMLInputElement) el.select();
      }
      if (el || ++tries >= 6) focusTarget.value = "";
      else frame = requestAnimationFrame(land);
    };
    // Never land in the same task as the key that caused it: Enter's keypress
    // would then activate the button that just took focus.
    frame = requestAnimationFrame(land);
    cleanup(() => cancelAnimationFrame(frame));
  });

  const startEditing$ = $(() => {
    draftInput.value = seed.value;
    holeState.value = "editing";
    focusTarget.value = "input";
  });

  const leaveEditing$ = $((commit: boolean) => {
    if (holeState.value !== "editing") return;
    if (commit) seed.value = draftInput.value.trim();
    else draftInput.value = seed.value;
    holeState.value = seed.value ? "seeded" : "masked";
    focusTarget.value = seed.value ? "seed" : "write";
  });

  const adjustSlots$ = $((delta: number) => {
    if (delta > 0) {
      afterCount.value = Math.min(MAX_SLOTS_AFTER, afterCount.value + 1);
    } else if (afterCount.value > 0) {
      afterCount.value -= 1;
    } else if (beforeCount.value > 1) {
      beforeCount.value -= 1;
    }
  });

  const fill$ = $(() => {
    const open = resolveWords(passage, seed.value).filter((w) => !w.kept).length;
    holeState.value = "denoising";
    setTimeout(
      () => {
        if (holeState.value !== "denoising") return;
        holeState.value = "settled";
        focusTarget.value = "reopen";
      },
      Math.max(0, open - 1) * WORD_STAGGER_MS + WORD_ENTER_MS + 120,
    );
  });

  const state = holeState.value;
  const resolved = state === "denoising" || state === "settled";
  const announcement =
    state === "denoising" ? "Filling the gap…" : state === "settled" ? `Gap filled: ${passage}` : "";

  return (
    <span ref={rootRef} class="dh-root">
      {/* Mounted empty and kept mounted, so each update is announced. */}
      <span class="dh-sr" role="status">
        {announcement}
      </span>

      {resolved ? (
        <span class={`dh-passage${state === "denoising" ? " is-resolving" : ""}`}>
          <span class="dh-passage__text" aria-hidden={state === "denoising" ? "true" : undefined}>
            {resolveWords(passage, seed.value).map((word, i) => (
              <span
                key={i}
                class={`dh-word${word.kept ? " is-kept" : ""}`}
                style={{ "--dh-delay": `${word.order * WORD_STAGGER_MS}ms` }}
              >
                {word.text}{" "}
              </span>
            ))}
          </span>
          {state === "settled" && showControls && (
            <button
              type="button"
              class="dh-btn dh-btn--reopen"
              data-dh-focus="reopen"
              aria-label="Reopen this gap"
              title="Reopen this gap"
              onClick$={() => {
                holeState.value = seed.value ? "seeded" : "masked";
                focusTarget.value = seed.value ? "seed" : "write";
              }}
            >
              <IconUndo />
            </button>
          )}
        </span>
      ) : (
        <span class={`dh-hole dh-hole--${variant}${state === "editing" ? " is-editing" : ""}`}>
          <span class="dh-glyph">
            <IconAperture />
          </span>

          {state === "editing" ? (
            <input
              data-dh-focus="input"
              type="text"
              class="dh-input"
              aria-label="Words to keep in this gap"
              placeholder="iron latch"
              autocomplete="off"
              spellcheck={false}
              value={draftInput.value}
              onInput$={(_, el) => {
                draftInput.value = el.value;
              }}
              onKeyDown$={(ev) => {
                if (ev.key === "Enter") leaveEditing$(true);
                else if (ev.key === "Escape") leaveEditing$(false);
              }}
              onBlur$={() => leaveEditing$(true)}
            />
          ) : (
            <>
              <SlotIndicator variant={variant} count={beforeCount.value} offset={0} />
              {seed.value && (
                <button
                  type="button"
                  class="dh-seed"
                  data-dh-focus="seed"
                  aria-label={`${seed.value}, your words. Edit`}
                  onClick$={startEditing$}
                >
                  <IconPencil />
                  <span>{seed.value}</span>
                </button>
              )}
              <SlotIndicator variant={variant} count={afterCount.value} offset={beforeCount.value + 1} />
              <span class="dh-count">
                <span aria-hidden="true">{totalSlots}w</span>
                <span class="dh-sr">
                  {totalSlots} {totalSlots === 1 ? "word" : "words"} to fill
                </span>
              </span>
            </>
          )}

          {showControls && state !== "editing" && (
            <span class="dh-actions" role="group" aria-label="Gap controls">
              <span class="dh-actions__surface">
                <button
                  type="button"
                  class="dh-btn dh-btn--write"
                  data-dh-focus="write"
                  aria-label="Write words to keep"
                  title="Write words to keep"
                  onClick$={startEditing$}
                >
                  <IconPencil />
                </button>
                <button
                  type="button"
                  class="dh-btn"
                  aria-label="Fewer words"
                  title="Fewer words"
                  disabled={!canShrink}
                  onClick$={() => adjustSlots$(-1)}
                >
                  <IconMinus />
                </button>
                <button
                  type="button"
                  class="dh-btn"
                  aria-label="More words"
                  title="More words"
                  disabled={!canGrow}
                  onClick$={() => adjustSlots$(1)}
                >
                  <IconPlus />
                </button>
                <button
                  type="button"
                  class="dh-btn"
                  aria-label="Close this gap"
                  title="Close this gap"
                  onClick$={() => {
                    holeState.value = "settled";
                    focusTarget.value = "reopen";
                  }}
                >
                  <IconUndo />
                </button>
                <button
                  type="button"
                  class="dh-btn dh-btn--fill"
                  aria-label="Fill this gap"
                  title="Fill this gap"
                  onClick$={fill$}
                >
                  <IconSpark />
                </button>
              </span>
            </span>
          )}
        </span>
      )}
    </span>
  );
});

export const LockedAnchor = component$<{ text: string }>(({ text }) => {
  useStyles$(styles);
  return (
    <span class="dh-anchor">
      <IconPin />
      <span>{text}</span>
      <span class="dh-sr"> (kept as written)</span>
    </span>
  );
});

export const InsertHoleCaret = component$<{ onInsert$?: QRL<() => void> }>(({ onInsert$ }) => {
  useStyles$(styles);
  return (
    <button
      type="button"
      class="dh-insert"
      title="Open a gap here"
      aria-label="Open a gap here"
      onClick$={onInsert$}
    >
      <IconInsertCaret />
    </button>
  );
});
