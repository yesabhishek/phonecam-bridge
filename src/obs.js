import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export async function checkObs(options = {}) {
  const platform = process.platform;
  const candidates = await detectObs(platform, options);
  const installed = candidates.some((candidate) => candidate.found);
  const installer = await selectInstaller(platform, options);

  return {
    installed,
    platform,
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    candidates,
    installer
  };
}

export async function printObsCheck() {
  const result = await checkObs();
  printReport(result);
  return result.installed;
}

export async function installObs() {
  const result = await checkObs();
  printReport(result);

  if (result.installed) {
    console.log("\nOBS Studio is already installed.");
    return true;
  }

  if (!result.installer) {
    printNoInstaller(result.platform);
    return false;
  }

  console.log(`\nInstalling OBS Studio with: ${result.installer.label}`);
  console.log(result.installer.commandLine);
  const code = await runInteractive(result.installer.command, result.installer.args, result.installer.options);

  if (code === 0) {
    console.log("\nOBS Studio install command completed.");
    const afterInstall = await checkObs();
    if (afterInstall.installed) {
      console.log("OBS Studio detected.");
      return true;
    }
    console.log("Install command completed, but OBS Studio was not detected yet. Restart the terminal or check the installer output.");
    return false;
  }

  console.log(`\nOBS Studio install command exited with code ${code}.`);
  return false;
}

export async function ensureObs() {
  const result = await checkObs();
  if (result.installed) {
    printReport(result);
    console.log("\nOBS Studio is ready.");
    return true;
  }

  return installObs();
}

async function detectObs(platform, options) {
  if (platform === "win32") {
    return detectWindowsObs(options);
  }

  if (platform === "darwin") {
    return detectMacObs(options);
  }

  if (platform === "linux") {
    return detectLinuxObs(options);
  }

  return [{ label: `Unsupported platform: ${platform}`, found: false }];
}

async function detectWindowsObs(options) {
  const paths = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "obs-studio", "bin", "64bit", "obs64.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "obs-studio", "bin", "64bit", "obs64.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "obs-studio", "bin", "64bit", "obs64.exe")
  ].filter(Boolean);

  const candidates = paths.map((value) => ({
    label: value,
    found: fs.existsSync(value),
    value
  }));

  candidates.push(await commandCandidate("where obs64.exe", "where", ["obs64.exe"], options));
  candidates.push(await wingetListCandidate(options));
  return candidates;
}

async function detectMacObs(options) {
  const appPath = "/Applications/OBS.app";
  return [
    {
      label: appPath,
      found: fs.existsSync(appPath),
      value: appPath
    },
    await commandCandidate("brew list --cask obs", "brew", ["list", "--cask", "obs"], options),
    await commandCandidate("mdfind OBS bundle id", "mdfind", ["kMDItemCFBundleIdentifier == 'com.obsproject.obs-studio'"], options)
  ];
}

async function detectLinuxObs(options) {
  return [
    await commandCandidate("command obs", "sh", ["-lc", "command -v obs"], options),
    await commandCandidate("flatpak com.obsproject.Studio", "flatpak", ["info", "com.obsproject.Studio"], options),
    await commandCandidate("snap obs-studio", "snap", ["list", "obs-studio"], options),
    await commandCandidate("dpkg obs-studio", "dpkg", ["-s", "obs-studio"], options)
  ];
}

async function selectInstaller(platform, options = {}) {
  if (platform === "win32") {
    if (await hasCommand("winget", options)) {
      return {
        label: "Windows Package Manager",
        command: "winget",
        args: [
          "install",
          "--id",
          "OBSProject.OBSStudio",
          "--exact",
          "--source",
          "winget",
          "--accept-package-agreements",
          "--accept-source-agreements"
        ],
        commandLine: "winget install --id OBSProject.OBSStudio --exact --source winget --accept-package-agreements --accept-source-agreements"
      };
    }

    if (await hasCommand("choco", options)) {
      return {
        label: "Chocolatey",
        command: "choco",
        args: ["install", "obs-studio", "-y"],
        commandLine: "choco install obs-studio -y"
      };
    }
  }

  if (platform === "darwin") {
    if (await hasCommand("brew", options)) {
      return {
        label: "Homebrew",
        command: "brew",
        args: ["install", "--cask", "obs"],
        commandLine: "brew install --cask obs"
      };
    }
  }

  if (platform === "linux") {
    if (await hasCommand("flatpak", options)) {
      return {
        label: "Flatpak",
        command: "flatpak",
        args: ["install", "-y", "flathub", "com.obsproject.Studio"],
        commandLine: "flatpak install -y flathub com.obsproject.Studio"
      };
    }

    if (await hasCommand("snap", options)) {
      return {
        label: "Snap",
        command: "snap",
        args: ["install", "obs-studio"],
        commandLine: "snap install obs-studio"
      };
    }

    if (await hasCommand("apt-get", options)) {
      const prefix = typeof process.getuid === "function" && process.getuid() === 0 ? [] : ["sudo"];
      const aptGet = [...prefix, "apt-get"].join(" ");
      const commandLine = `${aptGet} update && ${aptGet} install -y obs-studio`;
      return {
        label: "APT",
        command: "sh",
        args: ["-lc", commandLine],
        commandLine
      };
    }
  }

  return undefined;
}

async function wingetListCandidate(options) {
  if (!(await hasCommand("winget", options))) {
    return { label: "winget OBSProject.OBSStudio", found: false };
  }

  const result = await runCapture("winget", ["list", "--id", "OBSProject.OBSStudio", "--exact"], options);
  return {
    label: "winget OBSProject.OBSStudio",
    found: result.code === 0 && result.stdout.includes("OBSProject.OBSStudio"),
    value: result.stdout.trim()
  };
}

async function commandCandidate(label, command, args, options) {
  const result = await runCapture(command, args, options);
  return {
    label,
    found: result.code === 0 && Boolean(result.stdout.trim() || result.stderr.trim()),
    value: result.stdout.trim() || result.stderr.trim()
  };
}

async function hasCommand(command, options) {
  const probe = process.platform === "win32"
    ? await runCapture("where", [command], options)
    : await runCapture("sh", ["-lc", `command -v ${quoteShell(command)}`], options);

  return probe.code === 0 && Boolean(probe.stdout.trim());
}

function runCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? 2500;
    let settled = false;
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ code: 124, stdout, stderr: stderr || `Timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      finish({ code: code ?? 1, stdout, stderr });
    });
  });
}

function runInteractive(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit"
    });
    child.on("error", (error) => {
      console.error(error.message);
      resolve(127);
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

function printReport(result) {
  console.log(`OS: ${result.os} (${result.arch})`);
  console.log(`OBS Studio: ${result.installed ? "installed" : "not detected"}`);

  for (const candidate of result.candidates) {
    console.log(`  ${candidate.found ? "yes" : "no "} ${candidate.label}`);
  }

  if (!result.installed && result.installer) {
    console.log(`Installer: ${result.installer.label}`);
  }
}

function printNoInstaller(platform) {
  console.log("\nNo supported OBS installer was found for this machine.");
  if (platform === "win32") {
    console.log("Install winget or Chocolatey, or download OBS Studio from https://obsproject.com/download");
  } else if (platform === "darwin") {
    console.log("Install Homebrew, or download OBS Studio from https://obsproject.com/download");
  } else if (platform === "linux") {
    console.log("Install Flatpak, Snap, or APT support, or use your distribution's OBS Studio package.");
  } else {
    console.log("Download OBS Studio from https://obsproject.com/download");
  }
}

function quoteShell(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
