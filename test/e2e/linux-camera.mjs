// End-to-end check on Linux: a fake phone streams H.264 to "phonecam start",
// and we read the PhoneCam device back like a video-call app would.
//
// Needs: v4l2loopback loaded as /dev/video42 (see .github/workflows/ci.yml),
// the helper built into $PHONECAM_HOME/bin, and ffmpeg.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "phonecam-e2e-"));
const port = 18555;
const device = "/dev/video42";

const source = path.join(work, "phone.h264");
run("ffmpeg", [
  "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-t", "4",
  "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
  "-x264-params", "aud=1:keyint=30", "-pix_fmt", "yuv420p", "-f", "h264", source
]);
const units = splitAccessUnits(fs.readFileSync(source));

const server = spawn(process.execPath, [path.join(repo, "bin", "phonecam.js"), "start", "--port", String(port), "--no-qr"], {
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"]
});

try {
  await waitForHealth();
  const secret = JSON.parse(fs.readFileSync(path.join(process.env.PHONECAM_HOME, "config.json"), "utf8")).secret;
  const phone = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false });
  await new Promise((resolve, reject) => {
    phone.once("open", resolve);
    phone.once("error", reject);
  });
  phone.send(JSON.stringify({ type: "hello", key: secret }));
  await new Promise((resolve) => phone.once("message", resolve));

  let index = 0;
  const sender = setInterval(() => {
    const unit = units[index % units.length];
    const header = Buffer.alloc(9);
    header.writeUInt8(isKeyFrame(unit) ? 1 : 0, 0);
    header.writeUInt16BE(1920, 1);
    header.writeUInt16BE(1080, 3);
    phone.send(Buffer.concat([header, unit]));
    index += 1;
  }, 1000 / 30);

  await sleep(1500);
  const frames = path.join(work, "camera.yuv");
  run("ffmpeg", ["-loglevel", "error", "-y", "-f", "v4l2", "-i", device, "-frames:v", "30", "-f", "rawvideo", "-pix_fmt", "yuv420p", frames]);
  clearInterval(sender);
  phone.close();

  const probe = spawnSync("v4l2-ctl", ["-d", device, "--get-fmt-video"], { encoding: "utf8" });
  console.log(probe.stdout);
  assert.match(probe.stdout, /1920\/1080/);

  const frameSize = 1920 * 1080 * 1.5;
  const data = fs.readFileSync(frames);
  assert.equal(data.length, 30 * frameSize);
  // testsrc2 is colourful; the idle placeholder is flat grey. Expect real video.
  const luma = data.subarray(29 * frameSize, 29 * frameSize + 1920 * 1080);
  const distinct = new Set();
  for (let i = 0; i < luma.length; i += 997) {
    distinct.add(luma[i]);
  }
  assert.ok(distinct.size > 20, `expected live video, saw ${distinct.size} luma levels`);
  console.log("OK: PhoneCam device delivered 30 live 1920x1080 frames.");
} finally {
  server.kill("SIGTERM");
  fs.rmSync(work, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  assert.equal(result.status, 0, `${command} failed`);
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const ok = await new Promise((resolve) => {
      https.get({ host: "127.0.0.1", port, path: "/healthz", rejectUnauthorized: false }, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      }).on("error", () => resolve(false));
    });
    if (ok) {
      return;
    }
    await sleep(200);
  }
  throw new Error("phonecam start did not come up");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitAccessUnits(stream) {
  const starts = [];
  for (let i = 0; i + 4 < stream.length; i += 1) {
    if (stream[i] === 0 && stream[i + 1] === 0 && stream[i + 2] === 0 && stream[i + 3] === 1 && (stream[i + 4] & 0x1f) === 9) {
      starts.push(i);
    }
  }
  starts.push(stream.length);
  return starts.slice(0, -1).map((start, index) => stream.subarray(start, starts[index + 1]));
}

function isKeyFrame(unit) {
  for (let i = 0; i + 3 < unit.length; i += 1) {
    if (unit[i] === 0 && unit[i + 1] === 0 && unit[i + 2] === 1 && (unit[i + 3] & 0x1f) === 5) {
      return true;
    }
  }
  return false;
}
