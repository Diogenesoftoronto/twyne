import { expect, test } from "bun:test";
import {
  commentItemId,
  marginSurface,
  noteItemId,
  registerMarginSurface,
  setMarginThread,
  slotPlacement,
  suggestionItemId,
  type MarginSurface,
} from "./margin-surface";

function surface(active = true) {
  const opened: Array<string | null> = [];
  const instance: MarginSurface = {
    active: () => active,
    reveal: async () => ({ left: 900, top: 120, width: 300, maxH: 600 }),
    setOpen: (id) => opened.push(id),
  };
  return {
    instance,
    opened,
    setActive: (value: boolean) => {
      active = value;
    },
  };
}

test("registration is gated by whether the margin is active, and cleanup removes it", () => {
  const current = surface(false);
  const unregister = registerMarginSurface(current.instance);
  try {
    expect(marginSurface()).toBeNull();
    current.setActive(true);
    expect(marginSurface()).toBe(current.instance);
    current.setActive(false);
    expect(marginSurface()).toBeNull();
  } finally {
    unregister();
  }
  expect(marginSurface()).toBeNull();
});

test("an older surface's cleanup cannot unregister its replacement", () => {
  const old = surface();
  const current = surface();
  const unregisterOld = registerMarginSurface(old.instance);
  const unregisterCurrent = registerMarginSurface(current.instance);
  try {
    unregisterOld();
    expect(marginSurface()).toBe(current.instance);
    setMarginThread("comment:a");
    setMarginThread(null);
    expect(current.opened).toEqual(["comment:a", null]);
    expect(old.opened).toEqual([]);
  } finally {
    unregisterCurrent();
    unregisterOld();
  }
  expect(marginSurface()).toBeNull();
});

test("inactive surfaces still receive thread closure and slot geometry matches the editor shape", async () => {
  const current = surface(false);
  const unregister = registerMarginSurface(current.instance);
  try {
    setMarginThread(null);
    expect(current.opened).toEqual([null]);
    const slot = await current.instance.reveal("comment:a", 120);
    expect(slotPlacement(slot!)).toEqual({
      x: 900,
      top: 120,
      bottom: null,
      width: 300,
      maxH: 600,
    });
    expect(commentItemId("a")).toBe("comment:a");
    expect(noteItemId("a")).toBe("note:a");
    expect(suggestionItemId("a")).toBe("suggestion:a");
  } finally {
    unregister();
  }
  setMarginThread(null);
});
