import { $ } from "@qwik.dev/core";
import { DossierFolio } from "./dossier-folio";
import { DossierTopBar } from "./dossier-top-bar";

/**
 * The folio while the room is still reading the saved brief.
 *
 * Built on the exact `DossierFolio` frame, so when the real form or
 * conversation arrives only the leaves change — nothing in the frame moves.
 * What the app already knows (the chrome, the first question) renders as
 * real text; only what is still being read from storage shimmers.
 *
 * Inline function rather than `component$`, matching `DossierFolio`.
 */
export const DossierFolioSkeleton = (props: {
  surface: "form" | "conversational";
  backHref: string;
  backLabel: string;
}) =>
  DossierFolio({
    surface: props.surface,
    chrome: (
      <DossierTopBar
        backHref={props.backHref}
        backLabel={props.backLabel}
        mode={props.surface}
        switchHref=""
        showStartOver={false}
        variant="inset"
        onSwitch$={$(() => {})}
        onStartOver$={$(() => {})}
      />
    ),
    dossier: (
      <div class="dossier-skeleton" aria-hidden="true">
        <p
          class="dept-label text-[var(--color-ink-light)]"
          style="font-family: var(--font-typewriter);"
        >
          Working copy
        </p>
        <span class="dossier-skeleton__line dossier-skeleton__line--title" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} class="dossier-skeleton__card">
            <span class="dossier-skeleton__line dossier-skeleton__line--label" />
            <span class="dossier-skeleton__line" />
            <span class="dossier-skeleton__line dossier-skeleton__line--short" />
          </div>
        ))}
      </div>
    ),
    leaf:
      props.surface === "conversational" ? (
        <div class="dossier-skeleton dossier-skeleton--leaf" role="status">
          <span class="sr-only">Opening the interview…</span>
          <div class="dossier-skeleton__bubble" aria-hidden="true">
            <span class="dossier-skeleton__line dossier-skeleton__line--label" />
            <span class="dossier-skeleton__line" />
            <span class="dossier-skeleton__line dossier-skeleton__line--short" />
          </div>
          <div class="dossier-skeleton__composer" aria-hidden="true" />
        </div>
      ) : (
        <div class="dossier-skeleton dossier-skeleton--leaf" role="status">
          <span class="sr-only">Opening the dossier…</span>
          <p
            class="dept-label text-[var(--color-ink-light)]"
            style="font-family: var(--font-typewriter);"
            aria-hidden="true"
          >
            Dept. of the Working Title
          </p>
          <div class="dossier-skeleton__question" aria-hidden="true">
            <span
              class="dossier-skeleton__numeral"
              style="font-family: var(--font-display);"
            >
              I.
            </span>
            <span style="font-family: var(--font-display);">
              What are we calling it, for now?
            </span>
          </div>
          <span class="dossier-skeleton__rule" aria-hidden="true" />
          <div class="dossier-skeleton__meter" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} class="dossier-skeleton__notch" />
            ))}
          </div>
        </div>
      ),
  });
