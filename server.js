import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installLiveVoiceRelay } from "./scripts/live-voice-relay.mjs";

// Railway terminates TLS at its edge. Let Qwik validate browser origins using
// the edge's protocol rather than the container's internal HTTP connection.
// Keep explicit deployment overrides and local direct-server behavior intact.
if (process.env.RAILWAY_ENVIRONMENT_ID && !process.env.PROTOCOL_HEADER) {
  process.env.PROTOCOL_HEADER = "x-forwarded-proto";
}

const DIST_ROOT = fileURLToPath(new URL("./dist/", import.meta.url));
const ROOT_FILE_TYPES = {
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
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
  const launchMedia = /^assets\/launch\/the-room-(en|fr)\.(mp4|jpg|vtt)$/.test(
    filename,
  );
  const manualMedia =
    /^assets\/manual\/(roll-call|edited|newsreel|the-strike|sting|house-context|source-workspace|living-desk|writing-instruments)\.(mp4|jpg|vtt)$/.test(
      filename,
    );
  if (
    !filename ||
    (!launchMedia && !manualMedia && filename.includes("/")) ||
    filename.includes("\\")
  ) {
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
    // The router's static middleware sends entire files. Native video seeking
    // needs byte ranges for the launch film and contextual manual videos.
    if ((launchMedia || manualMedia) && extname(filename) === ".mp4") {
      res.setHeader("Accept-Ranges", "bytes");
      if (req.method === "GET" && req.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        let start = range?.[1] ? Number(range[1]) : 0;
        let end = range?.[2] ? Number(range[2]) : details.size - 1;
        if (range && !range[1] && range[2]) {
          start = Math.max(0, details.size - Number(range[2]));
          end = details.size - 1;
        }
        if (
          !range ||
          (!range[1] && !range[2]) ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start >= details.size ||
          end < start
        ) {
          res.setHeader("Content-Range", `bytes */${details.size}`);
          res.setHeader("Content-Length", 0);
          res.writeHead(416);
          return res.end();
        }
        end = Math.min(end, details.size - 1);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${details.size}`);
        res.setHeader("Content-Length", end - start + 1);
        res.writeHead(206);
        const stream = createReadStream(filePath, { start, end });
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        return stream.pipe(res);
      }
    }
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

    installLiveVoiceRelay(server);
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
