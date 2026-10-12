// Generated from the original editor by build-helper.ts.
export function findTextRange(
  doc: any,
  quote: string,
): { from: number; to: number } | null {
  // Whitespace-tolerant: the quote may come from tag-stripped HTML where
  // inline markup left extra spaces behind.
  const escaped = quote
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  if (!escaped) return null;
  const pattern = new RegExp(escaped);

  let found: { from: number; to: number } | null = null;
  doc.descendants((node: any, pos: number) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    let text = "";
    const positions: number[] = [];
    node.forEach((child: any, offset: number) => {
      if (!child.isText || !child.text) return;
      for (let i = 0; i < child.text.length; i++) {
        positions.push(pos + 1 + offset + i);
      }
      text += child.text;
    });
    const match = pattern.exec(text);
    if (match) {
      found = {
        from: positions[match.index],
        to: positions[match.index + match[0].length - 1] + 1,
      };
    }
    return false;
  });
  return found;
}
