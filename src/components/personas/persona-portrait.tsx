import { component$, useSignal, useStyles$ } from "@qwik.dev/core";
import {
  resolvePersonaPortrait,
  type PersonaPortraitIdentity,
} from "../../utils/persona-portrait";
import styles from "./persona-portrait.css?inline";

export interface PersonaPortraitProps extends PersonaPortraitIdentity {
  size?: 56 | 64 | 72;
  class?: string;
}

/** Decorative portrait: keep a visible speaker name beside it. */
export const PersonaPortrait = component$<PersonaPortraitProps>((props) => {
  useStyles$(styles);
  const failedSource = useSignal("");
  const identity = resolvePersonaPortrait(props);
  const showImage = identity.src && identity.src !== failedSource.value;
  return (
    <span
      class={["persona-portrait", props.class]}
      style={{ "--persona-portrait-size": `${props.size ?? 64}px` }}
      data-persona-portrait={identity.portraitId ?? "initials"}
      data-portrait-fallback={!showImage ? "true" : undefined}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={identity.src}
          alt=""
          width={480}
          height={600}
          loading="lazy"
          decoding="async"
          onError$={() => {
            failedSource.value = identity.src ?? "";
          }}
        />
      ) : (
        <span class="persona-portrait__initials">{identity.initials}</span>
      )}
    </span>
  );
});

export interface PersonaMastheadProps extends PersonaPortraitProps {
  /** An existing note type or status, distinct from the speaker's role. */
  label?: string;
  onColor?: boolean;
}

/** Speaker identity above a critique; actions remain with the host header. */
export const PersonaMasthead = component$<PersonaMastheadProps>((props) => {
  useStyles$(styles);
  const identity = resolvePersonaPortrait(props);
  return (
    <div
      class={[
        "persona-masthead",
        { "persona-masthead--on-color": props.onColor },
        props.class,
      ]}
    >
      <PersonaPortrait
        personaId={props.personaId}
        name={props.name}
        size={props.size}
      />
      <div class="persona-masthead__identity">
        <p class="persona-masthead__name">{identity.name}</p>
        <p class="persona-masthead__role">{identity.role}</p>
        {props.label && <p class="persona-masthead__label">{props.label}</p>}
      </div>
    </div>
  );
});
