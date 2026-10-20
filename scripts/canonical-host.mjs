/** Consolidate the public www alias before static files or the router respond. */
export function redirectCanonicalHost(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const host = req.headers.host?.toLowerCase();
  if (host !== "www.twyne.love" && host !== "www.twyne.love:443") {
    return false;
  }

  const url = new URL(req.url ?? "/", "https://twyne.love");
  res.writeHead(301, {
    Location: `https://twyne.love${url.pathname}${url.search}`,
    "Content-Length": "0",
  });
  res.end();
  return true;
}
