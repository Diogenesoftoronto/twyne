import { describe, expect, mock, test } from "bun:test";

const captured: Array<{
  event: string;
  properties: Record<string, unknown>;
}> = [];

mock.module("./posthog-context", () => ({
  capturePostHogEvent: async (
    event: string,
    properties: Record<string, unknown>,
  ) => {
    captured.push({ event, properties });
  },
}));

const { createProductionConvexLogger } = await import("./convex-context");

describe("production Convex logger", () => {
  test("does not write raw failures to the browser console", () => {
    const consoleError = mock(() => {});
    const consoleWarn = mock(() => {});
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = consoleError;
    console.warn = consoleWarn;
    try {
      const logger = createProductionConvexLogger();
      logger.error(
        "[CONVEX A(agents:runInterviewTurn)]",
        new Error(
          "Provider failed at https://private.example with api_key=secret",
        ),
      );
      logger.warn("WebSocket failed", "Bearer private-token");
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  test("captures only normalized, sanitized diagnostics", async () => {
    captured.length = 0;
    const logger = createProductionConvexLogger();
    logger.error(
      "[CONVEX A(agents:runInterviewTurn)]",
      Object.assign(new Error("Provider unavailable: sk-private-secret"), {
        provider: "openai",
        responseBody: {
          transcript: "private conversation",
          authorization: "Bearer secret",
        },
      }),
    );
    await Promise.resolve();

    expect(captured).toHaveLength(1);
    expect(captured[0]?.event).toBe("$exception");
    expect(captured[0]?.properties).toMatchObject({
      distinct_id: "convex-browser",
      $exception_type: "ConvexClientError",
      $exception_is_unhandled: false,
      $level: "error",
      twyne_error_code: "PROVIDER_ERROR",
      twyne_error_source: "provider",
      operation: "convex-client",
    });
    const serialized = JSON.stringify(captured[0]);
    expect(serialized).not.toContain("sk-private-secret");
    expect(serialized).not.toContain("private conversation");
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("agents:runInterviewTurn");
  });
});
