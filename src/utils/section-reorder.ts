import type { Transaction } from "@tiptap/pm/state";

import type {
  DocumentOutlineHeading,
  DocumentOutlineModel,
} from "./document-outline";

export type SectionDropPlacement = "before" | "after";

export interface SectionMoveRequest {
  sourceId: string;
  targetId: string;
  placement: SectionDropPlacement;
}

/**
 * A top-level ProseMirror range move. `insertAt` is expressed against the
 * document before the section is deleted; `moveSectionRange` maps it through
 * that deletion before inserting the captured content.
 */
export interface SectionMovePlan extends SectionMoveRequest {
  from: number;
  to: number;
  insertAt: number;
}

function insertionBoundary(
  target: DocumentOutlineHeading,
  placement: SectionDropPlacement,
): number {
  return placement === "before" ? target.from : target.to;
}

/**
 * Resolve a semantic heading drop to one complete section-range move.
 *
 * A heading's outline range includes every subordinate heading and its body,
 * so moving that range automatically carries nested sections with the parent.
 * Drops into that same range are rejected: accepting one would either insert
 * a section into itself or make the result depend on transaction mapping.
 * Adjacent boundary drops are rejected too because they are no-ops.
 */
export function planSectionMove(
  outline: DocumentOutlineModel,
  request: SectionMoveRequest,
): SectionMovePlan | null {
  const source = outline.byId[request.sourceId];
  const target = outline.byId[request.targetId];
  if (!source || !target || source === target) return null;

  // A target heading inside the source is always a self-drop, even when its
  // computed "after" boundary happens to equal the parent's closing boundary.
  if (target.from >= source.from && target.from < source.to) return null;

  const insertAt = insertionBoundary(target, request.placement);
  if (insertAt >= source.from && insertAt <= source.to) return null;

  return {
    ...request,
    from: source.from,
    to: source.to,
    insertAt,
  };
}

/**
 * Apply a planned move to an existing transaction.
 *
 * The delete and insert deliberately share one transaction, which makes the
 * operation one ProseMirror history event. Section ranges produced by the
 * outline are block boundaries; an open slice signals an unsupported nested
 * document shape and is rejected without changing the transaction.
 */
export function moveSectionRange(
  tr: Transaction,
  plan: SectionMovePlan,
): boolean {
  if (
    plan.from < 0 ||
    plan.to <= plan.from ||
    plan.to > tr.doc.content.size ||
    plan.insertAt < 0 ||
    plan.insertAt > tr.doc.content.size ||
    (plan.insertAt >= plan.from && plan.insertAt <= plan.to)
  ) {
    return false;
  }

  const section = tr.doc.slice(plan.from, plan.to);
  if (section.openStart !== 0 || section.openEnd !== 0) return false;

  tr.delete(plan.from, plan.to);
  const mappedInsertAt = tr.mapping.map(plan.insertAt, -1);
  tr.insert(mappedInsertAt, section.content);
  tr.setMeta("twyneSectionReorder", {
    sourceId: plan.sourceId,
    targetId: plan.targetId,
    placement: plan.placement,
  });
  tr.scrollIntoView();
  return true;
}
