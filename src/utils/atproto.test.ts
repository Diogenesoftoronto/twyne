import { describe, expect, test } from "bun:test";
import { PUBLIC_BSKY_APPVIEW, resolveAtprotoProfile } from "./atproto";

describe("ATProto profile hydration", () => {
  test("uses the public Bluesky AppView endpoint", () => {
    expect(PUBLIC_BSKY_APPVIEW).toBe("https://public.api.bsky.app");
  });

  test("maps a public profile without changing the account DID", async () => {
    const did = "did:plc:brka7yc4gssxdquiwpii22pr";
    const actors: string[] = [];

    const profile = await resolveAtprotoProfile(did, async (actor) => {
      actors.push(actor);
      return {
        data: {
          handle: "writer.example",
          displayName: "Writer",
          avatar: "https://cdn.example/avatar.jpg",
        },
      };
    });

    expect(actors).toEqual([did]);
    expect(profile).toEqual({
      did,
      handle: "writer.example",
      displayName: "Writer",
      avatar: "https://cdn.example/avatar.jpg",
    });
  });

  test("keeps a valid session usable when public profile lookup fails", async () => {
    const did = "did:plc:brka7yc4gssxdquiwpii22pr";
    await expect(
      resolveAtprotoProfile(did, async () => {
        throw new Error("offline");
      }),
    ).resolves.toEqual({ did, handle: did });
  });
});
