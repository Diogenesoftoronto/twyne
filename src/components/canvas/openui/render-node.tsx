import { component$, type JSXOutput } from "@builder.io/qwik";
import type { ElementNode } from "@openuidev/lang-core";
import { canvasLibrary } from "./library";
import type { CanvasBlockProps, CanvasComponent } from "./primitives";

function isElementNode(value: unknown): value is ElementNode {
  return !!value && typeof value === "object" && (value as ElementNode).type === "element";
}

export const OpenUiRenderNode = component$<{ node: unknown }>(({ node }) => {
  if (node == null || node === false) return null;
  if (typeof node === "string" || typeof node === "number") return <>{node}</>;
  if (Array.isArray(node)) {
    return <>{node.map((child, index) => <OpenUiRenderNode key={index} node={child} />)}</>;
  }
  if (!isElementNode(node)) return null;

  const definition = canvasLibrary.components[node.typeName];
  if (!definition) {
    return (
      <div role="status" class="font-[var(--font-typewriter)] text-[0.65rem] text-[var(--color-ink-muted)]">
        Unsupported block: {node.typeName}
      </div>
    );
  }

  const Block = definition.component as CanvasComponent;
  const renderNode = (value: unknown): JSXOutput => <OpenUiRenderNode node={value} />;
  const props: CanvasBlockProps<Record<string, unknown>> = {
    props: node.props,
    renderNode,
    statementId: node.statementId,
  };

  return (
    <div aria-busy={node.partial ? "true" : undefined} data-openui-partial={node.partial ? "true" : undefined}>
      <Block {...props} />
    </div>
  );
});

