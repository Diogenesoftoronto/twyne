import { afterAll, beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom is intentionally untyped in this project.
import { JSDOM } from "jsdom";
import type { Editor } from "@tiptap/core";
import {
  createTypstSession,
  type TypstSessionState,
  type TypstSessionDependencies,
} from "./session";
import { htmlToTypst } from "./document";
import {
  FOLIO_CONTENT_SAVED,
  type FolioContentSnapshot,
  type FolioContentSavedDetail,
} from "../idb";
import type { TypstSourceDraft } from "./source-drafts";
import type { ExportPayload } from "../exchange";

const previous = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
  const dom = new JSDOM("", { url: "https://twyne.test" });
  for (const key of ["window", "document", "DOMParser", "CustomEvent"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: dom.window[key],
    });
  }
});
afterAll(() => {
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

async function setup(
  overrides: Partial<TypstSessionDependencies> = {},
  initialSnapshot?: FolioContentSnapshot,
) {
  let html = initialSnapshot?.html ?? "<p>Initial</p>";
  let editable = true;
  const listeners = new Set<() => void>();
  const states: TypstSessionState[] = [];
  const saved: string[] = [];
  const drafts: TypstSourceDraft[] = [];
  const saveAttempts: Array<{
    source: string;
    expectedSource: string | null | undefined;
  }> = [];
  let snap: FolioContentSnapshot = initialSnapshot ?? {
    folioId: "folio",
    html,
    typstSource: htmlToTypst(html),
    format: "typst",
    updatedAt: 1,
  };
  const editor = {
    getHTML: () => html,
    get isEditable() {
      return editable;
    },
    setEditable: (value: boolean, emitUpdate = true) => {
      editable = value;
      if (emitUpdate) listeners.forEach((fn) => fn());
    },
    on: (_: string, callback: () => void) => listeners.add(callback),
    off: (_: string, callback: () => void) => listeners.delete(callback),
    commands: {
      setContent: (value: string, options: { emitUpdate: boolean }) => {
        html = value;
        if (options.emitUpdate) listeners.forEach((fn) => fn());
      },
    },
    isDestroyed: false,
  } as unknown as Editor;
  const session = await createTypstSession(
    {
      editor,
      folioId: "folio",
      readOnly: false,
      onState: (state) => states.push(state),
      onPages: () => {},
      getPayload: async () => ({ html, title: "Test" }) as ExportPayload,
    },
    {
      loadSnapshot: async () => snap,
      saveSource: async (_id, source, body, expected) => {
        saveAttempts.push({ source, expectedSource: expected });
        if ((snap.typstSource ?? null) !== expected)
          throw new Error("The manuscript changed");
        saved.push(source);
        snap = { ...snap, typstSource: source, html: body! };
      },
      loadDraft: async () => null,
      saveDraft: async (draft) => {
        drafts.push({ ...draft });
      },
      clearDraft: async () => {},
      saveRevision: async () => null,
      compile: async () => ({
        pdf: new Blob(["PDF"]),
        pages: ['<svg xmlns="http://www.w3.org/2000/svg"/>'],
        pageCount: 1,
      }),
      ...overrides,
    },
  );
  return {
    session,
    states,
    saved,
    drafts,
    saveAttempts,
    get html() {
      return html;
    },
    get editable() {
      return editable;
    },
    edit(value: string) {
      html = value;
      listeners.forEach((fn) => fn());
    },
    setSnapshot(value: FolioContentSnapshot) {
      snap = value;
    },
    get snapshot() {
      return snap;
    },
  };
}

describe("Typst source session", () => {
  test("only a successfully compiled source replaces the manuscript", async () => {
    let fail = true;
    const t = await setup({
      compile: async () => {
        if (fail) throw new Error("Syntax error at line 1");
        return { pdf: new Blob(["PDF"]), pages: [], pageCount: 1 };
      },
    });
    try {
      t.session.changeSource("= New title");
      expect(t.editable).toBe(false);
      await t.session.apply();
      expect(t.html).toBe("<p>Initial</p>");
      expect(t.saved).toHaveLength(0);
      expect(t.states.at(-1)?.error).toContain("Syntax error");
      fail = false;
      await t.session.apply();
      expect(t.html).toBe("<h1>New title</h1>");
      expect(t.saved).toEqual(["= New title"]);
      expect(t.editable).toBe(true);
    } finally {
      t.session.destroy();
    }
  });
  test("a delayed visual save never overwrites later keystrokes", async () => {
    const t = await setup();
    try {
      t.edit("<p>First edit</p>");
      const first: FolioContentSavedDetail = {
        ...t.snapshot,
        html: t.html,
        typstSource: htmlToTypst(t.html),
        origin: "local",
      };
      t.edit("<p>Second edit</p>");
      window.dispatchEvent(
        new CustomEvent(FOLIO_CONTENT_SAVED, { detail: first }),
      );
      expect(t.html).toBe("<p>Second edit</p>");
      expect(t.states.at(-1)?.source).toContain("Second edit");
    } finally {
      t.session.destroy();
    }
  });
  for (const restoredVersion of ["historical", "current"] as const) {
    for (const eventOrder of ["saved first", "remote change first"] as const) {
      test(`remote restoration of ${restoredVersion} visual HTML preserves a dirty source base (${eventOrder})`, async () => {
        const t = await setup();
        try {
          const initial = { ...t.snapshot };
          t.edit("<p>Saved visual version</p>");
          const local: FolioContentSavedDetail = {
            ...initial,
            html: t.html,
            typstSource: t.states.at(-1)!.source,
            updatedAt: 2,
            origin: "local",
          };
          t.setSnapshot(local);
          window.dispatchEvent(
            new CustomEvent(FOLIO_CONTENT_SAVED, { detail: local }),
          );
          t.edit("<p>Latest unsaved visual version</p>");
          const visualHtml = t.html;
          const remote: FolioContentSavedDetail = {
            ...initial,
            html: restoredVersion === "historical" ? initial.html : visualHtml,
            typstSource:
              restoredVersion === "historical"
                ? initial.typstSource
                : t.states.at(-1)!.source,
            updatedAt: 3,
            origin: "remote",
          };
          const source = "= My unapplied source";
          t.session.changeSource(source);
          expect(t.drafts.at(-1)?.baseSource).toBe(local.typstSource);
          expect(remote.typstSource).not.toBe(local.typstSource);
          t.setSnapshot(remote);
          const saved = new CustomEvent(FOLIO_CONTENT_SAVED, {
            detail: remote,
          });
          const changed = new CustomEvent("twyne:typst-remote-change", {
            detail: {
              folioId: remote.folioId,
              source: remote.typstSource,
              html: remote.html,
            },
          });
          for (const event of eventOrder === "saved first"
            ? [saved, changed]
            : [changed, saved])
            window.dispatchEvent(event);

          await t.session.apply();
          expect(t.saveAttempts).toHaveLength(0);
          expect(t.saved).toHaveLength(0);
          expect(t.snapshot).toEqual(remote);
          expect(t.html).toBe(visualHtml);
          expect(t.editable).toBe(false);
          expect(t.states.at(-1)).toMatchObject({
            source,
            dirty: true,
            conflict: true,
            applying: false,
            error:
              "Resolve the newer manuscript conflict before applying this draft.",
          });
          // Leaving the folio must persist the original comparison base too.
          t.session.destroy();
          const recovery = t.drafts.at(-1)!;
          const reopened = await setup(
            { loadDraft: async () => recovery },
            remote,
          );
          try {
            await reopened.session.apply();
            expect(reopened.saveAttempts).toHaveLength(0);
            expect(reopened.saved).toHaveLength(0);
            expect(reopened.snapshot).toEqual(remote);
            expect(reopened.html).toBe(remote.html);
            expect(reopened.states.at(-1)).toMatchObject({
              source,
              dirty: true,
              conflict: true,
              error:
                "Resolve the newer manuscript conflict before applying this draft.",
            });
          } finally {
            reopened.session.destroy();
          }
          expect(recovery).toMatchObject({
            folioId: "folio",
            source,
            baseSource: local.typstSource,
          });
          expect(
            t.drafts.every((draft) => draft.baseSource === local.typstSource),
          ).toBe(true);
        } finally {
          t.session.destroy();
        }
      });
    }
  }
  for (const savedVersion of ["historical", "current"] as const) {
    test(`a queued local save of ${savedVersion} visual HTML advances the dirty source base without replacing it`, async () => {
      const t = await setup();
      try {
        t.edit("<p>Queued visual version</p>");
        const queued: FolioContentSavedDetail = {
          ...t.snapshot,
          html: t.html,
          typstSource: t.states.at(-1)!.source,
          updatedAt: 2,
          origin: "local",
        };
        if (savedVersion === "historical") t.edit("<p>Later visual typing</p>");
        const visualHtml = t.html;
        const source = "= My local source edit";
        t.session.changeSource(source);
        expect(t.drafts.at(-1)?.baseSource).toBe(t.snapshot.typstSource);
        expect(t.snapshot.typstSource).not.toBe(queued.typstSource);

        t.setSnapshot(queued);
        window.dispatchEvent(
          new CustomEvent(FOLIO_CONTENT_SAVED, { detail: queued }),
        );
        expect(t.html).toBe(visualHtml);
        expect(t.states.at(-1)).toMatchObject({
          source,
          dirty: true,
          conflict: false,
          error: "",
        });
        expect(t.drafts.at(-1)).toMatchObject({
          source,
          baseSource: queued.typstSource,
        });

        await t.session.apply();
        expect(t.saveAttempts).toEqual([
          { source, expectedSource: queued.typstSource },
        ]);
        expect(t.saved).toEqual([source]);
        expect(t.html).toBe("<h1>My local source edit</h1>");
        expect(t.snapshot.typstSource).toBe(source);
        expect(t.states.at(-1)).toMatchObject({
          source,
          dirty: false,
          conflict: false,
          error: "",
        });
        expect(t.editable).toBe(true);
      } finally {
        t.session.destroy();
      }
    });
  }
  test("remote source conflicts preserve an unapplied draft", async () => {
    const t = await setup();
    try {
      t.session.changeSource("My local source");
      window.dispatchEvent(
        new CustomEvent("twyne:typst-remote-change", {
          detail: {
            folioId: "folio",
            source: "Remote source",
            html: "<p>Remote source</p>",
          },
        }),
      );
      expect(t.states.at(-1)?.conflict).toBe(true);
      expect(t.states.at(-1)?.source).toBe("My local source");
      expect(t.html).toBe("<p>Initial</p>");
      await t.session.apply();
      expect(t.saved).toHaveLength(0);
    } finally {
      t.session.destroy();
    }
  });
  test("recovers pending source and exposes it to export without replacing rich content", async () => {
    const t = await setup({
      loadDraft: async () => ({
        folioId: "folio",
        source: "#broken(",
        baseSource: htmlToTypst("<p>Initial</p>"),
        updatedAt: 1,
      }),
    });
    try {
      const detail = { folioId: "folio", source: "", pending: false };
      window.dispatchEvent(
        new CustomEvent("twyne:request-typst-source", { detail }),
      );
      expect(detail).toEqual({
        folioId: "folio",
        source: "#broken(",
        pending: true,
      });
      expect(t.html).toBe("<p>Initial</p>");
      expect(t.editable).toBe(false);
      await t.session.discard();
      expect(t.states.at(-1)?.dirty).toBe(false);
      expect(t.editable).toBe(true);
    } finally {
      t.session.destroy();
    }
  });
  test("remote changes preserve unsaved visual typing as a recovery draft", async () => {
    const t = await setup();
    try {
      t.edit("<p>Local unsaved typing</p>");
      const remote = {
        folioId: "folio",
        source: "Remote source",
        html: "<p>Remote source</p>",
      };
      window.dispatchEvent(
        new CustomEvent(FOLIO_CONTENT_SAVED, {
          detail: { ...remote, typstSource: remote.source, origin: "remote" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("twyne:typst-remote-change", { detail: remote }),
      );
      expect(t.html).toBe("<p>Local unsaved typing</p>");
      expect(t.states.at(-1)?.source).toContain("Local unsaved typing");
      expect(t.states.at(-1)?.dirty).toBe(true);
      expect(t.states.at(-1)?.conflict).toBe(true);
    } finally {
      t.session.destroy();
    }
  });
  test("a commit completing after folio switch still announces sync and clears recovery", async () => {
    let begin!: () => void;
    let finish!: () => void;
    const began = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let cleared = 0;
    let committed = 0;
    const listener = () => committed++;
    window.addEventListener("twyne:typst-source-committed", listener);
    const t = await setup({
      saveSource: async () => {
        begin();
        await finished;
      },
      clearDraft: async () => {
        cleared++;
      },
    });
    try {
      t.session.changeSource("= Saved after switching");
      const applying = t.session.apply();
      await began;
      t.session.destroy();
      finish();
      await applying;
      expect(committed).toBe(1);
      expect(cleared).toBe(1);
      expect(t.html).toBe("<p>Initial</p>");
    } finally {
      t.session.destroy();
      window.removeEventListener("twyne:typst-source-committed", listener);
    }
  });
  test("a superseded compilation cannot replace the newest proof", async () => {
    const jobs: Array<{
      signal?: AbortSignal;
      finish: (pages: number) => void;
    }> = [];
    const t = await setup({
      compile: async (_source, options) =>
        new Promise((resolve) =>
          jobs.push({
            signal: options?.signal,
            finish: (count) =>
              resolve({
                pdf: new Blob([String(count)]),
                pages: [],
                pageCount: count,
              }),
          }),
        ),
    });
    try {
      t.session.refreshProof();
      await Promise.resolve();
      t.session.changeSource("New source");
      t.session.refreshProof();
      await Promise.resolve();
      expect(jobs).toHaveLength(2);
      expect(jobs[0].signal?.aborted).toBe(true);
      jobs[1].finish(2);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      jobs[0].finish(1);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(t.states.at(-1)?.status).toBe("2 pages · source draft");
    } finally {
      t.session.destroy();
    }
  });
});
