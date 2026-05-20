import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import qrcode from "qrcode-terminal";
import selfsigned from "selfsigned";
import {
  asset,
  notFoundPage,
  obsPage,
  phonePage,
  previewPage,
  rootPage,
  stylesheet
} from "./pages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export async function startPhoneCamServer(options) {
  validateOptions(options);

  const token = crypto.randomBytes(18).toString("base64url");
  const cert = ensureCertificate(options);
  const sessions = createSignalState(token);
  const sockets = new Set();

  const server = https.createServer(cert, (request, response) => {
    routeHttp(request, response, token);
  });
  const obsHttpServer = options.obsHttp
    ? http.createServer((request, response) => {
        routeObsHttp(request, response, token);
      })
    : undefined;
  const wss = new WebSocketServer({ noServer: true });

  const trackSocket = (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };
  server.on("connection", trackSocket);
  obsHttpServer?.on("connection", trackSocket);

  const upgrade = (request, socket, head, constraints = {}) => {
    const url = new URL(request.url || "/", "https://localhost");
    if (url.pathname !== "/signal") {
      socket.destroy();
      return;
    }

    const role = url.searchParams.get("role");
    const kind = url.searchParams.get("kind") || "preview";
    const suppliedToken = url.searchParams.get("token");
    if (!sessions.isValid(role, suppliedToken)) {
      socket.destroy();
      return;
    }

    if (constraints.viewerOnly && role !== "viewer") {
      socket.destroy();
      return;
    }

    if (constraints.obsOnly && kind !== "obs") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, {
        role,
        kind
      });
    });
  };

  server.on("upgrade", (request, socket, head) => upgrade(request, socket, head));
  obsHttpServer?.on("upgrade", (request, socket, head) => {
    upgrade(request, socket, head, { viewerOnly: true, obsOnly: true });
  });

  wss.on("connection", (ws, _request, peer) => {
    sessions.attach(peer, ws);
  });

  await listen(server, options.port, options.host);
  const obsPort = options.obsPort || options.port + 1;
  if (obsHttpServer) {
    await listen(obsHttpServer, obsPort, "127.0.0.1");
  }

  const address = pickLanAddress();
  const phoneUrl = `https://${address}:${options.port}/phone?token=${token}`;
  const previewUrl = `https://localhost:${options.port}/preview?token=${token}`;
  const obsHttpsUrl = `https://localhost:${options.port}/obs?token=${token}`;
  const obsUrl = obsHttpServer
    ? `http://127.0.0.1:${obsPort}/obs?token=${token}`
    : obsHttpsUrl;

  printStartup({
    phoneUrl,
    previewUrl,
    obsUrl,
    obsHttpsUrl,
    showQr: options.qr,
    certificateSource: cert.source
  });

  if (options.open) {
    openBrowser(previewUrl);
  }

  const shutdown = createShutdown({ server, obsHttpServer, wss, sessions, sockets });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGHUP", shutdown);
}

function validateOptions(options) {
  if ((options.cert && !options.key) || (!options.cert && options.key)) {
    throw new Error("Use --cert and --key together.");
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("--port must be a valid TCP port.");
  }

  if (options.obsPort !== undefined && (!Number.isInteger(options.obsPort) || options.obsPort < 1 || options.obsPort > 65535)) {
    throw new Error("--obs-port must be a valid TCP port.");
  }
}

