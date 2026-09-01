import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST_ROOT = fileURLToPath(new URL("./dist/", import.meta.url));
const ROOT_FILE_TYPES = {
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

async function serveRootStaticFile(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") return next();

  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  let filename;
  try {
    filename = decodeURIComponent(pathname.slice(1));
  } catch {
    return next();
  }
  if (!filename || filename.includes("/") || filename.includes("\\")) {
    return next();
  }

  const filePath = join(DIST_ROOT, filename);
  try {
    const details = await stat(filePath);
    if (!details.isFile()) return next();

    const contentType = ROOT_FILE_TYPES[extname(filename).toLowerCase()];
    if (contentType) res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", details.size);
    res.setHeader(
      "Cache-Control",
      filename === "service-worker.js" || filename === "manifest.json"
        ? "no-cache"
        : "public, max-age=3600",
    );
    if (filename === "service-worker.js") {
      res.setHeader("Service-Worker-Allowed", "/");
    }
    res.writeHead(200);
    if (req.method === "HEAD") return res.end();
    createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return next();
    next(error);
  }
}

async function main() {
  try {
    const mod = await import("./server/entry.preview.js");
    const { router, notFound, staticFile } = mod.default ? mod.default : mod;

    const server = createServer((req, res) => {
      serveRootStaticFile(req, res, (rootStaticError) => {
        if (rootStaticError) {
          console.error(rootStaticError);
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal Server Error");
          return;
        }

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
