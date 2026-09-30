import { expect, spyOn, test } from "bun:test";
import { createServer } from "node:http";
import https from "node:https";
import { once } from "node:events";
import { WebSocket } from "ws";
import {
  installLiveVoiceRelay,
  liveHandshake,
  liveOriginAllowed,
} from "../scripts/live-voice-relay.mjs";
const issuer = "https://api.notorganic.info";
const proof = (htu = `${issuer}/v1/live/sessions`) =>
  `header.${Buffer.from(JSON.stringify({ htu, htm: "GET" })).toString("base64url")}.signature`;
const handshake = () => ({
  type: "twyne.live.connect",
  authorization: "DPoP token",
  dpop: proof(),
  idempotencyKey: "session-123",
  maxCostMicrousd: 500_000,
});
test("Live relay pins destination and the approved session spending ceiling", () => {
  const result = liveHandshake(handshake(), issuer);
  expect(result.url).toBe("wss://api.notorganic.info/v1/live/sessions");
  expect(result.headers["x-notorganic-max-cost-microusd"]).toBe("500000");
  expect(() =>
    liveHandshake({ ...handshake(), maxCostMicrousd: 5_000_000 }, issuer),
  ).toThrow();
  expect(() =>
    liveHandshake(
      { ...handshake(), dpop: proof("https://other.example/") },
      issuer,
    ),
  ).toThrow();
  expect(() =>
    liveHandshake(handshake(), "http://api.notorganic.info"),
  ).toThrow();
  expect(() =>
    liveHandshake(
      { ...handshake(), authorization: "Bearer provider-key" },
      issuer,
    ),
  ).toThrow();
});

async function checkUpgrades(
  origin: string,
  cases: (port: number) => {
    origin?: string;
    host?: string;
    status: number;
  }[],
) {
  const server = createServer();
  const upstream = createServer();
  let upstreamConnections = 0;
  upstream.on("connection", (socket) => {
    upstreamConnections++;
    socket.destroy();
  });
  const clients = new Set<WebSocket>();
  // Fail locally if an origin check accidentally initiates upstream authentication.
  const upstreamRequest = spyOn(https, "request").mockImplementation(() => {
    throw new Error("Origin checks must not contact the upstream gateway.");
  });
  let stop = () => {};
  try {
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const gatewayAddress = upstream.address();
    if (!gatewayAddress || typeof gatewayAddress === "string")
      throw new Error("Expected a local upstream sentinel.");
    stop = installLiveVoiceRelay(server, {
      origin,
      issuer: `https://127.0.0.1:${gatewayAddress.port}`,
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected a local TCP server.");
    for (const entry of cases(address.port)) {
      expect(
        liveOriginAllowed(
          entry.origin,
          origin,
          entry.host ?? `127.0.0.1:${address.port}`,
        ),
      ).toBe(entry.status === 101);
      const status = await new Promise<number>((resolve, reject) => {
        const client = new WebSocket(
          `ws://127.0.0.1:${address.port}/api/live`,
          {
            headers: {
              ...(entry.origin === undefined ? {} : { Origin: entry.origin }),
              ...(entry.host ? { Host: entry.host } : {}),
            },
            handshakeTimeout: 1500,
          },
        );
        clients.add(client);
        client.once("error", (error) => {
          // Older supported Bun versions expose rejection as a connection
          // error, without an unexpected-response event or HTTP status.
          if (entry.status === 403) resolve(0);
          else reject(error);
        });
        client.once("open", () => {
          resolve(101);
          client.close();
        });
        client.once("unexpected-response", (_request, response) => {
          resolve(response.statusCode ?? 0);
          response.destroy();
          client.terminate();
        });
      });
      if (entry.status === 101) expect(status).toBe(101);
      else expect([403, 0]).toContain(status);
      expect(upstreamRequest).not.toHaveBeenCalled();
      expect(upstreamConnections).toBe(0);
    }
  } finally {
    for (const client of clients) client.terminate();
    stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    upstreamRequest.mockRestore();
  }
}

const productionOrigins = ["https://twyne.love", "https://www.twyne.love"];
const rejectedOrigins = [
  undefined,
  "null",
  "not a URL",
  "https://unrelated.example",
  "https://twyne.love.evil.example",
  "https://www.twyne.love.evil.example",
  "https://twyne-love.example",
  "https://twyne.love@evil.example",
  "https://evil.example@twyne.love",
  "https://twyne.love:444",
  "http://twyne.love",
  "http://www.twyne.love",
  "https://twyne.love/path",
  "https://twyne.love?query=1",
  "https://twyne.love#fragment",
  "https://twyne.love/",
  "https://twyne.love:443",
];

test.each(productionOrigins)(
  "Live upgrades allow both HTTPS production origins when configured as %s",
  async (configured) => {
    await checkUpgrades(configured, () => [
      ...productionOrigins.map((origin) => ({ origin, status: 101 })),
      ...rejectedOrigins.map((origin) => ({ origin, status: 403 })),
    ]);
  },
);

test("Live upgrades keep custom configured origins exact and fail closed on invalid configuration", async () => {
  const configured = "https://preview.example";
  await checkUpgrades(configured, () => [
    { origin: configured, status: 101 },
    { origin: "https://www.preview.example", status: 403 },
    { origin: "https://preview.example.evil.example", status: 403 },
    { origin: "http://preview.example", status: 403 },
    { origin: "https://preview.example:444", status: 403 },
    ...productionOrigins.map((origin) => ({ origin, status: 403 })),
  ]);
  await checkUpgrades("not a URL", (port) => [
    { origin: configured, status: 403 },
    { origin: `http://127.0.0.1:${port}`, status: 403 },
    ...productionOrigins.map((origin) => ({ origin, status: 403 })),
  ]);
});

test("Live development upgrades require an HTTP loopback origin matching the exact request host", async () => {
  await checkUpgrades("", (port) => [
    { origin: `http://127.0.0.1:${port}`, status: 101 },
    { origin: `https://127.0.0.1:${port}`, status: 101 },
    {
      origin: `http://localhost:${port}`,
      host: `localhost:${port}`,
      status: 101,
    },
    { origin: `http://localhost:${port}`, status: 403 },
    { origin: "http://127.0.0.1:1", status: 403 },
    { origin: `http://localhost.evil.example:${port}`, status: 403 },
    { origin: `ftp://127.0.0.1:${port}`, status: 403 },
    { origin: `http://127.0.0.1:${port}/path`, status: 403 },
    ...productionOrigins.map((origin) => ({ origin, status: 403 })),
    { status: 403 },
  ]);
});
