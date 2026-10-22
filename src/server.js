import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { ensureCertificates } from "./cert.js";
import { pickLanAddress } from "./network.js";
import { loadConfig, secretMatches } from "./state.js";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/icon.svg": ["icon.svg", "image/svg+xml"]
};
const HELLO_TIMEOUT_MS = 5000;
const HEADER_BYTES = 9;

// Serves the phone page and receives its H.264 stream. Exactly one phone
// streams at a time; a newer connection replaces the older one.
export async function startServer({ port, sink, onStats, log = console.log }) {
  let address = await pickLanAddress();
  let tls = ensureCertificates(address);
  const files = Object.fromEntries(
    Object.entries(STATIC_FILES).map(([route, [file, type]]) => [route, { body: fs.readFileSync(path.join(webRoot, file)), type }])
  );

  let phone;
  let phoneInfo;
  const stats = { frames: 0, bytes: 0, keyFrames: 0, width: 0, height: 0, since: Date.now() };

  const server = https.createServer({ key: tls.key, cert: tls.cert }, (request, response) => {
    const url = new URL(request.url || "/", "https://localhost");
    const file = files[url.pathname];

    if (file) {
      send(response, 200, file.type, file.body);
    } else if (url.pathname === "/ca.crt") {
      send(response, 200, "application/x-x509-ca-cert", tls.caDer, {
        "content-disposition": "attachment; filename=\"PhoneCam-CA.crt\""
      });
    } else if (url.pathname === "/healthz") {
      send(response, 200, "application/json", JSON.stringify({
        ok: true,
        phone: Boolean(phone),
        device: phoneInfo,
        width: stats.width,
        height: stats.height
      }));
    } else {
      send(response, 404, "text/plain; charset=utf-8", "Not found");
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 8 * 1024 * 1024 });

  wss.on("connection", (ws, request) => {
    ws._socket?.setNoDelay(true);
    let authed = false;
    const helloTimer = setTimeout(() => ws.close(4001, "No pairing key"), HELLO_TIMEOUT_MS);

    ws.on("message", (data, isBinary) => {
      if (!authed) {
        let message;
        try {
          message = JSON.parse(data.toString());
        } catch {
          message = {};
        }
        if (isBinary || message.type !== "hello" || !secretMatches(loadConfig(), message.key)) {
          ws.close(4001, "Invalid pairing key");
          return;
        }
        authed = true;
        clearTimeout(helloTimer);
        if (phone && phone !== ws) {
          phone.close(4002, "Replaced by a newer connection");
        }
        phone = ws;
        phoneInfo = describeDevice(message.agent, request.socket.remoteAddress);
        ws.send(JSON.stringify({ type: "ready" }));
        log(`Phone connected: ${phoneInfo}`);
        return;
      }

      if (!isBinary || phone !== ws || data.length <= HEADER_BYTES) {
        return;
      }

      const frame = {
        keyFrame: (data[0] & 1) === 1,
        width: data.readUInt16BE(1),
        height: data.readUInt16BE(3),
        data: data.subarray(HEADER_BYTES)
      };
      stats.frames += 1;
      stats.bytes += data.length;
      stats.keyFrames += frame.keyFrame ? 1 : 0;
      stats.width = frame.width;
      stats.height = frame.height;
      sink.write(frame);
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (phone === ws) {
        phone = undefined;
        log("Phone disconnected. Waiting for it to reconnect…");
        sink.idle?.();
      }
    });
    ws.on("error", () => {});
  });

  let lastKeyFrameRequest = 0;
  sink.onKeyFrameNeeded?.(() => {
    const now = Date.now();
    if (phone && phone.readyState === phone.OPEN && now - lastKeyFrameRequest > 500) {
      lastKeyFrameRequest = now;
      phone.send(JSON.stringify({ type: "keyframe" }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is in use. PhoneCam may already be running (check “phonecam status”).`));
      } else {
        reject(error);
      }
    });
    server.listen(port, "0.0.0.0", resolve);
  });

  // Laptops change networks; re-issue the certificate for the new address so
  // the background service keeps working without a restart.
  const addressTimer = setInterval(async () => {
    const current = await pickLanAddress();
    if (current !== address) {
      address = current;
      tls = ensureCertificates(address);
      server.setSecureContext({ key: tls.key, cert: tls.cert });
      log(`Network changed: now reachable at https://${address}:${port}`);
    }
  }, 15000);
  addressTimer.unref();

  const statsTimer = setInterval(() => {
    const now = Date.now();
    const seconds = (now - stats.since) / 1000;
    if (phone && onStats) {
      onStats({
        fps: stats.frames / seconds,
        mbps: (stats.bytes * 8) / seconds / 1e6,
        width: stats.width,
        height: stats.height
      });
    }
    Object.assign(stats, { frames: 0, bytes: 0, keyFrames: 0, since: now });
  }, 2000);

  return {
    get address() {
      return address;
    },
    port: server.address().port,
    close() {
      clearInterval(statsTimer);
      clearInterval(addressTimer);
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      server.close();
    }
  };
}

function describeDevice(agent = "", remoteAddress = "") {
  const ip = remoteAddress.replace(/^::ffff:/, "");
  if (/iPhone|iPad/.test(agent)) {
    return `iPhone/iPad (${ip})`;
  }
  const android = agent.match(/Android [^;)]*;\s*([^;)]+)/);
  if (android) {
    return `${android[1].trim()} (${ip})`;
  }
  return ip || "unknown device";
}

function send(response, status, type, body, headers = {}) {
  response.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers
  });
  response.end(body);
}
