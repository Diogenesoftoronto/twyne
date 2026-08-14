import { describe, expect, test } from "bun:test";
import { canClaimLegacyEditorialArtifacts } from "./folio-workspace";

describe("legacy editorial artifact ownership", () => {
  test("claims legacy data when there is exactly one unambiguous folio", () => {
    expect(canClaimLegacyEditorialArtifacts(["folio-a"], "folio-a")).toBe(true);
  });

  test("does not attach ambiguous legacy data to the active folio", () => {
    expect(
      canClaimLegacyEditorialArtifacts(["folio-a", "folio-b"], "folio-a"),
    ).toBe(false);
  });

  test("does not claim data for an active id outside the folio drawer", () => {
    expect(canClaimLegacyEditorialArtifacts(["folio-a"], "folio-b")).toBe(
      false,
    );
  });
});
