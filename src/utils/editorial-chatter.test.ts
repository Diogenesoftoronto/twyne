import { describe, expect, test } from "bun:test";
import type { Persona } from "../types";
import { editorialWaitLines } from "./editorial-chatter";

describe("editorialWaitLines", () => {
  test("gives the resident editors distinct in-character lines", () => {
    const personas = ["devil", "angel", "scholar", "editor", "reader"].map(
      (id) => ({ id, name: id }) as Persona,
    );
    const lines = editorialWaitLines(personas);
    expect(new Set(lines.slice(0, personas.length)).size).toBe(personas.length);
    expect(lines.join(" ")).toContain("cross-examining");
    expect(lines.join(" ")).toContain("statistic");
  });

  test("keeps custom personas in the conversation", () => {
    const lines = editorialWaitLines([
      { id: "custom", name: "The Night Editor" } as Persona,
    ]);
    expect(lines[0]).toContain("The Night Editor");
  });
});
