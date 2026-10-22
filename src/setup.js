import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINUX_DEVICE, LINUX_HELPER } from "./sinks.js";
import { stateDir } from "./state.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "phonecam.js");
const VIDEO_NR = Number(LINUX_DEVICE.replace(/\D+/g, ""));

const MODPROBE_CONF = "/etc/modprobe.d/phonecam.conf";
const MODULES_LOAD_CONF = "/etc/modules-load.d/phonecam.conf";
const UDEV_RULE = "/etc/udev/rules.d/70-phonecam.rules";
const unitPath = () => path.join(os.homedir(), ".config", "systemd", "user", "phonecam.service");

const PACKAGES = {
  "apt-get": () => [
    "v4l2loopback-dkms",
    `linux-headers-${os.release()}`,
    "libavcodec-dev",
    "libswscale-dev",
    "libavutil-dev",
    "pkg-config",
    "build-essential"
  ],
  dnf: () => ["akmod-v4l2loopback", "ffmpeg-free-devel", "pkgconf-pkg-config", "gcc"],
  pacman: () => ["v4l2loopback-dkms", "linux-headers", "ffmpeg", "pkgconf", "base-devel"],
  zypper: () => ["v4l2loopback-kmp-default", "ffmpeg-7-libavcodec-devel", "ffmpeg-7-libswscale-devel", "pkg-config", "gcc"]
};

const INSTALL_ARGS = {
  "apt-get": ["install", "-y"],
  dnf: ["install", "-y"],
  pacman: ["-S", "--needed", "--noconfirm"],
  zypper: ["install", "-y"]
};

export function unsupportedPlatformMessage() {
  const name = { darwin: "macOS", win32: "Windows" }[process.platform] || process.platform;
  return `The PhoneCam camera driver for ${name} isn't available yet (Linux is supported today).\n` +
    "You can still test the phone connection: “phonecam start --record test.h264”.";
}

// One-time, admin-approved install: the v4l2loopback kernel module (the
// virtual "PhoneCam" device), the decoder helper, and a user service so the
// camera is there after every login.
export function setup() {
  if (process.platform !== "linux") {
    console.error(unsupportedPlatformMessage());
    return false;
  }

  const manager = Object.keys(PACKAGES).find((name) => commandExists(name));
  step("Installing the virtual camera module and video decoder (needs your password once)");
  if (manager) {
    if (manager === "apt-get") {
      sudo(["apt-get", "update"]);
      // Ubuntu keeps the V4L2 core (videodev) here on some kernels; Debian has no such package.
      sudo(["apt-get", "install", "-y", `linux-modules-extra-${os.release()}`], { optional: true });
    }
    sudo([manager, ...INSTALL_ARGS[manager], ...PACKAGES[manager]()]);
  } else {
    console.log("  No supported package manager found. Install v4l2loopback and the libavcodec/libswscale development files, then re-run setup.");
  }

  step("Creating the PhoneCam camera device");
  writeRoot(MODPROBE_CONF, `options v4l2loopback devices=1 video_nr=${VIDEO_NR} card_label="PhoneCam" exclusive_caps=1 max_buffers=2\n`);
  writeRoot(MODULES_LOAD_CONF, "v4l2loopback\n");
  writeRoot(UDEV_RULE, `KERNEL=="video${VIDEO_NR}", SUBSYSTEM=="video4linux", TAG+="uaccess", GROUP="video", MODE="0660"\n`);
  sudo(["udevadm", "control", "--reload-rules"], { optional: true });
  warnAboutOtherLoopbackConfig();
  sudo(["modprobe", "-r", "v4l2loopback"], { optional: true });
  sudo(["modprobe", "v4l2loopback"]);
  if (!fs.existsSync(LINUX_DEVICE)) {
    throw new Error(`${LINUX_DEVICE} did not appear. If Secure Boot is on, the v4l2loopback module may need to be signed (see README).`);
  }

  step("Building the camera helper");
  buildHelper();

  step("Starting PhoneCam in the background at login");
  installService();
  return true;
}

export function uninstall() {
  if (process.platform === "linux") {
    if (fs.existsSync(unitPath())) {
      run("systemctl", ["--user", "disable", "--now", "phonecam.service"], { optional: true });
      fs.rmSync(unitPath(), { force: true });
      run("systemctl", ["--user", "daemon-reload"], { optional: true });
    }
    const rootFiles = [MODPROBE_CONF, MODULES_LOAD_CONF, UDEV_RULE].filter((file) => fs.existsSync(file));
    if (rootFiles.length > 0) {
      sudo(["rm", "-f", ...rootFiles]);
      sudo(["modprobe", "-r", "v4l2loopback"], { optional: true });
    }
  }
  fs.rmSync(stateDir(), { recursive: true, force: true });
  console.log("PhoneCam removed. (System packages such as v4l2loopback were left installed.)");
}

export function buildHelper() {
  const source = path.join(repoRoot, "native", "linux", "phonecam-v4l2.c");
  const output = LINUX_HELPER();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const flags = spawnSync("pkg-config", ["--cflags", "--libs", "libavcodec", "libswscale", "libavutil"], { encoding: "utf8" });
  if (flags.status !== 0) {
    throw new Error("pkg-config can't find libavcodec/libswscale. Install their development packages and re-run setup.");
  }
  run("cc", ["-O2", "-o", output, source, ...flags.stdout.trim().split(/\s+/)]);
}

function installService() {
  const unit = `[Unit]
Description=PhoneCam wireless webcam
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="${process.execPath}" "${cliPath}" start --no-qr
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;
  fs.mkdirSync(path.dirname(unitPath()), { recursive: true });
  fs.writeFileSync(unitPath(), unit);
  run("systemctl", ["--user", "daemon-reload"]);
  run("systemctl", ["--user", "enable", "phonecam.service"]);
  run("systemctl", ["--user", "restart", "phonecam.service"]);
}

function warnAboutOtherLoopbackConfig() {
  let others = [];
  try {
    others = fs.readdirSync("/etc/modprobe.d")
      .map((name) => path.join("/etc/modprobe.d", name))
      .filter((file) => file !== MODPROBE_CONF && /v4l2loopback/.test(fs.readFileSync(file, "utf8")));
  } catch {
    return;
  }
  if (others.length > 0) {
    console.log(`  Note: ${others.join(", ")} also configures v4l2loopback; PhoneCam's options may be overridden.`);
  }
}

function writeRoot(file, contents) {
  const result = spawnSync("sudo", ["tee", file], { input: contents, stdio: ["pipe", "ignore", "inherit"] });
  if (result.status !== 0) {
    throw new Error(`Could not write ${file}.`);
  }
}

function sudo(args, options) {
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  return root ? run(args[0], args.slice(1), options) : run("sudo", args, options);
}

function run(command, args, { optional = false } = {}) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0 && !optional) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
  return result.status === 0;
}

function commandExists(command) {
  return spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

function step(message) {
  console.log(`\n→ ${message}`);
}
