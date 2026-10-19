/**
 * Piece types ("kits"). A kit chooses which editorial roles the slash menu
 * offers and appends Typst styles after TYPST_EDITORIAL_STYLES. The essay kit
 * is the baseline and adds nothing, so documents without a kit export exactly
 * as they always have.
 */
export type KitId = "essay" | "technical" | "paper" | "play";

export interface VendoredPackage {
  /** Path inside the compiler's virtual filesystem. */
  path: string;
  url: string;
}

export interface Kit {
  id: KitId;
  label: string;
  description: string;
  /** Kit-gated command ids this kit enables (see `kitGated` in the registry). */
  roles: readonly string[];
  /** Appended after TYPST_EDITORIAL_STYLES. */
  typstStyles: string;
  vendoredPackages: readonly VendoredPackage[];
}

const SHARED_ROLES = [
  "role.subtitle",
  "role.kicker",
  "role.standfirst",
  "role.epigraph",
  "role.scene-break",
] as const;

export const KITS: Record<KitId, Kit> = {
  essay: {
    id: "essay",
    label: "Essay",
    description: "Long-form prose with the standard editorial look.",
    roles: SHARED_ROLES,
    typstStyles: "",
    vendoredPackages: [],
  },
  technical: {
    id: "technical",
    label: "Technical",
    description:
      "Sans-serif body, light code blocks with line numbers and highlighting.",
    roles: [...SHARED_ROLES, "paragraph.code-block", "code.highlight-lines"],
    typstStyles: `
#set text(font: ("DM Sans", "DM Sans 9pt"), size: 12pt)
#show raw.where(block: true): set text(fill: rgb("#1f1b16"), size: 10.5pt)
#show raw.where(block: true): set block(width: 100%, fill: rgb("#f4efe3"), stroke: 0.6pt + rgb("#ddd0b1"), inset: (x: 1em, y: 0.7em), radius: 2pt, above: 0.9em, below: 0.9em)
#let twyne-code-numbered = true
`.trim(),
    vendoredPackages: [],
  },
  paper: {
    id: "paper",
    label: "Paper",
    description: "Numbered headings, an abstract, and a compact scholarly text.",
    roles: [...SHARED_ROLES, "role.abstract"],
    typstStyles: `
#set text(font: ("Libertinus Serif", "Lora"), size: 11pt)
#set par(leading: 0.65em, spacing: 1em, justify: true)
#set heading(numbering: "1.1")
`.trim(),
    vendoredPackages: [],
  },
  play: {
    id: "play",
    label: "Play",
    description: "Monospaced script layout with character cues and directions.",
    roles: [...SHARED_ROLES, "role.character-cue", "role.stage-direction"],
    typstStyles: `
#set text(font: "DejaVu Sans Mono", size: 11pt)
#set par(leading: 0.7em, spacing: 0.9em, justify: false)
#show heading: set align(center)
#show heading: set text(font: "DejaVu Sans Mono", weight: 700)
`.trim(),
    vendoredPackages: [],
  },
};

export const KIT_IDS = Object.keys(KITS) as KitId[];

export function resolveKit(id: string | null | undefined): Kit {
  return (id && (KITS as Record<string, Kit>)[id]) || KITS.essay;
}

/** Kits other than the essay pass their id through; essay stays implicit. */
export function kitStyles(id: string | null | undefined): string {
  return resolveKit(id).typstStyles;
}
