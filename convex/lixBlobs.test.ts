import { describe, expect, test } from "bun:test";
import { get, upsert } from "./lixBlobs";

type QueryPredicate = { field: string; value: unknown };

function makeCtx(identity: string | null) {
  const rows: Array<Record<string, unknown>> = [];
  const predicates: QueryPredicate[] = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () =>
        identity ? { tokenIdentifier: identity } : null,
    },
    db: {
      query: () => ({
        withIndex: (_name: string, cb: (q: unknown) => unknown) => {
          cb({
            eq: (field: string, value: unknown) => {
              predicates.push({ field, value });
              return {};
            },
          });
          return {
            first: async () => rows[0] ?? null,
          };
        },
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      insert: async (_table: string, value: Record<string, unknown>) => {
        rows.push({ _id: "row-1", ...value });
        return "row-1";
      },
    },
    rows,
    predicates,
    patches,
  };

  return ctx;
}

/** Reach the internal handler on a registered query/mutation. */
function handler<T>(fn: unknown): T {
  return (fn as { _handler: T })._handler;
}

describe("lixBlobs auth", () => {
  test("upsert derives the persisted userId from Convex auth", async () => {
    const ctx = makeCtx("auth-user");
    const blob = new ArrayBuffer(1);

    await handler<(ctx: unknown, args: { blob: ArrayBuffer }) => Promise<unknown>>(
      upsert,
    )(ctx as never, { blob });

    expect(ctx.rows[0]).toMatchObject({ userId: "auth-user", blob });
  });

  test("get queries by the Convex auth identity", async () => {
    const ctx = makeCtx("auth-user");

    await handler<(ctx: unknown, args: Record<string, never>) => Promise<unknown>>(
      get,
    )(ctx as never, {});

    expect(ctx.predicates).toContainEqual({
      field: "userId",
      value: "auth-user",
    });
  });

  test("rejects unauthenticated callers", async () => {
    const ctx = makeCtx(null);

    await expect(
      handler<(ctx: unknown, args: { blob: ArrayBuffer }) => Promise<unknown>>(
        upsert,
      )(ctx as never, { blob: new ArrayBuffer(1) }),
    ).rejects.toThrow("Not signed in");
  });
});
