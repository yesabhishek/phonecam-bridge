import crypto from "node:crypto";
import net from "node:net";

// Minimal X.509 v3 certificate builder (ECDSA P-256 / SHA-256) on top of
// Node's crypto, so PhoneCam needs no certificate library. Parsing and
// verification use Node's built-in X509Certificate.

const OID = {
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  subjectKeyIdentifier: "2.5.29.14",
  keyUsage: "2.5.29.15",
  subjectAltName: "2.5.29.17",
  basicConstraints: "2.5.29.19",
  authorityKeyIdentifier: "2.5.29.35",
  extKeyUsage: "2.5.29.37",
  serverAuth: "1.3.6.1.5.5.7.3.1"
};

export function generateKeyPair() {
  return crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
}

/**
 * @param {object} options
 * @param {{commonName: string, organization?: string}} options.subject
 * @param {crypto.KeyObject} options.publicKey   key being certified
 * @param {crypto.KeyObject} options.signingKey  issuer's private key
 * @param {{subject: object, publicKey: crypto.KeyObject}} [options.issuer] omit for self-signed
 * @param {Date} options.notBefore
 * @param {Date} options.notAfter
 * @param {boolean} [options.ca]
 * @param {{dns?: string[], ips?: string[]}} [options.altNames]
 * @returns {string} PEM certificate
 */
export function createCertificate({ subject, publicKey, signingKey, issuer, notBefore, notAfter, ca = false, altNames }) {
  const issuerInfo = issuer || { subject, publicKey };
  const extensions = [];

  if (ca) {
    extensions.push(extension(OID.basicConstraints, true, seq(boolean(true), integer(Buffer.from([0])))));
    // keyCertSign + cRLSign
    extensions.push(extension(OID.keyUsage, true, bitString(Buffer.from([0x06]), 1)));
  } else {
    extensions.push(extension(OID.basicConstraints, true, seq()));
    // digitalSignature
    extensions.push(extension(OID.keyUsage, true, bitString(Buffer.from([0x80]), 7)));
    extensions.push(extension(OID.extKeyUsage, false, seq(oid(OID.serverAuth))));
  }
  extensions.push(extension(OID.subjectKeyIdentifier, false, octetString(keyId(publicKey))));
  if (issuer) {
    extensions.push(extension(OID.authorityKeyIdentifier, false, seq(tlv(0x80, keyId(issuerInfo.publicKey)))));
  }
  if (altNames) {
    const names = [
      ...(altNames.dns || []).map((name) => tlv(0x82, Buffer.from(name, "ascii"))),
      ...(altNames.ips || []).map((ip) => tlv(0x87, ipBytes(ip)))
    ];
    extensions.push(extension(OID.subjectAltName, false, seq(...names)));
  }

  const algorithm = seq(oid(OID.ecdsaWithSha256));
  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))),
    integer(randomSerial()),
    algorithm,
    name(issuerInfo.subject),
    seq(time(notBefore), time(notAfter)),
    name(subject),
    publicKey.export({ type: "spki", format: "der" }),
    tlv(0xa3, seq(...extensions))
  );
  const signature = crypto.sign("sha256", tbs, { key: signingKey, dsaEncoding: "der" });
  const der = seq(tbs, algorithm, bitString(signature, 0));

  const base64 = der.toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

// ---- DER encoding ---------------------------------------------------------

function tlv(tag, ...contents) {
  const body = Buffer.concat(contents);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
}

function length(n) {
  if (n < 0x80) {
    return Buffer.from([n]);
  }
  const bytes = [];
  for (let value = n; value > 0; value = Math.floor(value / 256)) {
    bytes.unshift(value & 0xff);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const seq = (...items) => tlv(0x30, ...items);
const set = (...items) => tlv(0x31, ...items);
const boolean = (value) => tlv(0x01, Buffer.from([value ? 0xff : 0]));
const octetString = (bytes) => tlv(0x04, bytes);
const bitString = (bytes, unusedBits) => tlv(0x03, Buffer.from([unusedBits]), bytes);

function integer(bytes) {
  let value = bytes;
  while (value.length > 1 && value[0] === 0 && (value[1] & 0x80) === 0) {
    value = value.subarray(1);
  }
  if (value[0] & 0x80) {
    value = Buffer.concat([Buffer.from([0]), value]);
  }
  return tlv(0x02, value);
}

function oid(dotted) {
  const parts = dotted.split(".").map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f];
    for (let value = Math.floor(part / 128); value > 0; value = Math.floor(value / 128)) {
      chunk.unshift((value & 0x7f) | 0x80);
    }
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function name({ commonName, organization }) {
  const attributes = [];
  if (organization) {
    attributes.push(set(seq(oid(OID.organization), tlv(0x0c, Buffer.from(organization, "utf8")))));
  }
  attributes.push(set(seq(oid(OID.commonName), tlv(0x0c, Buffer.from(commonName, "utf8")))));
  return seq(...attributes);
}

function time(date) {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  // RFC 5280: UTCTime through 2049, GeneralizedTime after.
  return date.getUTCFullYear() < 2050
    ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`, "ascii"))
    : tlv(0x18, Buffer.from(`${iso}Z`, "ascii"));
}

function extension(id, critical, value) {
  return critical ? seq(oid(id), boolean(true), octetString(value)) : seq(oid(id), octetString(value));
}

function keyId(publicKey) {
  return crypto.createHash("sha1").update(publicKey.export({ type: "spki", format: "der" })).digest();
}

function ipBytes(ip) {
  if (net.isIPv4(ip)) {
    return Buffer.from(ip.split(".").map(Number));
  }
  const [head, tail = ""] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const groups = [...headParts, ...Array(8 - headParts.length - tailParts.length).fill("0"), ...tailParts];
  return Buffer.from(groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  }));
}

function randomSerial() {
  const bytes = crypto.randomBytes(16);
  bytes[0] = (bytes[0] & 0x7f) | 0x01;
  return bytes;
}
