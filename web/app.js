"use strict";

// Phone side of PhoneCam: capture the camera at 1080p, encode H.264 with the
// phone's hardware encoder (WebCodecs), and stream it to the computer over a
// WebSocket. When Wi-Fi gets congested we drop frames and lower the bitrate
// instead of letting latency build up.
(() => {
  const TARGET_WIDTH = 1920;
  const TARGET_HEIGHT = 1080;
  const TARGET_FPS = 30;
  const START_BITRATE = 8_000_000;
  const MIN_BITRATE = 2_000_000;
  const MAX_BITRATE = 12_000_000;
  const KEYFRAME_INTERVAL_MS = 2000;
  const MAX_BUFFERED_BYTES = 768 * 1024;
  const CODECS = ["avc1.640028", "avc1.4d0028", "avc1.42e028", "avc1.420028"];
  const START_CODE = new Uint8Array([0, 0, 0, 1]);

  const preview = document.getElementById("preview");
  const statusEl = document.getElementById("status");
  const hintEl = document.getElementById("hint");
  const startButton = document.getElementById("start");
  const flipButton = document.getElementById("flip");
  const dimButton = document.getElementById("dimButton");
  const dimOverlay = document.getElementById("dim");

  const params = new URLSearchParams(location.hash.slice(1));
  const key = params.get("k") || readStored("phonecam.key");
  const testMode = params.get("test") === "1";
  if (params.get("k")) {
    writeStored("phonecam.key", params.get("k"));
  }

  let ws;
  let ready = false;
  let reconnectDelay = 500;
  let stream;
  let track;
  let frameReader;
  let captureGeneration = 0;
  let facing = readStored("phonecam.facing") || "environment";
  let encoder;
  let encoderSettings;
  let encodeWidth = 0;
  let encodeHeight = 0;
  let bitrate = START_BITRATE;
  let avcc;
  let needKeyFrame = true;
  let lastKeyFrameAt = 0;
  let wakeLock;
  let stats = { frames: 0, bytes: 0, drops: 0, since: performance.now() };
  let stableSince = performance.now();

  if (!key) {
    setStatus("Not paired. Run “phonecam pair” on your computer and scan the QR code.", "bad");
    return;
  }

  if (!("VideoEncoder" in window)) {
    setStatus("This browser can't encode video. Use Safari on iOS 16.4+ or Chrome on Android.", "bad");
    return;
  }

  showHint();
  connect();
  startCamera().catch(showStartButton);

  startButton.addEventListener("click", () => {
    startButton.hidden = true;
    startCamera().catch(showStartButton);
  });
  flipButton.addEventListener("click", () => {
    facing = facing === "environment" ? "user" : "environment";
    writeStored("phonecam.facing", facing);
    startCamera().catch(showStartButton);
  });
  dimButton.addEventListener("click", () => {
    dimOverlay.hidden = false;
  });
  dimOverlay.addEventListener("click", () => {
    dimOverlay.hidden = true;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      return;
    }
    keepAwake();
    if (!track || track.readyState === "ended") {
      startCamera().catch(showStartButton);
    }
  });

  setInterval(reportAndAdapt, 2000);

  // ---- Connection --------------------------------------------------------

  function connect() {
    ws = new WebSocket(`wss://${location.host}/ws`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", key, agent: navigator.userAgent }));
    };
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "ready") {
        ready = true;
        reconnectDelay = 500;
        needKeyFrame = true;
        if (track) {
          setStatus("Connected", "live");
        }
      } else if (message.type === "keyframe") {
        needKeyFrame = true;
      }
    };
    ws.onclose = (event) => {
      ready = false;
      if (event.code === 4001) {
        removeStored("phonecam.key");
        setStatus("Pairing expired. Run “phonecam pair” and scan the new QR code.", "bad");
        return;
      }
      if (event.code === 4002) {
        setStatus("Another phone took over the camera.", "bad");
        return;
      }
      setStatus("Reconnecting to computer…", "bad");
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 3000);
    };
  }

  // ---- Capture -----------------------------------------------------------

  async function startCamera() {
    stopCapture();
    const generation = ++captureGeneration;

    stream = testMode
      ? syntheticStream()
      : await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: TARGET_WIDTH },
            height: { ideal: TARGET_HEIGHT },
            frameRate: { ideal: TARGET_FPS, max: TARGET_FPS }
          }
        });

    track = stream.getVideoTracks()[0];
    track.addEventListener("ended", () => {
      if (document.visibilityState === "visible") {
        startCamera().catch(showStartButton);
      }
    });
    preview.srcObject = stream;
    preview.style.transform = facing === "user" ? "scaleX(-1)" : "";
    await preview.play().catch(() => {});

    flipButton.hidden = testMode;
    dimButton.hidden = false;
    needKeyFrame = true;
    keepAwake();
    setStatus(ready ? "Connected" : "Connecting to computer…", ready ? "live" : undefined);

    if ("MediaStreamTrackProcessor" in window) {
      // Chrome: pull frames straight from the track, no video element copy.
      const processor = new MediaStreamTrackProcessor({ track });
      frameReader = processor.readable.getReader();
      (async () => {
        for (;;) {
          const { value, done } = await frameReader.read().catch(() => ({ done: true }));
          if (done || generation !== captureGeneration) {
            value?.close();
            return;
          }
          handleFrame(value);
        }
      })();
    } else {
      // Safari: wrap each presented video frame.
      const onFrame = (_now, metadata) => {
        if (generation !== captureGeneration) {
          return;
        }
        try {
          handleFrame(new VideoFrame(preview, { timestamp: Math.round(metadata.mediaTime * 1e6) }));
        } catch {
          // The element can briefly have no frame while the camera switches.
        }
        preview.requestVideoFrameCallback(onFrame);
      };
      preview.requestVideoFrameCallback(onFrame);
    }
  }

  function stopCapture() {
    captureGeneration += 1;
    frameReader?.cancel().catch(() => {});
    frameReader = undefined;
    if (stream) {
      for (const t of stream.getTracks()) {
        t.stop();
      }
    }
    stream = undefined;
    track = undefined;
  }

  function showStartButton(error) {
    if (error) {
      setStatus(`Camera unavailable: ${error.message || error.name}`, "bad");
    }
    startButton.hidden = false;
  }

  // ---- Encode and send ---------------------------------------------------

  function handleFrame(frame) {
    if (!ready || ws.readyState !== WebSocket.OPEN) {
      frame.close();
      return;
    }

    const width = frame.displayWidth & ~1;
    const height = frame.displayHeight & ~1;
    if (!encoder || encoder.state === "closed" || width !== encodeWidth || height !== encodeHeight) {
      if (!configureEncoder(width, height)) {
        frame.close();
        return;
      }
    }

    // Never queue: a late frame is worse than a missing one for a webcam.
    if (encoder.encodeQueueSize > 2 || ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      frame.close();
      stats.drops += 1;
      needKeyFrame = true;
      return;
    }

    const now = performance.now();
    const keyFrame = needKeyFrame || now - lastKeyFrameAt > KEYFRAME_INTERVAL_MS;
    if (keyFrame) {
      needKeyFrame = false;
      lastKeyFrameAt = now;
    }

    try {
      encoder.encode(frame, { keyFrame });
    } catch (error) {
      console.warn("encode failed", error);
      encoder = undefined;
    }
    frame.close();
  }

  function configureEncoder(width, height) {
    if (!encoderSettings) {
      return false;
    }
    if (!encoder || encoder.state === "closed") {
      encoder = new VideoEncoder({
        output: onChunk,
        error: (error) => {
          console.warn("encoder error", error);
          encoder = undefined;
        }
      });
    }
    encodeWidth = width;
    encodeHeight = height;
    avcc = undefined;
    encoder.configure(encoderConfig(encoderSettings, width, height, bitrate));
    needKeyFrame = true;
    return true;
  }

  function encoderConfig(settings, width, height, bps) {
    const config = {
      codec: settings.codec,
      width,
      height,
      bitrate: bps,
      bitrateMode: "variable",
      framerate: TARGET_FPS,
      latencyMode: "realtime",
      hardwareAcceleration: "prefer-hardware"
    };
    if (settings.format) {
      config.avc = { format: settings.format };
    }
    return config;
  }

  async function chooseEncoderSettings() {
    for (const codec of CODECS) {
      for (const format of ["annexb", "avc", undefined]) {
        const settings = { codec, format };
        try {
          const { supported } = await VideoEncoder.isConfigSupported(
            encoderConfig(settings, TARGET_WIDTH, TARGET_HEIGHT, START_BITRATE)
          );
          if (supported) {
            return settings;
          }
        } catch {
          // Try the next combination.
        }
      }
    }
    return undefined;
  }

  chooseEncoderSettings().then((settings) => {
    encoderSettings = settings;
    if (!settings) {
      setStatus("This phone can't encode H.264 video.", "bad");
    }
  });

  function onChunk(chunk, metadata) {
    if (metadata?.decoderConfig?.description) {
      avcc = parseAvcC(metadata.decoderConfig.description);
    }
    let data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const isKey = chunk.type === "key";
    if (!isAnnexB(data) && avcc) {
      data = toAnnexB(data, avcc, isKey);
    }
    if (!ready || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const packet = new Uint8Array(9 + data.byteLength);
    const view = new DataView(packet.buffer);
    view.setUint8(0, isKey ? 1 : 0);
    view.setUint16(1, encodeWidth);
    view.setUint16(3, encodeHeight);
    view.setUint32(5, Date.now() >>> 0);
    packet.set(data, 9);
    ws.send(packet);
    stats.frames += 1;
    stats.bytes += packet.byteLength;
  }

  // Safari may emit length-prefixed (AVCC) H.264; the computer expects Annex B.
  function parseAvcC(description) {
    const bytes = description instanceof ArrayBuffer
      ? new Uint8Array(description)
      : new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
    const lengthSize = (bytes[4] & 3) + 1;
    const units = [];
    let offset = 5;
    const spsCount = bytes[offset++] & 0x1f;
    for (let i = 0; i < spsCount; i += 1) {
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      units.push(bytes.slice(offset + 2, offset + 2 + length));
      offset += 2 + length;
    }
    const ppsCount = bytes[offset++];
    for (let i = 0; i < ppsCount; i += 1) {
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      units.push(bytes.slice(offset + 2, offset + 2 + length));
      offset += 2 + length;
    }
    return { lengthSize, parameterSets: units };
  }

  function toAnnexB(data, config, isKey) {
    const parts = [];
    if (isKey) {
      for (const unit of config.parameterSets) {
        parts.push(START_CODE, unit);
      }
    }
    let offset = 0;
    while (offset + config.lengthSize <= data.byteLength) {
      let length = 0;
      for (let i = 0; i < config.lengthSize; i += 1) {
        length = length * 256 + data[offset + i];
      }
      offset += config.lengthSize;
      parts.push(START_CODE, data.subarray(offset, offset + length));
      offset += length;
    }
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let position = 0;
    for (const part of parts) {
      out.set(part, position);
      position += part.byteLength;
    }
    return out;
  }

  function isAnnexB(data) {
    return data[0] === 0 && data[1] === 0 && (data[2] === 1 || (data[2] === 0 && data[3] === 1));
  }

  // ---- Bitrate adaptation and status -------------------------------------

  function reportAndAdapt() {
    const now = performance.now();
    const seconds = (now - stats.since) / 1000;
    const fps = stats.frames / seconds;
    const mbps = (stats.bytes * 8) / seconds / 1e6;
    const drops = stats.drops;
    stats = { frames: 0, bytes: 0, drops: 0, since: now };

    if (encoder && encoder.state === "configured") {
      if (drops > 0) {
        stableSince = now;
        const lower = Math.max(MIN_BITRATE, Math.round(bitrate * 0.7));
        if (lower !== bitrate) {
          bitrate = lower;
          encoder.configure(encoderConfig(encoderSettings, encodeWidth, encodeHeight, bitrate));
          needKeyFrame = true;
        }
      } else if (now - stableSince > 8000 && bitrate < START_BITRATE * 1.5) {
        stableSince = now;
        bitrate = Math.min(MAX_BITRATE, Math.round(bitrate * 1.15));
        encoder.configure(encoderConfig(encoderSettings, encodeWidth, encodeHeight, bitrate));
      }
    }

    if (ready && track && fps > 0) {
      const portrait = encodeHeight > encodeWidth ? " · turn phone sideways" : "";
      setStatus(`Live · ${encodeWidth}×${encodeHeight} · ${fps.toFixed(0)} fps · ${mbps.toFixed(1)} Mbps${portrait}`, "live");
    }
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = `status${kind ? ` ${kind}` : ""}`;
  }

  function showHint() {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) {
      hintEl.textContent = "";
      return;
    }
    hintEl.innerHTML = "Add this page to your Home Screen for one-tap reconnect. " +
      "<a href=\"/ca.crt\">Trust this computer</a> to skip the certificate warning.";
  }

  async function keepAwake() {
    try {
      if (!wakeLock || wakeLock.released) {
        wakeLock = await navigator.wakeLock?.request("screen");
      }
    } catch {
      // Not supported or not allowed yet; the hint covers it.
    }
  }

  // ---- Helpers -----------------------------------------------------------

  function syntheticStream() {
    const canvas = document.createElement("canvas");
    canvas.width = TARGET_WIDTH;
    canvas.height = TARGET_HEIGHT;
    const context = canvas.getContext("2d");
    let n = 0;
    const draw = () => {
      context.fillStyle = `hsl(${(n * 3) % 360} 55% 35%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#fff";
      context.font = "bold 180px sans-serif";
      context.fillText(`PhoneCam ${n}`, 160, 600);
      n += 1;
    };
    draw();
    setInterval(draw, 1000 / TARGET_FPS);
    return canvas.captureStream(TARGET_FPS);
  }

  function readStored(name) {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  }

  function writeStored(name, value) {
    try {
      localStorage.setItem(name, value);
    } catch {
      // Private mode: pairing still works from the URL fragment.
    }
  }

  function removeStored(name) {
    try {
      localStorage.removeItem(name);
    } catch {
      // Ignore.
    }
  }
})();
