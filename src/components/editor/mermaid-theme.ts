/**
 * The one mermaid configuration every Twyne surface shares — the manuscript
 * renderer in the editor and the live preview in the insert dialog.
 *
 * `theme: "base"` with editorial variables keeps diagrams reading as part of
 * the manuscript (ink lines, serif labels) instead of mermaid's default
 * cartoon palette. Concrete values, not CSS vars: mermaid bakes these into
 * SVG attributes where `var()` won't resolve.
 */
export function initializeTwyneMermaid(): Promise<void> {
  return import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        fontFamily: "Lora, 'Crimson Pro', Georgia, 'Times New Roman', serif",
        primaryColor: "#f4ecd8",
        primaryBorderColor: "#1f1b16",
        primaryTextColor: "#1f1b16",
        secondaryColor: "#efe6cf",
        secondaryBorderColor: "#1f1b16",
        secondaryTextColor: "#1f1b16",
        tertiaryColor: "#f4ecd8",
        tertiaryBorderColor: "#c1272d",
        tertiaryTextColor: "#1f1b16",
        lineColor: "#1f1b16",
        textColor: "#1f1b16",
        mainBkg: "#f4ecd8",
        nodeBorder: "#1f1b16",
        clusterBkg: "#efe6cf",
        clusterBorder: "#1f1b16",
        edgeLabelBackground: "#f4ecd8",
      },
    });
  });
}

/** Render a diagram source to standalone SVG. Throws on syntax errors. */
export async function renderTwyneMermaid(
  id: string,
  source: string,
): Promise<string> {
  await initializeTwyneMermaid();
  const { default: mermaid } = await import("mermaid");
  const { svg } = await mermaid.render(id, source);
  return svg;
}
