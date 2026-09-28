import { WebSocket, WebSocketServer } from "ws";

const FRAME = 131_072;
const BUFFER = 1_048_576;

export function liveHandshake(value, issuer) {
  const url = new URL("/v1/live/sessions", issuer);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Live requires a trusted HTTPS gateway.");
  if (
    value?.type !== "twyne.live.connect" ||
    typeof value.authorization !== "string" ||
    value.authorization.length > 16384 ||
    !/^DPoP [A-Za-z0-9._~+/=-]+$/.test(value.authorization) ||
    typeof value.dpop !== "string" ||
    value.dpop.length > 16384 ||
    !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value.dpop) ||
    typeof value.idempotencyKey !== "string" ||
    !/^[\w:-]{1,128}$/.test(value.idempotencyKey) ||
    value.maxCostMicrousd !== 500_000
  ) {
    throw new Error("Sign in again to start Live voice.");
  }
  const proof = JSON.parse(
    Buffer.from(value.dpop.split(".")[1], "base64url").toString(),
  );
  if (proof.htm !== "GET" || proof.htu !== url.href)
    throw new Error("Live authorization has the wrong destination.");
  url.protocol = "wss:";
  return {
    url: url.href,
    headers: {
      authorization: value.authorization,
      dpop: value.dpop,
      "idempotency-key": value.idempotencyKey,
      "x-notorganic-max-cost-microusd": "500000",
      "x-notorganic-product": "twyne",
      "x-notorganic-feature": "voice-live",
    },
  };
}

/** Browser cookies and provider keys never enter this transport. The gateway verifies the one-use DPoP proof and owns billing. */
export function installLiveVoiceRelay(server, options = {}) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: FRAME,
    perMessageDeflate: false,
  });
  const issuer =
    options.issuer ??
    process.env.NOTORGANIC_ISSUER ??
    "https://api.notorganic.info";
  const upgrade = (req, socket, head) => {
    if (req.url !== "/api/live") return;
    let allowed = false;
    try {
      const origin = new URL(req.headers.origin);
      const configured = options.origin ?? process.env.SITE_URL;
      allowed = configured
        ? origin.origin === new URL(configured).origin
        : ["localhost", "127.0.0.1"].includes(origin.hostname) &&
          origin.host === req.headers.host;
    } catch {
      /* Missing or invalid origins fail closed. */
    }
    if (!allowed) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      let upstream;
      let phase = "auth";
      let lifetime;
      const close = () => {
        if (phase === "closed") return;
        phase = "closed";
        clearTimeout(deadline);
        clearTimeout(lifetime);
        // Not Organic keeps its own upstream alive to collect final usage.
        if (upstream?.readyState === WebSocket.CONNECTING) upstream.terminate();
        else upstream?.close(1000, "Twyne disconnected");
        if (client.readyState < WebSocket.CLOSING) client.close();
      };
      const fail = (message) => {
        if (client.readyState === WebSocket.OPEN)
          client.send(JSON.stringify({ type: "twyne.live.error", message }));
        close();
      };
      const deadline = setTimeout(
        () => fail("Live connection timed out. Try again."),
        15_000,
      );
      client.on("error", close);
      client.on("close", close);
      client.on("message", (raw, binary) => {
        if (phase === "closed") return;
        if (binary || raw.length > FRAME)
          return fail("Live requires bounded JSON audio events.");
        let event;
        try {
          event = JSON.parse(raw.toString());
        } catch {
          return fail("Invalid Live event.");
        }
        if (phase === "auth") {
          let auth;
          try {
            auth = liveHandshake(event, issuer);
          } catch {
            return fail("Live authorization failed. Sign in again.");
          }
          phase = "connecting";
          upstream = new WebSocket(auth.url, {
            headers: auth.headers,
            handshakeTimeout: 12_000,
            maxPayload: FRAME,
            followRedirects: false,
            perMessageDeflate: false,
          });
          upstream.on("open", () => {
            if (phase === "closed") {
              upstream.close();
              return;
            }
            phase = "open";
            clearTimeout(deadline);
            lifetime = setTimeout(
              () => fail("Live reached its session limit."),
              26 * 60_000,
            );
            client.send(JSON.stringify({ type: "twyne.live.ready" }));
          });
          upstream.on("message", (data, isBinary) => {
            if (phase !== "open") return;
            if (isBinary || client.bufferedAmount + data.length > BUFFER)
              return fail(
                "The audio connection could not keep up. Reconnect to continue.",
              );
            client.send(data.toString());
          });
          upstream.on("error", () =>
            fail(
              "Live could not connect. Check your credit and voice permission, then try again.",
            ),
          );
          upstream.on("unexpected-response", (request, response) => {
            const status = response.statusCode;
            response.destroy();
            request.destroy();
            fail(
              status === 402
                ? "Not enough available credit. Add credit to continue."
                : status === 403
                  ? "Live permission or provider consent is missing."
                  : "GPT Live is unavailable on the provider. Try again later.",
            );
          });
          upstream.on("close", close);
          return;
        }
        if (
          phase !== "open" ||
          !event ||
          typeof event.type !== "string" ||
          !event.type.startsWith("session.") ||
          upstream.bufferedAmount + raw.length > BUFFER
        )
          return fail("Live is not ready or the connection is too slow.");
        upstream.send(raw.toString());
      });
    });
  };
  server.on("upgrade", upgrade);
  return () => {
    server.off("upgrade", upgrade);
    for (const client of wss.clients) client.close();
    wss.close();
  };
}
