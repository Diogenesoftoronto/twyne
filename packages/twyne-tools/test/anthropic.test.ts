import { describe, expect, test } from "bun:test";
import {
  anthropicText,
  buildAnthropicClientOptions,
} from "../src/anthropic.js";

describe("Anthropic SDK wiring", () => {
  test("uses the active signed-in profile by default", () => {
    expect(buildAnthropicClientOptions({})).toEqual({});
    expect(buildAnthropicClientOptions({ profile: " editorial " })).toEqual({
      profile: "editorial",
    });
  });

  test("joins only visible text response blocks", () => {
    expect(
      anthropicText([
        { type: "text", text: "First" },
        { type: "tool_use" },
        { type: "text", text: " response" },
      ]),
    ).toBe("First response");
  });
});
