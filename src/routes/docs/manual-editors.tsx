import { component$, useStyles$ } from "@qwik.dev/core";
import { PERSONAS } from "../../utils/personas";
import styles from "./manual-editors.css?inline";

/** Names, roles, marks, and examples stay with the live cast. The portraits
 * are original illustrations of fictional voices, made for this manual. */
const EDITOR_BRIEFS: Record<
  string,
  { narrative: string; ask: string; sampleIndex: number; portraitAlt: string }
> = {
  devil: {
    narrative:
      "She tests the premise your conclusion depends on. Bring her an argument that feels persuasive and ask where it could fail.",
    ask: "What is my weakest assumption, and what is the strongest objection to it?",
    sampleIndex: 0,
    portraitAlt:
      "Ink illustration of a sceptical woman holding a red pencil and manuscript.",
  },
  angel: {
    narrative:
      "She finds the sentence, image, or turn worth protecting. Before a heavy revision, ask what gives this draft its life.",
    ask: "Which passage should I preserve, and how can its strength guide the revision?",
    sampleIndex: 1,
    portraitAlt:
      "Ink illustration of a woman pointing to a passage in a red notebook.",
  },
  scholar: {
    narrative:
      "He distinguishes an assertion from its evidence. Bring him a claim, a statistic, or a slippery term to find exactly what support is owed.",
    ask: "Which claim needs a source, a definition, or a clearer limit?",
    sampleIndex: 2,
    portraitAlt:
      "Ink illustration of an older man with round spectacles comparing two index cards.",
  },
  editor: {
    narrative:
      "He reads for the ear and reaches for the smallest effective cut. Ask him about a sentence that drags or a paragraph that repeats itself.",
    ask: "Where does the rhythm stall, and what is the smallest cut that fixes it?",
    sampleIndex: 0,
    portraitAlt:
      "Ink illustration of a man with a blue pencil poised over a manuscript.",
  },
  reader: {
    narrative:
      "He reads as the audience named in your dossier. Ask where his attention changes and what he expected to learn next.",
    ask: "Where did you lose the thread, and would you keep reading?",
    sampleIndex: 0,
    portraitAlt:
      "Ink illustration of a young man studying a newspaper as he turns a page.",
  },
};

/** Place inside the manual's “Your editors” section, replacing the five
 * individual name headings and descriptions. Styles travel with the component. */
export const ManualEditors = component$(() => {
  useStyles$(styles);

  return (
    <figure class="manual-editors">
      <figcaption class="manual-editors__note">
        Illustrated AI editorial voices
      </figcaption>

      <div class="manual-editors__cast">
        {PERSONAS.map((persona) => {
          const brief = EDITOR_BRIEFS[persona.id];
          if (!brief) return null;
          const sample = persona.sampleLines?.[brief.sampleIndex];
          const nameId = `manual-editor-${persona.id}-name`;

          return (
            <article
              class="manual-editors__profile"
              aria-labelledby={nameId}
              key={persona.id}
            >
              <img
                class="manual-editors__portrait"
                src={`/assets/manual/editors/${persona.id}-transparent.webp`}
                srcset={`/assets/manual/editors/${persona.id}-transparent-480.webp 480w, /assets/manual/editors/${persona.id}-transparent.webp 1122w`}
                sizes="(min-width: 1024px) 144px, (min-width: 768px) 128px, 96px"
                width={1122}
                height={1402}
                loading="eager"
                decoding="async"
                alt={brief.portraitAlt}
              />

              <header class="manual-editors__identity">
                <h3 class="manual-editors__name" id={nameId}>
                  <span
                    class="manual-editors__mark"
                    style={{ color: persona.color }}
                    aria-hidden="true"
                  >
                    {persona.icon}
                  </span>
                  <span>{persona.name}</span>
                </h3>
                <p class="manual-editors__role">{persona.role}</p>
              </header>

              <div class="manual-editors__reading">
                <div class="manual-editors__brief">
                  <p class="manual-editors__narrative">{brief.narrative}</p>
                  <dl class="manual-editors__prompt">
                    <dt>Try asking</dt>
                    <dd>{brief.ask}</dd>
                  </dl>
                </div>

                {sample && (
                  <figure class="manual-editors__signature">
                    <figcaption>In this voice</figcaption>
                    <blockquote>
                      <p>“{sample}”</p>
                    </blockquote>
                  </figure>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </figure>
  );
});
