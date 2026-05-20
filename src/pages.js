import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export function asset(name) {
  if (name !== "logo.svg") {
    return "";
  }
  return fs.readFileSync(path.join(projectRoot, "assets", "logo.svg"), "utf8");
}

export function stylesheet() {
  return `
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #000;
  color: #ededed;
  text-rendering: geometricPrecision;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: #000;
}

body {
  min-height: 100vh;
}

button,
input,
textarea,
select {
  font: inherit;
}

.app {
  width: min(1180px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 28px 0 40px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
  margin-bottom: 22px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #fafafa;
  font-weight: 650;
  letter-spacing: 0;
}

.brand img {
  width: 28px;
  height: 28px;
  border-radius: 7px;
}

.statusRow,
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid #2a2a2a;
  border-radius: 999px;
  background: #0a0a0a;
  color: #a1a1aa;
  font-size: 13px;
  white-space: nowrap;
}

.chip::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 99px;
  background: #737373;
}

.chip.good::before {
  background: #00d084;
}

.chip.warn::before {
  background: #f5a524;
}

.chip.bad::before {
  background: #ff4d4f;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
  align-items: start;
}

.panel {
  border: 1px solid #262626;
  border-radius: 8px;
  background: #0a0a0a;
  overflow: hidden;
}

.panelHeader,
.panelBody {
  padding: 18px;
}

.panelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #1f1f1f;
}

.panelHeader h1,
.panelBody h1 {
  margin: 0;
  color: #fafafa;
  font-size: 18px;
  line-height: 1.2;
  letter-spacing: 0;
}

.panelBody h1 {
  margin-bottom: 10px;
  font-size: 24px;
}

.panelBody p,
.step,
.meta {
  margin: 0;
  color: #a1a1aa;
  font-size: 14px;
  line-height: 1.55;
}

.videoFrame {
  position: relative;
  aspect-ratio: 16 / 9;
  background: #000;
}

.phoneFrame {
  aspect-ratio: 9 / 16;
  max-height: min(72vh, 760px);
  margin: 0 auto;
  background: #000;
}

video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  background: #000;
  transform: scaleX(var(--mirror-x, 1)) rotate(var(--rotate-deg, 0deg));
}

.emptyState {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  color: #737373;
  text-align: center;
  pointer-events: none;
}

.statusBlock {
  display: grid;
  gap: 8px;
  padding: 14px 18px;
  border-top: 1px solid #1f1f1f;
  color: #d4d4d4;
  font-size: 13px;
}

.stack {
  display: grid;
  gap: 16px;
}

.steps {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.step {
  padding: 11px 12px;
  border: 1px solid #262626;
  border-radius: 8px;
  background: #111;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 13px;
  border: 1px solid #fafafa;
  border-radius: 6px;
  background: #fafafa;
  color: #000;
  font-weight: 600;
  cursor: pointer;
}

.button.secondary {
  border-color: #2f2f2f;
  background: #111;
  color: #ededed;
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.hero {
  display: grid;
  gap: 16px;
  padding: 34px;
}

.hero h1 {
  max-width: 760px;
  margin: 0;
  font-size: clamp(36px, 6vw, 72px);
  line-height: 0.95;
  letter-spacing: 0;
}

.hero p {
  max-width: 650px;
  margin: 0;
  color: #a1a1aa;
  font-size: 17px;
  line-height: 1.55;
}

.obsBody {
  margin: 0;
  overflow: hidden;
  background: #000;
}

.obsStage {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: #000;
}

.obsStage video {
  width: 100vw;
  height: 100vh;
  object-fit: contain;
}

.obsStatus {
  position: fixed;
  left: 16px;
  bottom: 16px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.7);
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
}

code {
  color: #ededed;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

@media (max-width: 880px) {
  .app {
    width: min(100vw - 20px, 1180px);
    padding-top: 16px;
  }

  .grid {
    grid-template-columns: 1fr;
  }

  .topbar,
  .panelHeader {
    align-items: flex-start;
    flex-direction: column;
  }

  .hero {
    padding: 24px;
  }
}
`;
}

export function rootPage() {
  return html("phonecam-bridge", `
    <main class="app">
      ${topbar()}
      <section class="panel hero">
        <h1>Phone camera, bridged over Wi-Fi.</h1>
        <p>Start the CLI, scan the QR code with Android or iPhone, and use the HTTPS preview or OBS Browser Source URL from the terminal.</p>
      </section>
    </main>
  `);
}

