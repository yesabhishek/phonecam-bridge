# phonecam-bridge

![phonecam-bridge logo](assets/logo.svg)

Use an Android or iPhone camera over Wi-Fi from a laptop browser, then bridge it into Teams or Zoom with OBS Virtual Camera.

`phonecam-bridge` starts a local HTTPS server, prints a QR code for the phone, serves a clean laptop preview, and exposes an OBS-friendly browser scene.

## Install

```bash
npm install -g phonecam-bridge
```

During install, `phonecam-bridge` detects Windows, macOS, or Linux and checks whether OBS Studio is already installed. The check is advisory and does not install OBS automatically. To skip it:

```bash
PHONECAM_BRIDGE_SKIP_OBS_CHECK=1 npm install -g phonecam-bridge
```

Local development:

```bash
npm install
npm start
```

## Usage

Local checkout:

```bash
npm start
npm run obs:check
npm run obs:ensure
```

Global install:

```bash
phonecam start
phonecam obs check
phonecam obs ensure
```

Options:

- `--host 0.0.0.0`: HTTPS bind host.
- `--port 8443`: HTTPS server port.
- `--obs-port 8444`: localhost-only HTTP port for OBS Browser Source.
- `--cert <path>` and `--key <path>`: use a trusted certificate instead of the generated self-signed certificate.
- `--no-open`: do not open the laptop preview automatically.
- `--no-qr`: print URLs without rendering a QR code.
- `--no-obs-http`: do not start the localhost-only HTTP OBS helper.

The terminal prints:

- `Phone URL`: scan this QR/link from Android Chrome or iPhone Safari.
- `Preview URL`: open this on the laptop for the normal preview.
- `OBS URL`: add this to OBS as a Browser Source.
- `OBS HTTPS`: HTTPS fallback for OBS when OBS trusts your certificate.

Press `Ctrl+C` to stop the server.

## HTTPS

All pages run over HTTPS because mobile browsers require a secure context for camera access over LAN.

By default, the CLI creates a self-signed certificate in the user config directory:

- Windows: `%LOCALAPPDATA%\\phonecam-bridge`
- macOS: `~/Library/Application Support/phonecam-bridge`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/phonecam-bridge`

Browsers and OBS may warn about the generated certificate. For a cleaner setup, provide your own trusted certificate:

```bash
phonecam start --cert ./localhost.pem --key ./localhost-key.pem
```

OBS Browser Source commonly cannot accept a generated self-signed HTTPS certificate interactively. For that reason, `phonecam start` also prints a localhost-only HTTP `OBS URL` by default. Use that URL in OBS. It is bound to `127.0.0.1` and cannot be opened from the phone or other devices.

## OBS, Teams, and Zoom

Teams and Zoom cannot select a web page directly as a camera. Use OBS as the bridge:

Check whether OBS Studio is installed:

```bash
npm run obs:check
```

Try to install OBS Studio with the OS package manager:

```bash
npm run obs:install
```

Check first, then install only if missing:

```bash
npm run obs:ensure
```

After installing the package globally with `npm install -g phonecam-bridge`, the same commands are available as:

```bash
phonecam obs check
phonecam obs install
phonecam obs ensure
```

Installer behavior:

- Windows: uses `winget` when available, then Chocolatey.
- macOS: uses Homebrew Cask when available.
- Linux: uses Flatpak when available, then Snap, then APT.

Some installers may require admin rights or corporate approval.

After OBS is installed:

1. Run `phonecam start`.
2. Add a new OBS source: `Browser`.
3. Paste the `OBS URL` printed by the CLI. Prefer the `http://127.0.0.1:.../obs` URL unless you provided a trusted certificate.
4. Set the browser source size to `1920 x 1080`.
5. Start `OBS Virtual Camera`.
6. In Teams or Zoom, select `OBS Virtual Camera`.

The phone camera continues to stream through the QR-paired browser page; OBS only receives the clean scene page.

## Phone Workflow

1. Run `phonecam start` on the laptop.
2. Scan the QR code from Android Chrome or iPhone Safari.
3. Accept the local HTTPS warning if your browser shows one.
4. Allow camera access.
5. Tap `Start camera`.
6. Use `Mirror off/on` or `Rotate 0/90/180/270` if you need to adjust the camera orientation.
7. Keep the phone page open and the screen awake.

## Checks

```bash
npm run check
npm run pack:dry-run
```

Health endpoint:

```bash
curl -k https://localhost:8443/healthz
```

## Limitations

- OBS install support depends on an available OS package manager and may require admin rights.
- Corporate Wi-Fi can block device-to-device traffic. Use another trusted network or hotspot if the phone cannot reach the laptop URL.
- Bluetooth is not used because it is not practical for real-time webcam-quality video into Teams or Zoom.
