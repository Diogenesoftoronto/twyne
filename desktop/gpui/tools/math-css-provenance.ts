import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

export interface MathCssConsumers {
  globalMermaid: string;
  equation: string;
  sourcePreview: string;
}

const marker = ".katex .katex-version:after";
const equationScope = ".twyne-math";
const previewScope = ".twyne-math-source-preview";

/** Read version annotations for the three real consumers separately.
 * This is stylesheet provenance, never a layout/pixel compatibility certificate.
 * Only the supported vendor marker selectors participate; conditional markers
 * are unresolved because a browser's media/environment is not supplied here. */
export function mathCssConsumers(css: string): MathCssConsumers {
  type Candidate = {
    value: string;
    scoped: boolean;
    important: boolean;
    order: number;
  };
  const rows: Record<keyof MathCssConsumers, Candidate[]> = {
    globalMermaid: [],
    equation: [],
    sourcePreview: [],
  };
  let order = 0;
  try {
    postcss.parse(css).walkRules((rule) => {
      if (!rule.selector.includes("katex-version")) return;
      const selectors: string[] = [];
      selectorParser((root) => {
        root.each((selector) => {
          selectors.push(selector.toString().trim().replace(/\s+/g, " "));
        });
      }).processSync(rule.selector);
      rule.walkDecls("content", (declaration) => {
        const version =
          /^(["'])(\d+\.\d+\.\d+)\1$/.exec(declaration.value.trim())?.[2] ??
          "unknown";
        for (const selector of selectors) {
          let consumers: (keyof MathCssConsumers)[] = [];
          let scoped = true;
          if (selector === marker) {
            consumers = ["globalMermaid", "equation", "sourcePreview"];
            scoped = false;
          } else if (selector === `${equationScope} ${marker}`) {
            consumers = ["equation"];
          } else if (selector === `${previewScope} ${marker}`) {
            consumers = ["sourcePreview"];
          } else if (
            selector === `:is(${equationScope},${previewScope}) ${marker}` ||
            selector === `:is(${equationScope}, ${previewScope}) ${marker}`
          ) {
            consumers = ["equation", "sourcePreview"];
          }
          for (const consumer of consumers) {
            rows[consumer].push({
              value: rule.parent?.type === "root" ? version : "unknown",
              scoped,
              important: declaration.important ?? false,
              order: order++,
            });
          }
        }
      });
    });
  } catch {
    return {
      globalMermaid: "unknown",
      equation: "unknown",
      sourcePreview: "unknown",
    };
  }
  const effective = (candidates: Candidate[]) => {
    candidates.sort(
      (a, b) =>
        Number(a.important) - Number(b.important) ||
        Number(a.scoped) - Number(b.scoped) ||
        a.order - b.order,
    );
    return candidates.at(-1)?.value ?? "unknown";
  };
  return {
    globalMermaid: effective(rows.globalMermaid),
    equation: effective(rows.equation),
    sourcePreview: effective(rows.sourcePreview),
  };
}
