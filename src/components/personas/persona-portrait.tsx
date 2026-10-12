import { component$, useSignal, useStyles$ } from "@qwik.dev/core";
import {
  resolvePersonaPortrait,
  type PersonaPortraitIdentity,
} from "../../utils/persona-portrait";
import styles from "./persona-portrait.css?inline";

export interface PersonaPortraitProps extends PersonaPortraitIdentity {
  /** Medallion diameter, or the figure's width, in pixels. */
  size?: number;
  /**
   * `face` crops the engraving to a coloured medallion that stays legible
   * down to a roster chip; `figure` shows the whole engraved editor.
   */
  framing?: "face" | "figure";
  /**
   * `tts` animates the jaw on its own; `live` leaves it to the caller, who
   * writes the voice's amplitude into `--pp-level` (0–1) every frame.
   * Read-aloud elsewhere is picked up by the speech player, not this prop.
   */
  speaking?: "tts" | "live";
  class?: string;
}

/** Decorative portrait: keep a visible speaker name beside it. */
export const PersonaPortrait = component$<PersonaPortraitProps>((props) => {
  useStyles$(styles);
  const failedSource = useSignal("");
  const identity = resolvePersonaPortrait(props);
  const showImage = identity.src && identity.src !== failedSource.value;
  const framing = props.framing ?? "face";
  const focus = identity.focus;
  // The jaw hinges on the lip line, which tilts with the head. Expressed as
  // the line's height at the stage's left and right edges (the stage is 4:5).
  const slope = focus ? Math.tan((focus.tilt * Math.PI) / 180) * 0.8 : 0;
  const size = props.size ?? 64;
  return (
    <span
      class={["persona-portrait", props.class]}
      style={{
        "--persona-portrait-size": `${size}px`,
        "--pp-color": identity.color,
        // Roster chips crop tighter, so a face still reads at 28px.
        "--pp-zoom": size <= 40 ? 2.75 : 2.35,
        ...(focus && {
          "--fx": focus.fx,
          "--fy": focus.fy,
          "--mx": focus.mx,
          "--my": focus.my,
          "--mw": focus.mw,
          "--tilt": `${focus.tilt}deg`,
          "--jaw-y0": `${(focus.my - focus.mx * slope) * 100}%`,
          "--jaw-y1": `${(focus.my + (1 - focus.mx) * slope) * 100}%`,
        }),
      }}
      data-framing={framing}
      data-persona-portrait={identity.portraitId ?? "initials"}
      data-persona-name={identity.name}
      data-portrait-fallback={!showImage ? "true" : undefined}
      data-speaking={props.speaking}
      aria-hidden="true"
    >
      {showImage ? (
        <span class="persona-portrait__stage">
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
          {focus && (
            <>
              <span class="persona-portrait__mouth" />
              <span
                class="persona-portrait__jaw"
                style={{ backgroundImage: `url("${identity.src}")` }}
              />
            </>
          )}
        </span>
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
      style={{ "--pp-color": identity.color }}
    >
      <PersonaPortrait
        personaId={props.personaId}
        name={props.name}
        color={props.color}
        imageUrl={props.imageUrl}
        size={props.size}
        framing={props.framing}
        speaking={props.speaking}
      />
      <div class="persona-masthead__identity">
        <p class="persona-masthead__name">{identity.name}</p>
        <p class="persona-masthead__role">{identity.role}</p>
        {props.label && <p class="persona-masthead__label">{props.label}</p>}
      </div>
    </div>
  );
});
