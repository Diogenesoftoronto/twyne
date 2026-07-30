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

const { reportApplicationDiagnostic } = await import(
  "./application-diagnostics"
);

describe("application diagnostics", () => {
  test("captures sanitized production diagnostics without using the console", async () => {
    captured.length = 0;
    const warn = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warn;
    try {
      reportApplicationDiagnostic(
        "twyne:ai:test",
        Object.assign(
          new Error(
            "Provider failed at https://private.example with api_key=secret",
          ),
          {
            provider: "openai",
            transcript: "private conversation",
          },
        ),
        { feature: "interview-turn" },
      );
      await Promise.resolve();
    } finally {
      console.warn = originalWarn;
    }

    expect(warn).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);
    const serialized = JSON.stringify(captured[0]);
    expect(serialized).toContain("PROVIDER_ERROR");
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("private conversation");
  });
});
