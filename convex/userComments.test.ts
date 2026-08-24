/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;

describeConvex("user comment resolution", () => {
  test("sets the requested state idempotently", async () => {
    const t = convexTest(schema, modules);
    const writer = t.withIdentity({
      tokenIdentifier: "test-issuer|comment-writer",
    });

    await writer.mutation(api.userComments.addComment, {
      commentId: "comment-1",
      folioId: "folio-1",
      text: "Keep this thread synchronized.",
      author: "Writer",
    });

    await writer.mutation(api.userComments.setCommentResolved, {
      commentId: "comment-1",
      resolved: true,
    });
    await writer.mutation(api.userComments.setCommentResolved, {
      commentId: "comment-1",
      resolved: true,
    });
    expect(
      (await writer.query(api.userComments.listComments, {}))[0]?.resolved,
    ).toBe(true);

    await writer.mutation(api.userComments.setCommentResolved, {
      commentId: "comment-1",
      resolved: false,
    });
    await writer.mutation(api.userComments.setCommentResolved, {
      commentId: "comment-1",
      resolved: false,
    });
    expect(
      (await writer.query(api.userComments.listComments, {}))[0]?.resolved,
    ).toBe(false);
  });
});
