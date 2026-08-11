import { describe, expect, test } from "bun:test";
import { publishViaMicropub } from "./micropub";

describe("Micropub publishing", () => {
  test("sends an h-entry without persisting or embedding the bearer token", async () => {
    let request: RequestInit | undefined;
    const result = await publishViaMicropub(
      {
        endpoint: "https://writer.example/micropub",
        token: "secret-token",
        title: "Field notes",
        html: "<p>Published prose.</p>",
      },
      async (_url, init) => {
        request = init;
        return new Response(null, {
          status: 201,
          headers: { location: "/field-notes" },
        });
      },
    );
    expect(result.url).toBe("https://writer.example/field-notes");
    expect(request?.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer secret-token" }),
    );
    const body = request?.body as URLSearchParams;
    expect(body.get("h")).toBe("entry");
    expect(body.get("content[html]")).toBe("<p>Published prose.</p>");
    expect(body.toString()).not.toContain("secret-token");
  });

  test("rejects insecure remote endpoints before making a request", async () => {
    let called = false;
    await expect(
      publishViaMicropub(
        {
          endpoint: "http://writer.example/micropub",
          token: "token",
          title: "Draft",
          html: "<p>Draft</p>",
        },
        async () => {
          called = true;
          return new Response();
        },
      ),
    ).rejects.toThrow("must use HTTPS");
    expect(called).toBe(false);
  });
});
