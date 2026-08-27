import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  createAppError,
  failureResult,
  isAppError,
  normalizeApplicationError,
  sanitizeErrorMetadata,
  successResult,
} from "./application-errors";

describe("application error construction", () => {
  test("creates stable, serializable errors with recovery metadata", () => {
    const error = createAppError("RATE_LIMITED", {
      referenceId: "req_safe-123",
      status: 429,
      recovery: { retryAfterMs: 2_500 },
      metadata: { feature: "persona-feedback", attempt: 2 },
    });

    expect(error).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests. Please wait and try again.",
      referenceId: "req_safe-123",
      source: "application",
      status: 429,
      recovery: {
        action: "retry-later",
        canRetry: true,
        retryAfterMs: 2_500,
      },
      metadata: { feature: "persona-feedback", attempt: 2 },
    });
    expect(JSON.parse(JSON.stringify(error))).toEqual(error);
    expect(isAppError(error)).toBe(true);
  });

  test("rejects unsafe caller-supplied reference IDs", () => {
    const error = createAppError("INTERNAL_ERROR", {
      referenceId: "Bearer secret-token",
    });
    expect(error.referenceId).toMatch(/^err_/);
    expect(error.referenceId).not.toContain("secret-token");
  });

  test("builds discriminated success and failure results", () => {
    expect(successResult({ id: "folio-1" })).toEqual({
      ok: true,
      value: { id: "folio-1" },
    });
    const failed = failureResult("failed to fetch");
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("NETWORK_UNAVAILABLE");
  });

  test("keeps a normalized error stable while merging safe overrides", () => {
    const original = createAppError("TIMEOUT", {
      referenceId: "req_existing",
      source: "provider",
      metadata: { provider: "openai" },
    });
    const normalized = normalizeApplicationError(original, {
      metadata: { feature: "room" },
    });
    expect(normalized).toMatchObject({
      code: "TIMEOUT",
      referenceId: "req_existing",
      source: "provider",
      metadata: { provider: "openai", feature: "room" },
    });
  });
});

describe("validation normalization", () => {
  test("maps known validation details to reviewed messages", () => {
    const error = normalizeApplicationError({
      code: "VALIDATION_ERROR",
      message: "Email format is invalid: private@example.com",
      field: "email",
    });
    expect(error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "Enter a valid email address.",
    });
    expect(JSON.stringify(error)).not.toContain("private@example.com");
  });

  test("does not pass unknown validation messages through", () => {
    const secret = "draft text only the author should see";
    const error = normalizeApplicationError({
      code: "BAD_REQUEST",
      message: `A bespoke validator rejected ${secret}`,
    });
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.message).toBe(
      "Check the highlighted information and try again.",
    );
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  test("accepts explicit validation mapping keys", () => {
    const error = createAppError("VALIDATION_FAILED", {
      validationKey: "file_too_large",
    });
    expect(error.message).toBe("Choose a smaller file and try again.");
  });

  test("explains the substantive draft boundary", () => {
    const error = createAppError("VALIDATION_FAILED", {
      validationKey: "draft_too_short",
    });
    expect(error.message).toBe(
      "Write at least 500 words before asking the room to judge the draft.",
    );
  });
});

