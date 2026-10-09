import { PERSONAS } from "./personas";

const PORTRAIT_IDS = ["devil", "angel", "scholar", "editor", "reader"] as const;
export type PersonaPortraitId = (typeof PORTRAIT_IDS)[number];

export interface PersonaPortraitIdentity {
  personaId?: string | null;
  name?: string | null;
  role?: string | null;
}

/** An explicit unknown ID must never borrow a resident's face by name. */
export function resolvePersonaPortrait(input: PersonaPortraitIdentity) {
  const hasId = input.personaId != null;
  const resident = hasId
    ? PERSONAS.find((persona) => persona.id === input.personaId)
    : PERSONAS.find((persona) => persona.name === input.name);
  const portraitId = PORTRAIT_IDS.find((id) => id === resident?.id);
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
    portraitId,
    src: portraitId
      ? `/assets/manual/editors/${portraitId}-transparent-480.webp`
      : undefined,
    attribution: portraitId ? (hasId ? "id" : "exact-name") : "initials",
  } as const;
}
