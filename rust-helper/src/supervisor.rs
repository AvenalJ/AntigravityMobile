//! Process supervision: the helper is the top-level launcher. It starts the
//! Node bridge via `scripts/start-bridge.bat` and relaunches it if it exits,
//! so a single double-click on the helper boots the whole stack and keeps it
//! up (no more "did I start the bridge?" failure).
//!
//! The bat is launched with MOBILE_SUPERVISED=1 so it skips its trailing
//! `pause` (see start-bridge.bat) and we can observe Node's real lifecycle.

use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::time::sleep;

/// Locate `scripts/start-bridge.bat`, honouring an override env var, else
/// walking up from the executable's directory to find the repo root.
fn find_bridge_bat() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("HELPER_BRIDGE").or_else(|_| std::env::var("RUSTDESK_HELPER_BRIDGE")) {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let mut dir: &Path = exe.parent()?;
    loop {
        let candidate = dir.join("scripts").join("start-bridge.bat");
        if candidate.is_file() {
            return Some(candidate);
        }
        dir = dir.parent()?;
    }
}

async fn is_bridge_alive() -> bool {
    for port in [5050, 5000] {
        if tokio::net::TcpStream::connect(("127.0.0.1", port as u16)).await.is_ok() {
            return true;
        }
    }
    false
}

/// Spawn-and-supervise loop. Runs forever; never returns under normal use.
pub async fn supervise_bridge() {
    if std::env::var("HELPER_NO_SUPERVISE").is_ok() {
        log::info!("HELPER_NO_SUPERVISE is set; skipping bridge supervisor");
        return;
    }

    let bat = match find_bridge_bat() {
        Some(b) => b,
        None => {
            log::error!(
                "start-bridge.bat not found (set HELPER_BRIDGE to its full path).                  Node bridge will NOT be auto-started."
            );
            return;
        }
    };
    let repo_root = bat
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();

    log::info!("supervising Node bridge via {}", bat.display());

    let mut backoff = Duration::from_secs(1);
    loop {
        // If the bridge is already running, wait and check again instead of launching a conflicting instance
        if is_bridge_alive().await {
            sleep(Duration::from_secs(5)).await;
            backoff = Duration::from_secs(1);
            continue;
        }

        let mut std_cmd = std::process::Command::new("cmd");
        std_cmd
            .arg("/c")
            .arg(&bat)
            .current_dir(&repo_root)
            .env("MOBILE_SUPERVISED", "1");

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            std_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = match tokio::process::Command::from(std_cmd).spawn() {
            Ok(c) => c,
            Err(e) => {
                log::error!("failed to launch bridge: {e}; retrying in {:?}", backoff);
                sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(30));
                continue;
            }
        };

        match child.wait().await {
            Ok(status) => log::warn!("Node bridge exited ({status}); relaunching"),
            Err(e) => log::error!("error waiting on bridge: {e}; relaunching"),
        }

        sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(30));
    }
}
