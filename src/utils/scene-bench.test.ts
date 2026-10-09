import { describe, expect, test } from "bun:test";
import {
  createSceneInventory,
  createSceneJudgementRequest,
  createSceneMediaBrief,
  MAX_SCENE_CHARACTERS,
  resolveSceneJudgement,
  SCENE_DIMENSIONS,
  SCENE_TENSION_OPTIONS,
  sceneSnapshotMatches,
  sceneSpanMatches,
  type ScenePassage,
} from "./scene-bench";
import type { JudgementResult } from "./judgement-client";

const passage: ScenePassage = {
  id: "scene-test",
  sourceOffset: 73,
  text: "At midnight, Mara crossed the kitchen. A lamp flickered above the doorway. She heard footsteps outside. She needed the letter, but the door was blocked.",
};
function response(text = passage): JudgementResult {
  const inventory = createSceneInventory(text);
  const options = ["none", ...inventory.spans.map((span) => span.id)];
  const pick = (selected: string, choices: readonly string[]) => ({
    type: "choice",
    choice: selected,
    confidence: 0.9,
    probabilities: Object.fromEntries(
      choices.map((key) => [
        key,
        key === selected ? 0.9 : 0.1 / (choices.length - 1),
      ]),
    ),
  });
  return {
    ok: true,
    model: "jev-test-fixture",
    transport: "endpoint",
    answers: {
      ...Object.fromEntries(
        SCENE_DIMENSIONS.map(({ id }) => [
          id,
          pick(inventory.dimensions[id][0]?.spanId ?? "none", options),
        ]),
      ),
      tensionLevel: pick("under-pressure", SCENE_TENSION_OPTIONS),
    },
  };
}

describe("scene inventory evidence", () => {
  test("keeps every quote tied to exact UTF-16 source offsets", () => {
    const source = {
      ...passage,
      text: "  🪟 The lamp flickered.\n\nMara crossed the room.  ",
    };
    const inventory = createSceneInventory(source);
    expect(inventory.status).toBe("ready");
    expect(inventory.spans).toHaveLength(2);
    for (const span of inventory.spans) {
      expect(source.text.slice(span.start, span.end)).toBe(span.text);
      expect(sceneSpanMatches(span, source)).toBe(true);
      expect(span.sourceOffset).toBe(source.sourceOffset + span.start);
    }
  });

  test("identical sentences keep distinct locations", () => {
    const source = {
      ...passage,
      text: "The lamp flickered. The lamp flickered.",
    };
    const inventory = createSceneInventory(source);
    expect(inventory.spans[0].text).toBe(inventory.spans[1].text);
    expect(inventory.spans[0].sourceOffset).not.toBe(
      inventory.spans[1].sourceOffset,
    );
    expect(inventory.dimensions.light.map((cue) => cue.spanId)).toEqual([
      "span-0",
      "span-1",
    ]);
  });

  test("unrecognized or non-English details stay unclassified", () => {
    const inventory = createSceneInventory({
      ...passage,
      text: "La pièce était sombre. Rien ne bougeait.",
    });
    expect(inventory.status).toBe("ready");
    expect(Object.values(inventory.dimensions).flat()).toHaveLength(0);
    expect(inventory.passage.text).toContain("sombre");
  });

  test("local cues remain labeled cues, including figurative language", () => {
    const inventory = createSceneInventory({
      ...passage,
      text: "She heard the news. The light of reason returned.",
    });
    expect(inventory.dimensions.sound[0]).toEqual({
      spanId: "span-0",
      cue: "heard",
      provenance: "local-cue",
    });
    expect(inventory.dimensions.light[0].provenance).toBe("local-cue");
  });

  test("limits are explicit and never produce a sampled complete inventory", () => {
    for (const source of [
      { ...passage, text: "x".repeat(MAX_SCENE_CHARACTERS + 1) },
      { ...passage, text: "Mara crossed the room. ".repeat(65) },
      { ...passage, sourceOffset: -1 },
      { ...passage, sourceOffset: Number.MAX_SAFE_INTEGER },
    ]) {
      const inventory = createSceneInventory(source);
      expect(inventory.status).toBe("limited");
      expect(inventory.spans).toHaveLength(0);
      expect(createSceneJudgementRequest(inventory)).toBeNull();
      expect(createSceneMediaBrief(inventory, "image")).toBeNull();
    }
    expect(createSceneInventory({ ...passage, text: " \n " }).status).toBe(
      "empty",
    );
  });
});

