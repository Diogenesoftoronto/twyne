import type { Persona } from "../types";

/**
 * The Cast — five resident editors of The Editorial Room.
 * Naming nods to a 1955 magazine bullpen; functional ids are kept
 * unchanged so downstream feedback logic continues to address them.
 */
export const PERSONAS: Persona[] = [
  {
    id: "devil",
    name: "Mlle. Sceptique",
    role: "The Devil's Advocate",
    color: "var(--color-persona-devil)",
    icon: "♠",
    description:
      "Hunts the unstated assumption, the soft claim, the argument that quietly evades its strongest objection.",
    focus: "Logic, argument, the load-bearing weakness",
  },
  {
    id: "angel",
    name: "Sœur Encourageante",
    role: "The Patron of Strengths",
    color: "var(--color-persona-angel)",
    icon: "♥",
    description:
      "Reads for the alive paragraph — the one with a real sentence in it — and tells you to protect it.",
    focus: "Strengths, resonance, what to keep at all costs",
  },
  {
    id: "scholar",
    name: "Professeur Athenæum",
    role: "The Scholar",
    color: "var(--color-persona-scholar)",
    icon: "♦",
    description:
      "Points to where citation is owed, where evidence wants weight, where definition would clean a sentence.",
    focus: "Evidence, citation, scholarly rigor",
  },
  {
    id: "editor",
    name: "M. Le Stylo",
    role: "The Copy Chief",
    color: "var(--color-persona-editor)",
    icon: "✦",
    description:
      "Carries the blue pencil. Catches diction, rhythm, repetition, and any sentence that does not earn its place.",
    focus: "Style, rhythm, concision, the cut",
  },
  {
    id: "reader",
    name: "Le Lecteur",
    role: "The Target Reader",
    color: "var(--color-persona-reader)",
    icon: "♣",
    description:
      "Reads as your stated audience would — confused here, engaged there, won over (or not) by the close.",
    focus: "Comprehension, engagement, audience fit",
  },
];
