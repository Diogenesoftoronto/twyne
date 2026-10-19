import { describe, expect, test } from "bun:test";
import {
  createSceneInventory,
  createScenePicturePrompt,
  parseSceneReading,
  type ScenePassage,
} from "./scene-bench";
import {
  LOW_CREDIT_MICROS,
  lowCreditWarning,
  SCENE_PICTURE_BUDGET_MICROS,
} from "./scene-media-credit";
import { modelsDevModelsForFeature } from "./models-dev";

const passage: ScenePassage = {
  id: "scene-media-test",
  sourceOffset: 0,
  text: "At midnight, Mara crossed the kitchen. A lamp flickered above the doorway.",
};

describe("scene picture prompt", () => {
  test("literal mode keeps writer ideas out and asks for visible gaps", () => {
    const prompt = createScenePicturePrompt(
      createSceneInventory(passage),
      "literal",
      [{ dimension: "sound", text: "rain on the glass", origin: "writer" }],
    )!;
    expect(prompt).toContain(passage.text);
    expect(prompt).toContain("Depict only what the passage states");
    expect(prompt).not.toContain("rain on the glass");
  });

  test("imagined mode carries the writer's ideas as considerations", () => {
    const prompt = createScenePicturePrompt(
      createSceneInventory(passage),
      "imagined",
      [{ dimension: "sound", text: "rain on the glass", origin: "writer" }],
    )!;
    expect(prompt).toContain("Sound: rain on the glass");
  });

  test("refuses an empty selection", () => {
    expect(
      createScenePicturePrompt(
        createSceneInventory({ ...passage, text: "  " }),
        "literal",
      ),
    ).toBeNull();
  });
});

describe("scene reading parser", () => {
  test("keeps valid items and tolerates fences", () => {
    const reading = parseSceneReading(
      '```json\n{"items":[{"dimension":"light","detail":"a single lamp","status":"sourced","source":"A lamp flickered"},{"dimension":"place","detail":"tiled floor","status":"invented"},{"dimension":"smell","detail":"bread","status":"invented"}]}\n```',
      passage,
    )!;
    expect(reading.items).toEqual([
      {
        dimension: "light",
        detail: "a single lamp",
        status: "sourced",
        source: "A lamp flickered",
      },
      { dimension: "place", detail: "tiled floor", status: "invented" },
    ]);
  });

  test("a claimed source that is not in the passage counts as invented", () => {
    const reading = parseSceneReading(
      '{"items":[{"dimension":"time","detail":"dawn light","status":"sourced","source":"the sun rose"}]}',
      passage,
    )!;
    expect(reading.items[0]).toEqual({
      dimension: "time",
      detail: "dawn light",
      status: "invented",
    });
  });

  test("returns null for prose", () => {
    expect(parseSceneReading("I cannot see the image.", passage)).toBeNull();
  });
});

describe("credit warnings", () => {
  test("warns when low, says out when a picture no longer fits", () => {
    expect(lowCreditWarning(LOW_CREDIT_MICROS * 5)).toBeNull();
    expect(lowCreditWarning(LOW_CREDIT_MICROS - 1)).toContain("running low");
    expect(lowCreditWarning(SCENE_PICTURE_BUDGET_MICROS - 1)).toContain(
      "run out",
    );
  });
});

describe("image model catalog", () => {
  test("offers image-output models for pictures and vision models for comparison", () => {
    const models = [
      {
        id: "text",
        name: "text",
        modalities: { input: ["text"], output: ["text"] },
      },
      {
        id: "img",
        name: "img",
        modalities: { input: ["text"], output: ["image"] },
      },
      {
        id: "vis",
        name: "vis",
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    ];
    expect(
      modelsDevModelsForFeature(models, "scene-image").map((m) => m.id),
    ).toEqual(["img"]);
    expect(
      modelsDevModelsForFeature(models, "scene-reading").map((m) => m.id),
    ).toEqual(["vis"]);
  });
});
