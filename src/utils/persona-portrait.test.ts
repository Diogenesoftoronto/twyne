import { describe, expect, test } from "bun:test";
import { resolvePersonaPortrait } from "./persona-portrait";

describe("persona portrait attribution", () => {
  test("known ID is authoritative even when the displayed name changed", () => {
    const result = resolvePersonaPortrait({
      personaId: "reader",
      name: "My reader",
      role: "First-time visitor",
    });
    expect(result.portraitId).toBe("reader");
    expect(result.name).toBe("My reader");
    expect(result.role).toBe("First-time visitor");
    expect(result.attribution).toBe("id");
  });

  test("explicit custom or invalid IDs never borrow a face by name", () => {
    for (const personaId of [
      "custom-reader",
      "READER",
      "",
      " ",
      "../../reader",
    ]) {
      const result = resolvePersonaPortrait({ personaId, name: "Le Lecteur" });
      expect(result.src).toBeUndefined();
      expect(result.initials).toBe("LL");
    }
  });

  test("legacy author-only notes may use an exact resident name", () => {
    const result = resolvePersonaPortrait({ name: "Mlle. Sceptique" });
    expect(result.portraitId).toBe("devil");
    expect(result.role).toBe("The Devil's Advocate");
    expect(result.attribution).toBe("exact-name");
  });

  test("name fallback does not guess at case, spelling or substring matches", () => {
    for (const name of [
      "le lecteur",
      "Le Lecteur ",
      "Lecteur",
      "My Le Lecteur",
    ]) {
      expect(resolvePersonaPortrait({ name }).src).toBeUndefined();
    }
  });

  test("custom and unknown speakers retain their identity as initials", () => {
    const result = resolvePersonaPortrait({
      personaId: "archivist",
      name: "Émilie Tran",
      role: "The Archivist",
    });
    expect(result.initials).toBe("ÉT");
    expect(result.name).toBe("Émilie Tran");
    expect(result.role).toBe("The Archivist");
    expect(result.src).toBeUndefined();
    expect(resolvePersonaPortrait({ name: "✶" }).initials).toBe("?");
    expect(resolvePersonaPortrait({}).name).toBe("Unnamed persona");
  });
});
