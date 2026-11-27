import { describe, expect, test } from "bun:test";
import {
  describeUpstreamFailure,
  networkFailure,
  upstreamFailureOf,
} from "./upstreamFailure";

describe("upstreamFailureOf", () => {
  test("keeps the machine code and drops the prose", async () => {
    const res = new Response(
      JSON.stringify({
        error: { code: "integration_not_approved", message: "secret query here" },
      }),
      { status: 403 },
    );
    expect(await upstreamFailureOf(res)).toEqual({
      status: 403,
      code: "integration_not_approved",
    });
  });

  test("ignores a code that isn't a machine code", async () => {
    const res = new Response(JSON.stringify({ code: "Your query was …" }), {
      status: 502,
    });
    expect(await upstreamFailureOf(res)).toEqual({ status: 502, code: undefined });
  });

  test("survives a non-JSON body", async () => {
    expect(await upstreamFailureOf(new Response("<html>", { status: 500 }))).toEqual({
      status: 500,
      code: undefined,
    });
  });
});

describe("describeUpstreamFailure", () => {
  test("a revoked session asks the writer to sign in", () => {
    const d = describeUpstreamFailure("Not Organic", { status: 401, code: "session_revoked" });
    expect(d.recovery).toBe("sign_in");
    expect(d.retryable).toBe(false);
    expect(d.message).toContain("401");
  });

  test("an empty wallet points at credit, not retry", () => {
    expect(describeUpstreamFailure("Not Organic", { status: 402 }).recovery).toBe("add_credit");
  });

  test("an unapproved address says so", () => {
    const d = describeUpstreamFailure("Not Organic", { status: 403, code: "integration_not_approved" });
    expect(d.title).toContain("approved");
  });

  test("timeouts and outages retry on their own", () => {
    expect(describeUpstreamFailure("Search", networkFailure(Object.assign(new Error(), { name: "TimeoutError" }))).code).toBe("timeout");
    expect(describeUpstreamFailure("Search", { status: 502 }).retryable).toBe(true);
  });
});
