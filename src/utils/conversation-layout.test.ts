import { describe, expect, test } from "bun:test";
import {
  CONVERSATION_COMPOSER_CLASS,
  CONVERSATION_HISTORY_CLASS,
  CONVERSATION_ROUTE_CLASS,
  CONVERSATION_SHELL_CLASS,
  dossierRouteClass,
} from "./conversation-layout";

describe("conversation viewport layout", () => {
  test("contains the conversation route to the dynamic viewport", () => {
    expect(CONVERSATION_ROUTE_CLASS).toContain("h-[100dvh]");
    expect(CONVERSATION_ROUTE_CLASS).toContain("min-h-0");
    expect(CONVERSATION_ROUTE_CLASS).toContain("overflow-hidden");
    expect(dossierRouteClass("conversational")).toBe(
      CONVERSATION_ROUTE_CLASS,
    );
  });

  test("gives remaining height to the shell and only history scrolls", () => {
    expect(CONVERSATION_SHELL_CLASS).toContain("min-h-0");
    expect(CONVERSATION_SHELL_CLASS).toContain("flex-1");
    expect(CONVERSATION_SHELL_CLASS).toContain("overflow-hidden");
    expect(CONVERSATION_HISTORY_CLASS).toContain("min-h-0");
    expect(CONVERSATION_HISTORY_CLASS).toContain("flex-1");
    expect(CONVERSATION_HISTORY_CLASS).toContain("overflow-y-auto");
    expect(CONVERSATION_COMPOSER_CLASS).toContain("shrink-0");
  });

  test("leaves the form route document-scrollable", () => {
    const formClass = dossierRouteClass("form");
    expect(formClass).toContain("min-h-screen");
    expect(formClass).not.toContain("overflow-hidden");
  });
});
