import { component$ } from "@builder.io/qwik";
import type { CanvasEdge, CanvasNode } from "../../types";

const EDGE_COLOR: Record<CanvasEdge["kind"], string> = {
  supports: "var(--color-accent-green)", complicates: "var(--color-accent-amber)",
  contradicts: "var(--color-accent-red)", extends: "var(--color-cobalt)",
  "same-topic": "var(--color-ink-muted)", manual: "var(--color-ink)",
};

export const CanvasEdges = component$<{ nodes: CanvasNode[]; edges: CanvasEdge[] }>((props) => {
  const byId = new Map(props.nodes.map((node) => [node.id, node]));
  return (
    <svg class="pointer-events-none absolute inset-0 overflow-visible" width="1" height="1" aria-hidden="true">
      <defs><marker id="canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="context-stroke" /></marker></defs>
      {props.edges.map((edge) => {
        const from = byId.get(edge.from); const to = byId.get(edge.to);
        if (!from || !to) return null;
        const x1 = from.x + from.w; const y1 = from.y + from.h / 2;
        const x2 = to.x; const y2 = to.y + to.h / 2;
        const bend = Math.max(42, Math.abs(x2 - x1) * 0.42);
        return <path key={edge.id} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} fill="none" stroke={EDGE_COLOR[edge.kind]} stroke-width="1.5" stroke-dasharray={edge.kind === "same-topic" ? "5 5" : undefined} marker-end="url(#canvas-arrow)" />;
      })}
    </svg>
  );
});

