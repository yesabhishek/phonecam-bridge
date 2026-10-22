import { spawn } from "node:child_process";
import fs from "node:fs";
import { loadConfig, statePath } from "./state.js";

export const LINUX_DEVICE = "/dev/video42";
export const LINUX_HELPER = () => statePath("bin/phonecam-v4l2");

// A sink takes H.264 access units from the phone and turns them into a
// webcam. Each sink starts writing at a key frame, and asks the phone for a
// new one whenever it had to drop data.
export function createSink({ record } = {}) {
  if (record) {
    return fileSink(record);
  }
  if (process.platform === "linux") {
    return v4l2Sink();
  }
  return undefined;
}

// Writes the raw H.264 stream to a file (play it with any video player).
// Used for testing on platforms without a camera driver yet.
function fileSink(file) {
  const out = fs.createWriteStream(file);
  let started = false;
  let requestKeyFrame = () => {};

  return {
    describe: () => `recording to ${file}`,
    onKeyFrameNeeded(callback) {
      requestKeyFrame = callback;
    },
    write(frame) {
      if (!started && !frame.keyFrame) {
        requestKeyFrame();
        return;
      }
      started = true;
      out.write(frame.data);
    },
    idle() {
      started = false;
    },
    close() {
      out.end();
    }
  };
}

// Pipes frames to the native helper, which decodes them and writes 1080p
// frames into the v4l2loopback "PhoneCam" device.
function v4l2Sink() {
  const helper = LINUX_HELPER();
  const device = loadConfig().device || LINUX_DEVICE;

  if (!fs.existsSync(helper) || !fs.existsSync(device)) {
    throw new Error("The PhoneCam camera isn't installed yet. Run “phonecam setup” once.");
  }

  let child;
  let waitForKeyFrame = true;
  let backpressured = false;
  let closing = false;
  let requestKeyFrame = () => {};

  const launch = () => {
    child = spawn(helper, ["--device", device, "--width", "1920", "--height", "1080", "--fps", "30"], {
      stdio: ["pipe", "pipe", "inherit"]
    });
    waitForKeyFrame = true;
    backpressured = false;

    child.stdin.on("error", () => {});
    child.stdin.on("drain", () => {
      backpressured = false;
      waitForKeyFrame = true;
      requestKeyFrame();
    });
    // The helper prints "K" when its decoder needs a fresh key frame.
    child.stdout.on("data", (chunk) => {
      if (chunk.includes(75)) {
        waitForKeyFrame = true;
        requestKeyFrame();
      }
    });
    child.on("exit", (code, signal) => {
      if (closing) {
        return;
      }
      console.error(`Camera helper stopped (${signal || code}); restarting.`);
      setTimeout(launch, 500);
    });
  };
  launch();

  return {
    describe: () => `PhoneCam camera (${device})`,
    onKeyFrameNeeded(callback) {
      requestKeyFrame = callback;
    },
    write(frame) {
      if (backpressured || (waitForKeyFrame && !frame.keyFrame)) {
        if (waitForKeyFrame) {
          requestKeyFrame();
        }
        return;
      }
      waitForKeyFrame = false;

      const header = Buffer.allocUnsafe(5);
      header.writeUInt32BE(frame.data.length + 1, 0);
      header.writeUInt8(frame.keyFrame ? 1 : 0, 4);
      child.stdin.write(header);
      if (!child.stdin.write(frame.data)) {
        backpressured = true;
      }
    },
    close() {
      closing = true;
      child.stdin.end();
      child.kill("SIGTERM");
    }
  };
}
