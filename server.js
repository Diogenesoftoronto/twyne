import { createServer } from "node:http";

async function main() {
  try {
    const mod = await import("./server/entry.preview.js");
    const { router, notFound, staticFile } = mod.default ? mod.default : mod;

    const server = createServer((req, res) => {
      if (staticFile) {
        staticFile(req, res, () => {
          router(req, res, () => {
            notFound(req, res, () => {
              res.writeHead(404, { "Content-Type": "text/plain" });
              res.end("Not Found");
            });
          });
        });
      } else {
        router(req, res, () => {
          notFound(req, res, () => {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
          });
        });
      }
    });

    const port = parseInt(process.env.PORT || "3000", 10);
    server.listen(port, "0.0.0.0", () => {
      console.log(`Twyne server listening on 0.0.0.0:${port}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

main();
