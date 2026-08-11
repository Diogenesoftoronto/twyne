import { $, component$, type PropFunction } from "@builder.io/qwik";
import type { CanvasNode } from "../../types";
import { OpenUiRenderer } from "./openui/renderer";

export const CanvasCard = component$<{
  node: CanvasNode;
  selected: boolean;
  onSelect$: PropFunction<(id: string) => void>;
  onChange$: PropFunction<(node: CanvasNode) => void>;
}>(({ node, selected, onSelect$, onChange$ }) => {
  const beginMove = $((event: PointerEvent) => {
    event.stopPropagation();
    const startX = event.clientX; const startY = event.clientY;
    const start = { x: node.x, y: node.y };
    const move = (next: PointerEvent) => void onChange$({ ...node, x: start.x + next.clientX - startX, y: start.y + next.clientY - startY, pinned: true });
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.body.style.userSelect = ""; };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.body.style.userSelect = "none";
  });
  const beginResize = $((event: PointerEvent) => {
    event.stopPropagation();
    const startX = event.clientX; const startY = event.clientY; const start = { w: node.w, h: node.h };
    const move = (next: PointerEvent) => void onChange$({ ...node, w: Math.max(220, start.w + next.clientX - startX), h: Math.max(120, start.h + next.clientY - startY), pinned: true });
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.body.style.userSelect = ""; };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.body.style.userSelect = "none";
  });
  const stance = node.annotation?.stance ?? "background";
  return (
    <article class={`absolute overflow-hidden bg-[var(--color-paper)] ${selected ? "outline outline-2 outline-[var(--color-vermilion)]" : "border border-[var(--color-paper-3)]"}`} style={{ transform: `translate(${node.x}px, ${node.y}px)`, width: `${node.w}px`, height: `${node.collapsed ? 42 : node.h}px` }} onClick$={() => onSelect$(node.id)}>
      <header class="flex h-[42px] cursor-grab items-center gap-2 border-b border-dashed border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 active:cursor-grabbing" onPointerDown$={beginMove}>
        <span class="h-2 w-2 rounded-full" style={{ background: stance === "supports" ? "var(--color-accent-green)" : stance === "contradicts" ? "var(--color-accent-red)" : stance === "complicates" ? "var(--color-accent-amber)" : "var(--color-ink-muted)" }} />
        <strong class="min-w-0 flex-1 truncate font-[var(--font-typewriter)] text-[0.7rem] tracking-wide text-[var(--color-ink)]">{node.title}</strong>
        {node.streaming && <span class="font-[var(--font-typewriter)] text-[0.6rem] text-[var(--color-vermilion)]">writing…</span>}
        <button type="button" aria-label={node.collapsed ? "Expand card" : "Collapse card"} class="px-1 text-[var(--color-ink-muted)]" onPointerDown$={(e) => e.stopPropagation()} onClick$={() => onChange$({ ...node, collapsed: !node.collapsed })}>{node.collapsed ? "+" : "−"}</button>
      </header>
      {!node.collapsed && <div class="h-[calc(100%-42px)] overflow-auto p-3">{node.ouiLang ? <OpenUiRenderer source={node.ouiLang} /> : <p class="font-[var(--font-serif)] text-sm leading-relaxed text-[var(--color-ink-light)]">{node.annotation?.relevance ?? "Source queued for extraction."}</p>}</div>}
      {!node.collapsed && <button type="button" aria-label="Resize card" class="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize text-[var(--color-ink-muted)]" onPointerDown$={beginResize}>⌟</button>}
    </article>
  );
});

