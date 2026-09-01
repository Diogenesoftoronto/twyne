import type { JSXOutput } from "@qwik.dev/core";
import type { DossierFilingState } from "../../utils/dossier-filing";

/**
 * The folio — the one frame both authoring surfaces are filed into.
 *
 * The form and the conversation used to be two different pages that happened
 * to share a colour palette: the form was a card floating on a `min-h-screen`
 * document that scrolled, the conversation was a full-bleed transcript with
 * page-wide chrome above it. Switching between them redrew everything, which
 * made a change of *surface* read like a change of *place*.
 *
 * Here they are the same object. One sheet, locked to the viewport, with the
 * route chrome filed into its top edge, the live dossier on the left leaf, and
 * whatever the writer is actually working in on the right. Because both
 * surfaces emit the identical frame in the identical position, switching them
 * only swaps the leaves — and the right leaf is keyed so the swap feeds in
 * like paper rather than blinking.
 *
 * This is deliberately an *inline* component (a plain function, not
 * `component$`) taking its three regions as JSX props rather than as slots.
 * Projected content that contains a component does not pick up prop changes
 * from the projecting parent — the live dossier froze on whichever field was
 * active when it first mounted. Rendering inline keeps the leaves inside the
 * caller's own reactivity, where they belong.
 */
interface DossierFolioProps {
  /**
   * Which surface is filling the right leaf. Keys the feed animation, so a
   * surface switch is a sheet change rather than a repaint.
   */
  surface: "form" | "conversational";
  /** The top bar, filed into the folio's edge. */
  chrome: JSXOutput;
  /** The left leaf: the brief as it currently stands. */
  dossier: JSXOutput;
  /** The right leaf: the question, or the transcript. */
  leaf: JSXOutput;
  /** Rendered outside the folio — transient overlays like the sending pip. */
  overlays?: JSXOutput;
  /** Persistence state, reflected by the paper outline and filing stamp. */
  filingState?: DossierFilingState;
}

export const DossierFolio = (props: DossierFolioProps) => {
  const filingState = props.filingState ?? "idle";
  return (
    <main class="flex h-[100dvh] min-h-0 flex-col overflow-hidden paper-sheet paper-foxed">
      {props.overlays}
      <div class="mx-auto flex min-h-0 w-full max-w-[92rem] flex-1 flex-col px-3 py-3 sm:px-5 sm:py-4">
        <div
          class="dossier-folio-frame folio relative flex min-h-0 flex-1 flex-col overflow-hidden"
          data-filing-state={filingState}
          aria-busy={filingState === "filing"}
        >
          {props.chrome}

          <div class="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)]">
            {/* ── LEFT LEAF: the dossier as it stands ─────────────────── */}
            <div
              class="folio-column border-b border-[var(--color-paper-3)] px-5 py-4 lg:border-b-0 lg:border-r"
              style="background: linear-gradient(165deg, var(--color-paper-soft) 0%, var(--color-paper-2) 100%);"
            >
              {props.dossier}
            </div>

            {/* ── RIGHT LEAF: the surface the writer is working in ────── */}
            <div
              key={props.surface}
              class="folio-shift flex min-h-0 flex-col bg-[var(--color-paper)]"
            >
              {props.leaf}
            </div>
          </div>

          {filingState === "filed" && (
            <div
              class="dossier-filed-confirmation"
              role="status"
              aria-live="polite"
            >
              <div class="dossier-filed-confirmation__paper">
                <span
                  class="dossier-filed-confirmation__mark"
                  aria-hidden="true"
                >
                  ✓
                </span>
                <strong>Filed</strong>
                <span>Dossier saved to this folio</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
