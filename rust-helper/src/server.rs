//! Localhost WebSocket server (I1). Node connects here as a client.
//!
//!   Helper -> Node : BINARY = encoded frames (fed by the capture task, Phase 2).
//!   Node   -> Helper: TEXT  = JSON `InputCommand`s (dispatched to enigo, Phase 4).
//!
//! Bound to 127.0.0.1 only — it is never exposed to the network; the phone talks
//! to Node on :5000, Node relays to here. Multiple Node reconnects are fine: each
//! connection subscribes to the shared frame broadcast.

use std::net::SocketAddr;

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;

use crate::protocol::{HelperEvent, InputCommand};

/// Shared handle wiring the capture task (frame producer) to connected clients,
/// and routing input commands back out to the input task.
#[derive(Clone)]
pub struct Hub {
    /// Encoded frames fan out to every connected Node client.
    pub frames_tx: broadcast::Sender<Vec<u8>>,
    /// Input commands received from Node, fan out to the input executor.
    pub input_tx: broadcast::Sender<InputCommand>,
    /// Capture geometry, reported in the Hello event.
    pub width: u32,
    pub height: u32,
    pub monitor: usize,
}

impl Hub {
    pub fn new() -> Self {
        // Frames: bounded so a stalled client drops old frames rather than
        // blocking capture (lag is preferable to backpressure on the encoder).
        let (frames_tx, _) = broadcast::channel(8);
        let (input_tx, _) = broadcast::channel(256);
        Self {
            frames_tx,
            input_tx,
            width: 0,
            height: 0,
            monitor: 0,
        }
    }
}

/// Accept loop. Binds to `addr` (127.0.0.1:<port>) and serves each Node client.
pub async fn run(addr: SocketAddr, hub: Hub) -> std::io::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    log::info!("helper WS listening on ws://{addr}");
    loop {
        let (stream, peer) = listener.accept().await?;
        let hub = hub.clone();
        tokio::spawn(async move {
            if let Err(e) = serve_client(stream, hub).await {
                log::debug!("client {peer} ended: {e}");
            }
        });
    }
}

async fn serve_client(stream: TcpStream, hub: Hub) -> anyhow_lite::Result {
    let ws = tokio_tungstenite::accept_async(stream)
        .await
        .map_err(|e| e.to_string())?;
    let (mut sink, mut source) = ws.split();
    log::info!("Node connected to helper");

    // Greet with capture geometry + pairing state (pairing fills in Phase 6).
    let hello = HelperEvent::Hello {
        width: hub.width,
        height: hub.height,
        monitor: hub.monitor,
        pairing_code: None,
    };
    let hello = serde_json::to_string(&hello).map_err(|e| e.to_string())?;
    sink.send(Message::Text(hello)).await.map_err(|e| e.to_string())?;

    let mut frames = hub.frames_tx.subscribe();

    loop {
        tokio::select! {
            // Outbound: encoded frames -> Node as binary.
            frame = frames.recv() => match frame {
                Ok(bytes) => {
                    if sink.send(Message::Binary(bytes)).await.is_err() {
                        break;
                    }
                }
                // Lagged: client too slow, skipped frames — keep going with the latest.
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    log::debug!("client lagged, dropped {n} frames");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            // Inbound: JSON input commands from Node.
            msg = source.next() => match msg {
                Some(Ok(Message::Text(txt))) => {
                    match serde_json::from_str::<InputCommand>(&txt) {
                        Ok(cmd) => { let _ = hub.input_tx.send(cmd); }
                        Err(e) => log::warn!("bad input command: {e}: {txt}"),
                    }
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {} // ignore binary/ping from Node
                Some(Err(e)) => { log::debug!("ws error: {e}"); break; }
            },
        }
    }
    log::info!("Node disconnected from helper");
    Ok(())
}

/// Tiny local error alias so we don't pull in the full `anyhow` crate yet.
mod anyhow_lite {
    pub type Result = std::result::Result<(), String>;
}
