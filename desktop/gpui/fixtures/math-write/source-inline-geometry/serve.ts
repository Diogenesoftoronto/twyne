import { prepareInlineGeometry } from "./fixture-server";

// Authored Parent entry point. This worker never starts the server.
const fixture = await prepareInlineGeometry();
const port = Number(process.env.INLINE_GEOMETRY_PORT ?? "5199");
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Invalid explicitly configured owned fixture port.");
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    return fixture.fetch(request) ?? new Response("Not an inline-geometry fixture path", { status: 404 });
  },
});
console.log(JSON.stringify({
  origin: String(server.url),
  example: String(server.url) + "inline-geometry/?scenario=wide-ordinary",
  artifacts: fixture.generated,
  scope: "Original-source scaffold; server preparation alone is not browser/native geometry proof.",
}, null, 2));
