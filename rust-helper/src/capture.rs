//! Desktop capture (Phase 2). Uses RustDesk's `scrap` crate — DXGI Desktop
//! Duplication on Windows — to grab the **whole primary desktop** (not one
//! window), JPEG-encodes each frame (C1), and pushes it into the frame hub.
//!
//! Runs on a dedicated blocking thread (scrap is synchronous). Frames fan out
//! to connected Node clients via the broadcast channel; if no client is
//! attached the send is a cheap no-op, so capture self-throttles to the cadence.

use std::io::ErrorKind::WouldBlock;
use std::time::{Duration, Instant};

use image::codecs::jpeg::JpegEncoder;
use image::{ExtendedColorType, ImageEncoder};
use scrap::{Capturer, Display};
use tokio::sync::broadcast;

/// Capture geometry, reported to Node in the Hello event.
#[derive(Clone, Copy)]
pub struct Geometry {
    pub width: u32,
    pub height: u32,
    pub monitor: usize,
}

/// Tunables for the capture loop (mirrors the prior CDP screencast: 1600x1000,
/// q55, ~20fps — keeps bandwidth sane over Tailscale).
#[derive(Clone, Copy)]
pub struct CaptureOpts {
    pub max_w: u32,
    pub max_h: u32,
    pub quality: u8,
    pub fps: u32,
}

impl Default for CaptureOpts {
    fn default() -> Self {
        Self { max_w: 1600, max_h: 1000, quality: 55, fps: 20 }
    }
}

/// Read primary-display geometry without holding a capturer. Used to fill the
/// Hello event before the capture thread starts.
pub fn primary_geometry() -> Result<Geometry, String> {
    let d = Display::primary().map_err(|e| e.to_string())?;
    Ok(Geometry { width: d.width() as u32, height: d.height() as u32, monitor: 0 })
}

/// Spawn the capture thread. It owns its Display/Capturer and re-creates them on
/// error (resolution change, secure desktop, GPU mode switch).
pub fn spawn(frames_tx: broadcast::Sender<Vec<u8>>, opts: CaptureOpts) {
    std::thread::Builder::new()
        .name("capture".into())
        .spawn(move || loop {
            if let Err(e) = run_once(&frames_tx, opts) {
                log::warn!("capture restarting after error: {e}");
            }
            std::thread::sleep(Duration::from_millis(300));
        })
        .expect("spawn capture thread");
}

/// One capturer lifetime: grab frames until a fatal error bubbles up.
fn run_once(frames_tx: &broadcast::Sender<Vec<u8>>, opts: CaptureOpts) -> Result<(), String> {
    let display = Display::primary().map_err(|e| e.to_string())?;
    let w = display.width();
    let h = display.height();
    let mut cap = Capturer::new(display).map_err(|e| e.to_string())?;
    log::info!("capture started: {w}x{h}");

    // Integer downsample factor so the long side fits the cap (cheap, no resample).
    let factor = downsample_factor(w as u32, h as u32, opts.max_w, opts.max_h);
    let frame_interval = Duration::from_millis((1000 / opts.fps.max(1)) as u64);

    loop {
        let t0 = Instant::now();
        match cap.frame() {
            Ok(frame) => {
                // scrap gives BGRA with a row stride that may exceed width*4.
                let stride = frame.len() / h;
                match encode_jpeg(&frame, w, h, stride, factor, opts.quality) {
                    Ok(jpeg) => {
                        // Err only means "no subscribers" — fine, keep capturing.
                        let _ = frames_tx.send(jpeg);
                    }
                    Err(e) => log::debug!("encode failed: {e}"),
                }
            }
            Err(ref e) if e.kind() == WouldBlock => {
                // No new frame yet — brief wait, then retry without pacing.
                std::thread::sleep(Duration::from_millis(2));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        }
        // Pace to target fps.
        if let Some(rem) = frame_interval.checked_sub(t0.elapsed()) {
            std::thread::sleep(rem);
        }
    }
}

/// Smallest integer factor f such that ceil(w/f) <= max_w and ceil(h/f) <= max_h.
fn downsample_factor(w: u32, h: u32, max_w: u32, max_h: u32) -> u32 {
    let fw = (w + max_w - 1) / max_w.max(1);
    let fh = (h + max_h - 1) / max_h.max(1);
    fw.max(fh).max(1)
}

/// BGRA(+stride) -> RGB (downsampled by `factor`) -> baseline JPEG bytes.
fn encode_jpeg(
    src: &[u8],
    w: usize,
    h: usize,
    stride: usize,
    factor: u32,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let f = factor as usize;
    let out_w = (w + f - 1) / f;
    let out_h = (h + f - 1) / f;
    let mut rgb = Vec::with_capacity(out_w * out_h * 3);

    let mut sy = 0usize;
    while sy < h {
        let row = sy * stride;
        let mut sx = 0usize;
        while sx < w {
            let p = row + sx * 4;
            // scrap is BGRA on Windows.
            rgb.push(src[p + 2]); // R
            rgb.push(src[p + 1]); // G
            rgb.push(src[p]); // B
            sx += f;
        }
        sy += f;
    }

    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality)
        .write_image(&rgb, out_w as u32, out_h as u32, ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok(out)
}
