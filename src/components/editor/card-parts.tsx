import {
  component$,
  Slot,
  useSignal,
  useVisibleTask$,
  type PropFunction,
  type Signal,
} from "@qwik.dev/core";
import { PersonaPortrait } from "../personas/persona-portrait";
import { resolvePersonaPortrait } from "../../utils/persona-portrait";
import { speechState } from "../../utils/speech";
import { PERSONAS } from "../../utils/personas";

/** Open a margin card's full thread on the board, where it has room. */
export const OPEN_FULL_THREAD_EVENT = "twyne:open-full-thread";
export interface OpenFullThreadDetail {
  kind: "note" | "comment";
  id: string;
}
let pending: OpenFullThreadDetail | null = null;
export function openFullThread(detail: OpenFullThreadDetail) {
  // A board panel that was hidden has not mounted its listener yet; it
  // takes the request from here when it first runs.
  pending = detail;
  window.dispatchEvent(
    new CustomEvent<OpenFullThreadDetail>(OPEN_FULL_THREAD_EVENT, { detail }),
  );
}
/**
 * The request a panel of this kind should act on. It is consumed only once
 * `ready` finds the thread, so a panel still loading can try again.
 */
export function takeFullThread(
  kind: OpenFullThreadDetail["kind"],
  detail: OpenFullThreadDetail | undefined,
  ready: (id: string) => boolean,
): OpenFullThreadDetail | null {
  const request = detail ?? pending;
  if (request?.kind !== kind || !ready(request.id)) return null;
  if (pending?.id === request.id) pending = null;
  return request;
}

/*
 * Shared parts of the cards that open beside a marked passage: persona
 * notes, proposed edits and the writer's own margin notes. One bust, one
 * tool row, one menu and one notice, so the three read as a family.
 */

/**
 * The speaker standing on the card's first box. A cast engraving stands as a
 * figure; anyone without one (a custom persona, the writer) gets a face.
 *
 * The card itself never names its speaker. Hovering or focusing the bust
 * lifts a second layer: who they are, what they read for, and the line of
 * method that explains the note.
 */
export const CardBust = component$<{
  name: string;
  personaId?: string;
  imageUrl?: string;
  color?: string;
  speaking?: "tts" | "live";
  activity?: "writing" | "thinking";
  /** Replaces the cast role, e.g. for the writer's own notes. */
  role?: string;
  /** Replaces the cast focus line. */
  detail?: string;
}>((props) => {
  const identity = resolvePersonaPortrait({
    personaId: props.personaId,
    name: props.name,
  });
  const figure = !!identity.portraitId;
  const cast = PERSONAS.find((p) =>
    props.personaId ? p.id === props.personaId : p.name === props.name,
  );
  const role = props.role ?? cast?.role;
  const detail = props.detail ?? cast?.focus;
  const id = `bust-${(props.personaId ?? props.name).replace(/\W+/g, "-")}`;
  return (
    <span
      class={["persona-note__bust", { "is-face": !figure }]}
      tabIndex={0}
      role="img"
      aria-label={role ? `${identity.name}, ${role}` : identity.name}
      aria-describedby={detail ? id : undefined}
    >
      <span class="persona-note__bust-frame">
        <PersonaPortrait
          personaId={props.personaId}
          name={props.name}
          imageUrl={props.imageUrl}
          color={props.color}
          framing={figure ? "figure" : "face"}
          size={figure ? 96 : 40}
          speaking={props.speaking}
          activity={props.activity}
        />
      </span>
      <span class="persona-note__who" id={id} aria-hidden="true">
        <span class="persona-note__who-name">{identity.name}</span>
        {role && <span class="persona-note__who-role">{role}</span>}
        {detail && <span class="persona-note__who-detail">{detail}</span>}
      </span>
    </span>
  );
});

/**
 * A speaker's face where there is no room for them to stand, such as a
 * board card. The same hover layer as the bust names them.
 */
export const SpeakerFace = component$<{
  name: string;
  personaId?: string;
  imageUrl?: string;
  color?: string;
  size?: number;
  speaking?: "tts" | "live";
}>((props) => {
  const identity = resolvePersonaPortrait({
    personaId: props.personaId,
    name: props.name,
  });
  const cast = PERSONAS.find((p) =>
    props.personaId ? p.id === props.personaId : p.name === props.name,
  );
  return (
    <span
      class="speaker-face"
      tabIndex={0}
      role="img"
      aria-label={cast ? `${identity.name}, ${cast.role}` : identity.name}
    >
      <PersonaPortrait
        personaId={props.personaId}
        name={props.name}
        imageUrl={props.imageUrl}
        color={props.color}
        size={props.size ?? 36}
        speaking={props.speaking}
      />
      <span class="persona-note__who persona-note__who--below" aria-hidden="true">
        <span class="persona-note__who-name">{identity.name}</span>
        {cast?.role && (
          <span class="persona-note__who-role">{cast.role}</span>
        )}
        {cast?.focus && (
          <span class="persona-note__who-detail">{cast.focus}</span>
        )}
      </span>
    </span>
  );
});

