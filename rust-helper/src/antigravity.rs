//! Launch the Antigravity 2.0 desktop app with remote debugging enabled, so the
//! bridge's CDP features (the Chat tab, the app/IDE source toggle) can attach.
//!
//! The Antigravity apps only expose CDP when started with
//! `--remote-debugging-port`; a normal launch (e.g. after a reboot) writes no
//! DevToolsActivePort file, so the bridge can't find them and the Chat tab is
//! stuck on "Connecting to Antigravity…". The helper fixes that by launching the
//! app itself. Port 9333 is used because Edge commonly squats 9222.

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

const DEBUG_PORT: u16 = 9333;

/// Locate Antigravity.exe (ANTIGRAVITY_PATH override, else the usual install dirs).
fn find_exe() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("ANTIGRAVITY_PATH") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        cands.push(PathBuf::from(&local).join("Programs/Antigravity/Antigravity.exe"));
        cands.push(PathBuf::from(&local).join("Antigravity/Antigravity.exe"));
    }
    if let Ok(pf) = std::env::var("ProgramFiles") {
        cands.push(PathBuf::from(pf).join("Antigravity/Antigravity.exe"));
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        cands.push(PathBuf::from(pf86).join("Antigravity/Antigravity.exe"));
    }
    cands.into_iter().find(|p| p.is_file())
}

/// Cheap reachability probe: is something accepting connections on the CDP port?
fn cdp_reachable() -> bool {
    let addr = ([127, 0, 0, 1], DEBUG_PORT).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

fn antigravity_running() -> bool {
    Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq Antigravity.exe", "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("antigravity.exe"))
        .unwrap_or(false)
}

/// Ensure the Antigravity 2.0 app is running with CDP. Runs on its own thread so
/// it never blocks capture/serving. Relaunches the app with the debug flag if it
/// is running without CDP (CDP can't be retrofitted onto a live process).
pub fn ensure_running() {
    std::thread::Builder::new()
        .name("antigravity".into())
        .spawn(|| {
            let exe = match find_exe() {
                Some(e) => e,
                None => {
                    log::error!(
                        "Antigravity.exe not found (set ANTIGRAVITY_PATH). The Chat tab and \
                         app/IDE toggle need it running with remote debugging."
                    );
                    return;
                }
            };

            if cdp_reachable() {
                log::info!("Antigravity CDP already active on {DEBUG_PORT}");
                return;
            }

            if antigravity_running() {
                log::warn!("Antigravity is running without CDP — relaunching it with remote debugging");
                let _ = Command::new("taskkill").args(["/IM", "Antigravity.exe", "/F"]).output();
                std::thread::sleep(Duration::from_millis(1500));
            }

            log::info!(
                "launching Antigravity 2.0 with --remote-debugging-port={DEBUG_PORT}: {}",
                exe.display()
            );
            match Command::new(&exe)
                .arg(format!("--remote-debugging-port={DEBUG_PORT}"))
                .spawn()
            {
                Ok(_) => {
                    // Wait briefly and confirm CDP came up (best-effort log only).
                    for _ in 0..30 {
                        std::thread::sleep(Duration::from_millis(500));
                        if cdp_reachable() {
                            log::info!("Antigravity CDP is now active on {DEBUG_PORT}");
                            return;
                        }
                    }
                    log::warn!("Antigravity launched but CDP not reachable yet on {DEBUG_PORT}");
                }
                Err(e) => log::error!("failed to launch Antigravity: {e}"),
            }
        })
        .ok();
}
