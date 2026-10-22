import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_PORT = 8443;

export function stateDir() {
  if (process.env.PHONECAM_HOME) {
    return process.env.PHONECAM_HOME;
  }

  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "phonecam"
    );
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "phonecam");
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "phonecam");
}

export function statePath(name) {
  return path.join(stateDir(), name);
}

// The pairing secret is created once and reused, so a phone that scanned the
// QR code (or saved it to its home screen) reconnects without re-pairing.
export function loadConfig() {
  const file = statePath("config.json");
  let config = {};

  try {
    config = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // First run, or unreadable config: fall through and create one.
  }

  let changed = false;
  if (typeof config.secret !== "string" || config.secret.length < 24) {
    config.secret = crypto.randomBytes(24).toString("base64url");
    changed = true;
  }
  if (!Number.isInteger(config.port)) {
    config.port = DEFAULT_PORT;
    changed = true;
  }

  if (changed) {
    saveConfig(config);
  }
  return config;
}

export function saveConfig(config) {
  fs.mkdirSync(stateDir(), { recursive: true });
  const file = statePath("config.json");
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function rotateSecret() {
  const config = loadConfig();
  config.secret = crypto.randomBytes(24).toString("base64url");
  saveConfig(config);
  return config;
}

export function secretMatches(config, supplied) {
  if (typeof supplied !== "string") {
    return false;
  }
  const expected = Buffer.from(config.secret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
