/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
describe("Typst sync", () => {
  test("round-trips canonical source and rejects destructive legacy writes", async () => {
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "issuer|writer",
    });
    const content = {
      folioId: "native",
      html: "<p>Hello</p>",
      format: "typst" as const,
      typstSource: "#let custom = 42\nHello",
    };
    await t.mutation(api.sync.putFolioContent, content);
    expect(
      await t.query(api.sync.getFolioContent, { folioId: "native" }),
    ).toMatchObject(content);
    await expect(
      t.mutation(api.sync.putFolioContent, {
        folioId: "native",
        html: "<p>Legacy overwrite</p>",
      }),
    ).rejects.toThrow("uses Typst");
    await expect(
      t.mutation(api.sync.pushAll, {
        folioContent: [{ folioId: "native", html: "<p>Legacy overwrite</p>" }],
      }),
    ).rejects.toThrow("uses Typst");
    const pulled = await t.query(api.sync.pullAll, {});
    expect(pulled.folioContent).toContainEqual(
      expect.objectContaining(content),
    );
  });
});
