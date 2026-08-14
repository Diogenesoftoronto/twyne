export type CommentEditorKind = "new" | "reply";

export type CommentEditorStyle = Record<string, string>;

/**
 * Responsive editor bounds keep several useful lines visible while handing
 * long-note scrolling to the textarea instead of the surrounding panel.
 */
export function commentEditorStyle(kind: CommentEditorKind): CommentEditorStyle {
  return {
    fontFamily: "var(--font-serif)",
    borderRadius: "2px",
    minHeight:
      kind === "new"
        ? "clamp(7rem, 18dvh, 12rem)"
        : "clamp(6rem, 16dvh, 10rem)",
    maxHeight:
      kind === "new" ? "min(42dvh, 28rem)" : "min(35dvh, 22rem)",
    overflowY: "auto",
    overscrollBehavior: "contain",
    resize: "vertical",
    scrollbarGutter: "stable",
  };
}
