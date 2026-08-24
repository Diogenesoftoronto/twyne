import { describe, expect, test } from "bun:test";
import {
  CONVERSATION_ROUTE_CLASS,
  DOSSIER_ROUTE_CLASS,
  FOLIO_COLUMN_CLASS,
  dossierRouteClass,
} from "./conversation-layout";

describe("dossier viewport layout", () => {
  test("contains both dossier surfaces to the dynamic viewport", () => {
    expect(DOSSIER_ROUTE_CLASS).toContain("h-[100dvh]");
    expect(DOSSIER_ROUTE_CLASS).toContain("min-h-0");
    expect(DOSSIER_ROUTE_CLASS).toContain("overflow-hidden");
    expect(CONVERSATION_ROUTE_CLASS).toBe(DOSSIER_ROUTE_CLASS);
  });

  test("the form no longer scrolls the document out from under the folio", () => {
    const formClass = dossierRouteClass("form");
    expect(formClass).not.toContain("min-h-screen");
    expect(formClass).toContain("overflow-hidden");
    expect(formClass).toBe(dossierRouteClass("conversational"));
  });

  test("scrolling belongs to frames inside the folio, not the page", () => {
    expect(FOLIO_COLUMN_CLASS).toContain("min-h-0");
    expect(FOLIO_COLUMN_CLASS).toContain("flex-1");
    expect(FOLIO_COLUMN_CLASS).toContain("folio-column");
  });
});
