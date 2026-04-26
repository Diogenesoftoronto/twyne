import type { Persona } from "../types";

export const PERSONAS: Persona[] = [
  {
    id: "devil",
    name: "The Devil's Advocate",
    role: "Challenger",
    color: "var(--color-persona-devil)",
    icon: "😈",
    description: "Finds weaknesses, logical gaps, and counterarguments you haven't considered.",
    focus: "Logic, argumentation, unstated assumptions",
  },
  {
    id: "angel",
    name: "The Encourager",
    role: "Supporter",
    color: "var(--color-persona-angel)",
    icon: "😇",
    description: "Highlights what's working beautifully and where your writing shines.",
    focus: "Strengths, effective passages, emotional resonance",
  },
  {
    id: "scholar",
    name: "The Scholar",
    role: "Researcher",
    color: "var(--color-persona-scholar)",
    icon: "🎓",
    description: "Checks claims, suggests citations, and points out where evidence is needed.",
    focus: "Evidence, citations, factual accuracy, depth",
  },
  {
    id: "editor",
    name: "The Copy Editor",
    role: "Polisher",
    color: "var(--color-persona-editor)",
    icon: "✏️",
    description: "Catches grammar, style, clarity, and flow issues at the sentence level.",
    focus: "Grammar, style, clarity, concision, flow",
  },
  {
    id: "reader",
    name: "The Target Reader",
    role: "Audience",
    color: "var(--color-persona-reader)",
    icon: "📖",
    description: "Reads as your intended audience would — confused here, engaged there, moved here.",
    focus: "Comprehension, engagement, pacing, audience fit",
  },
];
