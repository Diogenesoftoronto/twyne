import { describe, expect, test } from "bun:test";
import { relayTinkerRequest } from "./tinker-relay.server";

describe("Tinker same-origin relay", () => {
  test("requires a caller-supplied Tinker key", async () => {
    let called = false;
    const response = await relayTinkerRequest(
      new Request("https://twyne.test/api/tinker/models"),
      "models",
      async () => {
        called = true;
        return new Response();
      },
    );

    expect(response.status).toBe(401);
    expect(called).toBe(false);
  });

  test("forwards chat requests only to the fixed OpenAI-compatible endpoint", async () => {
    let requestedUrl = "";
    let authorization = "";
    let requestBody = "";
    const response = await relayTinkerRequest(
      new Request("https://twyne.test/api/tinker/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer tinker-test-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "thinkingmachines/Inkling",
          messages: [{ role: "user", content: "Hello" }],
        }),
      }),
      "chat/completions",
      async (url: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(url);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        requestBody = new TextDecoder().decode(
          init?.body as Uint8Array | undefined,
        );
        return new Response('{"choices":[]}', {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "tinker-request",
            "set-cookie": "must-not-pass-through",
          },
        });
      },
    );

    expect(requestedUrl).toBe(
      "https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1/chat/completions",
    );
    expect(authorization).toBe("Bearer tinker-test-key");
    expect(JSON.parse(requestBody)).toMatchObject({
      model: "thinkingmachines/Inkling",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("tinker-request");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("rejects malformed chat payloads before contacting Tinker", async () => {
    let called = false;
    const response = await relayTinkerRequest(
      new Request("https://twyne.test/api/tinker/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer tinker-test-key" },
        body: JSON.stringify({ model: "thinkingmachines/Inkling" }),
      }),
      "chat/completions",
      async () => {
        called = true;
        return new Response();
      },
    );

    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });
});
