import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import ipaddr from "ipaddr.js";

const MAX_BODY_BYTES = 24 * 1024 * 1024;
const REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "accept",
  "x-api-key",
  "x-goog-api-key",
  "anthropic-version",
  "anthropic-beta",
  "openai-organization",
  "openai-project",
  "http-referer",
  "x-title",
  "model",
  "x-model",
  "sample-rate",
];

function failure(status: number, message: string) {
  return Response.json(
    { error: { message, type: "twyne_provider_relay_error" } },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}

export function isPublicProviderAddress(address: string): boolean {
  try {
    // process() also converts IPv4-mapped IPv6 before checking its range.
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export async function resolveProviderTarget(
  target: string,
  resolve = (host: string) => lookup(host, { all: true }),
) {
  const url = new URL(target);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    target.length > 8192
  ) {
    throw new Error("Only public HTTPS provider URLs are supported.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = ipaddr.isValid(host)
    ? [{ address: host, family: ipaddr.parse(host).kind() === "ipv4" ? 4 : 6 }]
    : await resolve(host);
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicProviderAddress(address))
  ) {
    throw new Error("Private provider destinations are not allowed.");
  }
  return {
    url,
    address: addresses.find((entry) => entry.family === 4) ?? addresses[0],
  };
}

/** DNS is checked and pinned to the actual connection; redirects are never followed. */
async function forwardProviderRequest(
  target: string,
  init: RequestInit,
): Promise<Response> {
  const { url, address } = await resolveProviderTarget(target);
  return new Promise((resolve, reject) => {
    const upstream = httpsRequest(
      url,
      {
        method: init.method,
        headers: Object.fromEntries(new Headers(init.headers)),
        signal: init.signal ?? undefined,
        family: address.family,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
      },
      (response) => {
        const headers = new Headers();
        for (const name of [
          "content-type",
          "content-encoding",
          "x-request-id",
          "request-id",
          "retry-after",
        ]) {
          const value = response.headers[name];
          if (typeof value === "string") headers.set(name, value);
        }
        resolve(
          new Response(
            [204, 205, 304].includes(response.statusCode ?? 200)
              ? null
              : (Readable.toWeb(
                  response,
                ) as unknown as ReadableStream<Uint8Array>),
            { status: response.statusCode ?? 502, headers },
          ),
        );
      },
    );
    upstream.on("error", reject);
    upstream.end(init.body);
  });
}

/** Only caller credentials are forwarded; browser cookies and provider URLs never enter logs. */
export async function relayProviderRequest(
  request: Request,
  forward = forwardProviderRequest,
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return failure(403, "Provider requests must come from this site.");
  }
  const target = request.headers.get("x-twyne-provider-url");
  const method = request.headers.get("x-twyne-provider-method");
  if (
    request.method !== "POST" ||
    !target ||
    !["GET", "POST"].includes(method ?? "")
  ) {
    return failure(400, "A provider URL and GET or POST method are required.");
  }
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return failure(400, "Invalid provider URL.");
  }
  if (
    !["authorization", "x-api-key", "x-goog-api-key"].some((key) =>
      request.headers.get(key),
    ) &&
    !url.searchParams.get("key")
  ) {
    return failure(401, "A provider API key is required.");
  }
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  try {
    if (reader)
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return failure(413, "The provider request is too large.");
        }
        chunks.push(value);
      }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    const upstream = await forward(target, {
      method: method!,
      headers,
      body: method === "POST" ? body : undefined,
      // Node 20+ supports any(); the app's older DOM type library does not.
      signal: (
        AbortSignal as typeof AbortSignal & {
          any(signals: AbortSignal[]): AbortSignal;
        }
      ).any([request.signal, AbortSignal.timeout(180_000)]),
      redirect: "error",
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return failure(
        502,
        "The provider redirected the request. Use its final API URL in Settings.",
      );
    }
    const responseHeaders = new Headers({
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    });
    for (const name of [
      "content-type",
      "content-encoding",
      "x-request-id",
      "request-id",
      "retry-after",
    ]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return failure(
      502,
      "The provider could not be reached. Check its public HTTPS API URL in Settings.",
    );
  } finally {
    reader?.releaseLock();
  }
}
