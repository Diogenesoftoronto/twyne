/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;

const base = {
  folioId: "f1",
  personaId: "ed",
  personaName: "Ed",
  personaColor: "#000",
  type: "critique" as const,
  feedback: "Set the two keys against each other.",
  anchor: "Ada held the iron key.",
  createdAt: 1,
};

describeConvex("persona note evidence sync", () => {
  test("old notes without evidence and new notes with it both round-trip", async () => {
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "issuer|writer",
    });
    const facts = [
      { id: "key_colour", label: "key colour", value: "silver", near: true, passages: ["a pale key"] },
    ];
    await t.mutation(api.sync.pushAll, {
      personaNotes: [
        { ...base, noteId: "old" },
        { ...base, noteId: "new", anchors: ["Ben carried a silver key."], facts },
      ],
    });
    const pulled = await t.query(api.sync.pullAll, {});
    const old = pulled.personaNotes.find((n) => n.noteId === "old");
    const fresh = pulled.personaNotes.find((n) => n.noteId === "new");
    expect(old?.anchors).toBeUndefined();
    expect(old?.facts).toBeUndefined();
    expect(fresh).toMatchObject({ anchors: ["Ben carried a silver key."], facts });
  });
});
