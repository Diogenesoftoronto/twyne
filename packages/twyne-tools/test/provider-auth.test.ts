import { describe, expect, test } from "bun:test";
import { sdkAuthInvocation } from "../src/provider-auth.js";

describe("provider SDK authentication", () => {
  test("uses the official Codex CLI credential flow", () => {
    expect(sdkAuthInvocation("codex", "login")).toEqual({
      command: "codex",
      args: ["login"],
    });
    expect(sdkAuthInvocation("codex", "status")).toEqual({
      command: "codex",
      args: ["login", "status"],
    });
    expect(sdkAuthInvocation("codex", "logout")).toEqual({
      command: "codex",
      args: ["logout"],
    });
  });

  test("uses the official Anthropic CLI profile flow", () => {
    expect(sdkAuthInvocation("anthropic", "login")).toEqual({
      command: "ant",
      args: ["auth", "login"],
    });
    expect(sdkAuthInvocation("anthropic", "status")).toEqual({
      command: "ant",
      args: ["auth", "status"],
    });
    expect(sdkAuthInvocation("anthropic", "logout")).toEqual({
      command: "ant",
      args: ["auth", "logout"],
    });
  });
});