describe("scene model selection", () => {
  test("refuses a candidate whose quote no longer matches the snapshot", () => {
    const inventory = createSceneInventory(passage);
    inventory.spans[0].text = "An invented room.";
    expect(createSceneJudgementRequest(inventory)).toBeNull();
    expect(resolveSceneJudgement(inventory, response())).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
  test("asks one bounded evidence choice per dimension plus scene pressure", () => {
    const inventory = createSceneInventory(passage);
    const request = createSceneJudgementRequest(inventory)!;
    expect(Object.keys(request.questions)).toHaveLength(7);
    expect(request.state.passage).toBe(passage.text);
    expect(JSON.parse(request.state.spans)["span-0"]).toBe(
      inventory.spans[0].text,
    );
    expect(
      (request.questions.sound as { criteria: string[] }).criteria,
    ).toEqual(["none", "span-0", "span-1", "span-2", "span-3"]);
  });

  test("valid results preserve model provenance and only select original spans", () => {
    const result = resolveSceneJudgement(
      createSceneInventory(passage),
      response(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assessment.model).toBe("jev-test-fixture");
    expect(result.assessment.dimensions.sound.spanId).toBe("span-2");
    expect(result.assessment.passage).toEqual(passage);
    expect(result.assessment.tension.choice).toBe("under-pressure");
  });

  test("rejects invented IDs, missing distributions, non-finite and malformed probabilities", () => {
    for (const mutate of [
      (r: JudgementResult) => {
        (r.answers!.sound as { choice: string }).choice =
          "an invented rainy street";
      },
      (r: JudgementResult) => {
        delete r.answers!.place;
      },
      (r: JudgementResult) => {
        (
          r.answers!.sound as { probabilities: Record<string, number> }
        ).probabilities.none = NaN;
      },
      (r: JudgementResult) => {
        (
          r.answers!.sound as { probabilities: Record<string, number> }
        ).probabilities.none = -0.1;
      },
      (r: JudgementResult) => {
        (
          r.answers!.sound as { probabilities: Record<string, number> }
        ).probabilities["invented"] = 0.2;
      },
      (r: JudgementResult) => {
        (
          r.answers!.sound as { probabilities: Record<string, number> }
        ).probabilities.none = 0.8;
      },
      (r: JudgementResult) => {
        r.model = undefined;
      },
    ]) {
      const r = response();
      mutate(r);
      expect(resolveSceneJudgement(createSceneInventory(passage), r)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  test("uncertainty stays visible instead of becoming a factual selection", () => {
    const r = response();
    const probabilities = Object.fromEntries(
      ["none", "span-0", "span-1", "span-2", "span-3"].map((id) => [id, 0.2]),
    );
    r.answers!.sound = {
      type: "choice",
      choice: "span-2",
      confidence: 0,
      probabilities,
    };
    const result = resolveSceneJudgement(createSceneInventory(passage), r);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.assessment.dimensions.sound.state).toBe("uncertain");
  });

  test("does not attach a response to an edited, moved, or different selection", () => {
    const inventory = createSceneInventory(passage);
    for (const current of [
      { ...passage, text: passage.text + " " },
      { ...passage, sourceOffset: 74 },
      { ...passage, id: "other-folio" },
    ]) {
      expect(sceneSnapshotMatches(inventory, current)).toBe(false);
      expect(resolveSceneJudgement(inventory, response(), current)).toEqual({
        ok: false,
        reason: "stale",
      });
    }
    expect(resolveSceneJudgement(inventory, { ok: false })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("local media briefs", () => {
  test("keeps exact evidence and writer additions in separate labeled sections", () => {
    const brief = createSceneMediaBrief(
      createSceneInventory(passage),
      "sound",
      [{ dimension: "sound", text: "A distant ferry horn.", origin: "writer" }],
    )!;
    expect(brief).toContain(passage.text);
    expect(brief.indexOf("not facts from the manuscript")).toBeLessThan(
      brief.indexOf("A distant ferry horn."),
    );
    expect(brief).toContain("does not authorize a provider request");
    expect(passage.text).not.toContain("ferry horn");
  });

  test("does not treat lack of a local cue as proof a detail is absent", () => {
    const brief = createSceneMediaBrief(
      createSceneInventory({ ...passage, text: "She understood." }),
      "image",
    )!;
    expect(brief).toContain("absence of a cue is not proof of absence");
    expect(brief).toContain("place, time, light, sound, movement, pressure");
    expect(brief).toContain("None.");
  });
});
