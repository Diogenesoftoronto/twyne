/** Called only after the build's static-file middleware reports a miss. */
export function rejectMissingBuildAsset(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (!path.startsWith("/build/") && !path.startsWith("/assets/")) return false;
  // An old content hash cannot become a route by adding a trailing slash.
  // HTML here both wastes SSR work and hides the actual module-load failure.
  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": "9",
  });
  res.end(req.method === "HEAD" ? undefined : "Not Found");
  return true;
}
