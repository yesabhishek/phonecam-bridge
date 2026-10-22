import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { allLocalAddresses } from "./network.js";
import { stateDir, statePath } from "./state.js";
import { createCertificate, generateKeyPair } from "./x509.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Phones only allow camera access on HTTPS pages. A persistent local CA lets
// the phone trust it once (optional); the server certificate is re-issued
// from that CA whenever the laptop's addresses change, so trust survives
// DHCP changes.
export function ensureCertificates(hostAddress) {
  fs.mkdirSync(stateDir(), { recursive: true });
  const ca = ensureCa();
  const names = certificateNames(hostAddress);
  const leafKeyPath = statePath("server-key.pem");
  const leafCertPath = statePath("server-cert.pem");

  try {
    const cert = fs.readFileSync(leafCertPath, "utf8");
    const key = fs.readFileSync(leafKeyPath, "utf8");
    if (leafIsUsable(new crypto.X509Certificate(cert), ca.cert, names)) {
      return { key, cert, caDer: ca.cert.raw };
    }
  } catch {
    // Missing or unreadable: issue a new one below.
  }

  const { privateKey, publicKey } = generateKeyPair();
  const cert = createCertificate({
    subject: { commonName: hostAddress },
    publicKey,
    signingKey: ca.key,
    issuer: { subject: ca.subject, publicKey: ca.cert.publicKey },
    notBefore: new Date(Date.now() - DAY_MS),
    // Apple rejects server certificates valid for more than 825 days.
    notAfter: new Date(Date.now() + 365 * DAY_MS),
    altNames: names
  });
  const key = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.writeFileSync(leafKeyPath, key, { mode: 0o600 });
  fs.writeFileSync(leafCertPath, cert);

  return { key, cert, caDer: ca.cert.raw };
}

function ensureCa() {
  const keyPath = statePath("ca-key.pem");
  const certPath = statePath("ca-cert.pem");
  const subject = { commonName: `PhoneCam Local CA (${os.hostname()})`, organization: "PhoneCam" };

  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(certPath, "utf8"));
    const key = crypto.createPrivateKey(fs.readFileSync(keyPath, "utf8"));
    if (new Date(cert.validTo).getTime() - Date.now() > 30 * DAY_MS && cert.checkPrivateKey(key)) {
      return { key, cert, subject: parseSubject(cert.subject) };
    }
  } catch {
    // Missing, unreadable, or from an older version: create a new CA below.
  }

  const { privateKey, publicKey } = generateKeyPair();
  const pem = createCertificate({
    subject,
    publicKey,
    signingKey: privateKey,
    notBefore: new Date(Date.now() - DAY_MS),
    notAfter: new Date(Date.now() + 10 * 365 * DAY_MS),
    ca: true
  });
  fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync(certPath, pem);
  // A new CA invalidates any server certificate issued by the old one.
  fs.rmSync(statePath("server-cert.pem"), { force: true });
  return { key: privateKey, cert: new crypto.X509Certificate(pem), subject };
}

function leafIsUsable(cert, caCert, names) {
  if (!cert.verify(caCert.publicKey)) {
    return false;
  }
  if (new Date(cert.validTo).getTime() - Date.now() < 30 * DAY_MS) {
    return false;
  }
  return names.ips.every((ip) => cert.checkIP(ip)) && names.dns.every((host) => cert.checkHost(host));
}

function certificateNames(hostAddress) {
  const host = os.hostname().replace(/\.local$/i, "");
  const dns = [...new Set(["localhost", host, `${host}.local`])].filter((name) => /^[a-z0-9.-]+$/i.test(name));
  const ips = [...new Set([hostAddress, ...allLocalAddresses()])].filter((ip) => ip.includes(".") || ip === "::1");
  return { dns, ips };
}

function parseSubject(text) {
  const fields = Object.fromEntries(text.split("\n").map((line) => line.split("=")));
  return { commonName: fields.CN, organization: fields.O };
}
