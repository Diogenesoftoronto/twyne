/**
 * One surface per note.
 *
 * When the flow surface has its room rail on screen, a writer comment or a
 * persona note already has a card level with its passage. Opening its
 * conversation must not raise a second, differently placed card: the
 * conversation unfolds in the card's own slot, and the card steps aside
 * while it is open. The editor owns the conversations (reply, resolve,
 * persona threads); the flow surface owns the margin. This module is the
 * handshake between the two, so neither has to import the other.
 */

/** Where an unfolded conversation sits, in viewport pixels (it is fixed). */
export interface MarginSlot {
  left: number;
  top: number;
  width: number;
  maxH: number;
}

export interface MarginSurface {
  /** The room rail is on screen and carrying notes. */
  active(): boolean;
  /**
   * Place the item's card if it is waiting (or was set aside), then say where
   * its thread opens. `anchorTop` is the passage's viewport top, used when the
   * item has no card at all — a resolved comment, say.
   */
  reveal(itemId: string, anchorTop: number): Promise<MarginSlot | null>;
  /** The item whose conversation is open over its card, or null. */
  setOpen(itemId: string | null): void;
}

/** Fired by the surface whenever the open card's slot moves (scroll, reflow). */
export const MARGIN_SLOT_EVENT = "twyne:margin-slot";
export interface MarginSlotDetail {
  itemId: string;
  slot: MarginSlot;
}

/** Fired by the surface when the writer opens a card's conversation from the card. */
export const OPEN_MARGIN_THREAD_EVENT = "twyne:open-margin-thread";
export interface OpenMarginThreadDetail {
  kind: "comment" | "note";
  id: string;
}

let current: MarginSurface | null = null;

export function registerMarginSurface(surface: MarginSurface): () => void {
  current = surface;
  return () => {
    if (current === surface) current = null;
  };
}

/** The live surface, but only while it is actually taking notes. */
export function marginSurface(): MarginSurface | null {
  return current?.active() ? current : null;
}

/** Tell the surface which card's conversation is open (null: none). */
export function setMarginThread(itemId: string | null): void {
  current?.setOpen(itemId);
}

/** Popover placement for a slot: the shape the editor's cards already take. */
export function slotPlacement(slot: MarginSlot) {
  return {
    x: slot.left,
    top: slot.top,
    bottom: null,
    maxH: slot.maxH,
    width: slot.width,
  };
}

export const commentItemId = (id: string) => `comment:${id}`;
export const noteItemId = (id: string) => `note:${id}`;
export const suggestionItemId = (id: string) => `suggestion:${id}`;
