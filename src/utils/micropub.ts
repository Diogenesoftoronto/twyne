export interface MicropubPublishInput {
  endpoint: string;
  token: string;
  title: string;
  html: string;
}

export interface MicropubPublishResult {
  url: string | null;
  status: number;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function safeEndpoint(value: string): string {
  const url = new URL(value.trim());
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Micropub endpoints must use HTTPS.");
  }
  return url.toString();
}

/** Publish directly from the writer's browser. The bearer token is used for
 * this request only and is never persisted by Twyne. */
export async function publishViaMicropub(
  input: MicropubPublishInput,
  fetcher: FetchLike = fetch,
): Promise<MicropubPublishResult> {
  const endpoint = safeEndpoint(input.endpoint);
  const token = input.token.trim();
  if (!token) throw new Error("A Micropub access token is required.");
  const body = new URLSearchParams();
  body.set("h", "entry");
  body.set("name", input.title.trim() || "Untitled");
  body.set("content[html]", input.html);
  body.set("post-status", "published");

  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      accept: "application/json",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Micropub rejected the post (${response.status}).`);
  }
  const location = response.headers.get("location");
  if (location)
    return {
      url: new URL(location, endpoint).toString(),
      status: response.status,
    };
  try {
    const json = (await response.json()) as { url?: unknown };
    return {
      url:
        typeof json.url === "string"
          ? new URL(json.url, endpoint).toString()
          : null,
      status: response.status,
    };
  } catch {
    return { url: null, status: response.status };
  }
}
