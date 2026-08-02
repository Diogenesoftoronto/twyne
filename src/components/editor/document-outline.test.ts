import { describe, expect, test } from "bun:test";
import { focusOutlineHeadingElement } from "./document-outline";

describe("focusOutlineHeadingElement", () => {
  test("focuses and scrolls a generated heading id", () => {
    const focusCalls: unknown[][] = [];
    const scrollCalls: unknown[][] = [];
    const attributes = new Map<string, string>();
    const element = {
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
      focus: (...args: unknown[]) => focusCalls.push(args),
      scrollIntoView: (...args: unknown[]) => scrollCalls.push(args),
    } as unknown as HTMLElement;
    const root = {
      querySelector: (selector: string) => {
        expect(selector).toContain("chapter");
        return element;
      },
    } as unknown as ParentNode;

    expect(focusOutlineHeadingElement("chapter", root)).toBe(true);
    expect(attributes.get("tabindex")).toBe("-1");
    expect(focusCalls).toHaveLength(1);
    expect(scrollCalls).toHaveLength(1);
  });

  test("reports a missing heading without throwing", () => {
    const root = {
      querySelector: () => null,
    } as unknown as ParentNode;
    expect(focusOutlineHeadingElement("missing", root)).toBe(false);
  });
});
