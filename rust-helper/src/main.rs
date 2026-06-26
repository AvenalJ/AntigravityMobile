// rustdesk-helper — full-desktop capture + input helper for Antigravity Mobile.
//
// Role (per locked design):
//   - Top-level launcher: starts scripts/start-bridge.bat and supervises Node.
//   - Hosts a localhost WebSocket: binary = JPEG frames, JSON = input commands.
//   - Captures the primary desktop via `scrap` (Phase 2), injects via `enigo` (Phase 4).
//
// Phase 1: launcher/supervisor + localhost WS server, with stub input logging.

mod capture;
mod protocol;
mod server;
mod supervisor;

use std::net::SocketAddr;

use protocol::InputCommand;
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

    log::info!("rustdesk-helper starting (phase 2)");

    let mut hub = Hub::new();

    // Learn primary-display geometry up front so the Hello event is accurate,
    // then start whole-desktop capture feeding the frame hub.
    match capture::primary_geometry() {
        Ok(geo) => {
            hub.width = geo.width;
            hub.height = geo.height;
            hub.monitor = geo.monitor;
            capture::spawn(hub.frames_tx.clone(), capture::CaptureOpts::default());
        }
        Err(e) => log::error!("no display to capture: {e} (frames disabled)"),
    }

    // Phase 1 stub: log input commands so we can verify the Node->helper path
    // end-to-end before enigo lands in Phase 4.
    {
        let mut input = hub.input_tx.subscribe();
        tokio::spawn(async move {
            loop {
                match input.recv().await {
                    Ok(cmd) => log::info!("input (stub): {}", describe(&cmd)),
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
        });
    }

    // Launch + supervise the Node bridge (one double-click boots everything).
    tokio::spawn(supervisor::supervise_bridge());

    // Serve the localhost WS until killed.
    if let Err(e) = server::run(addr, hub).await {
        log::error!("WS server failed: {e}");
        std::process::exit(1);
    }
}

fn describe(cmd: &InputCommand) -> String {
    match cmd {
        InputCommand::Move { x, y } => format!("move {x:.3},{y:.3}"),
        InputCommand::Button { button, down, .. } => format!("button {button} down={down}"),
        InputCommand::Scroll { dx, dy, .. } => format!("scroll {dx:.1},{dy:.1}"),
        InputCommand::Key { key, down, ctrl, alt, shift, meta } => format!(
            "key {key} down={down} mods=[{}{}{}{}]",
            if *ctrl { "C" } else { "" },
            if *alt { "A" } else { "" },
            if *shift { "S" } else { "" },
            if *meta { "W" } else { "" },
        ),
        InputCommand::Text { text } => format!("text {:?}", text),
    }
}
