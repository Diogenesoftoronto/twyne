/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { manuscriptCitations, manuscriptWords } from "./achievements";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;

describeConvex("export everything", () => {
  test("zips only the caller's rows, files, and no token secrets", async () => {
    const t = convexTest(schema, modules);
    const writer = t.withIdentity({
      tokenIdentifier: "issuer|writer",
      subject: "writer",
    });
    const other = t.withIdentity({ tokenIdentifier: "issuer|other" });
    await writer.mutation(api.sync.putFolioContent, {
      folioId: "f1",
      html: "<p>Mine</p>",
      typstSource: "Mine",
    });
    await other.mutation(api.sync.putFolioContent, {
      folioId: "f2",
      html: "<p>Theirs</p>",
      typstSource: "Theirs",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("integrationTokens", {
        userId: "issuer|writer",
        tokenHash: "secret-hash",
        prefix: "twy_abc",
        name: "CLI",
        createdAt: 1,
      });
      await ctx.db.insert("lixBlobs", {
        userId: "issuer|writer",
        blob: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
        updatedAt: 1,
      });
    });

    const exportId = await writer.mutation(api.accountExport.requestExport, {});
    // A second request while one is running returns the same job.
    expect(await writer.mutation(api.accountExport.requestExport, {})).toBe(
      exportId,
    );
    await t.action(internal.accountExportBuild.build, { exportId });

    const latest = await writer.query(api.accountExport.getMyLatestExport, {});
    expect(latest?.status).toBe("ready");
    expect(
      await other.query(api.accountExport.getMyLatestExport, {}),
    ).toBeNull();

    const storageId = await t.run(
      async (ctx) => (await ctx.db.get(exportId))!.storageId!,
    );
    const zip = await t.run(
      async (ctx) => await (await ctx.storage.get(storageId))!.arrayBuffer(),
    );
    const files = unzipSync(new Uint8Array(zip));
    const content = JSON.parse(strFromU8(files["data/folioContent.json"]!));
    expect(content.map((row: { html: string }) => row.html)).toEqual([
      "<p>Mine</p>",
    ]);
    const tokens = strFromU8(files["data/integrationTokens.json"]!);
    expect(tokens).toContain("twy_abc");
    expect(tokens).not.toContain("secret-hash");
    const lix = JSON.parse(strFromU8(files["data/lixBlobs.json"]!));
    expect(Array.from(files[lix[0].blob.file]!)).toEqual([1, 2, 3]);
    expect(JSON.parse(strFromU8(files["manifest.json"]!)).achievements).toBe(
      "not-linked",
    );

    await t.mutation(internal.accountExport.expire, { exportId });
    expect(
      await writer.query(api.accountExport.getMyLatestExport, {}),
    ).toBeNull();
  });
});

describe("achievement criteria", () => {
  test("counts words and notes in HTML and Typst manuscripts", () => {
    expect(manuscriptWords("<p>One two&nbsp;three</p><p>— four</p>")).toBe(4);
    expect(manuscriptWords("", "= Title\nSome *bold* words")).toBe(4);
    expect(
      manuscriptCitations(
        '<p>a<sup data-type="footnote">1</sup> b<sup data-type="endnote">2</sup><sup>x</sup></p>',
      ),
    ).toBe(2);
    expect(manuscriptCitations("", "Text #footnote[a] and #cite(<k>)")).toBe(2);
  });
});
