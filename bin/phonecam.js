#!/usr/bin/env node

import { startPhoneCamServer } from "../src/server.js";
import { ensureObs, installObs, printObsCheck } from "../src/obs.js";

function parseArgs(argv) {
  const args = {
    command: argv[2] || "help",
    subcommand: argv[3],
    host: "0.0.0.0",
    port: 8443,
    obsPort: undefined,
    obsHttp: true,
    cert: undefined,
    key: undefined,
    open: true,
    qr: true
  };

  if (args.command === "-h" || args.command === "--help") {
    args.command = "help";
  }

  const startIndex = args.command === "obs" ? 4 : 3;

  for (let index = startIndex; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--host" && next) {
      args.host = next;
      index += 1;
    } else if (arg === "--port" && next) {
      args.port = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--obs-port" && next) {
      args.obsPort = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--cert" && next) {
      args.cert = next;
      index += 1;
    } else if (arg === "--key" && next) {
      args.key = next;
      index += 1;
    } else if (arg === "--no-open") {
      args.open = false;
    } else if (arg === "--no-qr") {
      args.qr = false;
    } else if (arg === "--no-obs-http") {
      args.obsHttp = false;
    } else if (arg === "-h" || arg === "--help") {
      args.command = "help";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`phonecam

Usage:
  phonecam start [--host 0.0.0.0] [--port 8443] [--obs-port 8444] [--cert ./cert.pem] [--key ./key.pem] [--no-open] [--no-qr] [--no-obs-http]
  phonecam obs check
  phonecam obs install
  phonecam obs ensure

What it does:
  Starts a local HTTPS server, prints a QR code for your phone, and opens a
  laptop preview page. The phone streams camera video to preview and OBS pages
  over Wi-Fi. OBS gets a localhost-only HTTP URL by default because OBS Browser
  Source often cannot accept self-signed HTTPS certificates.

Important:
  This CLI does not create a Windows webcam device. Teams/Zoom can only select
  this stream as a Camera if IT allows an OS-level virtual camera such as OBS
  Virtual Camera.

OBS commands:
  check    Detect OS, OBS install status, and supported installer.
  install  Try to install OBS Studio with the OS package manager.
  ensure   Check first, then install OBS Studio only when missing.
`);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.command === "help") {
    printHelp();
    return;
  }

  if (args.command === "obs") {
    if (args.subcommand === "check") {
      const ok = await printObsCheck();
      process.exitCode = ok ? 0 : 1;
      return;
    }

    if (args.subcommand === "install") {
      const ok = await installObs();
      process.exitCode = ok ? 0 : 1;
      return;
    }

    if (args.subcommand === "ensure") {
      const ok = await ensureObs();
      process.exitCode = ok ? 0 : 1;
      return;
    }

    throw new Error("Unknown OBS command. Use: phonecam obs check|install|ensure");
  }

  if (args.command === "start") {
    await startPhoneCamServer(args);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error) => {
  console.error(`\nphonecam: ${error.message}`);
  process.exitCode = 1;
});
