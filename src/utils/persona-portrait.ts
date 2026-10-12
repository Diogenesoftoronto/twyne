import { PERSONAS } from "./personas";

const PORTRAIT_IDS = ["devil", "angel", "scholar", "editor", "reader"] as const;
export type PersonaPortraitId = (typeof PORTRAIT_IDS)[number];

export interface PersonaPortraitIdentity {
  personaId?: string | null;
  name?: string | null;
  role?: string | null;
  /** A custom persona's colour; residents always wear their own. */
  color?: string | null;
  /** A custom editor's uploaded portrait; residents keep their engravings. */
  imageUrl?: string | null;
}

/**
 * Where each engraving's face sits, as fractions of the 480×600 source:
 * the face centre (`fx`, `fy`) frames the medallion, and the lip line
 * (`mx`, `my`, `mw` wide, tilted `tilt` degrees) is where the jaw hinges
 * when the editor speaks. Measured by eye against a 5px grid.
 */
export interface PortraitFocus {
  fx: number;
  fy: number;
  mx: number;
  my: number;
  mw: number;
  tilt: number;
}

const FOCUS: Record<PersonaPortraitId, PortraitFocus> = {
  devil: { fx: 0.406, fy: 0.25, mx: 0.427, my: 0.342, mw: 0.083, tilt: -14 },
  angel: { fx: 0.54, fy: 0.29, mx: 0.585, my: 0.352, mw: 0.098, tilt: -15 },
  scholar: { fx: 0.52, fy: 0.28, mx: 0.527, my: 0.348, mw: 0.075, tilt: -8 },
  editor: { fx: 0.53, fy: 0.25, mx: 0.5, my: 0.352, mw: 0.083, tilt: 12 },
  reader: { fx: 0.55, fy: 0.29, mx: 0.5, my: 0.342, mw: 0.088, tilt: 18 },
};

/** An explicit unknown ID must never borrow a resident's face by name. */
export function resolvePersonaPortrait(input: PersonaPortraitIdentity) {
  const hasId = input.personaId != null;
  const resident = hasId
    ? PERSONAS.find((persona) => persona.id === input.personaId)
    : PERSONAS.find((persona) => persona.name === input.name);
  const portraitId = PORTRAIT_IDS.find((id) => id === resident?.id);
  const color =
    (portraitId ? resident?.color : input.color?.trim()) ||
    "var(--color-ink-light)";
  const name = input.name?.trim() || resident?.name || "Unnamed persona";
  const role = input.role?.trim() || resident?.role || "Editorial voice";
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toLocaleUpperCase();

  return {
    name,
    role,
    initials: initials || "?",
    color,
    portraitId,
    focus: portraitId ? FOCUS[portraitId] : undefined,
    src: portraitId
      ? `/assets/manual/editors/${portraitId}-transparent-480.webp`
      : input.imageUrl || undefined,
    attribution: portraitId ? (hasId ? "id" : "exact-name") : "initials",
  } as const;
}