describe("Convex normalization", () => {
  test("reads structured ConvexError data without exposing its raw message", () => {
    const error = normalizeApplicationError(
      new ConvexError({
        code: "RATE_LIMITED",
        message: "Too many requests for user secret-user-id",
        retryAfterMs: 4_000,
        feature: "agentRoom",
        token: "convex-secret-token",
      }),
    );
    expect(error).toMatchObject({
      code: "RATE_LIMITED",
      source: "convex",
      recovery: {
        action: "retry-later",
        canRetry: true,
        retryAfterMs: 4_000,
      },
      metadata: {
        feature: "agentRoom",
      },
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("secret-user-id");
    expect(serialized).not.toContain("convex-secret-token");
  });

  test("normalizes string ConvexError data safely", () => {
    const error = normalizeApplicationError(
      new ConvexError("Request timed out at https://secret.example/v1"),
    );
    expect(error.code).toBe("TIMEOUT");
    expect(error.source).toBe("convex");
    expect(JSON.stringify(error)).not.toContain("secret.example");
  });

  test("supports structurally cloned Convex errors", () => {
    const error = normalizeApplicationError({
      name: "ConvexError",
      data: {
        code: "NOT_FOUND",
        resource: "folio",
        prompt: "private prompt",
      },
    });
    expect(error).toMatchObject({
      code: "NOT_FOUND",
      source: "convex",
      metadata: { resource: "folio" },
    });
    expect(JSON.stringify(error)).not.toContain("private prompt");
  });

  test("adapts lowercase server foundation codes and recovery metadata", () => {
    const error = normalizeApplicationError({
      name: "ConvexError",
      data: {
        code: "configuration_required",
        referenceId: "srv_reference-123",
        retryable: false,
        recovery: "open_settings",
        title: "Set up a provider",
        message: "Choose a provider at https://private.example/settings",
      },
    });
    expect(error).toMatchObject({
      code: "CONFIGURATION_ERROR",
      source: "convex",
      referenceId: "srv_reference-123",
      recovery: {
        action: "check-configuration",
        canRetry: false,
      },
    });
    expect(JSON.stringify(error)).not.toContain("private.example");
  });
});

describe("auth and HTTP normalization", () => {
  test("normalizes Better Auth API-shaped errors", () => {
    const error = normalizeApplicationError({
      name: "APIError",
      status: "UNAUTHORIZED",
      statusCode: 401,
      body: {
        code: "INVALID_CREDENTIALS",
        message: "Bad password hunter2",
        accessToken: "secret-token",
      },
      headers: { authorization: "Bearer secret" },
    });
    expect(error).toMatchObject({
      code: "AUTHENTICATION_FAILED",
      source: "auth",
      status: 401,
      recovery: { action: "sign-in", canRetry: true },
    });
    expect(JSON.stringify(error)).not.toContain("hunter2");
    expect(JSON.stringify(error)).not.toContain("secret-token");
  });

  test("normalizes unauthenticated Convex-style status to sign-in required", () => {
    const error = normalizeApplicationError({
      name: "ConvexError",
      data: { status: 401, code: "UNAUTHENTICATED" },
    });
    expect(error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(error.message).toBe("Sign in to continue.");
  });

  test("maps raw Convex and ATProto auth failures to safe recovery", () => {
    expect(
      normalizeApplicationError(
        new Error(
          "[CONVEX M(userComments:deleteComment)] Server Error: Not signed in",
        ),
        { source: "convex" },
      ),
    ).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      message: "Sign in to continue.",
      recovery: { action: "sign-in", canRetry: true },
    });

    expect(
      normalizeApplicationError(
        Object.assign(
          new Error(
            'Missing required scope "rpc:app.bsky.actor.getProfile?aud=private-audience"',
          ),
          { status: 403, name: "ScopeMissingError" },
        ),
        { source: "auth" },
      ),
    ).toMatchObject({
      code: "AUTHENTICATION_FAILED",
      message: "We could not verify your sign-in. Please try again.",
      recovery: { action: "sign-in", canRetry: true },
    });

    expect(
      normalizeApplicationError(
        {
          error: "use_dpop_nonce",
          message: 'DPoP "nonce" mismatch',
        },
        { source: "auth" },
      ),
    ).toMatchObject({
      code: "AUTHENTICATION_FAILED",
      recovery: { action: "sign-in", canRetry: true },
    });
  });

  test("normalizes fetch Responses without retaining URLs or bodies", () => {
    const error = normalizeApplicationError(
      new Response('{"prompt":"private draft"}', {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "3" },
      }),
      {
        metadata: {
          method: "POST",
          endpoint: "https://api.example/private",
        },
      },
    );
    expect(error).toMatchObject({
      code: "RATE_LIMITED",
      source: "fetch",
      status: 429,
      metadata: {
        method: "POST",
        endpoint: "[REDACTED]",
      },
      recovery: {
        action: "retry-later",
        canRetry: true,
        retryAfterMs: 3_000,
      },
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("private draft");
    expect(serialized).not.toContain("api.example");
  });

  test("maps HTTP failure boundaries", () => {
    const expectations = [
      [400, "VALIDATION_FAILED"],
      [403, "PERMISSION_DENIED"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT"],
      [504, "TIMEOUT"],
      [503, "NETWORK_UNAVAILABLE"],
      [500, "INTERNAL_ERROR"],
    ] as const;
    for (const [status, code] of expectations) {
      expect(
        normalizeApplicationError(new Response(null, { status })).code,
      ).toBe(code);
    }
  });
});

describe("network, provider, malformed, configuration, and internal errors", () => {
  test("recognizes timeout, abort, and network failures", () => {
    expect(normalizeApplicationError(new Error("request timed out")).code).toBe(
      "TIMEOUT",
    );
    expect(
      normalizeApplicationError(
        Object.assign(new Error("The operation was aborted"), {
          name: "AbortError",
        }),
      ).code,
    ).toBe("TIMEOUT");
    expect(
      normalizeApplicationError(new TypeError("Failed to fetch")).code,
    ).toBe("NETWORK_UNAVAILABLE");
    expect(
      normalizeApplicationError(new Error("connect ECONNREFUSED 127.0.0.1"))
        .code,
    ).toBe("NETWORK_UNAVAILABLE");
  });

  test("recognizes rate-limit and bounded retry metadata", () => {
    const error = normalizeApplicationError({
      provider: "anthropic",
      status: 429,
      retryAfterMs: 999_999_999,
      responseBody: '{"api_key":"secret"}',
    });
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.recovery.retryAfterMs).toBe(86_400_000);
    expect(JSON.stringify(error)).not.toContain("api_key");

    const plainError = Object.assign(new Error("request rejected"), {
      status: 429,
      retryAfterMs: 500,
    });
    expect(normalizeApplicationError(plainError)).toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      recovery: { retryAfterMs: 500 },
    });
  });

  test("maps provider auth and configuration failures to configuration", () => {
    const providerAuth = normalizeApplicationError({
      name: "AI_APICallError",
      provider: "openai",
      statusCode: 401,
      message: "Invalid API key sk-super-secret",
      responseBody: '{"error":{"message":"secret provider body"}}',
    });
    expect(providerAuth).toMatchObject({
      code: "CONFIGURATION_ERROR",
      source: "provider",
      status: 401,
      metadata: { provider: "openai" },
    });
    const serialized = JSON.stringify(providerAuth);
    expect(serialized).not.toContain("sk-super-secret");
    expect(serialized).not.toContain("secret provider body");

    expect(
      normalizeApplicationError(new Error("Provider is not configured")).code,
    ).toBe("CONFIGURATION_ERROR");

    expect(
      normalizeApplicationError({
        provider: "custom",
        status: 404,
        message: "Unknown model at https://private.example",
      }).code,
    ).toBe("CONFIGURATION_ERROR");
  });

  test("maps ordinary provider failures without leaking provider bodies", () => {
    const error = normalizeApplicationError(
      Object.assign(new Error("Provider exploded with private response"), {
        providerId: "custom-provider",
        responseBody: {
          transcript: "private conversation",
          authorization: "Bearer secret",
        },
      }),
    );
    expect(error).toMatchObject({
      code: "PROVIDER_ERROR",
      source: "provider",
      metadata: { providerId: "custom-provider" },
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("private response");
    expect(serialized).not.toContain("private conversation");
    expect(serialized).not.toContain("Bearer secret");
  });

  test("recognizes malformed service responses", () => {
    const error = normalizeApplicationError(
      new SyntaxError("Unexpected token < in JSON at position 0"),
    );
    expect(error.code).toBe("MALFORMED_RESPONSE");
    expect(error.message).not.toContain("Unexpected token");
  });

  test("uses a safe internal fallback for arbitrary errors", () => {
    const original = new Error(
      "Database exploded for https://internal.example with password=secret",
    );
    original.stack = `Error: ${original.message}\n at /private/server/file.ts:12:3`;
    const error = normalizeApplicationError(original);
    expect(error.code).toBe("INTERNAL_ERROR");
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("internal.example");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("/private/server");
  });
});

describe("unknown throws and aggressive redaction", () => {
  test("handles every non-Error primitive throw", () => {
    const values = [
      undefined,
      null,
      42,
      true,
      Symbol("secret"),
      "failed to fetch https://private.example?token=secret",
    ];
    for (const value of values) {
      const error = normalizeApplicationError(value);
      expect(isAppError(error)).toBe(true);
      expect(error.referenceId).toMatch(/^err_/);
      expect(JSON.stringify(error)).not.toContain("private.example");
    }
  });

  test("handles hostile objects, getters, and cycles without throwing", () => {
    const cyclic: Record<string, unknown> = {
      code: "INTERNAL_ERROR",
      provider: "custom",
      draft: "my private draft",
    };
    cyclic.self = cyclic;
    Object.defineProperty(cyclic, "message", {
      get() {
        throw new Error("getter secret");
      },
    });

    expect(() => normalizeApplicationError(cyclic)).not.toThrow();
    const error = normalizeApplicationError(cyclic);
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(error)).not.toContain("private draft");
    expect(JSON.stringify(error)).not.toContain("getter secret");
  });

  test("redacts nested tokens, auth, prose, URLs, stacks, and provider bodies", () => {
    const metadata = sanitizeErrorMetadata({
      provider: "openai",
      model: "safe-model",
      apiKey: "sk-12345678901234567890",
      authorization: "Bearer abc.def.ghi",
      headers: {
        cookie: "session=secret",
        "x-api-key": "secret",
      },
      prompt: "private prompt",
      transcript: "private transcript",
      draft: "private draft",
      endpoint: "https://api.example/v1?token=secret",
      stack: "Error: secret\n at /home/user/private.ts:1",
      providerBody: { output: "private completion" },
      reason: "private provider reason from transcript",
      detail: "call https://secret.example with bearer top-secret",
    });
    const serialized = JSON.stringify(metadata);
    expect(metadata).toMatchObject({
      provider: "openai",
      model: "safe-model",
      apiKey: "[REDACTED]",
      authorization: "[REDACTED]",
      prompt: "[REDACTED]",
      transcript: "[REDACTED]",
      draft: "[REDACTED]",
      endpoint: "[REDACTED]",
      stack: "[REDACTED]",
      providerBody: "[REDACTED]",
    });
    expect(serialized).not.toContain("1234567890");
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("api.example");
    expect(serialized).not.toContain("secret.example");
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("private completion");
    expect(serialized).not.toContain("private provider reason");
  });
});
