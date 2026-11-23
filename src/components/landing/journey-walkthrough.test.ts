import { describe, expect, test } from "bun:test";
import english from "../../i18n/landing/messages/en.json";
import { SUPPORTED_LOCALES } from "../../i18n/locale";
import { JOURNEYS } from "./journey-walkthrough";

type Tree = { [key: string]: string | Tree };

const entries = (tree: Tree, path = ""): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]) => {
    const id = path ? `${path}.${key}` : key;
    return typeof value === "string" ? [[id, value]] : entries(value, id);
  });

const ENGLISH = Object.fromEntries(entries(english as Tree));

/**
 * The walkthrough reads its narration by convention
 * (`walk.<copy>.s<n>Kicker|Title|Body`). A view added without copy, or copy
 * left behind after a view is removed, should fail here rather than render a
 * thrown id on the landing page.
 */
describe("landing walkthroughs", () => {
  test("every step has narration and every narration has a step", () => {
    for (const journey of JOURNEYS) {
      const steps = Object.keys(ENGLISH)
        .map((id) =>
          id.match(new RegExp(`^walk\\.${journey.copy}\\.s(\\d+)Title$`)),
        )
        .filter(Boolean).length;
      expect(steps).toBe(journey.views.length);
      for (let n = 1; n <= journey.views.length; n++) {
        for (const part of ["Kicker", "Title", "Body"]) {
          expect(ENGLISH[`walk.${journey.copy}.s${n}${part}`]).toBeString();
        }
      }
      expect(ENGLISH[`walk.${journey.copy}.tab`]).toBeString();
      expect(ENGLISH[`walk.${journey.copy}.tabSub`]).toBeString();
    }
  });

  test("Twyne Publishing journeys are labelled as in development", () => {
    // Every journey here comes from the publishing lab. If one ships, flip
    // its availability and drop the "In development" framing deliberately.
    expect(JOURNEYS.every((journey) => journey.availability === "coming")).toBe(
      true,
    );
  });
});

describe("landing copy", () => {
  test("has no em-dash asides", () => {
    const dashed = Object.entries(ENGLISH).filter(([, text]) =>
      text.includes("—"),
    );
    expect(dashed).toEqual([]);
  });

  test("every locale translates every landing string", async () => {
    const ids = Object.keys(ENGLISH).sort();
    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== "en")) {
      const translated = (await import(
        `../../i18n/landing/messages/${locale}.json`
      )) as { default: Tree };
      const ours = Object.fromEntries(entries(translated.default));
      expect(Object.keys(ours).sort()).toEqual(ids);
      for (const id of ids) {
        const placeholders = (text: string) =>
          [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
        expect([id, placeholders(ours[id])]).toEqual([
          id,
          placeholders(ENGLISH[id]),
        ]);
      }
    }
  });
});
