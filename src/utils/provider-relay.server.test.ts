import { describe, expect, test } from "bun:test";
import {
  isPublicProviderAddress,
  relayProviderRequest,
  resolveProviderTarget,
} from "./provider-relay.server";

describe("general provider relay", () => {
  const request = (
    target = "https://api.minimax.io/v1/chat/completions",
    extra: Record<string, string> = {},
  ) =>
    new Request("https://twyne.test/api/provider/", {
      method: "POST",
      headers: {
        "x-twyne-provider-url": target,
        "x-twyne-provider-method": "POST",
        authorization: "Bearer test-key",
        "content-type": "application/json",
        ...extra,
      },
      body: JSON.stringify({
        model: "test-model",
        messages: [{ role: "user", content: "test" }],
        stream: true,
      }),
    });
  test("rejects private, reserved and mapped addresses, including mixed DNS answers", async () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "100.64.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "0.0.0.0",
      "224.0.0.1",
    ]) {
      expect(isPublicProviderAddress(address)).toBe(false);
      await expect(
        resolveProviderTarget(
          `https://${address.includes(":") ? `[${address}]` : address}/v1`,
        ),
      ).rejects.toThrow();
    }
    await expect(
      resolveProviderTarget("https://provider.test", async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow();
    expect(isPublicProviderAddress("8.8.8.8")).toBe(true);
    for (const url of [
      "http://api.example.com",
      "https://user:password@api.example.com",
      "https://api.example.com/#fragment",
    ]) {
      await expect(resolveProviderTarget(url)).rejects.toThrow();
    }
  });
  test("relays multiple providers and streams without buffering or exposing cookies", async () => {
    for (const target of [
      "https://api.minimax.io/v1/chat/completions",
      "https://api.anthropic.com/v1/messages",
      "https://custom.provider.test/v1/responses",
    ]) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: first\n\n"));
        },
      });
      const response = await relayProviderRequest(
        request(target, {
          cookie: "private=session",
          "anthropic-version": "2023-06-01",
        }),
        async (url, init) => {
          expect(url).toBe(target);
          expect(new Headers(init.headers).get("cookie")).toBeNull();
          expect(new Headers(init.headers).get("authorization")).toBe(
            "Bearer test-key",
          );
          expect(new Headers(init.headers).get("anthropic-version")).toBe(
            "2023-06-01",
          );
          expect(
            JSON.parse(new TextDecoder().decode(init.body as Uint8Array))
              .stream,
          ).toBe(true);
          return new Response(stream, {
            headers: {
              "content-type": "text/event-stream",
              "set-cookie": "secret",
              "access-control-allow-origin": "*",
            },
          });
        },
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(
        "data: first\n\n",
      );
      await reader.cancel();
    }
  });
  test("preserves upstream errors and blocks redirects and cross-site requests", async () => {
    const error = await relayProviderRequest(request(), async () =>
      Response.json({ error: "invalid_key" }, { status: 401 }),
    );
    expect(error.status).toBe(401);
    expect(await error.json()).toEqual({ error: "invalid_key" });
    expect(
      (
        await relayProviderRequest(
          request(),
          async () =>
            new Response(null, {
              status: 302,
              headers: { location: "https://127.0.0.1" },
            }),
        )
      ).status,
    ).toBe(502);
    const denied = await relayProviderRequest(
      request(undefined, { origin: "https://evil.test" }),
      async () => {
        throw new Error("must not call");
      },
    );
    expect(denied.status).toBe(403);
  });
});
