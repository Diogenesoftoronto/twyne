import { expect, test, spyOn } from "bun:test";
import {
  withEditor as withHarness,
  type EditorHarness,
  type WithEditorOptions,
} from "../test-harness";
import {
  LivingDeskDecorations,
  startLivingDesk,
  livingDeskRecomputeMs,
} from "./living-desk";
import {
  livingDeskController,
  livingDeskSnapshot,
  LIVING_DESK_TOGGLE_EVENT,
} from "../../../utils/living-desk-contract";
import { LIVE_REVIEW_REQUEST_EVENT } from "../../../utils/live-review";
import * as liveReviewModule from "../../../utils/live-review";
import { rubricDraftFingerprint } from "../../../utils/rubric-judgement-result";
import { htmlToPlainText } from "../../../utils/anti-tabula-rasa";
import { scoreStaticFeatures } from "../../../utils/rubric";

// The shared harness installs Event but leaves CustomEvent in Bun's realm.
// Keep this engine's DOM-event bridge local to its tests.
const withEditor = (
  options: WithEditorOptions,
  run: (h: EditorHarness) => void | Promise<void>,
) =>
  withHarness(options, async (h) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
    Object.defineProperty(globalThis, "CustomEvent", {
      configurable: true,
      value: h.dom.window.CustomEvent,
    });
    try {
      await run(h);
    } finally {
      if (previous) Object.defineProperty(globalThis, "CustomEvent", previous);
      else Reflect.deleteProperty(globalThis, "CustomEvent");
    }
  });

const content =
  "<p>I remember my home. I kept my map. I trusted myself and my notes. We argue for the bridge. We think it helps.</p>";
test("fix updates manuscript, count and score in one frame; undo restores everything", async () => {
  await withEditor(
    { content, extensions: [LivingDeskDecorations] },
    ({ editor }) => {
      const stop = startLivingDesk(editor, {
        folioId: "test",
        getClient: () => null,
      });
      try {
        const controller = livingDeskController()!;
        const initial = livingDeskSnapshot();
        const stance = initial.findings.find((f) => f.id === "stance")!;
        expect(stance.count).toBe(2);
        controller.focus("stance");
        controller.preview(stance.occurrences[0].id);
        expect(editor.view.dom.querySelector(".ld-ghost")?.textContent).toBe(
          "I",
        );
        expect(editor.view.dom.getAttribute("data-ld-focus")).toBe("stance");
        editor.view.dom.dispatchEvent(
          new window.KeyboardEvent("keydown", { key: "ArrowRight" }),
        );
        expect(editor.view.dom.hasAttribute("data-ld-focus")).toBe(false);
        const start = performance.now();
        expect(controller.applyFix("stance", stance.occurrences[0].id)).toBe(
          true,
        );
        expect(performance.now() - start).toBeLessThan(300);
        expect(editor.getText()).toContain("I argue for the bridge");
        expect(
          livingDeskSnapshot().findings.find((f) => f.id === "stance")?.count,
        ).toBe(1);
        expect(
          livingDeskSnapshot().score.criteria.find(
            (c) => c.key === "consistency",
          )?.value,
        ).toBeCloseTo(9.7);
        expect(livingDeskSnapshot().score.lastChange).toMatchObject({
          criterion: "consistency",
          source: "¶1",
          delta: expect.closeTo(0.3),
        });
        expect(editor.view.dom.querySelector(".ld-flash")).not.toBeNull();
        expect(editor.commands.undo()).toBe(true);
        expect(editor.getText()).toContain("We argue for the bridge");
        expect(
          livingDeskSnapshot().findings.find((f) => f.id === "stance")?.count,
        ).toBe(2);
        expect(
          livingDeskSnapshot().score.criteria.find(
            (c) => c.key === "consistency",
          )?.value,
        ).toBeCloseTo(9.4);
        expect(livingDeskSnapshot().score.lastChange).toBeNull();
        expect(editor.view.dom.querySelector(".ld-flash")).toBeNull();
      } finally {
        stop();
      }
    },
  );
});

test("applyAll is a single undo event and controller dispatches the review and toggle events", async () => {
  await withEditor(
    { content, extensions: [LivingDeskDecorations] },
    ({ editor }) => {
      const stop = startLivingDesk(editor, {
        folioId: "batch",
        getClient: () => undefined,
      });
      try {
        const controller = livingDeskController()!;
        expect(controller.applyAll("stance")).toBe(2);
        expect(
          livingDeskSnapshot().findings.find((f) => f.id === "stance")?.state,
        ).toBe("resolved");
        expect(editor.commands.undo()).toBe(true);
        expect(
          livingDeskSnapshot().findings.find((f) => f.id === "stance")?.count,
        ).toBe(2);
        let requested: unknown;
        const listener = (event: Event) => {
          requested = (event as CustomEvent).detail;
        };
        window.addEventListener(LIVE_REVIEW_REQUEST_EVENT, listener);
        controller.confirm();
        window.removeEventListener(LIVE_REVIEW_REQUEST_EVENT, listener);
        expect(requested).toEqual({ folioId: "batch" });
        window.dispatchEvent(
          new window.CustomEvent(LIVING_DESK_TOGGLE_EVENT, {
            detail: { open: true },
          }),
        );
        expect(livingDeskSnapshot().open).toBe(true);
        controller.markDeliberate("stance", true);
        expect(
          livingDeskSnapshot().findings.find((f) => f.id === "stance")?.state,
        ).toBe("deliberate");
        expect(controller.applyAll("stance")).toBe(0);
        controller.markDeliberate("stance", false);
        expect(controller.applyAll("stance")).toBe(2);
      } finally {
        stop();
      }
      expect(livingDeskController()).toBeNull();
      expect(editor.view.dom.querySelector(".ld-occ")).toBeNull();
    },
  );
});

