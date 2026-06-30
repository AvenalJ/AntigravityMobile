//! Native input injection (Phase 4) via RustDesk's `enigo` crate (SendInput on
//! Windows). Consumes `InputCommand`s from the hub and drives the real OS:
//! absolute mouse, buttons, wheel, and keyboard **with modifier chords** (the
//! sticky chip row → Ctrl+C, Alt+Tab, Win, F-keys, …).
//!
//! enigo is synchronous and `!Send` across awaits, so it lives on its own
//! thread fed by a std mpsc channel; a tiny async task forwards the broadcast
//! into it.

use enigo::{
    Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings,
};
use tokio::sync::broadcast;

use crate::protocol::InputCommand;

/// Start the input executor. `width`/`height` are the captured display size used
/// to map normalised (0..1) coordinates to absolute pixels; 0 means "ask enigo".
pub fn spawn(mut input_rx: broadcast::Receiver<InputCommand>, width: u32, height: u32) {
    let (tx, rx) = std::sync::mpsc::channel::<InputCommand>();

    // Async forwarder: broadcast -> std mpsc (so the executor thread can block).
    tokio::spawn(async move {
        loop {
            match input_rx.recv().await {
                Ok(cmd) => {
                    if tx.send(cmd).is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    std::thread::Builder::new()
        .name("input".into())
        .spawn(move || {
            let mut enigo = match Enigo::new(&Settings::default()) {
                Ok(e) => e,
                Err(e) => {
                    log::error!("enigo init failed, input disabled: {e}");
                    return;
                }
            };

            // Resolve the coordinate space for normalised->absolute mapping.
            let (w, h) = if width > 0 && height > 0 {
                (width as i32, height as i32)
            } else {
                enigo.main_display().unwrap_or((1920, 1080))
            };
            log::info!("input ready: mapping over {w}x{h}");

            while let Ok(cmd) = rx.recv() {
                if let Err(e) = dispatch(&mut enigo, &cmd, w, h) {
                    log::debug!("input dispatch error: {e}");
                }
            }
        })
        .expect("spawn input thread");
}

fn to_abs(n: f64, span: i32) -> i32 {
    ((n * span as f64).round() as i32).clamp(0, span - 1)
}

fn dispatch(enigo: &mut Enigo, cmd: &InputCommand, w: i32, h: i32) -> Result<(), String> {
    match cmd {
        InputCommand::Move { x, y } => {
            enigo
                .move_mouse(to_abs(*x, w), to_abs(*y, h), Coordinate::Abs)
                .map_err(|e| e.to_string())?;
        }
        InputCommand::Button { x, y, button, down } => {
            // Land the pointer first so the click hits where the phone pointed.
            enigo
                .move_mouse(to_abs(*x, w), to_abs(*y, h), Coordinate::Abs)
                .map_err(|e| e.to_string())?;
            let b = match button.as_str() {
                "right" => Button::Right,
                "middle" => Button::Middle,
                _ => Button::Left,
            };
            let dir = if *down { Direction::Press } else { Direction::Release };
            enigo.button(b, dir).map_err(|e| e.to_string())?;
        }
        InputCommand::Scroll { dy, .. } => {
            // Phone delta is pixel-ish and positive = scroll page down, which is
            // also enigo's positive vertical direction. ~40px per wheel notch.
            let lines = (dy / 40.0).round() as i32;
            let lines = if lines == 0 && *dy != 0.0 {
                if *dy > 0.0 { 1 } else { -1 }
            } else {
                lines
            };
            if lines != 0 {
                enigo.scroll(lines, Axis::Vertical).map_err(|e| e.to_string())?;
            }
        }
        InputCommand::Key { key, down, ctrl, alt, shift, meta } => {
            let k = map_key(key).ok_or_else(|| format!("unknown key: {key}"))?;
            if *down {
                if *ctrl { enigo.key(Key::Control, Direction::Press).ok(); }
                if *alt { enigo.key(Key::Alt, Direction::Press).ok(); }
                if *shift { enigo.key(Key::Shift, Direction::Press).ok(); }
                if *meta { enigo.key(Key::Meta, Direction::Press).ok(); }
                enigo.key(k, Direction::Press).map_err(|e| e.to_string())?;
            } else {
                enigo.key(k, Direction::Release).map_err(|e| e.to_string())?;
                if *meta { enigo.key(Key::Meta, Direction::Release).ok(); }
                if *shift { enigo.key(Key::Shift, Direction::Release).ok(); }
                if *alt { enigo.key(Key::Alt, Direction::Release).ok(); }
                if *ctrl { enigo.key(Key::Control, Direction::Release).ok(); }
            }
        }
        InputCommand::Text { text } => {
            enigo.text(text).map_err(|e| e.to_string())?;
        }
        // Stream-control command, handled in the WS server — never reaches here.
        InputCommand::Video { .. } => {}
    }
    Ok(())
}

/// Map a logical key name (DOM-ish) to an enigo Key.
fn map_key(name: &str) -> Option<Key> {
    let k = match name {
        "Enter" | "Return" => Key::Return,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Escape" | "Esc" => Key::Escape,
        "Space" | " " => Key::Space,
        "Delete" | "Del" => Key::Delete,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "ArrowUp" | "Up" => Key::UpArrow,
        "ArrowDown" | "Down" => Key::DownArrow,
        "ArrowLeft" | "Left" => Key::LeftArrow,
        "ArrowRight" | "Right" => Key::RightArrow,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        "Control" | "Ctrl" => Key::Control,
        "Alt" => Key::Alt,
        "Shift" => Key::Shift,
        "Meta" | "Win" | "Super" => Key::Meta,
        other => {
            // Single Unicode character (e.g. "a", "c", "/", "1").
            let mut chars = other.chars();
            let c = chars.next()?;
            if chars.next().is_none() {
                Key::Unicode(c)
            } else {
                return None;
            }
        }
    };
    Some(k)
}
