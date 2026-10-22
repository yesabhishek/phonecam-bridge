import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import WebSocket from "ws";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "phonecam-test-"));
process.env.PHONECAM_HOME = home;

const { parseArgs } = await import("../bin/phonecam.js");
const { ensureCertificates } = await import("../src/cert.js");
const { pickLanAddress } = await import("../src/network.js");
const { startServer } = await import("../src/server.js");
const { loadConfig, rotateSecret, secretMatches } = await import("../src/state.js");

after(() => fs.rmSync(home, { recursive: true, force: true }));

describe("cli arguments", () => {
  test("parses start options", () => {
    assert.deepEqual(parseArgs(["start", "--port", "9000", "--record", "x.h264", "--no-qr"]), {
      command: "start",
      port: 9000,
      record: "x.h264",
      qr: false,
      reset: false
    });
  });

  test("rejects bad input", () => {
    assert.throws(() => parseArgs(["start", "--port", "99999"]), /--port/);
    assert.throws(() => parseArgs(["start", "--record"]), /--record/);
    assert.throws(() => parseArgs(["start", "--bogus"]), /Unknown option/);
  });

  test("maps help and version flags", () => {
    assert.equal(parseArgs([]).command, "help");
    assert.equal(parseArgs(["--help"]).command, "help");
    assert.equal(parseArgs(["--version"]).command, "version");
  });
});

describe("pairing state", () => {
  test("persists the secret across loads and rotates on reset", () => {
    const first = loadConfig();
    assert.equal(loadConfig().secret, first.secret);
    assert.ok(secretMatches(first, first.secret));
    assert.ok(!secretMatches(first, "wrong"));
    assert.ok(!secretMatches(first, undefined));

    const rotated = rotateSecret();
    assert.notEqual(rotated.secret, first.secret);
    assert.equal(loadConfig().secret, rotated.secret);
  });
});

describe("certificates", () => {
  test("issues a server certificate for the LAN address from a persistent CA", () => {
    const first = ensureCertificates("192.168.50.7");
    const cert = new crypto.X509Certificate(first.cert);
    const ca = new crypto.X509Certificate(fs.readFileSync(path.join(home, "ca-cert.pem"), "utf8"));
    assert.ok(ca.ca);
    assert.ok(!cert.ca);
    assert.ok(cert.verify(ca.publicKey));
    assert.ok(cert.checkIssued(ca));
    assert.equal(cert.checkIP("192.168.50.7"), "192.168.50.7");
    assert.equal(cert.checkHost("localhost"), "localhost");
    assert.match(cert.keyUsage.join(","), /1\.3\.6\.1\.5\.5\.7\.3\.1/);

    // Same address: reused. New address: re-issued from the same CA.
    assert.equal(ensureCertificates("192.168.50.7").cert, first.cert);
    const moved = ensureCertificates("10.0.0.9");
    assert.notEqual(moved.cert, first.cert);
    assert.ok(new crypto.X509Certificate(moved.cert).verify(ca.publicKey));
    assert.deepEqual(moved.caDer, first.caDer);
  });
});

describe("network", () => {
  test("picks an IPv4 address", async () => {
    assert.match(await pickLanAddress(), /^\d+\.\d+\.\d+\.\d+$/);
  });
});

describe("server", () => {
  const frames = [];
  let keyFrameRequest;
  let server;
  const sink = {
    describe: () => "test",
    write: (frame) => frames.push(frame),
    onKeyFrameNeeded: (callback) => {
      keyFrameRequest = callback;
    }
  };

  before(async () => {
    server = await startServer({ port: 0, sink, log: () => {} });
  });
  after(() => server.close());

  const open = () => new WebSocket(`wss://127.0.0.1:${server.port}/ws`, { rejectUnauthorized: false });
  const closeCode = (ws) => new Promise((resolve) => ws.once("close", (code) => resolve(code)));
  const nextMessage = (ws) => new Promise((resolve) => ws.once("message", (data) => resolve(JSON.parse(data.toString()))));

  test("serves the phone page and health check", async () => {
    const page = await get(server.port, "/");
    assert.equal(page.status, 200);
    assert.match(page.body, /<title>PhoneCam<\/title>/);
    assert.equal((await get(server.port, "/app.js")).status, 200);
    assert.equal((await get(server.port, "/ca.crt")).status, 200);
    assert.equal((await get(server.port, "/missing")).status, 404);
    assert.deepEqual(JSON.parse((await get(server.port, "/healthz")).body).ok, true);
  });

  test("rejects a wrong pairing key", async () => {
    const ws = open();
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", key: "nope" })));
    assert.equal(await closeCode(ws), 4001);
  });

  test("accepts the paired phone, parses frames, and forwards key frame requests", async () => {
    const ws = open();
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ type: "hello", key: loadConfig().secret, agent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" }));
    assert.deepEqual(await nextMessage(ws), { type: "ready" });

    const payload = Buffer.from([0, 0, 0, 1, 0x65, 0xaa, 0xbb]);
    const header = Buffer.alloc(9);
    header.writeUInt8(1, 0);
    header.writeUInt16BE(1920, 1);
    header.writeUInt16BE(1080, 3);
    ws.send(Buffer.concat([header, payload]));
    await waitFor(() => frames.length === 1);
    assert.equal(frames[0].keyFrame, true);
    assert.equal(frames[0].width, 1920);
    assert.equal(frames[0].height, 1080);
    assert.deepEqual(Buffer.from(frames[0].data), payload);

    const health = JSON.parse((await get(server.port, "/healthz")).body);
    assert.equal(health.phone, true);
    assert.match(health.device, /Pixel 8/);

    const request = nextMessage(ws);
    keyFrameRequest();
    assert.deepEqual(await request, { type: "keyframe" });

    // A second phone takes over; the first is told why.
    const second = open();
    const firstClosed = closeCode(ws);
    second.on("open", () => second.send(JSON.stringify({ type: "hello", key: loadConfig().secret })));
    assert.equal(await firstClosed, 4002);
    second.close();
  });
});

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    https.get({ host: "127.0.0.1", port, path: pathname, rejectUnauthorized: false }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    }).on("error", reject);
  });
}

async function waitFor(condition, timeoutMs = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
