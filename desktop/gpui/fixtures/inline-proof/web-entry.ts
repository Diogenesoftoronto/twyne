// Browser verification entry. Bundled locally by capture-web.ts; never shipped
// as an implicit system-browser dependency of the desktop application.
import { renderLatex } from "../../../../src/components/editor/math/math-renderer";
import { initializeTwyneMermaid } from "../../../../src/components/editor/mermaid-theme";
import mermaid from "mermaid";

type Fixture = {
  kind: string;
  source: string;
  block: boolean;
  font_size_px: number;
  width_px: number;
  color: number;
};

Object.assign(window, {
  async renderInlineFixture(fixture: Fixture) {
    const host = document.querySelector<HTMLElement>("#fixture")!;
    host.replaceChildren();
    host.style.width = `${fixture.width_px}px`;
    host.style.fontSize = `${fixture.font_size_px}px`;
    host.style.color = `#${fixture.color.toString(16).padStart(6, "0")}`;
    if (fixture.kind === "latex") {
      const result = await renderLatex(
        fixture.source,
        fixture.block ? "block" : "inline",
      );
      const atom = document.createElement(fixture.block ? "div" : "span");
      atom.className = `twyne-math twyne-math-${fixture.block ? "block" : "inline"}`;
      const render = document.createElement("span");
      render.className = result.error
        ? "twyne-math-render twyne-math-error"
        : "twyne-math-render";
      if (result.error) {
        const label = document.createElement("strong");
        label.textContent = "Invalid LaTeX";
        const source = document.createElement("code");
        source.className = "twyne-math-error-source";
        source.textContent = fixture.source;
        render.append(label, source);
      } else {
        render.innerHTML = result.html;
      }
      atom.append(render);
      host.append(atom);
      await document.fonts.ready;
      const box = render.getBoundingClientRect();
      return {
        error: result.error,
        width: box.width,
        height: box.height,
        engine: "actual KaTeX Write renderer",
      };
    }
    if (fixture.kind === "mermaid") {
      await document.fonts.load("16px Lora");
      await document.fonts.ready;
      await initializeTwyneMermaid();
      const configuration = mermaid.mermaidAPI.getConfig();
      mermaid.initialize({
        ...configuration,
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        flowchart: { ...configuration.flowchart, htmlLabels: false },
      });
      try {
        const { svg } = await mermaid.render(
          "twyne-inline-proof-fixture",
          fixture.source,
        );
        host.innerHTML = svg;
        await document.fonts.ready;
        const box = host.querySelector("svg")!.getBoundingClientRect();
        return {
          svg,
          width: box.width,
          height: box.height,
          engine: "actual Mermaid proof renderer",
        };
      } finally {
        mermaid.initialize(configuration);
      }
    }
    throw new Error(`No browser fixture renderer for ${fixture.kind}`);
  },
});
