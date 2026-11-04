import { expect, test } from "bun:test";
import { parseLocalLiveToolCall } from "./live-voice-local-tools";

test("maps a model tool call to the existing action contract", () => {
  expect(
    parseLocalLiveToolCall(
      "<tool_call>\n<function=replace>\n<parameter=original>\nold\n</parameter>\n<parameter=text>\nnew\n</parameter>\n</function>\n</tool_call>",
    ),
  ).toEqual({ kind: "replace", text: "new", original: "old", target: "" });
});

test("does not guess an action from malformed or duplicated arguments", () => {
  expect(parseLocalLiveToolCall("please replace old with new")).toBeNull();
  expect(
    parseLocalLiveToolCall(
      "<tool_call><function=delete></function></tool_call>",
    ),
  ).toBeNull();
  expect(
    parseLocalLiveToolCall(
      "<tool_call><function=find><parameter=text>a</parameter><parameter=text>b</parameter></function></tool_call>",
    ),
  ).toBeNull();
});
