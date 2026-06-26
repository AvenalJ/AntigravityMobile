//! Process supervision: the helper is the top-level launcher. It starts the
//! Node bridge via `scripts/start-bridge.bat` and relaunches it if it exits,
//! so a single double-click on the helper boots the whole stack and keeps it
//! up (no more "did I start the bridge?" failure).
//!
//! The bat is launched with MOBILE_SUPERVISED=1 so it skips its trailing
//! `pause` (see start-bridge.bat) and we can observe Node's real lifecycle.

use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::sleep;

/// Locate `scripts/start-bridge.bat`, honouring an override env var, else
/// walking up from the executable's directory to find the repo root.
fn find_bridge_bat() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("RUSTDESK_HELPER_BRIDGE") {
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

/// Spawn-and-supervise loop. Runs forever; never returns under normal use.
pub async fn supervise_bridge() {
    let bat = match find_bridge_bat() {
        Some(b) => b,
        None => {
            log::error!(
                "start-bridge.bat not found (set RUSTDESK_HELPER_BRIDGE to its full path). \
                 Node bridge will NOT be auto-started."
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
        // `cmd /c <bat>` runs the batch in this console; MOBILE_SUPERVISED skips its pause.
        let mut child = match Command::new("cmd")
            .arg("/c")
            .arg(&bat)
            .current_dir(&repo_root)
            .env("MOBILE_SUPERVISED", "1")
            .spawn()
        {
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

        // Bridge stayed up a while -> reset backoff; crash-looping -> back off.
        sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(30));
    }
}
