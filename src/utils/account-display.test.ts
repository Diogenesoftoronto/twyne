import { describe, expect, test } from "bun:test";
import {
  accountAvatarUrl,
  accountDisplayName,
  accountInitials,
  withAccountProfile,
} from "./account-display";

const user = {
  id: "synthetic-writer",
  email: "private-contact@example.test",
  name: "Morgan Vale",
  image: "https://profiles.example.test/morgan.jpg",
};

describe("account identity without private email", () => {
  test("uses the chosen writer name before the session name or handle", () => {
    expect(
      accountDisplayName(user, {
        displayName: "  M. Vale  ",
        handle: "morgan-vale",
      }),
    ).toBe("M. Vale");
    expect(accountDisplayName(user, { handle: "morgan-vale" })).toBe(
      "Morgan Vale",
    );
  });

  test("uses a real handle when a name is absent", () => {
    expect(
      accountDisplayName({ email: user.email }, { handle: "morgan-vale" }),
    ).toBe("morgan-vale");
  });

  test("never exposes email-only, legacy email names, or embedded email labels", () => {
    for (const name of [
      undefined,
      "",
      "   ",
      user.email,
      "PRIVATE-CONTACT@EXAMPLE.TEST",
      `Morgan <${user.email}>`,
    ]) {
      expect(accountDisplayName({ name, email: user.email })).toBe("Writer");
      expect(accountDisplayName(user, { displayName: name })).toBe(
        "Morgan Vale",
      );
    }
    expect(
      accountDisplayName({ name: user.email }, { handle: user.email }),
    ).toBe("Writer");
  });

  test("does not use a raw DID as the visible name", () => {
    expect(accountDisplayName({ name: "did:plc:synthetic" })).toBe("Writer");
  });

  test("initials respect names with multiple words and Unicode", () => {
    expect(accountInitials("Morgan Avery Vale")).toBe("MV");
    expect(accountInitials("Élodie Chen")).toBe("ÉC");
    expect(accountInitials("柳 青")).toBe("柳青");
    expect(accountInitials(user.email)).toBe("W");
  });

  test("only accepts actual HTTPS or same-origin image URLs", () => {
    expect(accountAvatarUrl(user.image)).toBe(user.image);
    expect(accountAvatarUrl("/api/avatar/synthetic-writer")).toBe(
      "/api/avatar/synthetic-writer",
    );
    for (const value of [
      undefined,
      "",
      "javascript:alert(1)",
      "data:image/svg+xml,<svg/>",
      "http://images.example.test/me.jpg",
      "//images.example.test/me.jpg",
      "/\\images.example.test/me.jpg",
      "https://private:secret@images.example.test/me.jpg",
      "not an image",
    ]) {
      expect(accountAvatarUrl(value)).toBeUndefined();
    }
  });

  test("an authenticated profile overrides name and image while preserving private email", () => {
    const merged = withAccountProfile(user, {
      displayName: "M. Vale",
      handle: "morgan-vale",
      avatarUrl: "https://storage.example.test/verified-avatar",
    });
    expect(merged).toMatchObject({
      id: user.id,
      email: user.email,
      name: "M. Vale",
      handle: "morgan-vale",
      image: "https://storage.example.test/verified-avatar",
    });
  });

  test("invalid profile fields preserve the safe authenticated session identity", () => {
    const merged = withAccountProfile(user, {
      displayName: user.email,
      avatarUrl: "javascript:alert(1)",
    });
    expect(merged.name).toBe("Morgan Vale");
    expect(merged.image).toBe(user.image);
  });

  test("removing a profile restores the session identity without stale fields", () => {
    const profile = {
      displayName: "M. Vale",
      handle: "morgan-vale",
      avatarUrl: "https://storage.example.test/old",
    };
    expect(withAccountProfile(user, profile).name).toBe("M. Vale");
    const restored = withAccountProfile(user, null);
    expect(restored.name).toBe("Morgan Vale");
    expect(restored.image).toBe(user.image);
    expect(restored.handle).toBeUndefined();
    expect(user.name).toBe("Morgan Vale");
  });

  test("a refreshed same-account session uses its new name and image", () => {
    const refreshed = {
      ...user,
      name: "Morgan V.",
      image: "https://profiles.example.test/new.jpg",
    };
    expect(withAccountProfile(refreshed, null)).toMatchObject({
      name: "Morgan V.",
      image: refreshed.image,
    });
  });

  test("another account never inherits the previous profile or avatar", () => {
    withAccountProfile(user, { displayName: "M. Vale", avatarUrl: user.image });
    expect(
      withAccountProfile(
        { id: "new-writer", email: "other@example.test" },
        null,
      ),
    ).toMatchObject({ name: "Writer", image: undefined, handle: undefined });
  });
});
