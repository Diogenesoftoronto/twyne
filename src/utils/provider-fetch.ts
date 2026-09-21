/** Browser transport for remote BYOK APIs. Keys are forwarded, never stored by the relay. */
export function usesProviderRelay(url: URL, origin: string): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    url.protocol === "https:" &&
    url.origin !== origin &&
    host !== "localhost" &&
    !host.endsWith(".localhost") &&
    !host.endsWith(".local") &&
    !host.endsWith(".ts.net") &&
    !/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      host,
    ) &&
    host !== "::1" &&
    !/^(fc|fd|fe[89ab])[0-9a-f]*:/i.test(host)
  );
}

export const providerFetch = async function providerFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (typeof window === "undefined" || typeof location === "undefined")
    return fetch(input, init);
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    location.href,
  );
  if (!usesProviderRelay(url, location.origin)) return fetch(input, init);
  const upstream = new Request(input instanceof Request ? input : url, init);
  const headers = new Headers(upstream.headers);
  headers.set("x-twyne-provider-url", url.href);
  headers.set("x-twyne-provider-method", upstream.method);
  return fetch(`${location.origin}/api/provider/`, {
    method: "POST",
    headers,
    body: upstream.body ? await upstream.arrayBuffer() : undefined,
    signal: upstream.signal,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
} as typeof fetch;