export function notFoundPage(message) {
  return html("phonecam-bridge error", `
    <main class="app">
      ${topbar("Invalid link")}
      <section class="panel">
        <div class="panelBody">
          <h1>Cannot open phonecam-bridge</h1>
          <p>${escapeHtml(message)}</p>
        </div>
      </section>
    </main>
  `);
}

export function phonePage(token) {
  return html("phonecam phone", `
    <main class="app">
      ${topbar("Phone camera")}
      <section class="grid">
        <div class="panel">
          <div class="panelHeader">
            <h1>Camera</h1>
            <div class="statusRow">
              <span id="signalChip" class="chip warn">connecting</span>
              <span id="viewerChip" class="chip">0 viewers</span>
            </div>
          </div>
          <div class="videoFrame phoneFrame">
            <video id="localVideo" autoplay muted playsinline></video>
            <div id="emptyState" class="emptyState">Camera is off</div>
          </div>
          <div class="statusBlock">
            <div id="status">Waiting to start camera.</div>
            <div id="peerStatus">Keep this page open while streaming.</div>
          </div>
        </div>
        <aside class="stack">
          <section class="panel">
            <div class="panelBody">
              <h1>Controls</h1>
              <p>Use the camera you want Teams or Zoom to see through OBS.</p>
              <div class="actions" style="margin-top: 16px;">
                <button id="start" class="button" type="button">Start camera</button>
                <button id="mirrorCamera" class="button secondary" type="button" aria-pressed="false">Mirror off</button>
                <button id="rotateCamera" class="button secondary" type="button">Rotate 0°</button>
                <button id="switchCamera" class="button secondary" type="button">Switch</button>
                <button id="stop" class="button secondary" type="button" disabled>Stop</button>
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panelBody">
              <h1>Notes</h1>
              <div class="steps">
                <div class="step">Allow camera access when the browser asks.</div>
                <div class="step">Keep the screen awake; mobile browsers may pause camera capture when locked.</div>
                <div class="step">If Wi-Fi blocks device-to-device traffic, use a trusted hotspot or another network.</div>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </main>
    <script>${phoneScript(token)}</script>
  `);
}

export function previewPage(token) {
  return html("phonecam preview", `
    <main class="app">
      ${topbar("Laptop preview")}
      <section class="grid">
        <div class="panel">
          <div class="panelHeader">
            <h1>Preview</h1>
            <div class="statusRow">
              <span id="signalChip" class="chip warn">connecting</span>
              <span id="phoneChip" class="chip">phone offline</span>
            </div>
          </div>
          <div class="videoFrame">
            <video id="remoteVideo" autoplay playsinline controls></video>
            <div id="emptyState" class="emptyState">Waiting for the phone camera</div>
          </div>
          <div class="statusBlock">
            <div id="status">Waiting for phone...</div>
            <div id="peerStatus">Open the phone QR link and start camera.</div>
          </div>
        </div>
        <aside class="stack">
          <section class="panel">
            <div class="panelBody">
              <h1>OBS bridge</h1>
              <p>Use the OBS URL from the terminal as a Browser Source, then start OBS Virtual Camera and select it in Teams or Zoom.</p>
              <div class="steps">
                <div class="step">Add Source: <code>Browser</code>.</div>
                <div class="step">Paste the HTTPS OBS URL.</div>
                <div class="step">Set size to <code>1920 x 1080</code>.</div>
                <div class="step">Start <code>OBS Virtual Camera</code>.</div>
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panelBody">
              <h1>Meeting apps</h1>
              <p>Teams and Zoom cannot select this page directly as a camera. They can select OBS Virtual Camera after OBS is installed.</p>
            </div>
          </section>
        </aside>
      </section>
    </main>
    <script>${viewerScript(token, "preview")}</script>
  `);
}

export function obsPage(token) {
  return html("phonecam OBS", `
    <main class="obsStage">
      <video id="remoteVideo" autoplay muted playsinline></video>
      <div id="emptyState" class="emptyState">Waiting for phone camera</div>
      <div id="status" class="obsStatus">connecting</div>
    </main>
    <script>${viewerScript(token, "obs")}</script>
  `, { bodyClass: "obsBody" });
}

function topbar(label = "phonecam-bridge") {
  return `
    <header class="topbar">
      <div class="brand">
        <img src="/assets/logo.svg" alt="">
        <span>${escapeHtml(label)}</span>
      </div>
    </header>
  `;
}

