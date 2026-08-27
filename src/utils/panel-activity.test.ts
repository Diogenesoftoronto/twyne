import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

const originalWindow = globalThis.window;
const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();

let activity: typeof import("./panel-activity");
let listeners: Record<string, Array<(e: unknown) => void>>;
let emitted: unknown[];

function fire(type: string, detail: unknown) {
  for (const fn of listeners[type] ?? []) fn({ type, detail });
}

beforeEach(async () => {
  listeners = {};
  emitted = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener: (type: string, fn: (e: unknown) => void) => {
        listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
      },
      dispatchEvent: (e: { detail?: unknown }) => {
        emitted.push(e.detail);
        return true;
      },
    },
  });
  (globalThis as Record<string, unknown>).CustomEvent = class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  activity = await import(`./panel-activity?t=${Date.now()}${Math.random()}`);
});

afterAll(() => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
  releaseBrowserGlobalsLock();
});

describe("counts", () => {
  test("start at zero for every panel", () => {
    expect(activity.panelActivity()).toEqual({
      personas: 0,
      rubric: 0,
      comments: 0,
      citations: 0,
      history: 0,
    });
  });

  test("returns a copy so callers cannot mutate the tracker", () => {
    const a = activity.panelActivity();
    a.personas = 99;
    expect(activity.panelActivity().personas).toBe(0);
  });

  test("accumulate and emit", () => {
    activity.bump("personas", 5);
    expect(activity.panelActivity().personas).toBe(5);
    expect(emitted.length).toBe(1);
  });

  /**
   * The badge exists to report work the writer could not see. Counting
   * activity on the tab they are already looking at would produce a badge on
   * the open panel, which is noise.
   */
  test("ignore the panel the writer is looking at", () => {
    activity.setVisiblePanel("personas");
    activity.bump("personas", 3);
    expect(activity.panelActivity().personas).toBe(0);

    activity.bump("comments", 2);
    expect(activity.panelActivity().comments).toBe(2);
  });

  test("clear when a tab is opened", () => {
    activity.bump("citations", 4);
    expect(activity.panelActivity().citations).toBe(4);
    activity.setVisiblePanel("citations");
    expect(activity.panelActivity().citations).toBe(0);
  });

  test("closing the board means nothing is visible, so counts resume", () => {
    activity.setVisiblePanel("rubric");
    activity.setVisiblePanel(null);
    activity.bump("rubric");
    expect(activity.panelActivity().rubric).toBe(1);
  });

  test("clearing an already-empty panel does not emit noise", () => {
    activity.clearPanel("rubric");
    expect(emitted.length).toBe(0);
  });
});

describe("startPanelActivity", () => {
  test("counts background notes against the Cast tab", () => {
    activity.startPanelActivity();
    fire("twyne:background-room-notes", [{}, {}, {}]);
    expect(activity.panelActivity().personas).toBe(3);
  });

  test("counts sources found in the background against the Apparatus tab", () => {
    activity.startPanelActivity();
    fire("twyne:background-sources", { saved: 2 });
    expect(activity.panelActivity().citations).toBe(2);
  });

  test("counts a changed comment thread against Marginalia", () => {
    activity.startPanelActivity();
    fire("twyne:user-comments-changed", undefined);
    expect(activity.panelActivity().comments).toBe(1);
  });

  test("stops counting once torn down", () => {
    const stop = activity.startPanelActivity();
    stop();
    fire("twyne:background-room-notes", [{}]);
    expect(activity.panelActivity().personas).toBe(0);
  });

  test("survives a malformed payload rather than throwing", () => {
    activity.startPanelActivity();
    expect(() => fire("twyne:background-room-notes", null)).not.toThrow();
    expect(() => fire("twyne:background-sources", null)).not.toThrow();
    expect(activity.panelActivity().personas).toBe(1);
    expect(activity.panelActivity().citations).toBe(1);
  });
});