/** A ⋯ button whose menu closes on Escape, on choice and on leaving it. */
export const CardMenu = component$<{ label?: string }>((props) => {
  const open = useSignal(false);
  return (
    <span
      class="persona-note__menu"
      onFocusOut$={(event, el) => {
        const next = (event as FocusEvent).relatedTarget as Node | null;
        if (!next || !el.contains(next)) open.value = false;
      }}
      onKeyDown$={(event) => {
        if ((event as KeyboardEvent).key === "Escape") open.value = false;
      }}
    >
      <button
        type="button"
        class="persona-note__tool focus-ring"
        aria-label={props.label ?? "More actions"}
        title={props.label ?? "More actions"}
        aria-haspopup="menu"
        aria-expanded={open.value}
        onClick$={() => (open.value = !open.value)}
      >
        <MoreIcon />
      </button>
      {open.value && (
        <span
          class="persona-note__menu-list"
          role="menu"
          onClick$={() => (open.value = false)}
        >
          <Slot />
        </span>
      )}
    </span>
  );
});

/** Why the passage with this speech id would not read aloud, if it would not. */
export function useSpeechError(id: Signal<string>): Signal<string> {
  const error = useSignal("");
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const current = track(id);
    const sync = () => {
      const s = speechState();
      error.value =
        s.id === current && s.status === "error"
          ? s.error?.message || "This could not be read aloud."
          : "";
    };
    sync();
    window.addEventListener("twyne:speech", sync);
    cleanup(() => window.removeEventListener("twyne:speech", sync));
  });
  return error;
}

/**
 * One compact line inside the card: a tinted glyph, the message, and at most
 * one way forward. The card's own colour stays for the persona; tone colours
 * only the glyph and a hairline, so a warning never outshouts the note.
 */
export const CardNotice = component$<{
  tone: "error" | "warning";
  icon?: "alert" | "voice";
  message: string;
  /** The longer reason, on hover; the line itself stays short. */
  detail?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction$?: PropFunction<() => void>;
  onDismiss$?: PropFunction<() => void>;
}>((props) => (
  <div
    class="persona-note__notice"
    data-tone={props.tone}
    role={props.tone === "error" ? "alert" : "status"}
  >
    <span class="persona-note__notice-icon" aria-hidden="true">
      {props.icon === "voice" ? <MutedIcon /> : <AlertIcon />}
    </span>
    <p class="persona-note__notice-text" title={props.detail}>
      {props.message}{" "}
      {props.actionLabel && props.actionHref && (
        <a
          href={props.actionHref}
          class="persona-note__notice-action focus-ring"
        >
          {props.actionLabel}
        </a>
      )}
    </p>
    {props.actionLabel && !props.actionHref && props.onAction$ && (
      <button
        type="button"
        class="persona-note__notice-retry focus-ring"
        aria-label={props.actionLabel}
        title={props.actionLabel}
        onClick$={props.onAction$}
      >
        <RetryIcon />
      </button>
    )}
    {props.onDismiss$ && (
      <button
        type="button"
        class="persona-note__notice-dismiss focus-ring"
        aria-label="Dismiss"
        title="Dismiss"
        onClick$={props.onDismiss$}
      >
        <CloseIcon />
      </button>
    )}
  </div>
));

export function AlertIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        d="M12 7v6"
        stroke="var(--color-paper)"
        stroke-width="2.4"
        stroke-linecap="round"
      />
      <circle cx="12" cy="17" r="1.4" fill="var(--color-paper)" />
    </svg>
  );
}

export function RetryIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

export function MutedIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="2"
        width="6"
        height="12"
        rx="3"
        fill="currentColor"
        stroke="none"
      />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function StrikeIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12h16" />
      <path d="M16.5 7.5C15.6 6 14 5.2 12 5.2c-2.6 0-4.4 1.3-4.4 3.2 0 1 .5 1.8 1.5 2.4" />
      <path d="M8 16.3c.8 1.6 2.4 2.5 4.4 2.5 2.7 0 4.5-1.3 4.5-3.3 0-.7-.2-1.3-.7-1.8" />
    </svg>
  );
}

/** The same diagonal arrows as the board's "Open the full note". */
export function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
    </svg>
  );
}

const glyph = (paths: string, width = 1.8) =>
  function Glyph() {
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width={width}
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        dangerouslySetInnerHTML={paths}
      />
    );
  };
export const ReplyIcon = glyph('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>');
export const LaterIcon = glyph('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>');
export const FixIcon = glyph('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>');
export const UpIcon = glyph('<path d="M7 10v10H4V10h3Z"/><path d="M7 10l4-7a2 2 0 0 1 3 1.7V9h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7"/>');
export const DownIcon = glyph('<path d="M17 14V4h3v10h-3Z"/><path d="M17 14l-4 7a2 2 0 0 1-3-1.7V15H5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.2 4H17"/>');
export const FileIcon = glyph('<path d="M6 3h12v18l-6-4-6 4V3Z"/>');