function routeHttp(request, response, token) {
  const url = new URL(request.url || "/", "https://localhost");

  if (url.pathname === "/healthz") {
    send(response, 200, "application/json", JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/style.css") {
    send(response, 200, "text/css; charset=utf-8", stylesheet());
    return;
  }

  if (url.pathname === "/assets/logo.svg") {
    send(response, 200, "image/svg+xml; charset=utf-8", asset("logo.svg"));
    return;
  }

  if (url.pathname === "/") {
    send(response, 200, "text/html; charset=utf-8", rootPage());
    return;
  }

  if (!isTokenValid(url, token)) {
    send(response, 403, "text/html; charset=utf-8", notFoundPage("Pairing link expired or invalid."));
    return;
  }

  if (url.pathname === "/phone") {
    send(response, 200, "text/html; charset=utf-8", phonePage(token));
    return;
  }

  if (url.pathname === "/preview") {
    send(response, 200, "text/html; charset=utf-8", previewPage(token));
    return;
  }

  if (url.pathname === "/obs") {
    send(response, 200, "text/html; charset=utf-8", obsPage(token));
    return;
  }

  send(response, 404, "text/html; charset=utf-8", notFoundPage("Page not found."));
}

function routeObsHttp(request, response, token) {
  const url = new URL(request.url || "/", "http://127.0.0.1");

  if (url.pathname === "/healthz") {
    send(response, 200, "application/json", JSON.stringify({ ok: true, obsHttp: true }));
    return;
  }

  if (url.pathname === "/style.css") {
    send(response, 200, "text/css; charset=utf-8", stylesheet());
    return;
  }

  if (url.pathname === "/assets/logo.svg") {
    send(response, 200, "image/svg+xml; charset=utf-8", asset("logo.svg"));
    return;
  }

  if (!isTokenValid(url, token)) {
    send(response, 403, "text/html; charset=utf-8", notFoundPage("Pairing link expired or invalid."));
    return;
  }

  if (url.pathname === "/obs") {
    send(response, 200, "text/html; charset=utf-8", obsPage(token));
    return;
  }

  send(response, 404, "text/html; charset=utf-8", notFoundPage("This local HTTP server is only for OBS Browser Source."));
}

function createSignalState(token) {
  let phoneSocket;
  const viewers = new Map();

  return {
    isValid(role, suppliedToken) {
      return suppliedToken === token && (role === "phone" || role === "viewer");
    },

    attach(peer, ws) {
      if (peer.role === "phone") {
        if (phoneSocket && phoneSocket.readyState === phoneSocket.OPEN) {
          phoneSocket.close(4000, "Replaced by a newer phone connection.");
        }
        phoneSocket = ws;
        sendJson(ws, { type: "status", role: "phone", message: "Phone signaling connected." });
        notifyPeerState();
        for (const [viewerId, viewer] of viewers.entries()) {
          sendJson(ws, { type: "viewer-ready", viewerId, kind: viewer.kind });
        }
      } else {
        const viewerId = crypto.randomBytes(10).toString("base64url");
        viewers.set(viewerId, { ws, kind: normalizeViewerKind(peer.kind) });
        sendJson(ws, {
          type: "status",
          role: "viewer",
          viewerId,
          message: "Viewer signaling connected."
        });
        if (phoneSocket && phoneSocket.readyState === phoneSocket.OPEN) {
          sendJson(phoneSocket, {
            type: "viewer-ready",
            viewerId,
            kind: viewers.get(viewerId).kind
          });
        }
        notifyPeerState();
      }

      ws.on("message", (raw) => relayMessage(peer, ws, raw));
      ws.on("close", () => detach(peer, ws));
      ws.on("error", () => detach(peer, ws));
    },

    closeAll() {
      if (phoneSocket && phoneSocket.readyState === phoneSocket.OPEN) {
        phoneSocket.close(1001, "Server shutting down.");
      }
      for (const viewer of viewers.values()) {
        if (viewer.ws.readyState === viewer.ws.OPEN) {
          viewer.ws.close(1001, "Server shutting down.");
        }
      }
    }
  };

  function relayMessage(peer, ws, raw) {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (peer.role === "phone") {
      const target = payload.to ? viewers.get(payload.to) : undefined;
      if (target && target.ws.readyState === target.ws.OPEN) {
        target.ws.send(JSON.stringify(payload));
      }
      return;
    }

    const viewerId = findViewerId(ws);
    if (!viewerId || !phoneSocket || phoneSocket.readyState !== phoneSocket.OPEN) {
      return;
    }

    phoneSocket.send(JSON.stringify({ ...payload, from: viewerId }));
  }

  function detach(peer, ws) {
    if (peer.role === "phone") {
      if (phoneSocket === ws) {
        phoneSocket = undefined;
      }
      notifyPeerState();
      return;
    }

    const viewerId = findViewerId(ws);
    if (viewerId) {
      viewers.delete(viewerId);
      if (phoneSocket && phoneSocket.readyState === phoneSocket.OPEN) {
        sendJson(phoneSocket, { type: "viewer-left", viewerId });
      }
      notifyPeerState();
    }
  }

  function findViewerId(ws) {
    for (const [viewerId, viewer] of viewers.entries()) {
      if (viewer.ws === ws) {
        return viewerId;
      }
    }
    return undefined;
  }

  function notifyPeerState() {
    const phoneConnected = Boolean(phoneSocket && phoneSocket.readyState === phoneSocket.OPEN);
    const viewerCount = viewers.size;
    const payload = { type: "peer-state", phoneConnected, viewerCount };

    if (phoneConnected) {
      sendJson(phoneSocket, payload);
    }

    for (const viewer of viewers.values()) {
      sendJson(viewer.ws, payload);
    }
  }
}

function normalizeViewerKind(kind) {
  return kind === "obs" ? "obs" : "preview";
}

function ensureCertificate(options) {
  if (options.cert && options.key) {
    return {
      key: fs.readFileSync(options.key),
      cert: fs.readFileSync(options.cert),
      source: "custom"
    };
  }

  const stateDir = getStateDir();
  const keyPath = path.join(stateDir, "localhost-key.pem");
  const certPath = path.join(stateDir, "localhost-cert.pem");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      source: "self-signed"
    };
  }

  fs.mkdirSync(stateDir, { recursive: true });
  const generated = selfsigned.generate([{ name: "commonName", value: "phonecam-bridge.local" }], {
    algorithm: "sha256",
    days: 365,
    keySize: 2048,
    extensions: [
      {
        name: "subjectAltName",
        altNames: certificateAltNames()
      }
    ]
  });

  fs.writeFileSync(keyPath, generated.private);
  fs.writeFileSync(certPath, generated.cert);

  return {
    key: generated.private,
    cert: generated.cert,
    source: "self-signed"
  };
}

