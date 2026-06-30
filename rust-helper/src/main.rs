// rustdesk-helper — full-desktop capture + input helper for Antigravity Mobile.
//
// Role (per locked design):
//   - Top-level launcher: starts scripts/start-bridge.bat and supervises Node.
//   - Hosts a localhost WebSocket: binary = JPEG frames, JSON = input commands.
//   - Captures the primary desktop via `scrap` (Phase 2), injects via `enigo` (Phase 4).
//
// Phase 1: launcher/supervisor + localhost WS server, with stub input logging.

mod antigravity;
mod capture;
mod h264;
mod input;
mod protocol;
mod server;
mod supervisor;

use std::net::SocketAddr;

use server::Hub;

/// Localhost port the helper serves on. Override via RUSTDESK_HELPER_PORT.
/// 47632 avoids 9333 (CDP), 5000 (bridge), 9222 (Edge).
const DEFAULT_PORT: u16 = 47632;

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let port: u16 = std::env::var("RUSTDESK_HELPER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_PORT);
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();

    log::info!("rustdesk-helper starting (phase 4)");

    let mut hub = Hub::new();

    // Learn primary-display geometry up front so the Hello event is accurate,
    // then start whole-desktop capture feeding the frame hub.
    match capture::primary_geometry() {
        Ok(geo) => {
            hub.width = geo.width;
            hub.height = geo.height;
            hub.monitor = geo.monitor;
            capture::spawn(hub.frames_tx.clone(), capture::CaptureOpts::default(), hub.h264.clone());
        }
        Err(e) => log::error!("no display to capture: {e} (frames disabled)"),
    }

    // Native input executor: maps phone InputCommands to real OS mouse/keyboard.
    input::spawn(hub.input_tx.subscribe(), hub.width, hub.height);

    // Bring up the Antigravity 2.0 app with CDP so the Chat tab + source toggle work.
    antigravity::ensure_running();

    // Launch + supervise the Node bridge (one double-click boots everything).
    tokio::spawn(supervisor::supervise_bridge());

    // Serve the localhost WS until killed.
    if let Err(e) = server::run(addr, hub).await {
        log::error!("WS server failed: {e}");
        std::process::exit(1);
    }
}
