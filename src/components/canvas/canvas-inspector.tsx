import { $, component$, type PropFunction } from "@builder.io/qwik";
import type { CanvasNode } from "../../types";
import { clampInspector } from "../../utils/source-canvas";
import { OpenUiRenderer } from "./openui/renderer";

export const CanvasInspector = component$<{ node?: CanvasNode; width: number; onWidth$: PropFunction<(width: number) => void>; onClose$: PropFunction<() => void> }>(({ node, width, onWidth$, onClose$ }) => {
  const resize = $((event: MouseEvent) => {
    const startX = event.clientX; const startWidth = width;
    const move = (next: MouseEvent) => void onWidth$(clampInspector(startWidth + startX - next.clientX));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up); document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  });
  return <aside class="relative hidden h-full shrink-0 flex-col border-l border-[var(--color-paper-3)] bg-[var(--color-paper)] md:flex" style={{ width: `${width}px` }}>
    <div class="absolute -left-1 top-0 h-full w-2 cursor-col-resize" onMouseDown$={resize} title="Drag to resize reference panel" />
    <header class="flex items-center border-b border-[var(--color-paper-3)] px-4 py-3"><span class="flex-1 font-[var(--font-typewriter)] text-[0.68rem] tracking-[0.14em] text-[var(--color-ink-muted)]">REFERENCE</span><button type="button" onClick$={onClose$} aria-label="Close reference panel">×</button></header>
    <div class="min-h-0 flex-1 overflow-auto p-5">{node ? <><h2 class="font-[var(--font-display)] text-xl leading-tight text-[var(--color-ink)]">{node.title}</h2>{node.annotation && <div class="my-4 border-y border-dashed border-[var(--color-paper-3)] py-3"><p class="font-[var(--font-sans)] text-sm leading-relaxed text-[var(--color-ink-light)]">{node.annotation.relevance}</p>{node.annotation.draftAnchor && <blockquote class="mt-2 font-[var(--font-serif)] text-sm italic text-[var(--color-ink-muted)]">“{node.annotation.draftAnchor}”</blockquote>}</div>}{node.ouiLang && <OpenUiRenderer source={node.ouiLang} label={`Full view of ${node.title}`} />}</> : <p class="font-[var(--font-serif)] text-sm text-[var(--color-ink-muted)]">Select a card to review its source and relation to the draft.</p>}</div>
  </aside>;
});
