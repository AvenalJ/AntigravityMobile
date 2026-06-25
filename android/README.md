# Antigravity Mobile — Android companion app

A Kotlin + Jetpack Compose (Material 3) Android app that is a mobile companion for a
locally-running **Antigravity IDE** instance, reached over a private **Tailscale**
network. It talks to the Node bridge in this repo (`../src/http-server.mjs`).

> **Important architecture note (read this first).**
> The original brief assumed the backend was a separate "Antigravity Automation"
> VS Code extension exposing REST on `:5000` and a WebSocket on `:9812`. **That is
> not what this repository is.** The bridge in this repo is a self-contained Node
> server that drives Antigravity IDE over the **Chrome DevTools Protocol (CDP)** and
> serves **HTTP _and_ WebSocket on a single port** (changed to **5000** for this
> project — see below). The app is built against that real API. Practical
> consequences:
>
> * **One port (5000)** carries both REST and the WebSocket. The Settings screen
>   still has separate REST/WS port fields, but they default to the same value.
> * **Chat** is a live **HTML mirror** of the IDE's Cascade panel (the bridge renders
>   it to HTML+CSS), shown in a WebView and refreshed on the `chat_update` socket
>   event. The IDE's own Markdown/code rendering comes through for free; there is no
>   structured per-message API to build native bubbles from.
> * **Diff accept/reject** uses the bridge's coarse approval API
>   (`/api/approvals` → `{pending, count, approveButton, rejectButton}`). There is no
>   per-file `+/-` line-count API, so the app shows a single Accept/Reject action bar
>   when a step needs approval; the diff itself is visible in the chat mirror above.
> * **Screenshot timeline** required a small bridge change: the saved-screenshot
>   routes were `localhost`-only. New Tailscale-reachable routes `GET /api/screenshots`
>   and `GET /api/screenshots/:filename` were added (see `../src/http-server.mjs`).
> * **Pause/Resume** of an agent run is **not exposed by the bridge**, so the app
>   offers *Stop current step* (rejects a pending approval) and a live status chip
>   (Running / Idle / Waiting for input / Offline) instead.
> * **CDP auto-discovery:** the bridge finds the running Antigravity app by reading
>   its `DevToolsActivePort` file (in `%APPDATA%\Antigravity` / `Antigravity IDE`),
>   then falls back to a fixed port scan. This means it locks onto the **Antigravity
>   2.0 desktop app** on its random debug port automatically — no fixed `9222` needed.

## Repositories & Git

The **Repository selector** (header on the Files and Git tabs) chooses which repo the
app works in. Add a repo by absolute path (e.g. `C:/XyourP/AntigravityMobile`);
selecting it calls `POST /api/repos/select`, which sets the bridge workspace and is
remembered in `data/config.json` (`repos`). The Files browser and Git tab then both
operate on that root.

The **Git tab** is a full working-tree view backed by new bridge endpoints
(`/api/git/*`, see `../src/git-service.mjs`): branch + ahead/behind, staged / changed /
untracked file lists with one-tap **stage / unstage / discard**, colored **diffs**,
**commit** of staged changes, and **branch switch / create**. Per project policy there
is **no push** — commits stay local.

## Viewing Antigravity 2.0 chats

Your chats live in the **Antigravity 2.0 desktop app** (`Antigravity.exe`), which
exposes a CDP endpoint the bridge now auto-discovers. The 2.0 app is a React UI with
hashed CSS classes, so the *text* chat-mirror selectors (built for the IDE's `#cascade`
panel) don't match it — instead, **view it live through the Screenshots tab** (the
scheduled/live capture shows the 2.0 window, including open conversations). The Chat
tab's text mirror still works against an IDE Cascade panel if one is exposed on CDP.

---

## Features

| Tab / area        | What it does                                                              |
|-------------------|---------------------------------------------------------------------------|
| **Chat**          | Live HTML mirror of the IDE chat, multi-line input → `POST /api/commands/execute`, typing indicator, model chip, Accept/Reject approval bar |
| **Files**         | Workspace file tree (`/api/files`), read-only code viewer with lightweight syntax highlighting (`/api/files/content`) |
| **Git**           | Working tree for the selected repo: branch + ahead/behind, staged / changed / untracked lists, tap-to-view colored diffs, **stage / unstage / discard / commit**, and **branch switch / create** (no push) |
| **Repositories**  | Pick which repo the Files + Git tabs operate in. Add repo roots by path; selection is remembered server-side and switches the bridge workspace |
| **Screenshots**   | Vertical timeline of scheduled screenshots with timestamps; tap for full-screen. Also the way to view the **Antigravity 2.0 app** (see below) |
| **Model selector**| Bottom-sheet picker from `GET /api/models`, set via `POST /api/models/set`, persisted in DataStore, shown as a chip in the top bar and above the input |
| **Agent controls**| Top-bar overflow: Refresh chat, Stop current step; status chip in the title |
| **Settings**      | Tailscale IP + REST/WS ports, **Test Connection**, no login |
| **States**        | Full-screen "Not connected" with Retry, proper empty states per tab, WS auto-reconnect with exponential backoff (cap 30 s), 10 s API timeouts |

