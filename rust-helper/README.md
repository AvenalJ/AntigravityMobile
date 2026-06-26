# rustdesk-helper

Full-desktop capture + input helper for Antigravity Mobile. Replaces the
CDP-window screencast with whole-desktop remote control (RustDesk-grade), built
on RustDesk's own crates (`scrap` for capture, `enigo` for input).

It is the **top-level launcher**: double-click `rustdesk-helper.exe` and it
(1) starts capture/input, (2) launches `scripts/start-bridge.bat` and supervises
Node (relaunch on exit), (3) serves a localhost WebSocket that Node relays to the
phone. One double-click boots the whole stack — no "did I start the bridge?".

## Build (Windows)

This project uses the **GNU** Rust toolchain (no Visual Studio needed), but
rustup's bundled mingw is incomplete (`dlltool`/`as` fail). You need a full
mingw-w64 GCC on PATH:

```powershell
# one-time toolchain setup
winget install -e --id Rustlang.Rustup
rustup default stable-x86_64-pc-windows-gnu
winget install -e --id BrechtSanders.WinLibs.POSIX.MSVCRT   # full mingw-w64 (matches the msvcrt gnu target)

# build (WinLibs bin must be on PATH for gcc/dlltool/as)
$wl = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
$env:Path = "$env:USERPROFILE\.cargo\bin;$wl;$env:Path"
cargo build --release
```

The release exe lands at `target/release/rustdesk-helper.exe`.

## Runtime env vars

- `RUSTDESK_HELPER_PORT` — localhost WS port (default `47632`).
- `RUSTDESK_HELPER_BRIDGE` — full path to `start-bridge.bat` (default: found by
  walking up from the exe).
- `RUST_LOG` — log level (default `info`).

## Protocol (helper <-> Node, localhost WS)

- Helper → Node: **binary** = encoded frames (JPEG, C1).
- Node → Helper: **text/JSON** = `InputCommand` (see `src/protocol.rs`).
- On connect, helper sends a `hello` event with capture geometry + pairing state.
