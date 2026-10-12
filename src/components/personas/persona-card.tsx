import { Slot, component$, useStyles$ } from "@qwik.dev/core";
import type { Persona } from "../../types";
import { renderMarkdown } from "../../utils/markdown";
import { openLiveVoice } from "../../utils/live-voice-workspace";
import { SpeakButton } from "../ui/speak-button";
import { PersonaPortrait } from "./persona-portrait";
import styles from "./persona-card.css?inline";

export interface PersonaCardProps {
  persona: Persona;
  /** Which sample note to show as the editor's calling card. */
  sampleIndex?: number;
}

/** Markdown marks are for the eye; read aloud, they are noise. */
function spoken(text: string): string {
  return text.replace(/[*_`]/g, "").replace(/[«»]/g, "");
}

/**
 * An editor's calling card: the engraved figure on their own colour plate,
 * and one note in their hand, so a writer learns to recognise the voice on
 * the page before they meet it in the margin. Edit and order controls go
 * in the default slot.
 */
export const PersonaCard = component$<PersonaCardProps>((props) => {
  useStyles$(styles);
  const p = props.persona;
  const sample =
    p.sampleLines?.[props.sampleIndex ?? 0] ?? p.sampleLines?.[0] ?? "";
  const speechId = `persona-card-${p.id}`;
  return (
    <article
      class="persona-card"
      style={{ "--pp-color": p.color }}
      aria-labelledby={`${speechId}-name`}
    >
      <div class="persona-card__plate">
        <span class="persona-card__suit" aria-hidden="true">
          {p.icon}
        </span>
        <PersonaPortrait
          personaId={p.id}
          name={p.name}
          color={p.color}
          imageUrl={p.imageUrl}
          framing="figure"
          size={208}
          class="persona-card__figure"
        />
      </div>

      <div class="persona-card__body">
        <header class="persona-card__head">
          <p class="persona-card__role">{p.role}</p>
          <h3 class="persona-card__name" id={`${speechId}-name`}>
            {p.name}
          </h3>
          <p class="persona-card__description">{p.description}</p>
        </header>

        {sample && (
          <figure class="persona-card__sample">
            <figcaption>In the margin</figcaption>
            <div
              class="persona-card__note comment-markdown"
              data-speech-id={speechId}
              dangerouslySetInnerHTML={renderMarkdown(sample)}
            />
          </figure>
        )}

        <footer class="persona-card__actions">
          {sample && (
            <span class="persona-card__hear">
              <SpeakButton
                id={speechId}
                text={spoken(sample)}
                voice={p.speechVoice}
                voices={p.speechVoices}
                instructions={p.voice}
                label={p.name}
              />
              Hear {p.name.split(" ").at(-1)}
            </span>
          )}
          <button
            type="button"
            class="persona-card__talk"
            onClick$={() => openLiveVoice(p.name)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            Talk it through
          </button>
          <span class="persona-card__controls">
            <Slot />
          </span>
        </footer>
      </div>
    </article>
  );
});
