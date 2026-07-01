# Antigravity Mobile

Mobile dashboard, native Android app, and full remote control for [Antigravity IDE](https://antigravity.google). Monitor conversations, drive your agent, and see your whole desktop — all from your phone.

> Fork of [AvenalJ/AntigravityMobile](https://github.com/AvenalJ/AntigravityMobile) extended with a native Android companion app, whole-desktop remote control, one-time device pairing, and an interactive setup wizard.

<p align="center">
  <img src="screenshots/screenshot.png" width="620" alt="Admin Panel Landscape" style="border:1px solid #30363d;border-radius:8px;" />
</p>

## Features

**📱 Native Android companion app** ([`android/`](android/)) — Kotlin + Jetpack Compose (Material 3) app that talks to the bridge over a private **Tailscale** network: live chat mirror, file browser, Git working-tree view (stage/discard/commit), model quota monitor, screenshot timeline, and a full remote-control Screen tab. Supports **Material You dynamic colors** — on Android 12+ the app automatically picks up your wallpaper-derived system palette. See [`android/README.md`](android/README.md) to build and sideload the APK.

**🖥️ Full-desktop remote control** ([`rust-helper/`](rust-helper/)) — a small Rust helper (`desktop-helper.exe`) captures the entire desktop (JPEG or H.264) and injects native mouse/keyboard input, RustDesk-style: tap, double-tap, hold-drag, three-finger scroll, sticky modifiers. It also supervises the Node bridge, so one double-click boots the whole stack.

**🧙 Setup wizard** (`/setup`) — interactive first-run guide with live checks that *does* the work: set the Antigravity path, launch with CDP, build and start the desktop helper (streamed build log), Tailscale guidance, and phone pairing with a live paired indicator.

**🔐 Device pairing** — a phone enters the PC's pairing code once and receives a long-lived token; all input injection requires a paired device. Optional PIN auth with rate limiting on top.

**Mobile Dashboard** (browser fallback) — real-time chat streaming, file browser with syntax highlighting, quota monitor, and quick commands. Full and lite mode for low-bandwidth use.

**Admin Panel** (`/admin`, localhost-only):
- Setup wizard, auto-accept for command prompts (Run, Allow, Continue, …)
- Quick commands — saved prompts injected directly into the agent
- Screenshot timeline with auto-capture
- Theme and layout customization for the mobile dashboard
- Multi-device CDP switching, session event logs
- Remote access via Cloudflare quick tunnels
- Telegram bot notifications *(optional, **off by default** — the code ships but nothing runs unless you enable it in the admin panel)*

**Error Detection** — monitors the chat stream and modal dialogs for errors like "Agent terminated" and "Model quota reached"; can alert via Telegram if enabled.

**Security** — pairing-gated input, optional PIN with IP-based rate limiting (5 attempts, 15-min lockout), localhost-only admin endpoints. No data leaves your machines (Tailscale is peer-to-peer; Telegram API only if you turn it on).

## Quick Start

**Requirements:** Node.js 18+, Antigravity installed. Optional: Rust toolchain (for the desktop helper), [Tailscale](https://tailscale.com) (recommended for phone access), `cloudflared` for public tunnels.

```bash
git clone https://github.com/Xpl4iN/AntigravityMobile.git
cd AntigravityMobile
npm install
node src/http-server.mjs
```

Then open **`http://localhost:5000/setup`** — the wizard walks you through (and automates) the rest: launching Antigravity with CDP, building/starting the desktop helper, Tailscale, and pairing your phone.

Day-to-day, once the helper is built: just double-click `rust-helper/target/release/desktop-helper.exe` — it starts capture/input **and** the bridge, and keeps the bridge alive.

- Admin panel: `http://localhost:5000/admin`
- Phone (Tailscale): `http://<your-tailscale-ip>:5000`

The bridge serves HTTP **and** WebSocket on one port (default **5000**, configurable via `data/config.json` → `server.port`). CDP defaults to port **9333**.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Your PC                                                        │
│                                                                 │
│  Antigravity ◄── CDP (9333) ──► Node bridge (:5000) ◄── WS ──►  │
│   (2.0 app / IDE)                  │            desktop-helper  │
│                                    │            (capture+input) │
│                       HTTP + WebSocket (one port)               │
│                                    │                            │
└────────────────────────────────────┼────────────────────────────┘
                                Tailscale
                                     │
                               Phone 📱 (Android app / browser)
```

| Component | Description |
|-----------|-------------|
| `src/http-server.mjs` | Express server, API endpoints, WebSocket bridge, setup wizard API |
| `src/chat-stream.mjs` | CDP-based chat capture, auto-accept, notification triggers |
| `src/cdp-client.mjs` | Chrome DevTools Protocol client (screenshots, input injection, DOM queries) |
| `src/helper-bridge.mjs` | Localhost link to the desktop helper (frames in, input commands out) |
| `src/pairing-service.mjs` | One-time device pairing: persistent code, per-device tokens |
| `src/git-service.mjs` | Git working-tree API for the phone's Git tab (no push by design) |
| `src/supervisor-service.mjs` | AI supervisor — autonomous monitoring, error recovery, task queue (Ollama) |
| `src/telegram-bot.mjs` | Optional Telegram alerts (inactive unless enabled) |
| `src/tunnel.mjs` | Cloudflare quick tunnel management |
| `src/config.mjs` | Persistent JSON config store (`data/config.json`) |
| `src/quota-service.mjs` | Language server quota polling (Windows only) |
| `src/launcher.mjs` | Startup orchestrator (server, CDP, Antigravity launch) |
| `rust-helper/` | `desktop-helper` — desktop capture (scrap), input injection (enigo), H.264, bridge supervisor |
| `android/` | Native Android companion app (Kotlin, Jetpack Compose, Material 3 + dynamic colors) |

## Configuration

### Port

Default is `5000`. Change `server.port` in `data/config.json` (created on first run).

### Setup wizard

`http://localhost:5000/setup` — re-run any time. Saves a custom Antigravity path to the config if auto-detection fails (`ANTIGRAVITY_PATH` env var also works).

### PIN Authentication

Optional 4–6 digit PIN on top of pairing:

```bash
MOBILE_PIN=1234 node src/http-server.mjs
```

The admin panel shows whether authentication is active; **Clear PIN** disables it.

### Remote Access (Cloudflare tunnel)

1. Install `cloudflared`
2. Admin Panel → Remote Access → **Start Tunnel** — a random public URL + QR code appear
3. PIN authentication is required before the tunnel can start

For phone access, prefer Tailscale — private, encrypted, and no public exposure.

### Telegram Bot (optional, off by default)

The integration is dormant until configured — safe to ignore entirely.

1. Create a bot via [@BotFather](https://t.me/BotFather), get your chat ID from [@userinfobot](https://t.me/userinfobot)
2. Enter both in Admin Panel → Telegram tab → Save & Connect
3. Toggle notification types individually

### CDP

The setup wizard (or the helper/scripts) launches Antigravity with `--remote-debugging-port=9333`. Manually:

```bash
Antigravity.exe --remote-debugging-port=9333
```

The bridge also auto-discovers a running instance via its `DevToolsActivePort` file.

## Project Structure

```
├── android/                    # Native Android companion app (Compose, Material You)
├── rust-helper/                # desktop-helper: capture + input + supervisor (Rust)
├── public/
│   ├── index.html              # Mobile dashboard (browser)
│   ├── minimal.html            # Lite mode (chat only)
│   ├── admin.html              # Admin panel
│   ├── setup.html              # Interactive setup wizard
│   └── css/, js/               # Dashboard styling & logic
├── src/                        # Node bridge (see component table above)
├── scripts/
│   ├── start-bridge.bat        # Bridge only (used by the helper's supervisor)
│   ├── start-antigravity-2.0-debug.bat   # Launch Antigravity 2.0 with CDP
│   └── Start/Stop-Antigravity-Mobile.*   # Legacy all-in-one launchers
├── data/                       # Runtime config & session data (gitignored)
└── screenshots/                # App screenshots for README
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| CDP Disconnected | Launch via the setup wizard, the debug script, or add `--remote-debugging-port=9333` manually |
| Can't connect from phone | Tailscale up on both devices? Try the Tailscale IP with port 5000. Check the firewall |
| Screen tab black / no input | Is `desktop-helper.exe` running? The wizard's helper step shows live status |
| Phone can't control the PC | Pair it first: Settings → Pair in the app, code from the wizard or bridge console |
| Auto-accept not clicking | Ensure CDP is connected (green indicator in admin). Check session logs |
| Quota not loading | Antigravity must be running and logged in. Windows only |
| PIN forgotten | Click **Clear PIN** in Admin → Server |
| Telegram silent | It's off by default. Verify token/chat ID, use the Test button, check toggles |
| Tunnel won't start | Ensure `cloudflared` is installed and PIN auth is enabled |

For debug output, run the server directly:
```bash
node src/http-server.mjs 2>&1 | tee server.log
```

## License

MIT — see [LICENSE](LICENSE).
Original work © AvenalJ; Android companion app, desktop helper, and related modifications © XyourP Websolution UG (haftungsbeschränkt).

## Acknowledgments

- Original project by [AvenalJ](https://github.com/AvenalJ/AntigravityMobile)
- Desktop capture/input built on the MIT-licensed [`scrap`](https://crates.io/crates/scrap) and [`enigo`](https://crates.io/crates/enigo) crates (as used by RustDesk)
- Inspired by [Antigravity-Shit-Chat](https://github.com/gherghett/Antigravity-Shit-Chat) by gherghett
- Quota monitoring inspired by [Antigravity Cockpit](https://marketplace.visualstudio.com/items?itemName=jlcodes.antigravity-cockpit)
