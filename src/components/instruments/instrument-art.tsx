import { component$, useStyles$ } from "@qwik.dev/core";
import styles from "./instrument-art.css?inline";

export const INSTRUMENT_ART = {
  "sentence-bench": {
    src: "/assets/instruments/sentence-bench-v1.webp",
    description:
      "Two wording slips at a composing stick, with an editorial pencil.",
  },
  threads: {
    src: "/assets/instruments/threads-v1.webp",
    description: "Two passages joined by a single red thread.",
  },
  research: {
    src: "/assets/instruments/research-v1.webp",
    description: "An open source dossier, with passages marked for comparison.",
  },
  scene: {
    src: "/assets/instruments/scene-v1.webp",
    description: "A small paper stage that frames a scene from the manuscript.",
  },
} as const;

export type InstrumentArtKind = keyof typeof INSTRUMENT_ART;

export interface InstrumentArtProps {
  kind: InstrumentArtKind;
  size?: "compact" | "standard" | "large";
  /** Omit beside a descriptive heading. Supply only when the art adds meaning. */
  label?: string;
  class?: string;
}

/** A quiet illustration, independent of model availability or task state. */
export const InstrumentArt = component$<InstrumentArtProps>((props) => {
  useStyles$(styles);
  const art = INSTRUMENT_ART[props.kind];
  return (
    <span
      class={["instrument-art", props.class]}
      data-instrument-art={props.kind}
      data-size={props.size ?? "standard"}
      aria-hidden={props.label ? undefined : "true"}
    >
      <img
        class="instrument-art__image"
        src={art.src}
        alt={props.label ?? ""}
        width={512}
        height={512}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </span>
  );
});

/** Optional paper tooth for an instrument's own illustration area. */
export const InstrumentTexture = component$<{ class?: string }>((props) => {
  useStyles$(styles);
  return (
    <span class={["instrument-art__texture", props.class]} aria-hidden="true" />
  );
});

/** A printed rule under an arrived result. It carries no status by itself. */
export const InstrumentRule = component$<{ class?: string }>((props) => {
  useStyles$(styles);
  return (
    <span class={["instrument-art__rule", props.class]} aria-hidden="true" />
  );
});
