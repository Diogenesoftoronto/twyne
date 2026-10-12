import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = {
  "./native.ts": () => import("./native"),
  "./_generated/server.ts": () => import("./_generated/server"),
};
const session = makeFunctionReference<"query">("native:session");

describe("native session identity", () => {
  test("an unauthenticated client receives no account", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(session, {})).toBeNull();
  });

  test("returns only the authenticated identity, with the exact issuer", async () => {
    const t = convexTest(schema, modules);
    const issuer = "https://writer.convex.site/";
    const writer = t.withIdentity({
      issuer,
      subject: "writer",
      tokenIdentifier: `${issuer}|writer`,
      email: "private@example.com",
      name: "Writer",
    });
    expect(await writer.query(session, {})).toEqual({
      issuer,
      subject: "writer",
      tokenIdentifier: `${issuer}|writer`,
    });
    const other = t.withIdentity({
      issuer: "https://other.convex.site",
      subject: "writer",
      tokenIdentifier: "https://other.convex.site|writer",
    });
    expect(await other.query(session, {})).toEqual({
      issuer: "https://other.convex.site",
      subject: "writer",
      tokenIdentifier: "https://other.convex.site|writer",
    });
  });

  test("rejects caller-supplied account claims", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(session, { subject: "someone-else" }),
    ).rejects.toThrow();
  });
});
