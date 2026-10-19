/**
 * Editorial roles — named, typographically distinct blocks that a piece of
 * writing has beyond "paragraph" and "heading": subtitle, kicker, standfirst,
 * epigraph, scene break, and the kit-specific abstract / cue / direction.
 *
 * Each role is persisted as `<div data-role="…" class="twyne-role-…">`, so the
 * HTML (and the Typst source bridge, which wraps every element generically)
 * stays valid for editors that do not know the role. The exporter maps each
 * role onto a `#twyne-…` function defined in `typst/theme.ts`.
 */
import { Node, mergeAttributes } from "@tiptap/core";

export type SceneBreakStyle = "ornament" | "rule" | "space";
export const SCENE_BREAK_STYLES: readonly SceneBreakStyle[] = [
  "ornament",
  "rule",
  "space",
];

interface TextRole {
  name: string;
  role: string;
  command: string;
}

const TEXT_ROLES: readonly TextRole[] = [
  { name: "subtitle", role: "subtitle", command: "Subtitle" },
  { name: "kicker", role: "kicker", command: "Kicker" },
  { name: "standfirst", role: "standfirst", command: "Standfirst" },
  { name: "abstract", role: "abstract", command: "Abstract" },
  { name: "characterCue", role: "character-cue", command: "CharacterCue" },
  {
    name: "stageDirection",
    role: "stage-direction",
    command: "StageDirection",
  },
];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    editorialRoles: {
      toggleSubtitle: () => ReturnType;
      toggleKicker: () => ReturnType;
      toggleStandfirst: () => ReturnType;
      toggleAbstract: () => ReturnType;
      toggleCharacterCue: () => ReturnType;
      toggleStageDirection: () => ReturnType;
      toggleEpigraph: (attributes?: { attribution?: string }) => ReturnType;
      setSceneBreak: (attributes?: { style?: SceneBreakStyle }) => ReturnType;
    };
  }
}

/** One block of inline text with a role. */
function textRole({ name, role, command }: TextRole) {
  return Node.create({
    name,
    group: "block",
    content: "inline*",
    defining: true,
    // Beat `paragraph` and `heading`'s generic `div` fallbacks when parsing.
    priority: 1000,
    parseHTML() {
      return [{ tag: `div[data-role="${role}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, {
          "data-role": role,
          class: `twyne-role-${role}`,
        }),
        0,
      ];
    },
    addCommands() {
      return {
        [`toggle${command}`]:
          () =>
          ({ commands }: { commands: any }) =>
            commands.toggleNode(name, "paragraph"),
      } as any;
    },
  });
}

export const Subtitle = textRole(TEXT_ROLES[0]);
export const Kicker = textRole(TEXT_ROLES[1]);
export const Standfirst = textRole(TEXT_ROLES[2]);
export const Abstract = textRole(TEXT_ROLES[3]);
export const CharacterCue = textRole(TEXT_ROLES[4]);
export const StageDirection = textRole(TEXT_ROLES[5]);

/** A set-off quotation, with an optional attribution rendered after it. */
export const Epigraph = Node.create({
  name: "epigraph",
  group: "block",
  content: "inline*",
  defining: true,
  priority: 1000,
  addAttributes() {
    return {
      attribution: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-attribution") ?? "",
        renderHTML: (attrs) =>
          attrs.attribution ? { "data-attribution": attrs.attribution } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-role="epigraph"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-role": "epigraph",
        class: "twyne-role-epigraph",
      }),
      0,
    ];
  },
  addCommands() {
    return {
      toggleEpigraph:
        (attributes) =>
        ({ commands, editor }) =>
          editor.isActive(this.name)
            ? commands.setNode("paragraph")
            : commands.setNode(this.name, attributes),
    };
  },
});

/** A section break inside a piece. An atom: it has no text of its own. */
export const SceneBreak = Node.create({
  name: "sceneBreak",
  group: "block",
  atom: true,
  selectable: true,
  priority: 1000,
  addAttributes() {
    return {
      style: {
        default: "ornament" as SceneBreakStyle,
        parseHTML: (el) => {
          const style = el.getAttribute("data-style");
          return SCENE_BREAK_STYLES.includes(style as SceneBreakStyle)
            ? style
            : "ornament";
        },
        renderHTML: (attrs) => ({ "data-style": attrs.style }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-role="scene-break"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-role": "scene-break",
        class: "twyne-role-scene-break",
        contenteditable: "false",
      }),
    ];
  },
  addCommands() {
    return {
      setSceneBreak:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { style: attributes?.style ?? "ornament" },
          }),
    };
  },
});

export const EditorialRoles = [
  Subtitle,
  Kicker,
  Standfirst,
  Epigraph,
  SceneBreak,
  Abstract,
  CharacterCue,
  StageDirection,
];
