/** Source editing needs validation even when its proof pane is hidden. */
export function isTypstProofActive(
  mode: "write" | "source" | "proof",
  split: boolean,
): boolean {
  return mode !== "write" || split;
}