function phoneScript(token) {
  return `
const TOKEN = ${JSON.stringify(token)};
const statusEl = document.querySelector("#status");
const peerStatusEl = document.querySelector("#peerStatus");
const signalChip = document.querySelector("#signalChip");
const viewerChip = document.querySelector("#viewerChip");
const localVideo = document.querySelector("#localVideo");
const emptyState = document.querySelector("#emptyState");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const switchButton = document.querySelector("#switchCamera");
const mirrorButton = document.querySelector("#mirrorCamera");
const rotateButton = document.querySelector("#rotateCamera");

let ws;
let stream;
let facingMode = "user";
let mirrored = false;
let rotation = 0;
let started = false;
const viewers = new Map();
const peerConnections = new Map();

startButton.addEventListener("click", () => start());
stopButton.addEventListener("click", () => stop());
switchButton.addEventListener("click", async () => {
  facingMode = facingMode === "user" ? "environment" : "user";
  if (started) {
    await stop();
    await start();
  }
});
mirrorButton.addEventListener("click", () => {
  mirrored = !mirrored;
  applyTransformState();
  broadcastTransformState();
});
rotateButton.addEventListener("click", () => {
  rotation = (rotation + 90) % 360;
  applyTransformState();
  broadcastTransformState();
});

connectSignal();

function connectSignal() {
  const socketProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(socketProtocol + "//" + location.host + "/signal?role=phone&token=" + encodeURIComponent(TOKEN));

  ws.addEventListener("open", () => {
    setChip(signalChip, "good", "connected");
    setStatus("Connected. Start camera when ready.");
  });

  ws.addEventListener("close", () => {
    setChip(signalChip, "bad", "disconnected");
    setStatus("Disconnected. Reconnecting...");
    setTimeout(connectSignal, 1200);
  });

  ws.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "viewer-ready") {
      viewers.set(message.viewerId, message.kind || "preview");
      updateViewerStatus();
      sendTransformState(message.viewerId);
      if (stream) await createOfferForViewer(message.viewerId);
    } else if (message.type === "viewer-left") {
      viewers.delete(message.viewerId);
      closePeer(message.viewerId);
      updateViewerStatus();
    } else if (message.type === "answer" && message.from) {
      const pc = peerConnections.get(message.from);
      if (pc) await pc.setRemoteDescription(message);
    } else if (message.type === "candidate" && message.from && message.candidate) {
      const pc = peerConnections.get(message.from);
      if (pc) await pc.addIceCandidate(message.candidate).catch(() => {});
    } else if (message.type === "peer-state") {
      updateViewerStatus(message.viewerCount);
    }
  });
}

async function start() {
  try {
    started = true;
    startButton.disabled = true;
    stopButton.disabled = false;
    emptyState.style.display = "none";
    setStatus("Requesting camera permission...");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
    localVideo.srcObject = stream;
    applyTransformState();
    setStatus("Camera is live.");
    for (const viewerId of viewers.keys()) {
      await createOfferForViewer(viewerId);
    }
  } catch (error) {
    setStatus("Camera start failed: " + error.message);
    await stop();
  }
}

async function stop() {
  started = false;
  startButton.disabled = false;
  stopButton.disabled = true;
  for (const viewerId of peerConnections.keys()) closePeer(viewerId);
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = undefined;
  }
  localVideo.srcObject = null;
  emptyState.style.display = "grid";
  setStatus("Camera stopped.");
}

async function createOfferForViewer(viewerId) {
  if (!stream) return;
  closePeer(viewerId);
  const pc = new RTCPeerConnection({ iceServers: [] });
  peerConnections.set(viewerId, pc);
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  pc.addEventListener("icecandidate", (event) => {
    if (event.candidate) sendSignal({ type: "candidate", to: viewerId, candidate: event.candidate });
  });
  pc.addEventListener("connectionstatechange", () => {
    setStatus("Camera live. Last WebRTC state: " + pc.connectionState + ".");
  });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal({ type: "offer", to: viewerId, sdp: pc.localDescription.sdp });
  sendTransformState(viewerId);
}

function closePeer(viewerId) {
  const pc = peerConnections.get(viewerId);
  if (pc) pc.close();
  peerConnections.delete(viewerId);
}

function sendSignal(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function applyTransformState() {
  localVideo.style.setProperty("--mirror-x", mirrored ? "-1" : "1");
  localVideo.style.setProperty("--rotate-deg", rotation + "deg");
  mirrorButton.textContent = mirrored ? "Mirror on" : "Mirror off";
  mirrorButton.setAttribute("aria-pressed", String(mirrored));
  rotateButton.textContent = "Rotate " + rotation + "°";
}

function sendTransformState(viewerId) {
  sendSignal({ type: "transform", to: viewerId, mirrored, rotation });
}

function broadcastTransformState() {
  for (const viewerId of viewers.keys()) {
    sendTransformState(viewerId);
  }
}

function setStatus(message) {
  statusEl.textContent = message;
}

function updateViewerStatus(count = viewers.size) {
  const label = count === 1 ? "1 viewer" : count + " viewers";
  viewerChip.textContent = label;
  viewerChip.className = "chip " + (count > 0 ? "good" : "");
  peerStatusEl.textContent = count > 0 ? "Streaming target connected." : "Open preview or OBS URL on the laptop.";
}

function setChip(element, state, text) {
  element.className = "chip " + state;
  element.textContent = text;
}
`;
}

