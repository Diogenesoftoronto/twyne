import { describe, expect, test } from "bun:test";
import { clientUsageSourceForProvider } from "./browser-inference";

describe("browser inference usage source", () => {
  test("classifies on-device and managed loopback providers as local", () => {
    expect(clientUsageSourceForProvider({ type: "supertonic" })).toBe("local");
    expect(
      clientUsageSourceForProvider({
        type: "litert",
        baseUrl: "http://127.0.0.1:8787/v1",
      }),
    ).toBe("local");
    expect(
      clientUsageSourceForProvider({
        type: "ollama",
        baseUrl: "http://localhost:11434/v1",
      }),
    ).toBe("local");
    expect(
      clientUsageSourceForProvider({
        type: "openai-compatible",
        baseUrl: "http://[::1]:8080/v1",
      }),
    ).toBe("local");
  });

  test("keeps remote and malformed BYOK endpoints billable-or-unknown", () => {
    expect(clientUsageSourceForProvider({ type: "openai" })).toBe("byok");
    expect(
      clientUsageSourceForProvider({
        type: "openai-compatible",
        baseUrl: "https://models.example.com/v1",
      }),
    ).toBe("byok");
    expect(
      clientUsageSourceForProvider({
        type: "openai-compatible",
        baseUrl: "not a URL",
      }),
    ).toBe("byok");
  });
});
