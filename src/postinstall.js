#!/usr/bin/env node

import { checkObs } from "./obs.js";

async function main() {
  if (process.env.PHONECAM_BRIDGE_SKIP_OBS_CHECK === "1") {
    return;
  }

  const result = await checkObs({ timeoutMs: 1200 });
  const platformName = platformLabel(result.platform);

  console.log(`phonecam-bridge: detected ${platformName} (${result.arch})`);

  if (result.installed) {
    console.log("phonecam-bridge: OBS Studio detected. You can use OBS Virtual Camera for Teams/Zoom.");
    return;
  }

  console.log("phonecam-bridge: OBS Studio was not detected.");

  if (result.installer) {
    console.log(`phonecam-bridge: run "npm run obs:ensure" to install with ${result.installer.label}.`);
    console.log("phonecam-bridge: after global install, you can also use \"phonecam obs ensure\".");
  } else {
    console.log("phonecam-bridge: run \"npm run obs:check\" for install guidance.");
  }
}

function platformLabel(platform) {
  if (platform === "win32") {
    return "Windows";
  }
  if (platform === "darwin") {
    return "macOS";
  }
  if (platform === "linux") {
    return "Linux";
  }
  return platform;
}

main().catch((error) => {
  console.log(`phonecam-bridge: OBS install-time check skipped: ${error.message}`);
});
