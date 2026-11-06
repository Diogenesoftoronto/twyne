import {
  component$,
  useStore,
  useStyles$,
  useVisibleTask$,
} from "@qwik.dev/core";
import type { Persona } from "../../types";
import { editorialWaitLines } from "../../utils/editorial-chatter";
import { PersonaPortrait } from "../personas/persona-portrait";
import styles from "./editorial-loader.css?inline";

interface EditorialLoaderProps {
  personas: Persona[];
  label: string;
  compact?: boolean;
}

/** A quiet, rotating bit of pressroom theatre for genuinely long waits. */
export const EditorialLoader = component$<EditorialLoaderProps>((props) => {
  useStyles$(styles);
  const store = useStore({ index: 0 });
  const lines = editorialWaitLines(props.personas);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    if (lines.length < 2) return;
    const timer = window.setInterval(() => {
      store.index = (store.index + 1) % lines.length;
    }, 3200);
    cleanup(() => window.clearInterval(timer));
  });

  return (
    <div
      class={[
        "editorial-loader",
        { "editorial-loader--compact": props.compact },
      ]}
      role="status"
      aria-live="polite"
    >
      <div class="editorial-loader__scene" aria-hidden="true">
        <span class="editorial-loader__sheet editorial-loader__sheet--back" />
        <span class="editorial-loader__sheet">
          <span class="editorial-loader__rule" data-ambient />
          <span class="editorial-loader__rule" data-ambient />
          <span class="editorial-loader__rule" data-ambient />
          <span class="editorial-loader__rule" data-ambient />
        </span>
        <span class="editorial-loader__mark" data-ambient />
      </div>
      {props.personas.length > 0 && (
        <div class="editorial-loader__cast" aria-hidden="true">
          {props.personas.map((persona, index) => (
            <span
              key={persona.id}
              class="editorial-loader__resident"
              data-ambient
              style={{ "--reader-index": index }}
            >
              <PersonaPortrait
                personaId={persona.id}
                name={persona.name}
                color={persona.color}
                imageUrl={persona.imageUrl}
                size={32}
              />
            </span>
          ))}
        </div>
      )}
      <p class="editorial-loader__label">{props.label}</p>
      <p class="editorial-loader__aside" aria-hidden="true">
        {lines[store.index % lines.length]}
      </p>
    </div>
  );
});
