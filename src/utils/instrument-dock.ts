import type { ScenePassage } from "./scene-bench";
export const INSTRUMENT_DOCK_EVENT = "twyne:instrument-dock";
export type InstrumentDockKind = "tasks" | "scene" | "local" | "entities";
export interface InstrumentDockRequest {
  kind: InstrumentDockKind;
  text?: string;
  passage?: ScenePassage;
}
export function openInstrumentDock(
  kind: InstrumentDockKind,
  text?: string,
  passage?: ScenePassage,
): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent<InstrumentDockRequest>(INSTRUMENT_DOCK_EVENT, {
        detail: { kind, text, passage },
      }),
    );
}