test("an edited stale span is refused", async () => {
  await withEditor(
    { content, extensions: [LivingDeskDecorations] },
    ({ editor }) => {
      const stop = startLivingDesk(editor, {
        folioId: "stale",
        getClient: () => null,
      });
      try {
        const old = livingDeskSnapshot().findings.find(
          (f) => f.id === "stance",
        )!.occurrences[0];
        editor.view.dispatch(
          editor.state.tr.insertText("They", old.from, old.to),
        );
        expect(livingDeskController()!.applyFix("stance", old.id)).toBe(false);
        expect(editor.getText()).toContain("They argue");
        expect(
          livingDeskSnapshot()
            .findings.find((f) => f.id === "stance")
            ?.occurrences.find((o) => o.id === old.id)?.note,
        ).toBe("This changed since it was found");
      } finally {
        stop();
      }
    },
  );
});

test("full editor recompute on a 5k-word manuscript is measured", async () => {
  const text =
    "I recall my childhood and my home near Hollins. We argue for the color of the sky. " +
    "The river carried stories past the old village. ".repeat(4);
  await withEditor(
    {
      content: Array.from({ length: 100 }, () => `<p>${text}</p>`).join(""),
      extensions: [LivingDeskDecorations],
    },
    ({ editor }) => {
      const stop = startLivingDesk(editor, {
        folioId: "perf",
        getClient: () => null,
      });
      try {
        console.info(
          `Living desk editor 5,500 words: ${livingDeskRecomputeMs.toFixed(1)} ms (segmentation + analysis + score, before decoration publication)`,
        );
        expect(livingDeskRecomputeMs).toBeLessThan(300);
      } finally {
        stop();
      }
    },
  );
});

test("deliberate occurrence signatures survive reload and only new drift is flagged", async () => {
  await withEditor(
    { content, extensions: [LivingDeskDecorations] },
    async ({ editor }) => {
      const storage = new Map<string, string>();
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
        },
      });
      const start = () =>
        startLivingDesk(editor, { folioId: "persist", getClient: () => null });
      let stop = start();
      try {
        livingDeskController()!.markDeliberate("stance", true);
        expect(storage.get("living-desk-deliberate:persist")).toBe(
          '["stance"]',
        );
        livingDeskController()!.setOpen(true);
        stop();
        stop = start();
        expect(livingDeskSnapshot().open).toBe(true);
        expect(
          livingDeskSnapshot().findings.find((f) => f.id === "stance"),
        ).toMatchObject({ state: "deliberate", count: 0 });
        editor.commands.setContent(
          content.replace("We think it helps", "We contend it helps"),
        );
        await new Promise((resolve) => setTimeout(resolve, 450));
        expect(
          livingDeskSnapshot().findings.find((f) => f.id === "stance"),
        ).toMatchObject({ state: "open", count: 1 });
        stop();
        stop = start();
        const reloaded = livingDeskSnapshot().findings.find(
          (f) => f.id === "stance",
        )!;
        expect(reloaded.count).toBe(1);
        expect(
          reloaded.occurrences.find((o) => o.after.includes("argue")),
        ).toMatchObject({ flagged: false, label: "deliberate" });
        editor.commands.setContent(
          content.replace("We think it helps", "We contend it helps") +
            "<p>We believe the bridge is needed.</p>",
        );
        await new Promise((resolve) => setTimeout(resolve, 450));
        expect(
          livingDeskSnapshot().findings.find((f) => f.id === "stance")?.count,
        ).toBe(2);
      } finally {
        stop();
      }
    },
  );
});

test("large manuscripts publish a limited status rather than a clean bill", async () => {
  await withEditor(
    {
      content: `<p>${"long draft ".repeat(8100)}</p>`,
      extensions: [LivingDeskDecorations],
    },
    ({ editor }) => {
      const stop = startLivingDesk(editor, {
        folioId: "long",
        getClient: () => null,
      });
      try {
        expect(livingDeskSnapshot().analysisStatus).toBe("limited");
        expect(livingDeskSnapshot().score.estimate).toBeNull();
      } finally {
        stop();
      }
    },
  );
});

test("a stale loaded reading keeps the estimate marker until the exact draft is confirmed", async () => {
  await withEditor(
    { content, extensions: [LivingDeskDecorations] },
    async ({ editor }) => {
      const currentFingerprint = await rubricDraftFingerprint(
        htmlToPlainText(editor.getHTML()),
      );
      let review = {
        folioId: "review",
        status: "waiting",
        result: {
          folioId: "review",
          at: 100,
          fingerprint: "an older draft",
          rubric: {
            overallScore: 78,
            overallGrade: "B",
            staticScore: scoreStaticFeatures("older prose"),
            criteria: [],
          },
        },
      } as unknown as liveReviewModule.LiveReviewSnapshot;
      const read = spyOn(
        liveReviewModule,
        "liveReviewSnapshot",
      ).mockImplementation(() => review);
      const stop = startLivingDesk(editor, {
        folioId: "review",
        getClient: () => null,
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(livingDeskSnapshot().score.confirmed).toBe(7.8);
        expect(livingDeskSnapshot().score.editsSinceConfirmed).toBeGreaterThan(
          0,
        );
        review = {
          ...review,
          status: "current",
          result: {
            ...review.result!,
            at: 101,
            fingerprint: currentFingerprint,
          },
        };
        window.dispatchEvent(new window.CustomEvent("twyne:live-review"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(livingDeskSnapshot().score.editsSinceConfirmed).toBe(0);
        expect(
          livingDeskSnapshot().score.criteria.every((c) => c.delta === 0),
        ).toBe(true);
      } finally {
        stop();
        read.mockRestore();
      }
    },
  );
});
