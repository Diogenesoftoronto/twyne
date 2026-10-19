import { afterAll, beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error — jsdom ships JS only; no @types/jsdom is installed.
import { JSDOM } from "jsdom";
import { withEditor } from "../test-harness";
import { EditorialRoles } from "./editorial-roles";
import { serializeTypst } from "../../../utils/typst/serialize";
import { htmlToTypst, typstToHtml } from "../../../utils/typst/document";
import {
  getEditorCommand,
  getSlashCommands,
} from "../../../utils/editor-commands";
import { KITS } from "../../../utils/typst/kits";
import { DEFAULT_LAYOUT } from "../../../types";

const dom = new JSDOM("", { url: "https://twyne.test/" });
const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
beforeAll(() =>
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    writable: true,
    value: dom.window.DOMParser,
  }),
);
afterAll(() => {
  if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
  else Reflect.deleteProperty(globalThis, "DOMParser");
});

const options = (content: string) => ({
  content,
  extensions: EditorialRoles,
});
const typst = (html: string) =>
  serializeTypst({ title: "T", html, layout: DEFAULT_LAYOUT }).source;

const textRoles = [
  ["toggleSubtitle", "subtitle", "twyne-subtitle"],
  ["toggleKicker", "kicker", "twyne-kicker"],
  ["toggleStandfirst", "standfirst", "twyne-standfirst"],
  ["toggleAbstract", "abstract", "twyne-abstract"],
  ["toggleCharacterCue", "character-cue", "twyne-cue"],
  ["toggleStageDirection", "stage-direction", "twyne-direction"],
] as const;

describe("editorial roles", () => {
  for (const [command, role, fn] of textRoles) {
    test(`${role}: command inserts, HTML round-trips, Typst serializes`, async () => {
      await withEditor(options("<p>Words</p>"), ({ editor, html }) => {
        editor.commands.setTextSelection(2);
        expect((editor.commands as any)[command]()).toBe(true);
        expect(html()).toContain(`data-role="${role}"`);
        expect(html()).toContain(`twyne-role-${role}`);
        const saved = html();
        editor.commands.setContent(saved);
        expect(html()).toBe(saved);
        expect(typst(saved)).toContain(`#${fn}[#text("Words")]`);
        // Toggling again returns to a paragraph.
        editor.commands.setTextSelection(2);
        (editor.commands as any)[command]();
        expect(html()).not.toContain("data-role");
        expect(html()).toContain("<p>Words</p>");
      });
    });

    test(`${role}: Typst source parses back to the role`, () => {
      const source = htmlToTypst(`<div data-role="${role}">Words</div>`);
      expect(typstToHtml(source)).toContain(`data-role="${role}"`);
      const bare = `#${fn}[Plain words]`;
      expect(typstToHtml(bare)).toBe(
        `<div data-role="${role}">Plain words</div>`,
      );
    });
  }

  test("epigraph carries an attribution through HTML and Typst", async () => {
    await withEditor(options("<p>Quote</p>"), ({ editor, html }) => {
      editor.commands.setTextSelection(2);
      expect(editor.commands.toggleEpigraph({ attribution: "Ovid" })).toBe(
        true,
      );
      expect(html()).toContain('data-attribution="Ovid"');
      const saved = html();
      editor.commands.setContent(saved);
      expect(html()).toBe(saved);
      expect(typst(saved)).toContain(
        '#twyne-epigraph(attribution: [#text("Ovid")])[#text("Quote")]',
      );
      expect(typstToHtml("#twyne-epigraph(attribution: [Ovid])[Quote]")).toBe(
        '<div data-role="epigraph" data-attribution="Ovid">Quote</div>',
      );
    });
  });

  test("epigraph without attribution has no argument", () => {
    expect(typst('<div data-role="epigraph">Quote</div>')).toContain(
      '#twyne-epigraph()[#text("Quote")]',
    );
  });

  test("scene break inserts for each style and serializes", async () => {
    for (const style of ["ornament", "rule", "space"] as const) {
      await withEditor(options("<p>One</p>"), ({ editor, html }) => {
        expect(editor.commands.setSceneBreak({ style })).toBe(true);
        expect(html()).toContain(`data-style="${style}"`);
        const saved = html();
        editor.commands.setContent(saved);
        expect(html()).toBe(saved);
        expect(typst(saved)).toContain(`#twyne-scene-break(style: "${style}")`);
        expect(typstToHtml(`#twyne-scene-break(style: "${style}")`)).toBe(
          `<div data-role="scene-break" data-style="${style}"></div>`,
        );
      });
    }
  });

  test("unrecognised role calls fall back to opaque Typst without throwing", () => {
    for (const source of [
      '#twyne-scene-break(style: "confetti")',
      "#twyne-subtitle(weird: 1)[Words]",
      "#twyne-epigraph(attribution: [*Ovid*])[Quote]",
      "#twyne-kicker[Unclosed",
    ]) {
      const html = typstToHtml(source);
      expect(html).toContain("raw-typst");
    }
  });

  test("the command registry exposes every role in the Piece group", () => {
    for (const id of [
      "role.subtitle",
      "role.kicker",
      "role.standfirst",
      "role.epigraph",
      "role.scene-break",
      "role.abstract",
      "role.character-cue",
      "role.stage-direction",
    ]) {
      expect(getEditorCommand(id)?.slash?.group).toBe("Piece");
    }
    expect(getEditorCommand("paragraph.heading-2")?.searchTerms).not.toContain(
      "subtitle",
    );
  });
  test("the slash menu only offers Piece commands the active kit enables", () => {
    const ids = (kit: keyof typeof KITS) =>
      getSlashCommands("", { kitCommands: KITS[kit].roles })
        .filter((c) => c.slash?.group === "Piece")
        .map((c) => c.id);
    expect(ids("essay")).toEqual([
      "role.subtitle",
      "role.kicker",
      "role.standfirst",
      "role.epigraph",
      "role.scene-break",
    ]);
    expect(ids("paper")).toContain("role.abstract");
    expect(ids("paper")).not.toContain("role.character-cue");
    expect(ids("play")).toContain("role.stage-direction");
    expect(ids("technical")).toContain("code.highlight-lines");
    // Without a kit in context nothing is hidden.
    expect(
      getSlashCommands("", {}).filter((c) => c.slash?.group === "Piece"),
    ).toHaveLength(9);
  });
});
