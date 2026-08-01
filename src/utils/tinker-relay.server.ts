const TINKER_OPENAI_BASE_URL =
  "https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1";
const MAX_CHAT_BODY_BYTES = 24 * 1024 * 1024;
const MAX_AUTH_HEADER_LENGTH = 4096;

export type TinkerRelayPath = "chat/completions" | "models";
export type TinkerFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function jsonError(status: number, message: string): Response {
  return Response.json(
    { error: { message, type: "twyne_tinker_relay_error" } },
    {
      status,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

function bearerAuthorization(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (
    authorization.length === 0 ||
    authorization.length > MAX_AUTH_HEADER_LENGTH ||
    !/^Bearer\s+\S+$/i.test(authorization)
  ) {
    return null;
  }
  return authorization;
}

function relayResponseHeaders(upstream: Response): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
  });
  for (const name of ["content-type", "x-request-id"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function validChatPayload(value: unknown): value is {
  model: string;
  messages: unknown[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.model === "string" &&
    payload.model.length > 0 &&
    payload.model.length <= 512 &&
    Array.isArray(payload.messages)
  );
}

/**
 * Relay only the two Tinker OpenAI-compatible resources Twyne needs.
 *
 * The upstream host and path are selected by server code, never by the
 * caller. Keys and request bodies are forwarded in memory and are not logged
 * or persisted.
 */
export async function relayTinkerRequest(
  request: Request,
  path: TinkerRelayPath,
  fetchImpl: TinkerFetch = fetch,
): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (!authorization) {
    return jsonError(401, "A Tinker API key is required.");
  }

  const expectedMethod = path === "models" ? "GET" : "POST";
  if (request.method.toUpperCase() !== expectedMethod) {
    return jsonError(405, `Use ${expectedMethod} for this resource.`);
  }

  let body: Uint8Array | undefined;
  if (path === "chat/completions") {
    const declaredLength = Number(
      request.headers.get("content-length") ?? Number.NaN,
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_CHAT_BODY_BYTES
    ) {
      return jsonError(413, "The Tinker request is too large.");
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_CHAT_BODY_BYTES) {
      return jsonError(413, "The Tinker request is too large.");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return jsonError(400, "The Tinker request must be valid JSON.");
    }
    if (!validChatPayload(payload)) {
      return jsonError(
        400,
        "The Tinker request must include a model and messages.",
      );
    }
    body = bytes;
  }

  try {
    const upstream = await fetchImpl(`${TINKER_OPENAI_BASE_URL}/${path}`, {
      method: expectedMethod,
      headers: {
        authorization,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body,
      signal: request.signal,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: relayResponseHeaders(upstream),
    });
  } catch {
    return jsonError(502, "Tinker could not be reached.");
  }
}
