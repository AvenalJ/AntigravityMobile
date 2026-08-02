/**
 * Pairing Service (K2) — one-time device pairing, RustDesk-style.
 *
 * The PC owns a persistent pairing code (shown in the bridge console). A phone
 * enters it once; the bridge issues a long-lived device token the phone stores
 * and presents on every request. Paired devices then control silently; unpaired
 * devices are refused input injection (full-PC-control gate).
 *
 * State lives in data/pairing.json so the code is stable across restarts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes, randomInt, timingSafeEqual } from 'crypto';

const DATA_DIR = join(process.cwd(), 'data');
const STORE = join(DATA_DIR, 'pairing.json');

let state = { code: null, devices: [] }; // devices: [{ token, name, pairedAt }]

function load() {
    try {
        if (existsSync(STORE)) {
            state = JSON.parse(readFileSync(STORE, 'utf-8'));
            if (!state.devices) state.devices = [];
        }
    } catch (e) { /* fall through to fresh state */ }
}

function save() {
    try {
        if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(STORE, JSON.stringify(state, null, 2));
    } catch (e) { console.error('pairing: failed to persist', e.message); }
}

/** Generate the persistent 6-digit pairing code if absent. Call once at startup. */
export function init() {
    load();
    if (!state.code) {
        state.code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        save();
    }
    console.log('\n┌─────────────────────────────────────────────┐');
    console.log(`│  Pairing code for new devices:  ${state.code}        │`);
    console.log('│  Enter it once on the phone (Settings → Pair) │');
    console.log('└─────────────────────────────────────────────┘\n');
}

export function getCode() { return state.code; }

function constEq(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Verify a code; on success issue and persist a new device token. */
export function pair(code, name = 'device') {
    if (!state.code || !constEq(code, state.code)) return null;
    const token = randomBytes(24).toString('hex');
    state.devices.push({ token, name: String(name).slice(0, 60), pairedAt: new Date().toISOString() });
    save();
    return token;
}

export function isPaired(token) {
    if (!token) return false;
    return state.devices.some(d => constEq(d.token, token));
}

export function listDevices() {
    return state.devices.map(d => ({ name: d.name, pairedAt: d.pairedAt, token: d.token.slice(0, 8) + '…' }));
}

/** Revoke a device by its full token (or the short prefix shown in listDevices). */
export function revoke(tokenOrPrefix) {
    const before = state.devices.length;
    state.devices = state.devices.filter(d => d.token !== tokenOrPrefix && !d.token.startsWith(tokenOrPrefix.replace('…', '')));
    if (state.devices.length !== before) { save(); return true; }
    return false;
}

/** Rotate the pairing code (does not unpair existing devices). */
export function rotateCode() {
    state.code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    save();
    return state.code;
}

/**
 * Express middleware: require a valid device token (header `x-device-token`).
 * Applied to input-injection routes so only paired devices can drive the PC.
 */
export function requirePaired(req, res, next) {
    const token = req.get('x-device-token') || req.body?.token;
    if (isPaired(token)) return next();
    res.status(403).json({ error: 'pairing_required' });
}
