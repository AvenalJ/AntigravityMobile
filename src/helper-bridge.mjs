/**
 * Helper Bridge — Node side of the localhost link to rustdesk-helper.exe.
 *
 * The Rust helper does whole-desktop capture (scrap) and input injection
 * (enigo). Node is a thin relay: it connects to the helper's localhost
 * WebSocket, forwards binary frames to the phone's existing frame stream, and
 * forwards JSON input commands the phone triggers.
 *
 *   helper -> Node : BINARY  = JPEG frames        (re-emitted as 'frame')
 *   helper -> Node : TEXT    = events (hello, ...) (parsed: geometry, pairing)
 *   Node   -> helper: TEXT   = InputCommand JSON   (sendInput)
 *
 * Connection is resilient: Node reconnects with backoff, so startup order with
 * the helper never matters (whoever is up first waits for the other).
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';

const HELPER_PORT = Number(process.env.RUSTDESK_HELPER_PORT) || 47632;
const HELPER_URL = `ws://127.0.0.1:${HELPER_PORT}`;

export const helperEvents = new EventEmitter();

let ws = null;
let connected = false;
let backoff = 500;
const MAX_BACKOFF = 10000;

let geometry = { width: 0, height: 0, monitor: 0 };
let pairingCode = null;
let latestFrame = null; // last JPEG Buffer, for instant first paint on idle desktops

function connect() {
    ws = new WebSocket(HELPER_URL);

    ws.on('open', () => {
        connected = true;
        backoff = 500;
        console.log(`🖥️  Connected to rustdesk-helper at ${HELPER_URL}`);
        helperEvents.emit('status', { connected: true });
    });

    ws.on('message', (data, isBinary) => {
        if (isBinary) {
            latestFrame = data;
            helperEvents.emit('frame', data);
        } else {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.event === 'hello') {
                    geometry = { width: msg.width, height: msg.height, monitor: msg.monitor };
                    pairingCode = msg.pairing_code ?? null;
                    helperEvents.emit('hello', { geometry, pairingCode });
                    console.log(`🖥️  Helper capture ${geometry.width}x${geometry.height} (monitor ${geometry.monitor})`);
                }
            } catch (e) { /* ignore malformed control msg */ }
        }
    });

    const reconnect = () => {
        if (connected) console.log('🖥️  rustdesk-helper disconnected; reconnecting…');
        connected = false;
        helperEvents.emit('status', { connected: false });
        ws = null;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
    };

    ws.on('close', reconnect);
    ws.on('error', () => { try { ws.close(); } catch (e) {} });
}

/** Start the reconnecting connection to the helper. */
export function start() {
    if (ws) return;
    connect();
}

/** Forward an InputCommand to the helper. No-op (logged) if not connected. */
export function sendInput(cmd) {
    if (!connected || !ws) return false;
    try {
        ws.send(JSON.stringify(cmd));
        return true;
    } catch (e) {
        return false;
    }
}

/** Press-and-release a key with optional modifiers (chip row, Phase 4). */
export function sendKeyPress(key, mods = {}) {
    const base = { type: 'key', key, ctrl: !!mods.ctrl, alt: !!mods.alt, shift: !!mods.shift, meta: !!mods.meta };
    sendInput({ ...base, down: true });
    sendInput({ ...base, down: false });
}

export function isConnected() { return connected; }
export function getGeometry() { return geometry; }
export function getPairingCode() { return pairingCode; }
export function getLatestFrame() { return latestFrame; }
