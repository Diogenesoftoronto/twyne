import { describe, expect, test } from "bun:test";
import {
  researchDiagnosticsReport,
  researchFailureDetails,
  researchFailureFrom,
  logResearchEvent,
} from "./research-failure";

const fallback = { stage: "search", title: "Search failed", message: "No results." };

describe("researchFailureFrom", () => {
  test("reads a ConvexError's structured payload", () => {
    const err = Object.assign(new Error("ConvexError"), {
      data: {
        code: "authentication_required",
        title: "Your Not Organic sign-in has ended",
        message: "Sign in again.",
        retryable: false,
        recovery: "sign_in",
        stage: "search",
        referenceId: "ref-123",
        upstreamStatus: 401,
        upstreamCode: "session_revoked",
      },
    });
    const f = researchFailureFrom(err, fallback);
    expect(f.recovery).toBe("sign_in");
    expect(f.retryable).toBe(false);
    expect(researchFailureDetails(f)).toContain("Reference: ref-123");
    expect(researchFailureDetails(f)).toContain("Answered: 401 session_revoked");
  });

  test("falls back to the step's own words for a plain error", () => {
    const f = researchFailureFrom(new Error("boom"), fallback);
    expect(f.title).toBe("Search failed");
    expect(f.message).toContain("boom");
    expect(f.recovery).toBe("retry");
  });
});

test("the diagnostics report carries the failure and recent events", () => {
  logResearchEvent("search", "failed", { code: "x" });
  const f = researchFailureFrom(new Error("boom"), fallback);
  const report = researchDiagnosticsReport({ status: "error", signedIn: true, failure: f });
  expect(report).toContain("Signed in: yes");
  expect(report).toContain("Last failure:");
  expect(report).toContain("search failed code=x");
});