Dark mode by default, follows the system setting. Neutral dark surface with a single
teal accent. No splash, no onboarding — opens straight to Chat.

---

## Prerequisites

* **Antigravity IDE** open on your laptop with **CDP enabled** (the bridge connects to
  the IDE's DevTools port, default `9222`). See the repo root `README.md` for how the
  bridge launches the IDE / connects.
* **Node.js 18+** to run the bridge (`npm install` then `npm start` in the repo root,
  or let the IDE auto-start it — see below).
* **Tailscale** running on both the laptop and the phone, on the same tailnet.
* To build the APK yourself: **JDK 17+** and the **Android SDK** (platform `android-36`,
  build-tools `35.0.0`). Android Studio Ladybug (or newer) bundles compatible tooling.
  No Android Studio is required if you build from the command line with the Gradle
  wrapper.

---

## Backend setup (laptop)

1. From the **repo root** (one level up from here):
   ```bash
   npm install
   npm start          # serves HTTP + WebSocket on 0.0.0.0:5000
   ```
2. **Auto-start with the IDE (recommended).** `../.vscode/tasks.json` defines a
   `folderOpen` task that runs `npm start` whenever the workspace is opened in
   Antigravity IDE. The first time, enable it via the Command Palette →
   **Tasks: Manage Automatic Tasks → Allow Automatic Tasks in Folder**. The task sets
   `MOBILE_SKIP_AUTH_PROMPT=1` so it never blocks on the PIN prompt.
3. Find your laptop's Tailscale IP (`tailscale ip -4`, a `100.x.x.x` address).

The bridge port is configured in `../data/config.json` (`server.port`, default `5000`).
There is no login — Tailscale is the security boundary.

---

## Build the APK

From **this `android/` directory**:

```bash
# Debug (no signing config needed):
./gradlew assembleDebug
#   → app/build/outputs/apk/debug/app-debug.apk

# Release (signed, minified, resource-shrunk):
./gradlew assembleRelease
#   → app/build/outputs/apk/release/app-release.apk
```

`local.properties` must point at your SDK (`sdk.dir=...`). The Gradle wrapper downloads
Gradle 8.10.2 automatically on first run.

### Signing the release APK

`assembleRelease` is wired to a keystore via properties in `gradle.properties`:

```
AGM_RELEASE_STORE_FILE=keystore/release.jks
AGM_RELEASE_STORE_PASSWORD=...
AGM_RELEASE_KEY_ALIAS=...
AGM_RELEASE_KEY_PASSWORD=...
```

Generate a keystore once (a dev one is fine for sideloading):

```bash
keytool -genkeypair -v -keystore keystore/release.jks \
  -storepass <pwd> -keypass <pwd> -alias antigravity \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Antigravity Mobile, O=You, C=DE"
```

Keep real keystores/passwords out of version control (see `.gitignore`). For a CI or
shared build, pass them on the command line instead:
`./gradlew assembleRelease -PAGM_RELEASE_STORE_PASSWORD=...` etc. If no keystore is
present, `assembleRelease` still configures but produces an unsigned APK; `assembleDebug`
always works.

---

## Sideload onto your phone

USB (with `adb` from the SDK's `platform-tools`):

```bash
adb install -r app/build/outputs/apk/release/app-release.apk
```

Or copy the APK to the phone and open it (enable *Install unknown apps* for your file
manager / browser).

---

## Configure the connection (in the app)

1. Launch **Antigravity** on the phone. With nothing configured it opens on a
   *Set up your connection* screen → **Open settings**.
2. Enter:
   * **Tailscale IP** — your laptop's `100.x.x.x` address.
   * **REST port** — `5000` (default).
   * **WebSocket port** — `5000` (same single port; leave as-is unless you changed it).
3. Tap **Test Connection** — it pings `GET /api/status` and reports success/failure.
4. **Save**. The app connects, and the WebSocket auto-reconnects if the link drops.

If the bridge is unreachable you'll see a full-screen **Not connected** state showing
the address and a **Retry** button — the app never crashes on a dropped connection.

---

## Tech / size notes

* Min SDK 29 (Android 10), target/compile SDK 36, Kotlin 2.0, Compose Material 3.
* Dependencies kept lean (OkHttp, kotlinx-serialization, DataStore, Coil) and the
  release build uses R8 + resource shrinking to stay small.
