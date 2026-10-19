/** Editorial role ↔ Typst function names, shared by export and source parsing. */
export const TEXT_ROLE_FUNCTIONS: Record<string, string> = {
  subtitle: "twyne-subtitle",
  kicker: "twyne-kicker",
  standfirst: "twyne-standfirst",
  abstract: "twyne-abstract",
  "character-cue": "twyne-cue",
  "stage-direction": "twyne-direction",
};
export const EPIGRAPH_FUNCTION = "twyne-epigraph";
export const SCENE_BREAK_FUNCTION = "twyne-scene-break";
export const SCENE_BREAK_STYLES = ["ornament", "rule", "space"] as const;
export type SceneBreakStyleName = (typeof SCENE_BREAK_STYLES)[number];

export const ROLE_BY_FUNCTION: Record<string, string> = Object.fromEntries(
  Object.entries(TEXT_ROLE_FUNCTIONS).map(([role, fn]) => [fn, role]),
);