function certificateAltNames() {
  const dnsNames = new Set(["localhost", "phonecam-bridge.local", os.hostname()]);
  const ipNames = new Set(["127.0.0.1", "::1"]);

  for (const values of Object.values(os.networkInterfaces())) {
    for (const info of values || []) {
      if (!info.internal) {
        ipNames.add(info.address);
      }
    }
  }

  return [
    ...Array.from(dnsNames).filter(Boolean).map((value) => ({ type: 2, value })),
    ...Array.from(ipNames).filter(Boolean).map((ip) => ({ type: 7, ip }))
  ];
}

function getStateDir() {
  if (process.env.PHONECAM_BRIDGE_HOME) {
    return process.env.PHONECAM_BRIDGE_HOME;
  }

  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), "AppData", "Local"),
      "phonecam-bridge"
    );
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "phonecam-bridge");
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "phonecam-bridge");
}

function isTokenValid(url, token) {
  return url.searchParams.get("token") === token;
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function pickLanAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const values of Object.values(interfaces)) {
    for (const info of values || []) {
      if (info.family === "IPv4" && !info.internal) {
        candidates.push(info.address);
      }
    }
  }

  return candidates[0] || "127.0.0.1";
}

function openBrowser(url) {
  const platform = process.platform;
  const command =
    platform === "win32"
      ? `start "" "${url}"`
      : platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  import("node:child_process").then(({ exec }) => {
    exec(command, () => {});
  });
}

function printStartup({ phoneUrl, previewUrl, obsUrl, obsHttpsUrl, showQr, certificateSource }) {
  console.log("\nphonecam-bridge is running.\n");
  console.log(`Phone URL:   ${phoneUrl}`);
  console.log(`Preview URL: ${previewUrl}`);
  console.log(`OBS URL:     ${obsUrl}`);
  if (obsHttpsUrl && obsHttpsUrl !== obsUrl) {
    console.log(`OBS HTTPS:   ${obsHttpsUrl}`);
  }
  console.log(`\nHTTPS: ${certificateSource === "custom" ? "using custom certificate" : "using generated self-signed certificate"}`);
  console.log("If a browser or OBS warns about the certificate, trust it only for this local session.");
  console.log("Use the OBS URL, not OBS HTTPS, unless OBS trusts your certificate.");
  console.log("Press Ctrl+C to stop.\n");

  if (showQr) {
    qrcode.generate(phoneUrl, { small: true });
    console.log("");
  }
}

function createShutdown({ server, obsHttpServer, wss, sessions, sockets }) {
  let shuttingDown = false;

  return () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log("\nStopping phonecam-bridge...");
    sessions.closeAll();
    wss.close();

    const forceTimer = setTimeout(() => {
      for (const socket of sockets) {
        socket.destroy();
      }
    }, 1500);

    let pending = obsHttpServer ? 2 : 1;
    const done = () => {
      pending -= 1;
      if (pending === 0) {
        clearTimeout(forceTimer);
        console.log("Stopped phonecam-bridge.");
        process.exit(0);
      }
    };

    server.close(done);
    obsHttpServer?.close(done);
  };
}
