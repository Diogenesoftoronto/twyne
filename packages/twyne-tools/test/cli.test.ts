import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../src/cli.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function captureIo(env: NodeJS.ProcessEnv = {}) {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      env,
      stdout: {
        write: (value: string | Uint8Array) => ((stdout += value), true),
      },
      stderr: {
        write: (value: string | Uint8Array) => ((stderr += value), true),
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe("Twyne CLI", () => {
  test("prints help without credentials", async () => {
    const captured = captureIo();
    expect(await runCli(["--help"], captured.io)).toBe(0);
    expect(captured.stdout()).toContain("twyne folio import");
    expect(captured.stderr()).toBe("");
  });

  test("lists folios through the shared authenticated client", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({
        ok: true,
        data: [{ id: "folio-1", name: "Essay", type: "draft", updatedAt: 7 }],
      });
    }) as typeof fetch;
    const captured = captureIo({
      TWYNE_API_URL: "https://twyne.example",
      TWYNE_ACCESS_TOKEN: "twyne_pat_test",
    });

    expect(await runCli(["folio", "list", "--json"], captured.io)).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual([
      { id: "folio-1", name: "Essay", type: "draft", updatedAt: 7 },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://twyne.example/api/integrations/v1");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer twyne_pat_test",
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      operation: "folios.list",
    });
  });
});
