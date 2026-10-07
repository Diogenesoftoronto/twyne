import { afterAll, beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom is intentionally untyped in this project.
import { JSDOM } from "jsdom";
import type { Editor } from "@tiptap/core";
import {
  createTypstSession,
  type TypstSessionState,
  type TypstSessionDependencies,
  type TypstSessionOptions,
} from "./session";
import type { TypstCompilation, TypstCompileOptions } from "./client";
import { htmlToTypst } from "./document";
import {
  FOLIO_CONTENT_SAVED,
  type FolioContentSnapshot,
  type FolioContentSavedDetail,
} from "../idb";
import type { TypstSourceDraft } from "./source-drafts";
import type { ExportPayload } from "../exchange";
import { DEFAULT_LAYOUT } from "../../types";

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
  proofActive = true,
  getPayload?: TypstSessionOptions["getPayload"],
) {
  const folioId = initialSnapshot?.folioId ?? "folio";
  let html = initialSnapshot?.html ?? "<p>Initial</p>";
  let editable = true;
  let htmlReads = 0;
  const listeners = new Set<() => void>();
  const states: TypstSessionState[] = [];
  const pageCounts: number[] = [];
  const saved: string[] = [];
  const drafts: TypstSourceDraft[] = [];
  const saveAttempts: Array<{
    source: string;
    expectedSource: string | null | undefined;
  }> = [];
  let snap: FolioContentSnapshot = initialSnapshot ?? {
    folioId,
    html,
    typstSource: htmlToTypst(html),
    format: "typst",
    updatedAt: 1,
  };
  const editor = {
    getHTML: () => {
      htmlReads++;
      return html;
    },
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
      folioId,
      readOnly: false,
      proofActive,
      onState: (state) => states.push(state),
      onPages: (count) => pageCounts.push(count),
      getPayload:
        getPayload ?? (async () => ({ html, title: "Test" }) as ExportPayload),
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
    pageCounts,
    saved,
    drafts,
    saveAttempts,
    get html() {
      return html;
    },
    get editable() {
      return editable;
    },
    get htmlReads() {
      return htmlReads;
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
    get source() {
      // Source inspection/export is an explicit synchronization boundary.
      const detail = { folioId, source: "", pending: false };
      window.dispatchEvent(
        new CustomEvent("twyne:request-typst-source", { detail }),
      );
      return detail.source;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function proof(pageCount = 1): TypstCompilation {
  return {
    pdf: new Blob([`PDF with ${pageCount} pages`]),
    pages: Array.from(
      { length: pageCount },
      (_, index) =>
        `<svg xmlns="http://www.w3.org/2000/svg"><text>Page ${index + 1}</text></svg>`,
    ),
    pageCount,
  };
}

function controlledCompiler() {
  const jobs: Array<{
    source: string;
    options?: TypstCompileOptions;
    resolve(value: TypstCompilation): void;
    reject(reason: Error): void;
  }> = [];
  const compile: TypstSessionDependencies["compile"] = (source, options) => {
    const pending = deferred<TypstCompilation>();
    jobs.push({ source, options, ...pending });
    // Deliberately ignore aborts so late worker results exercise publication
    // guards rather than relying on the compiler to respect cancellation.
    return pending.promise;
  };
  return { jobs, compile };
}

// Let payload preparation, compilation, and their chained continuations settle
// without advancing the session's 450/500 ms debounce windows.
const settle = () => Bun.sleep(0);

describe("Typst source session", () => {
  test("applying source checks a visual conflict still inside the quiet window", async () => {
    const t = await setup();
    try {
      t.session.changeSource("Authored source draft");
      t.edit("<p>A programmatic visual change</p>");
      await t.session.apply();
      expect(t.saved).toHaveLength(0);
      expect(t.html).toBe("<p>A programmatic visual change</p>");
      expect(t.states.at(-1)?.conflict).toBe(true);
      expect(t.states.at(-1)?.source).toBe("Authored source draft");
    } finally {
      t.session.destroy();
    }
  });
  test("a typing burst performs no synchronous serialization and reconciles once after quiet", async () => {
    const t = await setup();
    try {
      const reads = t.htmlReads;
      const initial = t.states.at(-1)?.source;
      for (let i = 0; i < 30; i++) t.edit(`<p>Typed ${i}</p>`);
      expect(t.htmlReads).toBe(reads);
      expect(t.states.at(-1)?.source).toBe(initial);
      await Bun.sleep(550);
      expect(t.htmlReads).toBe(reads + 1);
      expect(t.states.at(-1)?.source).toContain("Typed 29");
    } finally {
      t.session.destroy();
    }
  });
  test("an immediate source request flushes the final visual edit", async () => {
    const t = await setup();
    try {
      t.edit("<p>Final keystroke</p>");
      expect(t.source).toContain("Final keystroke");
      t.session.changeSource(t.source + "\n\nAuthored addition");
      expect(t.states.at(-1)?.dirty).toBe(true);
      expect(t.states.at(-1)?.source).toContain("Final keystroke");
    } finally {
      t.session.destroy();
    }
  });
  test("an acknowledgement of a coalesced snapshot advances the base while newer typing stays live", async () => {
    const t = await setup();
    try {
      const first = "<p>Saved burst</p>";
      t.edit(first);
      window.dispatchEvent(
        new CustomEvent("twyne:content", { detail: { html: first } }),
      );
      t.edit("<p>Later keystroke</p>");
      const acknowledged = {
        ...t.snapshot,
        html: first,
        typstSource: htmlToTypst(first),
        origin: "local",
      };
      t.setSnapshot(acknowledged);
      const reads = t.htmlReads;
      window.dispatchEvent(
        new CustomEvent(FOLIO_CONTENT_SAVED, { detail: acknowledged }),
      );
      expect(t.htmlReads).toBe(reads);
      expect(t.source).toContain("Later keystroke");
      t.session.changeSource("Authored source");
      expect(t.drafts.at(-1)?.baseSource).toBe(acknowledged.typstSource);
      await t.session.apply();
      expect(t.saved).toEqual(["Authored source"]);
    } finally {
      t.session.destroy();
    }
  });
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
      t.session.flushVisual();
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
      expect(t.source).toContain("Second edit");
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
            typstSource: t.source,
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
              restoredVersion === "historical" ? initial.typstSource : t.source,
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
          typstSource: t.source,
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
  test("Write view never compiles a hidden proof; opening it compiles the newest text", async () => {
    const compiled: string[] = [];
    const t = await setup(
      {
        compile: async (source) => {
          compiled.push(source);
          return { pdf: new Blob(["PDF"]), pages: [], pageCount: 1 };
        },
      },
      undefined,
      false,
    );
    try {
      t.edit("<p>Latest visual text</p>");
      t.session.refreshProof();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(compiled).toHaveLength(0);
      t.session.setProofActive(true);
      await new Promise((resolve) => setTimeout(resolve, 550));
      expect(compiled).toHaveLength(1);
      expect(compiled[0]).toContain("Latest visual text");
      t.session.changeSource("= Draft");
      t.session.setProofActive(false);
      await new Promise((resolve) => setTimeout(resolve, 550));
      expect(compiled).toHaveLength(1);
      await t.session.apply();
      expect(compiled).toHaveLength(2);
      expect(t.saved).toEqual(["= Draft"]);
    } finally {
      t.session.destroy();
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

describe("Typst proof scheduling", () => {
  test("a same-source save acknowledgement preserves the running compilation", async () => {
    const compiler = controlledCompiler();
    const t = await setup({ compile: compiler.compile });
    try {
      t.session.refreshProof(false);
      await settle();
      expect(compiler.jobs).toHaveLength(1);
      const acknowledged: FolioContentSavedDetail = {
        ...t.snapshot,
        updatedAt: 2,
        origin: "local",
      };
      t.setSnapshot(acknowledged);
      window.dispatchEvent(
        new CustomEvent(FOLIO_CONTENT_SAVED, { detail: acknowledged }),
      );
      expect(compiler.jobs[0].options?.signal?.aborted).toBe(false);
      await Bun.sleep(500);
      expect(compiler.jobs).toHaveLength(1);
      expect(compiler.jobs[0].options?.signal?.aborted).toBe(false);
      compiler.jobs[0].resolve(proof(2));
      await settle();
      expect(t.states.at(-1)).toMatchObject({
        status: "2 pages",
        proofStale: false,
        error: "",
      });
      expect(t.pageCounts).toEqual([2]);
    } finally {
      t.session.destroy();
    }
  });

  test("reopening an unchanged completed proof reuses its existing URLs", async () => {
    const compiler = controlledCompiler();
    const t = await setup({ compile: compiler.compile });
    try {
      t.session.refreshProof(false);
      await settle();
      compiler.jobs[0].resolve(proof(2));
      await settle();
      const ready = t.states.at(-1)!;
      expect(ready.pdfUrl).not.toBe("");
      t.session.setProofActive(false);
      t.session.setProofActive(true);
      await Bun.sleep(500);
      expect(compiler.jobs).toHaveLength(1);
      expect(t.states.at(-1)).toMatchObject({
        pdfUrl: ready.pdfUrl,
        pages: ready.pages,
        proofStale: false,
        status: "2 pages",
      });
      expect(t.pageCounts).toEqual([2]);
    } finally {
      t.session.destroy();
    }
  });

  test("an unchanged remote echo preserves pending work while a real remote edit replaces it", async () => {
    const compiler = controlledCompiler();
    const t = await setup({ compile: compiler.compile });
    try {
      t.session.refreshProof(false);
      await settle();
      window.dispatchEvent(
        new CustomEvent("twyne:typst-remote-change", {
          detail: {
            folioId: "folio",
            source: t.snapshot.typstSource,
            html: t.snapshot.html,
          },
        }),
      );
      expect(compiler.jobs[0].options?.signal?.aborted).toBe(false);
      await Bun.sleep(500);
      expect(compiler.jobs).toHaveLength(1);
      expect(compiler.jobs[0].options?.signal?.aborted).toBe(false);
      window.dispatchEvent(
        new CustomEvent("twyne:typst-remote-change", {
          detail: {
            folioId: "folio",
            source: "= Remote manuscript",
            html: "<h1>Remote manuscript</h1>",
          },
        }),
      );
      expect(compiler.jobs[0].options?.signal?.aborted).toBe(true);
      expect(t.states.at(-1)?.proofStale).toBe(true);
      await Bun.sleep(500);
      expect(compiler.jobs).toHaveLength(2);
      expect(compiler.jobs[1].source).toBe("= Remote manuscript");
      expect(compiler.jobs[1].options?.payload?.html).toBe(
        "<h1>Remote manuscript</h1>",
      );
      compiler.jobs[1].resolve(proof(2));
      await settle();
      const ready = t.states.at(-1)!;
      compiler.jobs[0].resolve(proof());
      await settle();
      expect(t.states.at(-1)).toEqual(ready);
      expect(t.pageCounts).toEqual([2]);
    } finally {
      t.session.destroy();
    }
  });

  test("automatic refreshes coalesce identical in-flight work and publish once", async () => {
    const compiler = controlledCompiler();
    const t = await setup({ compile: compiler.compile });
    try {
      t.session.refreshProof(false);
      await settle();
      for (let i = 0; i < 5; i++) t.session.refreshProof(false);
      await settle();
      expect(compiler.jobs).toHaveLength(1);
      expect(compiler.jobs[0].options?.signal?.aborted).toBe(false);
      compiler.jobs[0].resolve(proof(3));
      await settle();
      expect(t.states.at(-1)).toMatchObject({
        status: "3 pages",
        proofStale: false,
      });
      expect(t.pageCounts).toEqual([3]);
    } finally {
      t.session.destroy();
    }
  });

  test("automatic refresh reuses completed work for a newly allocated equal payload", async () => {
    const compiler = controlledCompiler();
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      async () => ({
        html: "<p>Initial</p>",
        title: "Test",
        layout: { ...DEFAULT_LAYOUT },
        bibliography: [],
      }),
    );
    try {
      t.session.refreshProof(false);
      await settle();
      compiler.jobs[0].resolve(proof());
      await settle();
      const ready = t.states.at(-1)!;
      t.session.refreshProof(false);
      expect(t.states.at(-1)?.proofStale).toBe(true);
      await settle();
      expect(compiler.jobs).toHaveLength(1);
      expect(t.states.at(-1)).toMatchObject({
        pdfUrl: ready.pdfUrl,
        pages: ready.pages,
        proofStale: false,
      });
      expect(t.pageCounts).toEqual([1]);
    } finally {
      t.session.destroy();
    }
  });

  const payloadChanges: Array<[string, Partial<ExportPayload>]> = [
    ["title", { title: "Renamed manuscript" }],
    ["HTML", { html: "<p>Different projected content</p>" }],
    ["canonical payload source", { typstSource: "= Payload source" }],
    ["header", { header: "Changed running header" }],
    ["footer", { footer: "Changed running footer" }],
    ["layout", { layout: { ...DEFAULT_LAYOUT, marginLeft: 7 } }],
    ["citation style", { citationStyle: "apa" }],
    [
      "bibliography",
      {
        bibliography: [
          {
            id: "reference",
            folioId: "folio",
            title: "Revised citation",
            url: "https://example.com/reference",
            accessedAt: 1,
          },
        ],
      },
    ],
    [
      "marginalia",
      {
        marginalia: [
          {
            personaId: "editor",
            personaName: "Editor",
            personaColor: "blue",
            feedback: "Revised note",
            timestamp: 1,
            type: "suggestion",
          },
        ],
      },
    ],
    [
      "brief",
      {
        brief: {
          answers: {
            workingTitle: "Changed brief",
            format: "Essay",
            audience: "Readers",
            goal: "Explain",
            tone: "Direct",
            constraints: "Short",
            successSignal: "Clear",
          },
          attachments: [],
          completedAt: 1,
          updatedAt: 1,
        },
      },
    ],
    [
      "folios",
      {
        folios: [
          {
            id: "folio",
            name: "Changed folio",
            type: "draft",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
    ],
  ];
  for (const [field, change] of payloadChanges) {
    test(`automatic refresh recompiles when ${field} changes without a source edit`, async () => {
      const compiler = controlledCompiler();
      let payload: ExportPayload = {
        html: "<p>Initial</p>",
        title: "Test",
      };
      const t = await setup(
        { compile: compiler.compile },
        undefined,
        true,
        async () => structuredClone(payload),
      );
      try {
        t.session.refreshProof(false);
        await settle();
        compiler.jobs[0].resolve(proof());
        await settle();
        const ready = t.states.at(-1)!;
        payload = { ...payload, ...change };
        t.session.refreshProof(false);
        expect(t.states.at(-1)).toMatchObject({
          pdfUrl: ready.pdfUrl,
          pages: ready.pages,
          proofStale: true,
        });
        await settle();
        expect(compiler.jobs).toHaveLength(2);
        expect(compiler.jobs[1].source).toBe(compiler.jobs[0].source);
        expect(compiler.jobs[1].options?.payload).toEqual(payload);
        compiler.jobs[1].resolve(proof(2));
        await settle();
        expect(t.states.at(-1)?.proofStale).toBe(false);
        expect(t.states.at(-1)?.pdfUrl).not.toBe(ready.pdfUrl);
        expect(t.pageCounts).toEqual([1, 2]);
      } finally {
        t.session.destroy();
      }
    });
  }

  test("automatic refresh includes source in the key even when its payload is unchanged", async () => {
    const compiler = controlledCompiler();
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      async () => ({ html: "<p>Initial</p>", title: "Test" }),
    );
    try {
      t.session.refreshProof(false);
      await settle();
      compiler.jobs[0].resolve(proof());
      await settle();
      const ready = t.states.at(-1)!;
      t.session.changeSource("= Changed source");
      expect(t.states.at(-1)).toMatchObject({
        pdfUrl: ready.pdfUrl,
        pages: ready.pages,
        proofStale: true,
      });
      t.session.refreshProof(false);
      await settle();
      expect(compiler.jobs).toHaveLength(2);
      expect(compiler.jobs[1].source).toBe("= Changed source");
      expect(compiler.jobs[1].options?.payload).toEqual(
        compiler.jobs[0].options?.payload,
      );
      compiler.jobs[1].resolve(proof(2));
      await settle();
      expect(t.states.at(-1)?.proofStale).toBe(false);
      expect(t.states.at(-1)?.status).toBe("2 pages · source draft");
    } finally {
      t.session.destroy();
    }
  });

  test("default explicit refresh rebuilds a completed proof and automatic refresh joins it", async () => {
    const compiler = controlledCompiler();
    const t = await setup({ compile: compiler.compile });
    try {
      t.session.refreshProof(false);
      await settle();
      compiler.jobs[0].resolve(proof());
      await settle();
      const ready = t.states.at(-1)!;
      t.session.refreshProof();
      await settle();
      expect(compiler.jobs).toHaveLength(2);
      t.session.refreshProof(false);
      await settle();
      expect(compiler.jobs).toHaveLength(2);
      expect(compiler.jobs[1].options?.signal?.aborted).toBe(false);
      expect(t.states.at(-1)).toMatchObject({
        pdfUrl: ready.pdfUrl,
        proofStale: true,
      });
      compiler.jobs[1].resolve(proof(2));
      await settle();
      expect(t.states.at(-1)?.pdfUrl).not.toBe(ready.pdfUrl);
      expect(t.states.at(-1)?.proofStale).toBe(false);
      expect(t.pageCounts).toEqual([1, 2]);
    } finally {
      t.session.destroy();
    }
  });

  test("a failed initial compilation is retried by an automatic refresh", async () => {
    const compiler = controlledCompiler();
    const t = await setup({ compile: compiler.compile });
    try {
      t.session.refreshProof(false);
      await settle();
      compiler.jobs[0].reject(new Error("Temporary compiler failure"));
      await settle();
      expect(t.states.at(-1)).toMatchObject({
        pdfUrl: "",
        proofStale: true,
        error: "Temporary compiler failure",
      });
      t.session.refreshProof(false);
      await settle();
      expect(compiler.jobs).toHaveLength(2);
      compiler.jobs[1].resolve(proof());
      await settle();
      expect(t.states.at(-1)).toMatchObject({ proofStale: false, error: "" });
      expect(t.pageCounts).toEqual([1]);
    } finally {
      t.session.destroy();
    }
  });

  test("a failed forced refresh retains the old artifact but never caches the failure", async () => {
    const compiler = controlledCompiler();
    const t = await setup({ compile: compiler.compile });
    try {
      t.session.refreshProof(false);
      await settle();
      compiler.jobs[0].resolve(proof());
      await settle();
      const ready = t.states.at(-1)!;
      t.session.refreshProof();
      await settle();
      compiler.jobs[1].reject(new Error("Refresh failed"));
      await settle();
      expect(t.states.at(-1)).toMatchObject({
        pdfUrl: ready.pdfUrl,
        pages: ready.pages,
        proofStale: true,
        status: "Showing last valid proof",
        error: "Refresh failed",
      });
      t.session.refreshProof(false);
      await settle();
      expect(compiler.jobs).toHaveLength(3);
      compiler.jobs[2].resolve(proof(2));
      await settle();
      expect(t.states.at(-1)).toMatchObject({ proofStale: false, error: "" });
      expect(t.pageCounts).toEqual([1, 2]);
    } finally {
      t.session.destroy();
    }
  });

  test("a visual keystroke immediately marks the retained proof stale without serializing", async () => {
    const compiler = controlledCompiler();
    const t = await setup({ compile: compiler.compile });
    try {
      t.session.refreshProof(false);
      await settle();
      compiler.jobs[0].resolve(proof());
      await settle();
      const ready = t.states.at(-1)!;
      const reads = t.htmlReads;
      t.edit("<p>A newer visual manuscript</p>");
      expect(t.htmlReads).toBe(reads);
      expect(t.states.at(-1)).toMatchObject({
        pdfUrl: ready.pdfUrl,
        pages: ready.pages,
        proofStale: true,
      });
      t.session.refreshProof(false);
      await settle();
      expect(compiler.jobs).toHaveLength(2);
      expect(compiler.jobs[1].source).toContain("A newer visual manuscript");
      compiler.jobs[1].resolve(proof(2));
      await settle();
      expect(t.states.at(-1)?.proofStale).toBe(false);
      expect(t.states.at(-1)?.pdfUrl).not.toBe(ready.pdfUrl);
    } finally {
      t.session.destroy();
    }
  });

  test("a latest payload failure cancels old work and allows a fresh same-key retry", async () => {
    const compiler = controlledCompiler();
    let payloadFailure = false;
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      async () => {
        if (payloadFailure) throw new Error("Payload preparation failed");
        return { html: "<p>Initial</p>", title: "Test" };
      },
    );
    try {
      t.session.refreshProof(false);
      await settle();
      payloadFailure = true;
      t.session.refreshProof(false);
      await settle();
      expect(compiler.jobs[0].options?.signal?.aborted).toBe(true);
      expect(t.states.at(-1)).toMatchObject({
        proofStale: true,
        error: "Payload preparation failed",
      });
      compiler.jobs[0].reject(new Error("Obsolete worker rejected"));
      await settle();
      expect(t.states.at(-1)?.error).toBe("Payload preparation failed");
      payloadFailure = false;
      t.session.refreshProof();
      await settle();
      expect(compiler.jobs).toHaveLength(2);
      expect(compiler.jobs[1].options?.payload).toEqual(
        compiler.jobs[0].options?.payload,
      );
      compiler.jobs[1].resolve(proof());
      await settle();
      expect(t.states.at(-1)).toMatchObject({
        proofStale: false,
        error: "",
      });
      expect(t.pageCounts).toEqual([1]);
    } finally {
      t.session.destroy();
    }
  });

  test("settings changed while hidden mark the retained artifact stale until reopening", async () => {
    const compiler = controlledCompiler();
    let header = "Original header";
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      async () => ({ html: "<p>Initial</p>", title: "Test", header }),
    );
    try {
      t.session.refreshProof(false);
      await settle();
      compiler.jobs[0].resolve(proof());
      await settle();
      const ready = t.states.at(-1)!;
      t.session.setProofActive(false);
      header = "New header";
      t.session.refreshProof(false);
      expect(t.states.at(-1)).toMatchObject({
        pdfUrl: ready.pdfUrl,
        pages: ready.pages,
        proofStale: true,
      });
      await settle();
      expect(compiler.jobs).toHaveLength(1);
      t.session.setProofActive(true);
      await Bun.sleep(500);
      expect(compiler.jobs).toHaveLength(2);
      expect(compiler.jobs[1].options?.payload?.header).toBe(header);
      compiler.jobs[1].resolve(proof(2));
      await settle();
      expect(t.states.at(-1)?.proofStale).toBe(false);
    } finally {
      t.session.destroy();
    }
  });

  test("late payload preparation cannot compile or publish an obsolete source", async () => {
    const compiler = controlledCompiler();
    const payloads: Array<{
      source: string;
      pending: ReturnType<typeof deferred<ExportPayload>>;
    }> = [];
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      (source) => {
        const pending = deferred<ExportPayload>();
        payloads.push({ source, pending });
        return pending.promise;
      },
    );
    try {
      t.session.refreshProof(false);
      t.session.changeSource("= Newer source");
      t.session.refreshProof(false);
      expect(payloads).toHaveLength(2);
      payloads[1].pending.resolve({
        html: "<h1>Newer source</h1>",
        title: "New",
      });
      await settle();
      expect(compiler.jobs).toHaveLength(1);
      expect(compiler.jobs[0].source).toBe("= Newer source");
      compiler.jobs[0].resolve(proof(2));
      await settle();
      const ready = t.states.at(-1)!;
      payloads[0].pending.resolve({ html: "<p>Initial</p>", title: "Old" });
      await settle();
      expect(compiler.jobs).toHaveLength(1);
      expect(t.states.at(-1)).toEqual(ready);
      expect(t.pageCounts).toEqual([2]);
    } finally {
      t.session.destroy();
    }
  });

  test("out-of-order payloads for unchanged source use only the newest settings", async () => {
    const compiler = controlledCompiler();
    const payloads: Array<ReturnType<typeof deferred<ExportPayload>>> = [];
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      () => {
        const pending = deferred<ExportPayload>();
        payloads.push(pending);
        return pending.promise;
      },
    );
    try {
      t.session.refreshProof(false);
      t.session.refreshProof(false);
      payloads[1].resolve({ html: "<p>Initial</p>", title: "Newest settings" });
      await settle();
      compiler.jobs[0].resolve(proof(2));
      await settle();
      const ready = t.states.at(-1)!;
      payloads[0].resolve({
        html: "<p>Initial</p>",
        title: "Obsolete settings",
      });
      await settle();
      expect(compiler.jobs).toHaveLength(1);
      expect(compiler.jobs[0].options?.payload?.title).toBe("Newest settings");
      expect(t.states.at(-1)).toEqual(ready);
      expect(t.pageCounts).toEqual([2]);
    } finally {
      t.session.destroy();
    }
  });

  test("a superseded settings worker cannot report progress or publish a stale PDF", async () => {
    const compiler = controlledCompiler();
    let header = "Old header";
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      async () => ({ html: "<p>Initial</p>", title: "Test", header }),
    );
    try {
      t.session.refreshProof(false);
      await settle();
      header = "Newest header";
      t.session.refreshProof(false);
      await settle();
      expect(compiler.jobs).toHaveLength(2);
      expect(compiler.jobs[0].options?.signal?.aborted).toBe(true);
      compiler.jobs[1].resolve(proof(2));
      await settle();
      const ready = t.states.at(-1)!;
      const emitted = t.states.length;
      compiler.jobs[0].options?.onProgress?.("Obsolete worker progress");
      compiler.jobs[0].resolve(proof(3));
      await settle();
      expect(t.states).toHaveLength(emitted);
      expect(t.states.at(-1)).toEqual(ready);
      expect(t.pageCounts).toEqual([2]);
    } finally {
      t.session.destroy();
    }
  });

  test("returning to a completed payload cancels different work and reuses the valid artifact", async () => {
    const compiler = controlledCompiler();
    let header = "Original header";
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      async () => ({ html: "<p>Initial</p>", title: "Test", header }),
    );
    try {
      t.session.refreshProof(false);
      await settle();
      compiler.jobs[0].resolve(proof());
      await settle();
      const ready = t.states.at(-1)!;
      header = "Intermediate header";
      t.session.refreshProof(false);
      await settle();
      header = "Original header";
      t.session.refreshProof(false);
      await settle();
      expect(compiler.jobs).toHaveLength(2);
      expect(compiler.jobs[1].options?.signal?.aborted).toBe(true);
      expect(t.states.at(-1)).toMatchObject({
        pdfUrl: ready.pdfUrl,
        pages: ready.pages,
        proofStale: false,
      });
      compiler.jobs[1].resolve(proof(3));
      await settle();
      expect(t.states.at(-1)?.pdfUrl).toBe(ready.pdfUrl);
      expect(t.pageCounts).toEqual([1]);
    } finally {
      t.session.destroy();
    }
  });

  test("Apply joins the matching in-flight proof and saves exactly once", async () => {
    const compiler = controlledCompiler();
    const t = await setup({ compile: compiler.compile });
    try {
      t.session.changeSource("= Applied draft");
      t.session.refreshProof(false);
      await settle();
      const applying = t.session.apply();
      await settle();
      expect(compiler.jobs).toHaveLength(1);
      expect(compiler.jobs[0].options?.signal?.aborted).toBe(false);
      expect(t.states.at(-1)?.applying).toBe(true);
      expect(t.saved).toHaveLength(0);
      compiler.jobs[0].resolve(proof());
      await applying;
      expect(t.saved).toEqual(["= Applied draft"]);
      expect(t.html).toBe("<h1>Applied draft</h1>");
      expect(t.states.at(-1)).toMatchObject({
        dirty: false,
        applying: false,
        proofStale: false,
        error: "",
      });
      expect(t.pageCounts).toEqual([1]);
    } finally {
      t.session.destroy();
    }
  });

  test("Apply waiting for payload preparation joins a later matching refresh", async () => {
    const compiler = controlledCompiler();
    const payloads: Array<ReturnType<typeof deferred<ExportPayload>>> = [];
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      () => {
        const pending = deferred<ExportPayload>();
        payloads.push(pending);
        return pending.promise;
      },
    );
    try {
      t.session.changeSource("= Applied after payload race");
      const applying = t.session.apply();
      t.session.refreshProof(false);
      expect(payloads).toHaveLength(2);
      const payload = { html: "<p>Initial</p>", title: "Test" };
      payloads[1].resolve(payload);
      await settle();
      payloads[0].resolve(payload);
      await settle();
      expect(compiler.jobs).toHaveLength(1);
      expect(compiler.jobs[0].options?.signal?.aborted).toBe(false);
      compiler.jobs[0].resolve(proof());
      await applying;
      expect(t.saved).toEqual(["= Applied after payload race"]);
      expect(t.states.at(-1)).toMatchObject({
        dirty: false,
        applying: false,
        proofStale: false,
      });
      expect(t.pageCounts).toEqual([1]);
    } finally {
      t.session.destroy();
    }
  });

  test("Apply can finish after a newer refresh already published the matching proof", async () => {
    const compiler = controlledCompiler();
    const payloads: Array<ReturnType<typeof deferred<ExportPayload>>> = [];
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      () => {
        const pending = deferred<ExportPayload>();
        payloads.push(pending);
        return pending.promise;
      },
    );
    try {
      t.session.changeSource("= Applied after the newer proof");
      const applying = t.session.apply();
      t.session.refreshProof(false);
      expect(payloads).toHaveLength(2);
      const payload = { html: "<p>Initial</p>", title: "Test" };
      payloads[1].resolve(payload);
      await settle();
      compiler.jobs[0].resolve(proof(2));
      await settle();
      expect(t.pageCounts).toEqual([2]);
      expect(t.saved).toHaveLength(0);
      payloads[0].resolve(payload);
      await applying;
      expect(compiler.jobs).toHaveLength(1);
      expect(t.saved).toEqual(["= Applied after the newer proof"]);
      expect(t.states.at(-1)).toMatchObject({
        dirty: false,
        applying: false,
        proofStale: false,
        error: "",
      });
      expect(t.pageCounts).toEqual([2]);
    } finally {
      t.session.destroy();
    }
  });

  for (const obsoleteResult of ["resolve", "reject"] as const) {
    test(`Apply follows a settings replacement when its aborted worker ${obsoleteResult}s`, async () => {
      const compiler = controlledCompiler();
      let header = "Original header";
      const t = await setup(
        { compile: compiler.compile },
        undefined,
        true,
        async () => ({ html: "<p>Initial</p>", title: "Test", header }),
      );
      try {
        t.session.changeSource("= Applied with the latest settings");
        const applying = t.session.apply();
        await settle();
        expect(compiler.jobs).toHaveLength(1);
        header = "Latest header";
        t.session.refreshProof(false);
        await settle();
        expect(compiler.jobs).toHaveLength(2);
        expect(compiler.jobs[0].options?.signal?.aborted).toBe(true);
        if (obsoleteResult === "resolve") compiler.jobs[0].resolve(proof());
        else compiler.jobs[0].reject(new Error("Obsolete worker aborted"));
        await settle();
        expect(t.saved).toHaveLength(0);
        expect(t.states.at(-1)).toMatchObject({ applying: true, error: "" });
        compiler.jobs[1].resolve(proof(2));
        await applying;
        expect(t.saved).toEqual(["= Applied with the latest settings"]);
        expect(t.states.at(-1)).toMatchObject({
          dirty: false,
          applying: false,
          proofStale: false,
          error: "",
        });
        expect(t.pageCounts).toEqual([2]);
      } finally {
        t.session.destroy();
      }
    });
  }

  test("Apply in hidden Write view revalidates changed settings before saving", async () => {
    const compiler = controlledCompiler();
    let header = "Original header";
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      async () => ({ html: "<p>Initial</p>", title: "Test", header }),
    );
    try {
      t.session.changeSource("= Hidden source draft");
      t.session.setProofActive(false);
      const applying = t.session.apply();
      await settle();
      expect(compiler.jobs).toHaveLength(1);
      header = "Latest header";
      t.session.refreshProof(false);
      await settle();
      expect(compiler.jobs).toHaveLength(2);
      expect(compiler.jobs[0].options?.signal?.aborted).toBe(true);
      expect(compiler.jobs[1].options?.payload?.header).toBe("Latest header");
      compiler.jobs[0].resolve(proof());
      await settle();
      expect(t.saved).toHaveLength(0);
      expect(t.states.at(-1)?.applying).toBe(true);
      compiler.jobs[1].resolve(proof(2));
      await applying;
      expect(t.saved).toEqual(["= Hidden source draft"]);
      expect(t.states.at(-1)).toMatchObject({
        dirty: false,
        applying: false,
        proofStale: false,
        error: "",
      });
      expect(t.pageCounts).toEqual([2]);
    } finally {
      t.session.destroy();
    }
  });

  test("a destroyed session never starts a compiler after late payload preparation", async () => {
    const compiler = controlledCompiler();
    const payload = deferred<ExportPayload>();
    const t = await setup(
      { compile: compiler.compile },
      undefined,
      true,
      () => payload.promise,
    );
    try {
      t.session.refreshProof(false);
      t.session.destroy();
      const emitted = t.states.length;
      payload.resolve({ html: "<p>Initial</p>", title: "Test" });
      await settle();
      expect(compiler.jobs).toHaveLength(0);
      expect(t.states).toHaveLength(emitted);
      expect(t.pageCounts).toEqual([]);
    } finally {
      t.session.destroy();
    }
  });

  test("a folio transition isolates late worker output and does not reuse another folio's cache", async () => {
    const compiler = controlledCompiler();
    const first = await setup({ compile: compiler.compile });
    let second: Awaited<ReturnType<typeof setup>> | undefined;
    try {
      first.session.refreshProof(false);
      await settle();
      compiler.jobs[0].resolve(proof());
      await settle();
      first.session.refreshProof();
      await settle();
      expect(compiler.jobs).toHaveLength(2);
      first.session.destroy();
      const firstEmitted = first.states.length;
      expect(compiler.jobs[1].options?.signal?.aborted).toBe(true);
      second = await setup(
        { compile: compiler.compile },
        { ...first.snapshot, folioId: "another-folio" },
      );
      second.session.refreshProof(false);
      await settle();
      expect(compiler.jobs).toHaveLength(3);
      expect(compiler.jobs[2].source).toBe(compiler.jobs[0].source);
      compiler.jobs[2].resolve(proof(2));
      await settle();
      const ready = second.states.at(-1)!;
      compiler.jobs[1].options?.onProgress?.("Previous folio progress");
      compiler.jobs[1].resolve(proof(3));
      await settle();
      expect(first.states).toHaveLength(firstEmitted);
      expect(first.pageCounts).toEqual([1]);
      expect(second.states.at(-1)).toEqual(ready);
      expect(second.pageCounts).toEqual([2]);
    } finally {
      first.session.destroy();
      second?.session.destroy();
    }
  });
});
