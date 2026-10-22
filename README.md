# PhoneCam

<img src="web/icon.svg" width="72" align="right" alt="">

Use your phone as a **wireless 1080p webcam** for Teams, Google Meet, Zoom, or any other video app.

- **No app on the phone.** Scan a QR code once; the camera runs in Safari or Chrome.
- **No OBS or other third-party app.** PhoneCam installs a real camera device called **PhoneCam**.
- **No window on the computer.** It runs in the background; you pick "PhoneCam" in your call app.

```
Phone browser ──── Wi-Fi (H.264, 1080p30) ────▶ phonecam ──▶ "PhoneCam" camera ──▶ Teams / Meet / Zoom
```

## Platform support

| Computer | Status |
|---|---|
| **Linux** | ✅ Supported (v4l2loopback camera device) |
| macOS | 🚧 Planned: CoreMediaIO Camera Extension |
| Windows | 🚧 Planned: Media Foundation virtual camera (Windows 11) |

On macOS and Windows you can already run `phonecam start --record test.h264` to try the phone connection.

| Phone | Requirement |
|---|---|
| iPhone / iPad | Safari, iOS 16.4 or newer |
| Android | Chrome 94 or newer |

## Install

You need Node.js 20+ and git. Then:

```bash
curl -fsSL https://raw.githubusercontent.com/yesabhishek/phonecam-bridge/main/install.sh | sh
```

On Linux this runs the one-time `phonecam setup`, which asks for your password once to:

1. install the `v4l2loopback` kernel module and the video decoder libraries,
2. create the **PhoneCam** camera (`/dev/video42`),
3. build the small decoder helper, and
4. start PhoneCam in the background at every login (a systemd user service).

At the end it prints a QR code.

## Connect your phone

1. Scan the QR code with your phone's camera (or run `phonecam pair` to see it again).
2. The first time, the phone warns that the connection isn't private, because the
   certificate is made by your own computer. Tap **Show Details → visit this website**
   (iPhone) or **Advanced → Proceed** (Android).
3. Allow camera access. The page shows `Live · 1920×1080 · 30 fps`.
4. **Add the page to your Home Screen.** Next time, just tap the icon.

Then choose **PhoneCam** as the camera in your video app.

Tips:

- Hold the phone **sideways** for a full 16:9 picture. Portrait video is shown with side bars.
- Keep the page open and the phone unlocked. PhoneCam keeps the screen awake; tap **Dim screen** to black it out while streaming.
- To skip the certificate warning for good, tap **Trust this computer** on the phone page and install the profile.
  On iPhone, also enable it under Settings → General → About → Certificate Trust Settings.

## Commands

```
phonecam setup              One-time install of the PhoneCam camera
phonecam pair [--reset]     Show the QR code; --reset un-pairs all phones
phonecam start [options]    Run in the foreground (setup already runs it at login)
    --port <n>              HTTPS port (default 8443, remembered)
    --record <file>         Save the phone's H.264 stream instead of feeding the camera
    --no-qr                 Don't print the QR code
phonecam status             Is PhoneCam running, and is a phone streaming?
phonecam uninstall          Remove the camera, service, and pairing data
```

## How it works

- **Phone:** the page captures the camera at 1920×1080 and 30 fps and encodes H.264 with the phone's hardware encoder through WebCodecs. It streams over a WebSocket on your local network.
- **Low latency on busy Wi-Fi:** frames are never queued. If the network falls behind, the phone drops frames, lowers the bitrate (2–12 Mbps, starting at 8), and sends a fresh key frame. It doesn't let delay build up.
- **Computer:** `phonecam` checks the pairing key and passes the video to a small C helper. The helper decodes it with libavcodec and writes a steady 1080p30 stream into the v4l2loopback device. When the phone is away, the camera shows a placeholder instead of disappearing from your call.
- **Reconnects:** the phone reconnects on its own after Wi-Fi drops or a laptop restart. Pairing is remembered, so you scan only once.

## Security

- Everything stays on your local network. There is no cloud service or account.
- The phone page is served over HTTPS with a certificate from a CA that PhoneCam creates on your computer. That CA's private key never leaves your computer.
- A phone can stream only if it has the pairing key from the QR code. `phonecam pair --reset` revokes every phone that was paired before.
- Only one phone streams at a time. A newly paired phone replaces the old one.

## Troubleshooting

| Problem | Fix |
|---|---|
| Phone can't open the link | Phone and computer must be on the same Wi-Fi. Guest and corporate networks often block device-to-device traffic, so try a home network or your phone's hotspot. Check that your firewall allows TCP port 8443. |
| Wrong address in the QR code | Disconnect VPNs and run `phonecam pair` again. |
| `/dev/video42 did not appear` | With Secure Boot on, the v4l2loopback module must be signed. Follow your distribution's DKMS/MOK instructions, or turn off Secure Boot. |
| PhoneCam missing in a browser call | Restart the browser after setup. |
| "Another phone took over the camera" | A second paired phone connected. Close the page on that phone. |
| Is it running? | `phonecam status`, or `journalctl --user -u phonecam` for logs. |

## Development

```bash
git clone https://github.com/yesabhishek/phonecam-bridge && cd phonecam-bridge
npm install
npm test                                   # unit and server tests
npm run build:helper                       # Linux: build the decoder helper
node bin/phonecam.js start --record out.h264
```

Add `&test=1` to the phone URL (after the key) to stream a generated test pattern instead of the camera.
CI runs the unit tests on Linux and macOS. It also runs a Linux end-to-end test that streams to a real v4l2loopback device and reads the frames back (`test/e2e/linux-camera.mjs`).

## License

MIT
