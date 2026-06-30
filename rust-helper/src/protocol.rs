//! Wire protocol between the Rust helper and the Node bridge over the localhost
//! WebSocket.
//!
//!   Helper -> Node : BINARY messages  = encoded video frames (JPEG for C1).
//!   Node   -> Helper: TEXT (JSON)      = input commands (this enum).
//!
//! Coordinates are normalised 0.0..=1.0 over the captured (primary) display, so
//! the phone never needs to know the host resolution — the helper maps them to
//! absolute pixels for enigo in Phase 4.

use serde::{Deserialize, Serialize};

/// One input command from the phone, relayed verbatim by Node.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InputCommand {
    /// Absolute pointer move to a normalised position.
    Move { x: f64, y: f64 },
    /// Mouse button down/up at a normalised position. button = left|right|middle.
    Button {
        x: f64,
        y: f64,
        button: String,
        down: bool,
    },
    /// Wheel scroll. Positive `dy` scrolls the page down (matches the phone gesture).
    Scroll { x: f64, y: f64, dx: f64, dy: f64 },
    /// A single key event with active modifiers (the sticky chip row, E1/F1).
    /// `key` is a logical name: "a", "Enter", "Escape", "F5", "ArrowUp", ...
    Key {
        key: String,
        down: bool,
        #[serde(default)]
        ctrl: bool,
        #[serde(default)]
        alt: bool,
        #[serde(default)]
        shift: bool,
        #[serde(default)]
        meta: bool,
    },
    /// Type a literal string into the focused OS window (the input field, F1).
    Text { text: String },
    /// Switch the outbound video codec for the screen stream: "h264" | "jpeg".
    /// Handled in the WS server (toggles the capture encoder), not the input task.
    Video { codec: String },
}

/// Control/status messages the helper may send to Node as TEXT alongside the
/// binary frame stream (kept separate from frames, which are always BINARY).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum HelperEvent {
    /// Sent once on connect so Node knows capture geometry and pairing state.
    Hello {
        width: u32,
        height: u32,
        monitor: usize,
        /// Phase 6 fills this; Phase 1 reports null.
        pairing_code: Option<String>,
    },
}
