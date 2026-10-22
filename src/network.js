import dgram from "node:dgram";
import os from "node:os";

const VIRTUAL_INTERFACE = /^(utun|tun|tap|docker|br-|veth|vmnet|vboxnet|virbr|bridge|awdl|llw|zt|tailscale|wg)/i;

// Picks the address a phone on the same Wi-Fi can reach. The OS's default
// route is the best signal; the first non-internal address (what most tools
// use) is often a VPN, Docker, or VM interface instead.
export async function pickLanAddress() {
  const candidates = lanCandidates();
  const routed = await defaultRouteAddress();

  if (routed && isPrivateLan(routed) && candidates.some((candidate) => candidate.address === routed)) {
    return routed;
  }

  const physical = candidates.find((candidate) => !VIRTUAL_INTERFACE.test(candidate.name) && isPrivateLan(candidate.address));
  return physical?.address || routed || candidates[0]?.address || "127.0.0.1";
}

export function lanCandidates() {
  const result = [];
  for (const [name, values] of Object.entries(os.networkInterfaces())) {
    for (const info of values || []) {
      if (info.family === "IPv4" && !info.internal) {
        result.push({ name, address: info.address });
      }
    }
  }
  return result;
}

export function allLocalAddresses() {
  const result = new Set(["127.0.0.1", "::1"]);
  for (const values of Object.values(os.networkInterfaces())) {
    for (const info of values || []) {
      if (!info.internal) {
        result.add(info.address);
      }
    }
  }
  return [...result];
}

function isPrivateLan(address) {
  const [a, b] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Connecting a UDP socket sends no packets; it only asks the kernel which
// local address it would route through.
function defaultRouteAddress() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const done = (value) => {
      socket.close();
      resolve(value);
    };
    socket.once("error", () => done(undefined));
    socket.connect(53, "192.0.2.1", () => {
      try {
        done(socket.address().address);
      } catch {
        done(undefined);
      }
    });
  });
}
