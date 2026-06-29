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

// Outbound queue for keystroke/text commands that arrive while the helper WS is
// mid-reconnect (backoff up to 10 s). Without this, typing "sometimes does
// nothing" because the command is silently dropped during the gap. We queue ONLY
// text/key (the input field): they're order- but not time-sensitive, so flushing
// them a moment late is correct. Mouse move/button/scroll are position- and
// time-sensitive, so we never replay stale ones — they're dropped if offline.
const QUEUEABLE = new Set(['text', 'key']);
const PENDING_TTL_MS = 8000;
const PENDING_MAX = 50;
let pending = []; // [{ cmd, at }]

function flushPending() {
    if (!connected || !ws || pending.length === 0) return;
    const now = Date.now();
    const due = pending.filter((p) => now - p.at <= PENDING_TTL_MS);
    pending = [];
    for (const p of due) {
        try { ws.send(JSON.stringify(p.cmd)); } catch (e) { /* dropped on send error */ }
    }
}

function connect() {
    ws = new WebSocket(HELPER_URL);

    ws.on('open', () => {
        connected = true;
        backoff = 500;
        console.log(`🖥️  Connected to rustdesk-helper at ${HELPER_URL}`);
        helperEvents.emit('status', { connected: true });
        flushPending(); // deliver keystrokes typed during the reconnect gap
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

/**
 * Forward an InputCommand to the helper.
 * Returns true if the command was sent or queued for imminent delivery, false if
 * it was dropped (helper offline and the command is not queueable). Callers can
 * surface `false` instead of pretending the input landed.
 */
export function sendInput(cmd) {
    if (connected && ws) {
        try {
            ws.send(JSON.stringify(cmd));
            return true;
        } catch (e) {
            // fall through to queue attempt below
        }
    }
    // Offline (or send failed): queue keystrokes/text so a brief helper
    // reconnect doesn't silently swallow what the user typed.
    if (cmd && QUEUEABLE.has(cmd.type)) {
        pending.push({ cmd, at: Date.now() });
        if (pending.length > PENDING_MAX) pending.shift();
        return true;
    }
    return false;
}

/**
 * Press-and-release a key with optional modifiers (chip row, Phase 4).
 * Returns true if both events were sent or queued.
 */
export function sendKeyPress(key, mods = {}) {
    const base = { type: 'key', key, ctrl: !!mods.ctrl, alt: !!mods.alt, shift: !!mods.shift, meta: !!mods.meta };
    const a = sendInput({ ...base, down: true });
    const b = sendInput({ ...base, down: false });
    return a && b;
}

export function isConnected() { return connected; }
export function getGeometry() { return geometry; }
export function getPairingCode() { return pairingCode; }
export function getLatestFrame() { return latestFrame; }
