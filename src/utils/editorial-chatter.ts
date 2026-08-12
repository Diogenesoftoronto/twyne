import type { Persona } from "../types";

const PERSONA_WAIT_LINES: Record<string, string> = {
  devil: "Mlle. Sceptique is cross-examining the thesis.",
  angel: "Sœur Encourageante has found one sentence worth protecting.",
  scholar: "Professeur Athenæum is asking that statistic for its papers.",
  editor: "M. Le Stylo is removing an adjective with unnecessary ceremony.",
  reader: "Le Lecteur has missed his stop, which may be a good sign.",
};

const PRESSROOM_LINES = [
  "Blue pencils are being sharpened with intent.",
  "The proof desk has detected a suspiciously comfortable paragraph.",
  "Someone in the room has written “prove it” in the margin.",
  "The galley is making its case before a difficult jury.",
];

export function editorialWaitLines(personas: Persona[]): string[] {
  const cast = personas.map(
    (persona) =>
      PERSONA_WAIT_LINES[persona.id] ??
      `${persona.name} has taken the draft aside for a private word.`,
  );
  return [...cast, ...PRESSROOM_LINES];
}
