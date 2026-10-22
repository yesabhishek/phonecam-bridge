import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Runs the native decoder helper on a real H.264 stream. Needs the helper
// built (PHONECAM_HELPER=path) and ffmpeg to make the test video.
const helper = process.env.PHONECAM_HELPER;
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const skip = !helper ? "set PHONECAM_HELPER to the built helper" : !hasFfmpeg ? "ffmpeg not installed" : false;

test("decodes H.264 and letterboxes it into 1920x1080 I420 frames", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phonecam-helper-"));
  try {
    const source = path.join(dir, "portrait.h264");
    const encoded = spawnSync("ffmpeg", [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30", "-t", "2",
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
      "-x264-params", "aud=1:keyint=30", "-pix_fmt", "yuv420p", "-f", "h264", source
    ]);
    assert.equal(encoded.status, 0, encoded.stderr?.toString());

    const units = splitAccessUnits(fs.readFileSync(source));
    assert.equal(units.length, 60);
    const framed = Buffer.concat(units.flatMap((unit) => {
      const header = Buffer.alloc(5);
      header.writeUInt32BE(unit.length + 1, 0);
      header.writeUInt8(isKeyFrame(unit) ? 1 : 0, 4);
      return [header, unit];
    }));

    const output = path.join(dir, "out.yuv");
    const run = spawnSync(helper, ["--output", output], { input: framed });
    assert.equal(run.status, 0, run.stderr.toString());

    const frameSize = 1920 * 1080 * 1.5;
    const yuv = fs.readFileSync(output);
    assert.equal(yuv.length, 60 * frameSize);

    // Portrait input is pillarboxed: left edge black, centre has picture.
    const last = yuv.subarray(59 * frameSize, 60 * frameSize);
    const row = 540 * 1920;
    assert.equal(last[row + 10], 16);
    assert.notEqual(last[row + 960], 16);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