function viewerScript(token, kind) {
  return `
const TOKEN = ${JSON.stringify(token)};
const KIND = ${JSON.stringify(kind)};
const statusEl = document.querySelector("#status");
const peerStatusEl = document.querySelector("#peerStatus");
const signalChip = document.querySelector("#signalChip");
const phoneChip = document.querySelector("#phoneChip");
const remoteVideo = document.querySelector("#remoteVideo");
const emptyState = document.querySelector("#emptyState");

let ws;
let pc;
let viewerId;

connectSignal();

function connectSignal() {
  const socketProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(socketProtocol + "//" + location.host + "/signal?role=viewer&kind=" + encodeURIComponent(KIND) + "&token=" + encodeURIComponent(TOKEN));

  ws.addEventListener("open", () => {
    setStatus("Connected. Waiting for phone camera.");
    setChip(signalChip, "good", "connected");
  });

  ws.addEventListener("close", () => {
    setStatus("Disconnected. Reconnecting...");
    if (signalChip) setChip(signalChip, "bad", "disconnected");
    setTimeout(connectSignal, 1200);
  });

  ws.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "status" && message.viewerId) {
      viewerId = message.viewerId;
    } else if (message.type === "offer") {
      await answerOffer(message);
    } else if (message.type === "candidate" && message.candidate) {
      if (pc) await pc.addIceCandidate(message.candidate).catch(() => {});
    } else if (message.type === "mirror") {
      applyTransformState(Boolean(message.mirrored), 0);
    } else if (message.type === "transform") {
      applyTransformState(Boolean(message.mirrored), normalizeRotation(message.rotation));
    } else if (message.type === "peer-state") {
      const online = Boolean(message.phoneConnected);
      if (phoneChip) setChip(phoneChip, online ? "good" : "", online ? "phone online" : "phone offline");
      if (peerStatusEl) peerStatusEl.textContent = online ? "Phone connected. Start the phone camera." : "Open the phone QR link and start camera.";
    }
  });
}

async function answerOffer(offer) {
  if (pc) pc.close();
  pc = new RTCPeerConnection({ iceServers: [] });
  pc.addEventListener("track", (event) => {
    remoteVideo.srcObject = event.streams[0];
    if (emptyState) emptyState.style.display = "none";
    setStatus(KIND === "obs" ? "receiving phone camera" : "Receiving phone camera.");
  });
  pc.addEventListener("icecandidate", (event) => {
    if (event.candidate) sendSignal({ type: "candidate", candidate: event.candidate });
  });
  pc.addEventListener("connectionstatechange", () => {
    setStatus((KIND === "obs" ? "webrtc: " : "WebRTC state: ") + pc.connectionState);
    if (pc.connectionState === "failed" && emptyState) emptyState.style.display = "grid";
  });
  await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal({ type: "answer", sdp: pc.localDescription.sdp });
}

function sendSignal(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function applyTransformState(mirrored, rotation) {
  remoteVideo.style.setProperty("--mirror-x", mirrored ? "-1" : "1");
  remoteVideo.style.setProperty("--rotate-deg", rotation + "deg");
}

function normalizeRotation(value) {
  const parsed = Number.parseInt(value, 10);
  if (![0, 90, 180, 270].includes(parsed)) return 0;
  return parsed;
}

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function setChip(element, state, text) {
  if (!element) return;
  element.className = "chip " + state;
  element.textContent = text;
}
`;
}

function html(title, body, options = {}) {
  const bodyClass = options.bodyClass ? ` class="${escapeHtml(options.bodyClass)}"` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="/assets/logo.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/style.css">
  </head>
  <body${bodyClass}>${body}</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
