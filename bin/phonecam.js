#!/usr/bin/env node

import fs from "node:fs";
import https from "node:https";
import qrcode from "qrcode-terminal";
import { ensureCertificates } from "../src/cert.js";
import { pickLanAddress } from "../src/network.js";
import { startServer } from "../src/server.js";
import { setup, uninstall, unsupportedPlatformMessage } from "../src/setup.js";
import { createSink } from "../src/sinks.js";
import { loadConfig, rotateSecret, saveConfig, statePath } from "../src/state.js";

const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const HELP = `phonecam ${VERSION} — use your phone as a wireless 1080p webcam

Usage:
  phonecam setup              One-time install of the PhoneCam camera (asks for admin once)
  phonecam pair [--reset]     Show the QR code to scan with your phone
                              --reset forgets previously paired phones
  phonecam start [options]    Run in the foreground (setup already runs it at login)
  phonecam status             Show whether PhoneCam is running and a phone is streaming
  phonecam uninstall          Remove the camera, background service, and pairing data

Start options:
  --port <n>          HTTPS port (default 8443, remembered)
  --record <file>     Save the phone's H.264 stream to a file instead of the camera
  --no-qr             Don't print the QR code

On your phone: scan the QR code, allow camera access, and keep the page open.
Then pick "PhoneCam" as the camera in Teams, Meet, or Zoom.`;

export function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = { command, qr: true, reset: false };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--port") {
      options.port = Number.parseInt(rest[++index], 10);
      if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
        throw new Error("--port needs a number between 1 and 65535.");
      }
    } else if (arg === "--record") {
      options.record = rest[++index];
      if (!options.record) {
        throw new Error("--record needs a file path.");
      }
    } else if (arg === "--no-qr") {
      options.qr = false;
    } else if (arg === "--reset") {
      options.reset = true;
    } else if (arg === "-h" || arg === "--help") {
      options.command = "help";
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.command === "-h" || options.command === "--help") {
    options.command = "help";
  }
  if (options.command === "-v" || options.command === "--version") {
    options.command = "version";
  }
  return options;
}

async function printPairing({ reset = false } = {}) {
  const config = reset ? rotateSecret() : loadConfig();
  const address = await pickLanAddress();
  ensureCertificates(address);
  const url = `https://${address}:${config.port}/#k=${config.secret}`;

  console.log("\nScan with your phone's camera (iPhone Safari or Android Chrome):\n");
  qrcode.generate(url, { small: true });
  console.log(`\n${url}\n`);
  console.log("First time only: your phone warns that the connection isn't private — tap");
  console.log("“Show Details → visit this website” (iPhone) or “Advanced → Proceed” (Android).");
  console.log("Then add the page to your Home Screen to reconnect with one tap.\n");
  if (reset) {
    console.log("Previously paired phones were forgotten.\n");
  }
}

async function start(options) {
  const config = loadConfig();
  if (options.port && options.port !== config.port) {
    config.port = options.port;
    saveConfig(config);
  }

  let sink = createSink({ record: options.record });
  if (!sink) {
    console.log(`${unsupportedPlatformMessage()}\nThe phone's stream will be received but not shown as a camera.\n`);
    sink = { describe: () => "no camera driver", write() {} };
  }

  const interactive = process.stdout.isTTY;
  let statusLineShown = false;
  const log = (message) => {
    if (statusLineShown) {
      process.stdout.write("\n");
      statusLineShown = false;
    }
    console.log(message);
  };

  const server = await startServer({
    port: config.port,
    sink,
    log,
    onStats: interactive
      ? ({ fps, mbps, width, height }) => {
          process.stdout.write(`\r● Streaming ${width}×${height} · ${fps.toFixed(0)} fps · ${mbps.toFixed(1)} Mbps   `);
          statusLineShown = true;
        }
      : undefined
  });

  log(`PhoneCam is running on https://${server.address}:${config.port} → ${sink.describe()}`);
  if (options.qr) {
    await printPairing();
  }
  log("Waiting for your phone… (Ctrl+C to stop)");

  const shutdown = () => {
    server.close();
    sink.close?.();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function status() {
  const config = loadConfig();
  let ca;
  try {
    ca = fs.readFileSync(statePath("ca-cert.pem"));
  } catch {
    console.log("PhoneCam has not been started on this computer yet.");
    return false;
  }

  const health = await new Promise((resolve) => {
    const request = https.get({ host: "127.0.0.1", port: config.port, path: "/healthz", ca, timeout: 2000 }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(undefined);
        }
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(undefined));
  });

  if (!health?.ok) {
    console.log(`PhoneCam is not running (port ${config.port}). Start it with “phonecam start”.`);
    return false;
  }
  console.log(`PhoneCam is running on port ${config.port}.`);
  console.log(health.phone
    ? `Phone: ${health.device} streaming ${health.width}×${health.height}`
    : "Phone: not connected (run “phonecam pair” to show the QR code)");
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  switch (options.command) {
    case "help":
      console.log(HELP);
      return;
    case "version":
      console.log(VERSION);
      return;
    case "setup":
      if (!setup()) {
        process.exitCode = 1;
        return;
      }
      console.log("\nPhoneCam is installed and will start automatically at login.");
      await printPairing();
      return;
    case "pair":
      await printPairing({ reset: options.reset });
      return;
    case "start":
      await start(options);
      return;
    case "status":
      process.exitCode = (await status()) ? 0 : 1;
      return;
    case "uninstall":
      uninstall();
      return;
    default:
      throw new Error(`Unknown command: ${options.command}. Run “phonecam help”.`);
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url))) {
  main().catch((error) => {
    console.error(`phonecam: ${error.message}`);
    process.exitCode = 1;
  });
}
