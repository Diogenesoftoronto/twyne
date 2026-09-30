import { afterAll, beforeAll, expect, test } from "bun:test";
// @ts-expect-error jsdom is intentionally untyped in this project's test harness.
import { JSDOM } from "jsdom";
import { prepareTypstAssets } from "./render-assets";
import { typstString } from "./string";

const originals = new Map(
  ["window", "fetch"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]),
);
const requests: string[] = [];
beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: new JSDOM("", { url: "https://twyne.test/" }).window,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: URL) => {
      requests.push(url.href);
      return url.pathname === "/active.png"
        ? new Response(new Uint8Array([1, 2, 3]))
        : new Response("missing", { status: 404 });
    },
  });
});
afterAll(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("comments, quoted literals, raw fences and escaped helper names do not resolve assets", async () => {
  const image = '#twyne-image("/missing.png", width: 50%, alt: "Missing")';
  const ignored = [
    `// ${image}\n// #twyne-math("\\\\invalid", block: true)`,
    `/* #twyne-mermaid("invalid diagram") /* nested comment */ ${image} */`,
    `#text(${typstString(image)})`,
    `#let example = ${typstString('#twyne-mermaid("invalid diagram")')}`,
    `\`${image}\``,
    `\`\`\`typst\n#twyne-math("invalid", block: true)\n${image}\n\`\`\``,
    `\\${image}`,
  ].join("\n\n");
  const before = requests.length;
  expect(await prepareTypstAssets(ignored)).toBe(ignored);
  expect(requests.length).toBe(before);
  const source =
    ignored + '\n#twyne-image("/active.png", width: 50%, alt: "Active")';
  const prepared = await prepareTypstAssets(source);
  expect(prepared).toStartWith(ignored);
  expect(prepared).toContain(
    '#image(bytes((1,2,3,)), width: 50%, alt: "Active")',
  );
  expect(requests.slice(before)).toEqual(["https://twyne.test/active.png"]);
});

test("an executable unavailable image still rejects asset preparation", async () => {
  await expect(
    prepareTypstAssets('#twyne-image("/missing.png", width: 100%, alt: "")'),
  ).rejects.toThrow("could not be loaded");
});
