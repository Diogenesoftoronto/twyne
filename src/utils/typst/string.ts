/** Quote literal text without depending on browser export modules. */
export function typstString(value: string): string {
  return (
    '"' +
    // Typst requires control bytes to be escaped in string literals.
    // eslint-disable-next-line no-control-regex
    value.replace(/["\\\u0000-\u001f\u007f]/g, (c) => {
      if (c === '"' || c === "\\") return "\\" + c;
      if (c === "\n") return "\\n";
      if (c === "\r") return "\\r";
      if (c === "\t") return "\\t";
      return "\\u{" + c.charCodeAt(0).toString(16) + "}";
    }) +
    '"'
  );
}
