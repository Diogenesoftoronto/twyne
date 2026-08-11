import { $, component$, useSignal, useStore, useStylesScoped$, type PropFunction } from "@builder.io/qwik";
import type { CanvasNode, SourceCanvas as SourceCanvasState } from "../../types";
import { clampZoom } from "../../utils/source-canvas";
import { CanvasCard } from "./canvas-card";
import { CanvasEdges } from "./canvas-edges";
import { CanvasInspector } from "./canvas-inspector";

export const SourceCanvas = component$<{ canvas: SourceCanvasState; onChange$: PropFunction<(canvas: SourceCanvasState) => void>; onMap$?: PropFunction<() => void>; onRetry$?: PropFunction<() => void>; status?: string }>(({ canvas, onChange$, onMap$, onRetry$, status }) => {
  useStylesScoped$(`.board{background-color:var(--color-paper-soft);background-image:radial-gradient(var(--color-paper-3) .7px,transparent .7px);background-size:18px 18px}.stage{transform-origin:0 0;will-change:transform}@media(prefers-reduced-motion:reduce){.stage{will-change:auto}}`);
  const selected = useSignal<string>();
  const inspectorOpen = useSignal(!canvas.expanded);
  const pan = useStore({ active: false, x: 0, y: 0, originX: 0, originY: 0 });
  const updateNode = $((node: CanvasNode) => onChange$({ ...canvas, nodes: canvas.nodes.map((item) => item.id === node.id ? node : item) }));
  const beginPan = $((event: PointerEvent) => { if (event.target !== event.currentTarget) return; pan.active = true; pan.x = event.clientX; pan.y = event.clientY; pan.originX = canvas.viewport.x; pan.originY = canvas.viewport.y; });
  const movePan = $((event: PointerEvent) => { if (!pan.active) return; void onChange$({ ...canvas, viewport: { ...canvas.viewport, x: pan.originX + event.clientX - pan.x, y: pan.originY + event.clientY - pan.y } }); });
  const endPan = $(() => { pan.active = false; });
  const wheel = $((event: WheelEvent) => { event.preventDefault(); const zoom = clampZoom(canvas.viewport.zoom * (event.deltaY > 0 ? .9 : 1.1)); void onChange$({ ...canvas, viewport: { ...canvas.viewport, zoom } }); });
  const chosen = canvas.nodes.find((node) => node.id === selected.value);
  return <section class={`flex overflow-hidden border border-[var(--color-paper-3)] bg-[var(--color-paper)] ${canvas.expanded ? "fixed inset-0 z-40 h-screen" : "h-[min(74vh,860px)] min-h-[520px]"}`} aria-label="Research source canvas">
    <div class="relative min-w-0 flex-1 overflow-hidden">
      <div class="absolute left-3 top-3 z-20 flex items-center gap-1 border border-[var(--color-paper-3)] bg-[var(--color-paper)] p-1 font-[var(--font-typewriter)] text-[0.66rem]">
        {onMap$ && <button type="button" class="px-2 py-1 hover:bg-[var(--color-paper-soft)]" onClick$={onMap$}>✦ Map connections</button>}
        <button type="button" class="px-2 py-1 hover:bg-[var(--color-paper-soft)]" onClick$={() => onChange$({ ...canvas, expanded: !canvas.expanded })}>{canvas.expanded ? "Restore view" : "Expand board"}</button>
        {!inspectorOpen.value && <button type="button" class="px-2 py-1" onClick$={() => { inspectorOpen.value = true; }}>Open reference</button>}
        {status && <span role="status" class="px-2 text-[var(--color-ink-muted)]">{status}</span>}
        {onRetry$ && status && /failed|check/i.test(status) && <button type="button" class="border-l border-[var(--color-paper-3)] px-2 py-1 text-[var(--color-vermilion)]" onClick$={onRetry$}>Retry extraction</button>}
      </div>
      <div class="board absolute inset-0 cursor-grab active:cursor-grabbing" onPointerDown$={beginPan} onPointerMove$={movePan} onPointerUp$={endPan} onPointerCancel$={endPan} onWheel$={wheel}>
        <div class="stage absolute left-0 top-0" style={{ transform: `translate(${canvas.viewport.x}px,${canvas.viewport.y}px) scale(${canvas.viewport.zoom})` }}>
          <CanvasEdges nodes={canvas.nodes} edges={canvas.edges} />
          {canvas.nodes.map((node) => <CanvasCard key={node.id} node={node} selected={selected.value === node.id} onSelect$={(id) => { selected.value = id; inspectorOpen.value = true; }} onChange$={updateNode} />)}
        </div>
      </div>
      <div class="absolute bottom-3 right-3 z-20 border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1 font-[var(--font-typewriter)] text-[0.64rem] text-[var(--color-ink-muted)]">{Math.round(canvas.viewport.zoom * 100)}%</div>
    </div>
    {inspectorOpen.value && !canvas.expanded && <CanvasInspector node={chosen} width={canvas.inspectorWidth} onWidth$={(width) => onChange$({ ...canvas, inspectorWidth: width })} onClose$={() => { inspectorOpen.value = false; }} />}
  </section>;
});
