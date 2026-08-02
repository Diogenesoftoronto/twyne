import { component$, type PropFunction } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";

/**
 * The single chrome shared by /dossier/create and /dossier/refine.
 *
 * The earlier versions of these routes scattered exits through the body —
 * a "Back to desk" link in the top bar, a "Close" button inside the form,
 * a "Cancel" button inside the conversation chrome. They meant different
 * things, disappeared depending on which authoring surface the writer
 * happened to be in, and trapped anyone who switched to conversation with
 * no obvious way back.
 *
 * This bar fixes both problems at once. It owns the only page-level exit
 * ("Back to desk"), the only mode switch (the right-aligned Form /
 * Conversation pair), and the only destructive action ("Start over"). The
 * authoring surfaces below it carry no chrome of their own.
 */
interface DossierTopBarProps {
  /** Where "Back to desk" navigates. */
  backHref: string;
  /** Label for the back link — "Back to desk" while in the editor, "Back home" while in onboarding. */
  backLabel: string;
  /** Current authoring surface. */
  mode: "form" | "conversational";
  /** Where the writer lands when they pick the other surface. */
  switchHref: string;
  /** When true, render the "Start over" destructive action. Only the refine page exposes it. */
  showStartOver: boolean;
  onSwitch$: PropFunction<() => void>;
  onStartOver$: PropFunction<() => void>;
}

export const DossierTopBar = component$((props: DossierTopBarProps) => {
  const formPill = props.mode === "form";
  return (
    <div
      class="px-4 py-2 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-2)]/80 backdrop-blur-sm flex items-center justify-between gap-4"
    >
      <div class="flex items-center gap-3">
        <Link
          href={props.backHref}
          class="text-[var(--color-ink-light)] hover:text-[var(--color-ink)] text-sm flex items-center gap-1.5"
          style={{ fontFamily: "var(--font-typewriter)" }}
        >
          <span aria-hidden="true">←</span> {props.backLabel}
        </Link>
        {props.showStartOver && (
          <button
            type="button"
            onClick$={props.onStartOver$}
            class="text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)] text-[0.65rem] tracking-[0.18em] uppercase"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Start over
          </button>
        )}
      </div>

      <div
        class="flex items-center gap-1 text-[0.65rem] tracking-[0.18em] uppercase"
        style={{ fontFamily: "var(--font-typewriter)" }}
        role="group"
        aria-label="Authoring surface"
      >
        <span class="text-[var(--color-ink-muted)] mr-1 hidden sm:inline">
          Surface:
        </span>
        <button
          type="button"
          aria-pressed={formPill}
          onClick$={props.onSwitch$}
          class={
            formPill
              ? "rounded-full bg-[var(--color-vermilion)] px-3 py-1 text-white"
              : "rounded-full px-3 py-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          }
        >
          Form
        </button>
        <button
          type="button"
          aria-pressed={!formPill}
          onClick$={props.onSwitch$}
          class={
            formPill
              ? "rounded-full px-3 py-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              : "rounded-full bg-[var(--color-vermilion)] px-3 py-1 text-white"
          }
        >
          Conversation
        </button>
      </div>
    </div>
  );
});