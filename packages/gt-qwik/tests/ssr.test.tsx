/**
 * Integration smoke test that imports the *built* `gt-qwik` library and
 * renders Qwik trees with different locales through `renderToString`.
 *
 * The point is to prove that the published `dist/` is consumable by a Qwik
 * app — that `component$` was correctly extracted with the `.qwik.mjs`
 * suffix the Qwik optimizer recognizes, no stray `dist/_chunks/qwik.tsx`
 * is required at the wrong path, and the per-tree locale state stays
 * isolated between renders.
 *
 * Run `bun run build` first; this test imports the built artifacts.
 */
/** @jsxImportSource @qwik.dev/core */
import "./preload";
import { describe, expect, test } from "bun:test";
import { component$ } from "@qwik.dev/core";
import { renderToString } from "@qwik.dev/core/server";
import {
  createGTState,
  GTProvider,
  setLocale,
  setLocaleQrl,
  translate,
  useTranslate,
} from "../dist/index.qwik.mjs";
import { hashMessage } from "gt-i18n/internal";

const welcome = "Hello, {name}!";
const config = {
  defaultLocale: "en",
  locales: ["en", "fr"],
  dictionary: {
    settings: { title: "Settings", welcome },
  },
  catalogs: {
    fr: {
      [hashMessage("Settings", { $format: "ICU" })]: "Paramètres",
      [hashMessage(welcome, { $format: "ICU" })]: "Bonjour, {name} !",
    },
  },
};

describe("built dist SSR", () => {
  test("dist exports the public Qwik + runtime surface", () => {
    expect(typeof GTProvider).toBe("function");
    expect(typeof useTranslate).toBe("function");
    expect(typeof setLocaleQrl).toBe("function");
    expect(typeof createGTState).toBe("function");
    expect(typeof setLocale).toBe("function");
    expect(typeof translate).toBe("function");
  });

  test("runtime-only entry works without the Qwik provider", () => {
    const state = createGTState(config, "fr");
    expect(translate(state, "settings.title")).toBe("Paramètres");
    expect(translate(state, "settings.welcome", { name: "Ada" })).toBe(
      "Bonjour, Ada !",
    );
  });

  test("regional locale resolution falls back to the supported base", () => {
    const state = createGTState(config, "fr-CA");
    expect(state.locale).toBe("fr");
  });

  test("concurrent provider renders keep distinct locales", async () => {
    const Greeting = component$(() => {
      const t = useTranslate();
      return <p>{t("settings.welcome", { name: "Camille" })}</p>;
    });

    const [english, french] = await Promise.all([
      renderToString(
        <GTProvider config={config} initialLocale="en">
          <Greeting />
        </GTProvider>,
      ),
      renderToString(
        <GTProvider config={config} initialLocale="fr">
          <Greeting />
        </GTProvider>,
      ),
    ]);
    const enHtml = english.html;
    const frHtml = french.html;

    expect(enHtml).toContain("Hello, Camille!");
    expect(frHtml).toContain("Bonjour, Camille !");
    expect(enHtml).not.toContain("Bonjour");
  });

  test("provider state is plain JSON-serializable for SSR resume", () => {
    const state = createGTState(config, "fr");
    const round = JSON.parse(JSON.stringify(state));
    expect(round.locale).toBe("fr");
    expect(translate(round, "settings.title")).toBe("Paramètres");
  });
});
