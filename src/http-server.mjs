#!/usr/bin/env node
/**
 * Antigravity Mobile Bridge - HTTP Server
 * 
 * Features:
 * - CDP screenshot streaming (zero-token capture)
 * - CDP command injection (control agent from mobile)
 * - WebSocket real-time updates
 * - Live chat view replication
 * 
 * Usage: node http-server.mjs
 */

import express from 'express';
import { networkInterfaces } from 'os';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname, extname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, watch } from 'fs';
import { createInterface } from 'readline';
import { createHash, randomBytes } from 'crypto';
import multer from 'multer';
import * as CDP from './cdp-client.mjs';
import * as ChatStream from './chat-stream.mjs';
import * as QuotaService from './quota-service.mjs';
import * as Config from './config.mjs';
import * as TelegramBot from './telegram-bot.mjs';
import * as Tunnel from './tunnel.mjs';
import * as Supervisor from './supervisor-service.mjs';
import * as OllamaClient from './ollama-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ============================================================================
// Live Activity Feed — In-memory event ring buffer + disk session logs
// ============================================================================
const MAX_EVENTS = 100;
const activityEvents = [];
const LOGS_DIR = join(PROJECT_ROOT, 'data', 'logs');
if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
let loggingPaused = false;

function getLogFile() {
    const date = new Date().toISOString().slice(0, 10);
    return join(LOGS_DIR, `session-${date}.jsonl`);
}

function emitEvent(type, message) {
    if (loggingPaused) return;
    const icons = {
        info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        cdp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/></svg>',
        config: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
        telegram: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg>',
        screenshot: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
        command: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
        device: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'
    };
    const event = { time: new Date().toISOString(), type, icon: icons[type] || icons.info, message };
    activityEvents.push(event);
    if (activityEvents.length > MAX_EVENTS) activityEvents.shift();
    // Persist to disk
    try { writeFileSync(getLogFile(), JSON.stringify(event) + '\n', { flag: 'a' }); } catch (e) { }
}
emitEvent('info', 'Server starting...');

// ============================================================================
// Usage Analytics
// ============================================================================
const ANALYTICS_FILE = join(PROJECT_ROOT, 'data', 'analytics.json');
let analytics = { screenshots: 0, errors: 0, commands: 0, uptimeStart: Date.now(), dailyStats: {} };
try {
    if (existsSync(ANALYTICS_FILE)) analytics = JSON.parse(readFileSync(ANALYTICS_FILE, 'utf-8'));
    // Only set uptimeStart on very first launch — never overwrite
    if (!analytics.uptimeStart) {
        analytics.uptimeStart = Date.now();
        try { writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2), 'utf-8'); } catch (e) { }
    }
} catch (e) { }

function trackMetric(type) {
    analytics[type] = (analytics[type] || 0) + 1;
    const today = new Date().toISOString().slice(0, 10);
    if (!analytics.dailyStats) analytics.dailyStats = {};
    if (!analytics.dailyStats[today]) analytics.dailyStats[today] = { screenshots: 0, errors: 0, commands: 0 };
    analytics.dailyStats[today][type] = (analytics.dailyStats[today][type] || 0) + 1;
    try { writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2), 'utf-8'); } catch (e) { }
}

// ============================================================================
// Configuration
// ============================================================================
const HTTP_PORT = 3001;
const DATA_DIR = join(PROJECT_ROOT, 'data');
const UPLOADS_DIR = join(PROJECT_ROOT, 'uploads');
const MESSAGES_FILE = join(DATA_DIR, 'messages.json');

// ============================================================================
// Authentication (Optional)
// ============================================================================
let authEnabled = false;
let authPinHash = null;
let validSessions = new Set();

function hashPin(pin) {
    return createHash('sha256').update(pin).digest('hex');
}

function generateSessionToken() {
    return randomBytes(32).toString('hex');
}

function validateSession(token) {
    if (!authEnabled) return true;
    return validSessions.has(token);
}

async function promptForAuth() {
    // Check for PIN from environment variable (non-interactive mode)
    if (process.env.MOBILE_PIN) {
        const pin = process.env.MOBILE_PIN;
        if (pin.length >= 4 && pin.length <= 6 && /^\d+$/.test(pin)) {
            authEnabled = true;
            authPinHash = hashPin(pin);
            console.log('🔐 Authentication enabled via MOBILE_PIN environment variable');
            return;
        } else {
            console.log('⚠️ Invalid MOBILE_PIN (must be 4-6 digits). Continuing without auth.');
            return;
        }
    }

    // Default to no authentication for local home network
    console.log('ℹ️ Running on local home network - auth disabled.');
}

// Ensure directories exist
if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}
if (!existsSync(UPLOADS_DIR)) {
    mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer configuration for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp|bmp/;
        const ext = allowed.test(extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        cb(null, ext && mime);
    }
});

// Workspace path (will be set dynamically via IDE detection or default to parent folder)
let workspacePath = join(PROJECT_ROOT, '..');
Supervisor.setProjectRoot(workspacePath);
let lastValidWorkspacePath = null;  // Track the last successfully detected path
let workspacePollingActive = false;
let workspacePollingInterval = null;
let consecutiveFailures = 0;  // Track consecutive CDP failures

// Start workspace polling to detect IDE's active folder
async function startWorkspacePolling() {
    if (workspacePollingActive) return;
    workspacePollingActive = true;

    const poll = async () => {
        try {
            let detectedPath = await CDP.getWorkspacePath();

            if (!detectedPath) {
                consecutiveFailures++;
                // Don't log every failure, only occasional ones
                if (consecutiveFailures <= 3 || consecutiveFailures % 10 === 0) {
                    console.log(`[Workspace Poll] No path detected (${consecutiveFailures} consecutive failures)`);
                }
                // IMPORTANT: Don't revert to default - keep last valid path
                return;
            }

            // Reset failure counter on success
            consecutiveFailures = 0;

            // Normalize path: replace double backslashes with single
            detectedPath = detectedPath.replace(/\\\\/g, '\\');

            console.log(`[Workspace Poll] Detected: "${detectedPath}" | Current: "${workspacePath}" | Equal: ${pathEquals(detectedPath, workspacePath)}`);

            // Update last valid path
            lastValidWorkspacePath = detectedPath;

            if (!pathEquals(detectedPath, workspacePath)) {
                const oldPath = workspacePath;
                workspacePath = detectedPath;
                Supervisor.setProjectRoot(workspacePath);
                console.log(`📂 Workspace changed: ${oldPath} → ${workspacePath}`);

                // Broadcast to all connected clients
                broadcast('workspace_changed', {
                    path: workspacePath,
                    projectName: basename(workspacePath)
                });
            }
        } catch (e) {
            consecutiveFailures++;
            if (consecutiveFailures <= 3 || consecutiveFailures % 10 === 0) {
                console.log(`[Workspace Poll] Error (${consecutiveFailures}):`, e.message);
            }
            // IMPORTANT: Don't revert to default on error - keep current path
        }
    };

    // Initial check
    await poll();

    // Poll every 5 seconds
    workspacePollingInterval = setInterval(poll, 5000);
}

function stopWorkspacePolling() {
    if (workspacePollingInterval) {
        clearInterval(workspacePollingInterval);
        workspacePollingInterval = null;
    }
    workspacePollingActive = false;
}

// ============================================================================


// ============================================================================
// Scheduled Screenshots — auto-capture gallery
// ============================================================================
const SCREENSHOTS_DIR = join(PROJECT_ROOT, 'data', 'screenshots');
if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });
let screenshotInterval = null;

function startScreenshotScheduler() {
    if (screenshotInterval) return;
    if (!Config.getConfig('scheduledScreenshots.enabled')) return;
    screenshotInterval = setInterval(async () => {
        try {
            if (!Config.getConfig('scheduledScreenshots.enabled')) { stopScreenshotScheduler(); return; }
            const available = await CDP.isAvailable();
            if (!available?.available) return;
            const base64 = await CDP.captureScreenshot({ format: 'jpeg', quality: 60 });
            if (!base64) return;
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const file = join(SCREENSHOTS_DIR, `screenshot-${ts}.jpg`);
            writeFileSync(file, Buffer.from(base64, 'base64'));
            trackMetric('screenshots');
        } catch (e) { }
    }, 30000);
}

function stopScreenshotScheduler() {
    if (screenshotInterval) { clearInterval(screenshotInterval); screenshotInterval = null; }
}

// Cross-platform path comparison (case-insensitive on Windows, case-sensitive on Mac/Linux)
const isWindows = process.platform === 'win32';
function pathStartsWith(path, prefix) {
    if (isWindows) {
        return path.toLowerCase().startsWith(prefix.toLowerCase());
    }
    return path.startsWith(prefix);
}
function pathEquals(path1, path2) {
    if (isWindows) {
        return path1.toLowerCase() === path2.toLowerCase();
    }
    return path1 === path2;
}

// ============================================================================
// File Watcher (for auto-refresh)
// ============================================================================
let activeWatcher = null;
let watchedPath = null;
let watchDebounceTimer = null;

function startWatching(folderPath) {
    // Stop existing watcher
    stopWatching();

    if (!existsSync(folderPath)) return;

    watchedPath = folderPath;

    try {
        activeWatcher = watch(folderPath, { persistent: false }, (eventType, filename) => {
            // Debounce: wait 300ms after last change before broadcasting
            if (watchDebounceTimer) clearTimeout(watchDebounceTimer);

            watchDebounceTimer = setTimeout(() => {
                broadcast('file_changed', {
                    type: eventType,
                    filename: filename,
                    folder: folderPath,
                    timestamp: new Date().toISOString()
                });
            }, 300);
        });

        console.log(`📁 Watching: ${folderPath}`);
    } catch (e) {
        console.log(`⚠️ Watch error: ${e.message}`);
    }
}

function stopWatching() {
    if (activeWatcher) {
        activeWatcher.close();
        activeWatcher = null;
        watchedPath = null;
        console.log('📁 Stopped watching');
    }
    if (watchDebounceTimer) {
        clearTimeout(watchDebounceTimer);
        watchDebounceTimer = null;
    }
}

// ============================================================================
// Storage
// ============================================================================
let messages = [];
let inbox = [];

function loadMessages() {
    try {
        if (existsSync(MESSAGES_FILE)) {
            messages = JSON.parse(readFileSync(MESSAGES_FILE, 'utf-8'));
        }
    } catch (e) {
        messages = [];
    }
}

function saveMessages() {
    try {
        if (messages.length > 500) messages = messages.slice(-500);
        writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    } catch (e) { }
}

loadMessages();

// Load persistent config
Config.loadConfig();
const serverStartTime = Date.now();

// Set workspace targeting from config
const targetWorkspace = Config.getConfig('server.targetWorkspace');
if (targetWorkspace) {
    CDP.setPreferredWorkspace(targetWorkspace);
}

// ============================================================================
// WebSocket Clients
// ============================================================================
const clients = new Set();

function broadcast(event, data) {
    const message = JSON.stringify({ event, data, ts: new Date().toISOString() });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ============================================================================
// HTTP Server
// ============================================================================
const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use(express.json({ limit: '50mb' }));

// ============================================================================
// Frontend Concatenation — Split source files → single HTML response
// ============================================================================
const CSS_ORDER = [
    'variables.css', 'themes.css', 'layout.css', 'components.css',
    'chat.css', 'files.css', 'settings.css', 'assist.css'
];
const JS_ORDER = [
    'api.js', 'websocket.js', 'navigation.js', 'chat.js',
    'settings.js', 'theme.js', 'chat-live.js', 'files.js',
    'icons.js', 'assist.js', 'task-queue.js', 'app.js'
];

let cachedInlinedHtml = null;

function buildInlinedHtml() {
    const publicDir = join(PROJECT_ROOT, 'public');
    const skeleton = readFileSync(join(publicDir, 'index.html'), 'utf-8');

    // Concatenate CSS
    let css = '';
    for (const file of CSS_ORDER) {
        const path = join(publicDir, 'css', file);
        if (existsSync(path)) {
            css += `/* === ${file} === */\n` + readFileSync(path, 'utf-8') + '\n\n';
        } else {
            console.warn(`⚠️ CSS file not found: css/${file}`);
        }
    }

    // Concatenate JS
    let js = '';
    for (const file of JS_ORDER) {
        const path = join(publicDir, 'js', file);
        if (existsSync(path)) {
            js += `// === ${file} ===\n` + readFileSync(path, 'utf-8') + '\n\n';
        } else {
            console.warn(`⚠️ JS file not found: js/${file}`);
        }
    }

    // Replace placeholders
    let html = skeleton
        .replace(/^\s*<!-- CSS -->\s*$/m, `    <style>\n${css}    </style>`)
        .replace(/^\s*<!-- JS -->\s*$/m, `    <script>\n${js}    </script>`);

    cachedInlinedHtml = html;
    console.log(`📄 Built inlined HTML: ${CSS_ORDER.length} CSS + ${JS_ORDER.length} JS files → ${Math.round(html.length / 1024)}KB`);
    return html;
}

// Build on startup
buildInlinedHtml();

// Watch public/css and public/js directories — rebuild cache on any file change
(function watchPublicFiles() {
    const publicDir = join(PROJECT_ROOT, 'public');
    let rebuildTimer = null;
    const scheduleRebuild = () => {
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => {
            console.log('📄 Public files changed — rebuilding inlined HTML...');
            buildInlinedHtml();
            rebuildTimer = null;
        }, 300);
    };
    for (const subdir of ['css', 'js']) {
        const dir = join(publicDir, subdir);
        if (existsSync(dir)) {
            try {
                watch(dir, { persistent: false }, scheduleRebuild);
            } catch (e) {
                console.warn(`⚠️ Could not watch ${subdir}: ${e.message}`);
            }
        }
    }
    // Also watch index.html itself
    try {
        watch(join(publicDir, 'index.html'), { persistent: false }, scheduleRebuild);
    } catch (e) { }
})();

// Serve the inlined HTML for the root page
app.get('/', (req, res) => {
    if (!cachedInlinedHtml) buildInlinedHtml();
    res.type('html').send(cachedInlinedHtml);
});

// Dev endpoint: rebuild cached HTML (useful after editing CSS/JS files)
app.post('/api/admin/rebuild-html', localhostOnly, (req, res) => {
    buildInlinedHtml();
    res.json({ success: true, size: cachedInlinedHtml.length });
});

// Static files (CSS/JS source files, images, manifest, etc.)
app.use(express.static(join(PROJECT_ROOT, 'public')));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ============================================================================
// Login Rate Limiting — per-IP cooldown
// ============================================================================
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map();

function checkLoginRateLimit(ip) {
    const entry = loginAttempts.get(ip);
    if (!entry) return { allowed: true };
    if (Date.now() - entry.firstAttempt > LOGIN_LOCKOUT_MS) {
        loginAttempts.delete(ip);
        return { allowed: true };
    }
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
        const remainingSec = Math.ceil((LOGIN_LOCKOUT_MS - (Date.now() - entry.firstAttempt)) / 1000);
        return { allowed: false, remainingSec };
    }
    return { allowed: true };
}

function recordFailedLogin(ip) {
    const entry = loginAttempts.get(ip);
    if (!entry || Date.now() - entry.firstAttempt > LOGIN_LOCKOUT_MS) {
        loginAttempts.set(ip, { count: 1, firstAttempt: Date.now() });
    } else {
        entry.count++;
    }
}

function clearLoginAttempts(ip) {
    loginAttempts.delete(ip);
}

// Clean up stale rate-limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of loginAttempts) {
        if (now - entry.firstAttempt > LOGIN_LOCKOUT_MS * 2) {
            loginAttempts.delete(ip);
        }
    }
}, 300000);

// ============================================================================
// Auth Endpoints (before auth middleware)
// ============================================================================

// Check if auth is enabled
app.get('/api/auth/status', (req, res) => {
    res.json({ authEnabled });
});

// Login with PIN
app.post('/api/auth/login', (req, res) => {
    if (!authEnabled) {
        return res.json({ success: true, token: 'no-auth-required' });
    }

    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const rateCheck = checkLoginRateLimit(ip);
    if (!rateCheck.allowed) {
        emitEvent('warning', `Login rate limited: ${ip}`);
        return res.status(429).json({
            error: `Too many failed attempts. Try again in ${Math.ceil(rateCheck.remainingSec / 60)} minute(s).`,
            retryAfter: rateCheck.remainingSec
        });
    }

    const { pin } = req.body;
    if (!pin) {
        return res.status(400).json({ error: 'PIN required' });
    }

    if (hashPin(pin) === authPinHash) {
        clearLoginAttempts(ip);
        const token = generateSessionToken();
        validSessions.add(token);
        console.log('🔓 New session authenticated');
        res.json({ success: true, token });
    } else {
        recordFailedLogin(ip);
        const entry = loginAttempts.get(ip);
        const remaining = LOGIN_MAX_ATTEMPTS - (entry?.count || 0);
        emitEvent('warning', `Failed login attempt from ${ip} (${remaining} attempts left)`);
        res.status(401).json({ error: 'Invalid PIN', attemptsRemaining: remaining });
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
        validSessions.delete(token);
    }
    res.json({ success: true });
});

// ============================================================================
// Admin Panel (localhost-only)
// ============================================================================
function localhostOnly(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (isLocal) return next();
    res.status(403).json({ error: 'Admin access is localhost only' });
}

// Serve admin page
app.get('/admin', localhostOnly, (req, res) => {
    res.sendFile(join(PROJECT_ROOT, 'public', 'admin.html'));
});

// Get config
app.get('/api/admin/config', localhostOnly, (req, res) => {
    const cfg = Config.getConfig();
    const masked = JSON.parse(JSON.stringify(cfg));
    if (masked.telegram?.botToken && masked.telegram.botToken.length > 6) {
        masked.telegram.botToken = '***' + masked.telegram.botToken.slice(-6);
    }
    res.json({ config: masked });
});

// Save config
app.post('/api/admin/config', localhostOnly, async (req, res) => {
    try {
        const updates = req.body;
        if (updates.server && 'pin' in updates.server) {
            const pin = updates.server.pin;
            if (pin && pin.length >= 4 && pin.length <= 6 && /^\d+$/.test(pin)) {
                authEnabled = true;
                authPinHash = hashPin(pin);
                updates.server.pin = hashPin(pin);
            } else if (!pin || pin.trim() === '') {
                // Empty PIN = disable auth
                authEnabled = false;
                authPinHash = null;
                delete updates.server.pin;
                console.log('🔓 PIN authentication disabled');
            } else {
                delete updates.server.pin;
            }
        }
        if (updates.telegram?.botToken?.startsWith('***')) {
            updates.telegram.botToken = Config.getConfig('telegram.botToken');
        }
        Config.mergeConfig(updates);
        emitEvent('config', 'Settings saved');
        const tgConfig = Config.getConfig('telegram');
        if (tgConfig.enabled && tgConfig.botToken) {
            await TelegramBot.initBot(tgConfig);
        } else {
            await TelegramBot.stopBot();
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Test telegram
app.post('/api/admin/telegram/test', localhostOnly, async (req, res) => {
    try {
        const { chatId } = req.body;
        if (!TelegramBot.isRunning()) {
            const tgConfig = Config.getConfig('telegram');
            if (tgConfig.botToken) await TelegramBot.initBot(tgConfig);
            if (!TelegramBot.isRunning()) {
                return res.json({ success: false, error: 'Bot not running. Save a valid token first.' });
            }
        }
        const result = await TelegramBot.sendTestMessage(chatId);
        res.json(result);
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Server status
app.get('/api/admin/status', localhostOnly, async (req, res) => {
    let cdpConnected = false;
    try { cdpConnected = (await CDP.isAvailable()).available; } catch (e) { }
    const uptimeMs = Date.now() - serverStartTime;
    const hours = Math.floor(uptimeMs / 3600000);
    const mins = Math.floor((uptimeMs % 3600000) / 60000);
    const tunnelStatus = Tunnel.getTunnelStatus();

    // Find best LAN IP for mobile access
    const nets = networkInterfaces();
    const ipEntries = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ipEntries.push({ address: net.address, name: name.toLowerCase() });
            }
        }
    }
    const realPatterns = ['wi-fi', 'wifi', 'wlan', 'ethernet', 'eth', 'en0', 'en1'];
    const candidates = ipEntries.filter(e => e.address.startsWith('192.168.') && !e.address.endsWith('.1'));
    let lanIP = null;
    for (const p of realPatterns) {
        const m = candidates.find(e => e.name.includes(p));
        if (m) { lanIP = m.address; break; }
    }
    if (!lanIP) lanIP = candidates[0]?.address || ipEntries.find(e => e.address.startsWith('192.168.'))?.address || ipEntries[0]?.address;

    res.json({
        cdpConnected,
        telegramActive: TelegramBot.isRunning(),
        tunnelActive: tunnelStatus.running,
        tunnelUrl: tunnelStatus.url,
        uptime: `${hours}h ${mins}m`,
        port: Config.getConfig('server.port') || HTTP_PORT,
        activeClients: clients.size,
        authEnabled,
        activeDevice: CDP.getActiveDevice(),
        lanIP
    });
});

// ============================================================================
// Device Management Endpoints
// ============================================================================

// List devices
app.get('/api/admin/devices', localhostOnly, (req, res) => {
    res.json({ devices: Config.getConfig('devices') || [] });
});

// Add/update device
app.post('/api/admin/devices', localhostOnly, (req, res) => {
    const { name, cdpPort, active } = req.body;
    if (!name || !cdpPort) return res.status(400).json({ error: 'name and cdpPort required' });

    const devices = Config.getConfig('devices') || [];
    const existing = devices.find(d => d.cdpPort === parseInt(cdpPort));

    if (existing) {
        existing.name = name;
        if (active) {
            devices.forEach(d => d.active = false);
            existing.active = true;
            CDP.setActiveDevice(existing.cdpPort);
        }
    } else {
        if (active) devices.forEach(d => d.active = false);
        devices.push({ name, cdpPort: parseInt(cdpPort), active: !!active });
        if (active) CDP.setActiveDevice(parseInt(cdpPort));
    }

    Config.updateConfig('devices', devices);
    res.json({ success: true, devices });
});

// Switch active device
app.post('/api/admin/devices/switch', localhostOnly, (req, res) => {
    const { cdpPort } = req.body;
    const devices = Config.getConfig('devices') || [];
    const target = devices.find(d => d.cdpPort === parseInt(cdpPort));
    if (!target) return res.status(404).json({ error: 'Device not found' });

    devices.forEach(d => d.active = false);
    target.active = true;
    CDP.setActiveDevice(target.cdpPort);
    Config.updateConfig('devices', devices);
    emitEvent('device', `Switched to ${target.name} (port ${target.cdpPort})`);
    res.json({ success: true, active: target });
});

// Delete device
app.delete('/api/admin/devices/:port', localhostOnly, (req, res) => {
    const port = parseInt(req.params.port);
    let devices = Config.getConfig('devices') || [];
    const wasActive = devices.find(d => d.cdpPort === port)?.active;
    devices = devices.filter(d => d.cdpPort !== port);

    if (devices.length === 0) {
        devices = [{ name: 'Default', cdpPort: 9333, active: true }];
        CDP.setActiveDevice(9333);
    } else if (wasActive) {
        devices[0].active = true;
        CDP.setActiveDevice(devices[0].cdpPort);
    }

    Config.updateConfig('devices', devices);
    res.json({ success: true, devices });
});

// ============================================================================
// Quick Commands Endpoints
// ============================================================================

// List commands
app.get('/api/admin/commands', (req, res) => {
    res.json({ commands: Config.getConfig('quickCommands') || [] });
});

// Save commands (replace all)
app.post('/api/admin/commands', localhostOnly, (req, res) => {
    const { commands } = req.body;
    if (!Array.isArray(commands)) return res.status(400).json({ error: 'commands array required' });
    Config.updateConfig('quickCommands', commands);
    res.json({ success: true, commands });
});

// Execute a quick command (inject prompt into agent via CDP)
app.post('/api/commands/execute', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    try {
        const result = await CDP.injectAndSubmit(prompt);
        emitEvent('command', `Executed: ${prompt.slice(0, 50)}`);
        trackMetric('commands');
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Activity feed events
app.get('/api/admin/events', localhostOnly, (req, res) => {
    res.json({ events: activityEvents.slice().reverse() });
});

// Session logs - list
app.get('/api/admin/logs', localhostOnly, (req, res) => {
    try {
        const files = readdirSync(LOGS_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
        const sessions = files.map(f => {
            const stats = statSync(join(LOGS_DIR, f));
            const content = readFileSync(join(LOGS_DIR, f), 'utf-8').trim();
            const lines = content ? content.split('\n').length : 0;
            return { filename: f, size: stats.size, events: lines, date: f.replace('session-', '').replace('.jsonl', '') };
        });
        res.json({ sessions });
    } catch (e) { res.json({ sessions: [] }); }
});

// Session logs - view
app.get('/api/admin/logs/:filename', localhostOnly, (req, res) => {
    const file = join(LOGS_DIR, req.params.filename);
    if (!existsSync(file)) return res.status(404).json({ error: 'Not found' });
    try {
        const content = readFileSync(file, 'utf-8').trim();
        const events = content ? content.split('\n').map(line => JSON.parse(line)) : [];
        res.json({ events: events.reverse() });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Session logs - download
app.get('/api/admin/logs/:filename/download', localhostOnly, (req, res) => {
    const file = join(LOGS_DIR, req.params.filename);
    if (!existsSync(file)) return res.status(404).json({ error: 'Not found' });
    res.download(file);
});

// Session logs - clear all
app.delete('/api/admin/logs', localhostOnly, (req, res) => {
    try {
        const files = readdirSync(LOGS_DIR).filter(f => f.endsWith('.jsonl'));
        files.forEach(f => unlinkSync(join(LOGS_DIR, f)));
        activityEvents.length = 0;
        emitEvent('info', 'Session logs cleared');
        res.json({ success: true, deleted: files.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Session logs - pause/resume
app.get('/api/admin/logs/pause', localhostOnly, (req, res) => {
    res.json({ paused: loggingPaused });
});

app.post('/api/admin/logs/pause', localhostOnly, (req, res) => {
    loggingPaused = !loggingPaused;
    res.json({ paused: loggingPaused });
});

// Usage analytics
app.get('/api/admin/analytics', localhostOnly, (req, res) => {
    const uptimeMs = Date.now() - (analytics.uptimeStart || Date.now());
    const days = Math.floor(uptimeMs / 86400000);
    const hours = Math.floor((uptimeMs % 86400000) / 3600000);
    const mins = Math.floor((uptimeMs % 3600000) / 60000);
    let totalUptime = '';
    if (days > 0) totalUptime = `${days}d ${hours}h`;
    else if (hours > 0) totalUptime = `${hours}h ${mins}m`;
    else totalUptime = `${mins}m`;
    res.json({
        totals: { screenshots: analytics.screenshots || 0, errors: analytics.errors || 0, commands: analytics.commands || 0 },
        totalUptime,
        firstStarted: new Date(analytics.uptimeStart).toISOString(),
        dailyStats: analytics.dailyStats || {}
    });
});

// ============================================================================


// ============================================================================
// Screenshot Gallery Endpoints
// ============================================================================

// List screenshots
app.get('/api/admin/screenshots', localhostOnly, (req, res) => {
    try {
        const files = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.jpg')).sort().reverse();
        const screenshots = files.slice(0, 100).map(f => {
            const stats = statSync(join(SCREENSHOTS_DIR, f));
            const ts = f.replace('screenshot-', '').replace('.jpg', '').replace(/-/g, (m, i) => i < 10 ? '-' : i === 10 ? 'T' : ':').slice(0, 19);
            return { filename: f, size: stats.size, timestamp: ts };
        });
        res.json({ screenshots });
    } catch (e) { res.json({ screenshots: [] }); }
});

// Serve a screenshot image
app.get('/api/admin/screenshots/:filename', localhostOnly, (req, res) => {
    const file = join(SCREENSHOTS_DIR, req.params.filename);
    if (!existsSync(file)) return res.status(404).json({ error: 'Not found' });
    res.set('Content-Type', 'image/jpeg');
    res.send(readFileSync(file));
});

// Toggle auto-accept commands
app.post('/api/admin/auto-accept/toggle', localhostOnly, (req, res) => {
    const current = Config.getConfig('autoAcceptCommands');
    Config.updateConfig('autoAcceptCommands', !current);
    emitEvent('config', `Auto-accept commands ${!current ? 'enabled' : 'disabled'}`);
    res.json({ enabled: !current });
});

// Save mobile UI customization
app.post('/api/admin/mobile-ui', localhostOnly, (req, res) => {
    const { showQuickActions, navigationMode, refreshInterval, theme, showAssistTab } = req.body;
    const settings = { showQuickActions, navigationMode, refreshInterval, theme };
    if (showAssistTab !== undefined) settings.showAssistTab = showAssistTab;
    Config.updateConfig('mobileUI', settings);
    // Keep supervisor.showAssistTab in sync
    if (showAssistTab !== undefined) Config.updateConfig('supervisor.showAssistTab', showAssistTab);
    // Keep dashboard.theme in sync so both config paths agree
    if (theme) Config.updateConfig('dashboard.theme', theme);
    emitEvent('config', 'Mobile UI settings saved');
    res.json({ success: true });
});

// Get mobile UI settings (accessible from mobile dashboard)
app.get('/api/admin/mobile-ui', (req, res) => {
    const mobileUI = Config.getConfig('mobileUI') || {};
    // Fallback: if mobileUI.theme is missing, use dashboard.theme
    if (!mobileUI.theme) {
        mobileUI.theme = Config.getConfig('dashboard.theme') || 'dark';
    }
    // Include supervisor assist tab state
    mobileUI.showAssistTab = Config.getConfig('supervisor.showAssistTab') || false;
    res.json(mobileUI);
});

// ============================================================================
// Supervisor API Endpoints
// ============================================================================

// Get supervisor status
app.get('/api/admin/supervisor', localhostOnly, async (req, res) => {
    const status = Supervisor.getStatus();
    const ollamaStatus = await OllamaClient.isAvailable();
    const config = Config.getConfig('supervisor') || {};
    res.json({ ...status, ollamaAvailable: ollamaStatus.available, ollamaModels: ollamaStatus.models || [], config });
});

// Save supervisor config
app.post('/api/admin/supervisor', localhostOnly, (req, res) => {
    const { endpoint, model, maxActionsPerMinute, projectContext, disableInjects, contextWindow } = req.body;
    const updates = {};
    if (endpoint !== undefined) updates.endpoint = endpoint;
    if (model !== undefined) updates.model = model;
    if (maxActionsPerMinute !== undefined) updates.maxActionsPerMinute = parseInt(maxActionsPerMinute) || 10;
    if (projectContext !== undefined) updates.projectContext = projectContext;
    if (disableInjects !== undefined) updates.disableInjects = !!disableInjects;
    if (contextWindow !== undefined) updates.contextWindow = parseInt(contextWindow) || 8192;
    const current = Config.getConfig('supervisor') || {};
    Config.updateConfig('supervisor', { ...current, ...updates });
    emitEvent('config', 'Supervisor config saved');
    res.json({ success: true });
});

// Toggle supervisor on/off
app.post('/api/admin/supervisor/toggle', localhostOnly, async (req, res) => {
    const current = Config.getConfig('supervisor.enabled');
    Config.updateConfig('supervisor.enabled', !current);
    if (!current) {
        Supervisor.start();
    } else {
        Supervisor.stop();
    }
    emitEvent('config', `Supervisor ${!current ? 'enabled' : 'disabled'}`);
    res.json({ enabled: !current });
});

// Save project context
app.post('/api/admin/supervisor/context', localhostOnly, (req, res) => {
    const { context } = req.body;
    Config.updateConfig('supervisor.projectContext', context || '');
    emitEvent('config', 'Supervisor project context updated');
    res.json({ success: true });
});

// Get supervisor action log
app.get('/api/admin/supervisor/logs', localhostOnly, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({ actions: Supervisor.getActionLog(limit) });
});

// Test Ollama connection
app.post('/api/admin/supervisor/test', localhostOnly, async (req, res) => {
    const { endpoint: testEndpoint } = req.body;
    if (testEndpoint) OllamaClient.setEndpoint(testEndpoint);
    const result = await OllamaClient.isAvailable();
    // Reset to configured endpoint
    const configEndpoint = Config.getConfig('supervisor.endpoint') || 'http://localhost:11434';
    OllamaClient.setEndpoint(configEndpoint);
    res.json(result);
});

// Clear supervisor history
app.post('/api/admin/supervisor/clear', localhostOnly, (req, res) => {
    Supervisor.clearHistory();
    res.json({ success: true });
});

// Supervisor chat — user talks to supervisor conversationally (Assist tab)
app.post('/api/supervisor/chat', async (req, res) => {
    const { message } = req.body || {};
    if (!message || !message.trim()) return res.json({ success: false, error: 'Empty message' });
    const result = await Supervisor.chatWithUser(message.trim());
    res.json(result);
});

// Get supervisor chat history for Assist tab
app.get('/api/supervisor/chat/history', (req, res) => {
    res.json({ messages: Supervisor.getUserChatHistory() });
});

// Streaming supervisor chat via Server-Sent Events
app.post('/api/supervisor/chat/stream', async (req, res) => {
    const { message } = req.body || {};
    if (!message || !message.trim()) {
        return res.json({ success: false, error: 'Empty message' });
    }

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    try {
        const result = await Supervisor.chatWithUserStream(message.trim(), (token) => {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
        });

        if (result.success) {
            // Process [READ:path] and [LIST:path] tags in the final response
            const processed = await Supervisor.processFileReads(result.response);
            const hasFileContent = processed !== result.response;

            res.write(`data: ${JSON.stringify({ done: true, response: result.response })}\n\n`);

            // If file content was resolved, send a follow-up with the processed text
            if (hasFileContent) {
                res.write(`data: ${JSON.stringify({ file_content: processed })}\n\n`);
            }
        } else {
            res.write(`data: ${JSON.stringify({ error: result.error })}\n\n`);
        }
    } catch (e) {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    }
    res.end();
});

// ============================================================================
// Task Queue API (Feature 3)
// ============================================================================

app.get('/api/supervisor/queue', (req, res) => {
    res.json({ queue: Supervisor.getTaskQueue() });
});

app.post('/api/supervisor/queue', (req, res) => {
    const { instruction } = req.body || {};
    if (!instruction) return res.json({ success: false, error: 'Missing instruction' });
    res.json(Supervisor.addTask(instruction));
});

app.delete('/api/supervisor/queue/:index', (req, res) => {
    res.json(Supervisor.removeTask(parseInt(req.params.index)));
});

app.delete('/api/supervisor/queue', (req, res) => {
    res.json(Supervisor.clearTaskQueue());
});

// ============================================================================
// Supervisor Suggest Mode API (Feature 6)
// ============================================================================

// Get pending suggestions
app.get('/api/supervisor/suggestions', (req, res) => {
    res.json({ suggestions: Supervisor.getPendingSuggestions() });
});

// Approve a suggestion
app.post('/api/supervisor/suggestions/:id/approve', async (req, res) => {
    const id = parseInt(req.params.id);
    const result = await Supervisor.approveSuggestion(id);
    res.json(result);
});

// Dismiss a suggestion
app.post('/api/supervisor/suggestions/:id/dismiss', (req, res) => {
    const id = parseInt(req.params.id);
    const result = Supervisor.dismissSuggestion(id);
    res.json(result);
});

// ============================================================================
// File Awareness API (Feature 4)
// ============================================================================

app.post('/api/supervisor/file/read', (req, res) => {
    const { path } = req.body || {};
    if (!path) return res.json({ success: false, error: 'Missing path' });
    res.json(Supervisor.readProjectFile(path));
});

app.post('/api/supervisor/file/list', (req, res) => {
    const { path } = req.body || {};
    res.json(Supervisor.listProjectDir(path || ''));
});

// ============================================================================
// Session Intelligence API (Feature 5)
// ============================================================================

app.get('/api/supervisor/sessions', (req, res) => {
    res.json(Supervisor.getSessionStats());
});

app.post('/api/supervisor/sessions/save', localhostOnly, (req, res) => {
    res.json({ success: true, digest: Supervisor.saveSessionDigest() });
});

// ============================================================================
// Tunnel API Endpoints
// ============================================================================

// Get tunnel status
app.get('/api/admin/tunnel', localhostOnly, (req, res) => {
    const status = Tunnel.getTunnelStatus();
    const config = Config.getConfig('tunnel') || {};
    res.json({ ...status, autoStart: config.autoStart || false });
});

// Start tunnel
app.post('/api/admin/tunnel/start', localhostOnly, async (req, res) => {
    if (!authEnabled) {
        return res.status(400).json({ success: false, error: 'PIN authentication must be enabled before starting a remote tunnel. Set a PIN first for security.' });
    }
    const result = await Tunnel.startTunnel(HTTP_PORT);
    if (result.success) {
        emitEvent('success', `Tunnel active: ${result.url}`);
    } else {
        emitEvent('error', `Tunnel failed: ${result.error}`);
    }
    res.json(result);
});

// Stop tunnel
app.post('/api/admin/tunnel/stop', localhostOnly, (req, res) => {
    const result = Tunnel.stopTunnel();
    emitEvent('info', 'Tunnel stopped');
    res.json(result);
});

// Toggle tunnel auto-start
app.post('/api/admin/tunnel/auto-start', localhostOnly, (req, res) => {
    const current = Config.getConfig('tunnel.autoStart') || false;
    Config.updateConfig('tunnel.autoStart', !current);
    res.json({ autoStart: !current });
});

// Toggle scheduled screenshots
app.post('/api/admin/screenshots/toggle', localhostOnly, (req, res) => {
    const current = Config.getConfig('scheduledScreenshots.enabled');
    Config.updateConfig('scheduledScreenshots', { ...Config.getConfig('scheduledScreenshots'), enabled: !current });
    if (!current) { startScreenshotScheduler(); emitEvent('screenshot', 'Scheduled screenshots enabled'); }
    else { stopScreenshotScheduler(); emitEvent('screenshot', 'Scheduled screenshots disabled'); }
    res.json({ enabled: !current });
});

// Delete all screenshots
app.delete('/api/admin/screenshots', localhostOnly, (req, res) => {
    try {
        const files = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.jpg'));
        files.forEach(f => unlinkSync(join(SCREENSHOTS_DIR, f)));
        emitEvent('screenshot', `Deleted ${files.length} screenshots`);
        res.json({ success: true, deleted: files.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Auth middleware - protect all other API routes
app.use('/api', (req, res, next) => {
    // Skip auth check for auth and admin endpoints
    if (req.path.startsWith('/auth/') || req.path.startsWith('/admin/')) {
        return next();
    }

    if (!authEnabled) {
        return next();
    }

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (validateSession(token)) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized', needsAuth: true });
    }
});

// ============================================================================
// CDP Endpoints - Screenshot & Command Injection
// ============================================================================

// Check CDP status
app.get('/api/cdp/status', async (req, res) => {
    try {
        const status = await CDP.isAvailable();
        res.json(status);
    } catch (e) {
        res.json({ available: false, error: e.message });
    }
});

// Get available CDP targets
app.get('/api/cdp/targets', async (req, res) => {
    try {
        const targets = await CDP.getTargets();
        res.json({ targets });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Set preferred CDP target workspace
app.post('/api/cdp/workspace', express.json(), async (req, res) => {
    try {
        const { workspace } = req.body;
        if (workspace === undefined) return res.status(400).json({ error: 'Workspace is required' });
        
        // Update both the in-memory CDP preference and the persistent config
        CDP.setPreferredWorkspace(workspace || null);
        Config.updateConfig('server.targetWorkspace', workspace || null);
        
        res.json({ success: true, workspace });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Click element by xpath (forwarded from mobile dashboard)
app.post('/api/cdp/click', async (req, res) => {
    try {
        const { xpath, text } = req.body;
        if (!xpath) return res.status(400).json({ success: false, error: 'Missing xpath' });
        const result = await CDP.clickElementByXPath(xpath);
        emitEvent('success', `Mobile click: "${text || 'button'}"`);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Capture screenshot
app.get('/api/cdp/screenshot', async (req, res) => {
    try {
        const format = req.query.format || 'png';
        const quality = parseInt(req.query.quality) || 80;

        const base64 = await CDP.captureScreenshot({ format, quality });
        trackMetric('screenshots');

        // Return as image
        if (req.query.raw === 'true') {
            const buffer = Buffer.from(base64, 'base64');
            res.set('Content-Type', `image/${format}`);
            res.set('Cache-Control', 'no-cache');
            res.send(buffer);
        } else {
            res.json({
                success: true,
                format,
                data: base64,
                dataUrl: `data:image/${format};base64,${base64}`
            });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Screenshot as raw image (for <img> src)
app.get('/api/cdp/screen.png', async (req, res) => {
    try {
        const base64 = await CDP.captureScreenshot({ format: 'png', quality: 90 });
        const buffer = Buffer.from(base64, 'base64');
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(buffer);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Inject command (type text)
app.post('/api/cdp/inject', async (req, res) => {
    try {
        const { text, submit } = req.body;
        if (!text) return res.status(400).json({ error: 'Text required' });

        let result;
        if (submit) {
            result = await CDP.injectAndSubmit(text);
        } else {
            result = await CDP.injectCommand(text);
        }

        // Log to messages
        messages.push({
            type: 'mobile_command',
            content: text,
            timestamp: new Date().toISOString()
        });
        saveMessages();
        broadcast('mobile_command', { text, submitted: !!submit });

        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Focus input area
app.post('/api/cdp/focus', async (req, res) => {
    try {
        const result = await CDP.focusInput();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get live chat messages from IDE
app.get('/api/cdp/chat', async (req, res) => {
    try {
        const result = await CDP.getChatMessages();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message, messages: [] });
    }
});

// Get agent panel content
app.get('/api/cdp/panel', async (req, res) => {
    try {
        const result = await CDP.getAgentPanelContent();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get conversation text from the IDE panel
app.get('/api/cdp/conversation', async (req, res) => {
    try {
        const result = await CDP.getConversationText();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// Live Chat Stream (captures #cascade element from webview)
// ============================================================================

// Get live chat snapshot
app.get('/api/chat/snapshot', async (req, res) => {
    try {
        const snapshot = await ChatStream.getChatSnapshot();
        if (snapshot) {
            res.json(snapshot);
        } else {
            res.status(503).json({ error: 'No chat found', messages: [] });
        }
    } catch (e) {
        res.status(500).json({ error: e.message, messages: [] });
    }
});

// Start chat stream
app.post('/api/chat/start', async (req, res) => {
    try {
        const result = await ChatStream.startChatStream((chat) => {
            // Broadcast chat updates to WebSocket clients
            broadcast('chat_update', {
                messageCount: chat.messageCount,
                messages: chat.messages,
                timestamp: new Date().toISOString()
            });
        }, 2000);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Stop chat stream
app.post('/api/chat/stop', (req, res) => {
    ChatStream.stopChatStream();
    res.json({ success: true });
});

// Check stream status
app.get('/api/chat/status', (req, res) => {
    res.json({ streaming: ChatStream.isStreaming() });
});

// ============================================================================
// Quota Endpoints - Model quota data from Antigravity
// ============================================================================

// Get model quota data
app.get('/api/quota', async (req, res) => {
    try {
        const quota = await QuotaService.getQuota();
        res.json(quota);
    } catch (e) {
        res.status(500).json({ available: false, error: e.message, models: [] });
    }
});

// Check quota service availability
app.get('/api/quota/status', async (req, res) => {
    try {
        const status = await QuotaService.isAvailable();
        res.json(status);
    } catch (e) {
        res.json({ available: false, error: e.message });
    }
});

// ============================================================================
// Model & Mode Control Endpoints
// ============================================================================

// Get current model and mode
app.get('/api/models', async (req, res) => {
    try {
        const result = await CDP.getAvailableModels();
        const modeResult = await CDP.getModelAndMode();
        res.json({
            models: result.models || [],
            currentModel: modeResult.model || result.current || 'Unknown',
            currentMode: modeResult.mode || 'Unknown'
        });
    } catch (e) {
        // Return known defaults on error
        res.json({
            models: [
                'Gemini 3.1 Pro (High)',
                'Gemini 3.1 Pro (Low)',
                'Gemini 3 Flash',
                'Claude Sonnet 4.6',
                'Claude Sonnet 4.6 (Thinking)',
                'Claude Opus 4.6 (Thinking)',
                'GPT-OSS 120B (Medium)'
            ],
            currentModel: 'Unknown',
            currentMode: 'Unknown',
            error: e.message
        });
    }
});

// Set model
app.post('/api/models/set', async (req, res) => {
    try {
        const { model } = req.body;
        console.log('[SetModel] Request received for model:', model);
        if (!model) {
            return res.status(400).json({ error: 'Model name required' });
        }
        const result = await CDP.setModel(model);
        console.log('[SetModel] CDP result:', JSON.stringify(result));
        if (result.success) {
            broadcast('model_changed', { model: result.selected });
        }
        res.json(result);
    } catch (e) {
        console.log('[SetModel] Error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get available modes
app.get('/api/modes', async (req, res) => {
    try {
        const result = await CDP.getAvailableModes();
        res.json(result);
    } catch (e) {
        res.json({
            modes: [
                { name: 'Planning', description: 'Agent can plan before executing. Use for complex tasks.' },
                { name: 'Fast', description: 'Agent executes tasks directly. Use for simple tasks.' }
            ],
            current: 'Planning',
            error: e.message
        });
    }
});

// Set mode
app.post('/api/modes/set', async (req, res) => {
    try {
        const { mode } = req.body;
        if (!mode) {
            return res.status(400).json({ error: 'Mode name required' });
        }
        const result = await CDP.setMode(mode);
        if (result.success) {
            broadcast('mode_changed', { mode: result.selected });
        }
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// Command Approval Endpoints
// ============================================================================

// Get pending approvals
app.get('/api/approvals', async (req, res) => {
    try {
        const result = await CDP.getPendingApprovals();
        res.json(result);
    } catch (e) {
        res.json({ pending: false, count: 0, error: e.message });
    }
});

// Respond to approval (approve or reject)
app.post('/api/approvals/respond', async (req, res) => {
    try {
        const { action } = req.body;
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Action must be "approve" or "reject"' });
        }
        console.log('[Approvals] Responding with:', action);
        const result = await CDP.respondToApproval(action);
        console.log('[Approvals] Result:', JSON.stringify(result));
        if (result.success) {
            broadcast('approval_responded', { action: result.action });
        }
        res.json(result);
    } catch (e) {
        console.log('[Approvals] Error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// File Upload & File Browser Endpoints
// ============================================================================

// Upload image from mobile
app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded' });
        }

        const filePath = join(UPLOADS_DIR, req.file.filename);
        const fileUrl = `/uploads/${req.file.filename}`;

        res.json({
            success: true,
            filename: req.file.filename,
            originalName: req.file.originalname,
            path: filePath,
            url: fileUrl,
            size: req.file.size
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Serve uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));

// Serve Antigravity resources (for icons in chat)
if (existsSync('/usr/share/antigravity')) {
    app.use('/usr/share/antigravity', express.static('/usr/share/antigravity'));
}

// Set workspace path
app.post('/api/workspace', (req, res) => {
    const { path } = req.body;
    if (path && existsSync(path)) {
        workspacePath = path;
        Supervisor.setProjectRoot(workspacePath);
        broadcast('workspace_changed', {
            path: workspacePath,
            projectName: basename(workspacePath)
        });
        res.json({ success: true, workspace: workspacePath });
    } else {
        res.status(400).json({ error: 'Invalid path' });
    }
});

// Get current workspace
app.get('/api/workspace', (req, res) => {
    const targetWorkspace = Config.getConfig('server.targetWorkspace');
    res.json({
        workspace: workspacePath,
        targetWorkspace: targetWorkspace || null,
        projectName: basename(workspacePath)
    });
});

// Reset file browser to workspace root (e.g., after getting stuck in a subfolder)
app.post('/api/workspace/reset', async (req, res) => {
    try {
        const detectedPath = await CDP.getWorkspacePath();
        if (detectedPath) {
            workspacePath = detectedPath;
            Supervisor.setProjectRoot(workspacePath);
            broadcast('workspace_changed', {
                path: workspacePath,
                projectName: basename(workspacePath)
            });
        }
        res.json({ success: true, workspace: workspacePath });
    } catch (e) {
        res.json({ success: false, workspace: workspacePath, error: e.message });
    }
});

// List files in directory
app.get('/api/files', (req, res) => {
    try {
        const requestedPath = req.query.path || workspacePath;

        // Resolve to absolute path
        const fullPath = resolve(requestedPath);

        if (!existsSync(fullPath)) {
            return res.status(404).json({ error: 'Path not found' });
        }

        // Security: Prevent listing directories outside workspace
        const workspaceRoot = resolve(workspacePath);
        if (!pathStartsWith(fullPath, workspaceRoot)) {
            return res.status(403).json({ error: 'Access denied - outside workspace' });
        }

        const stats = statSync(fullPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Not a directory' });
        }

        const items = readdirSync(fullPath).map(name => {
            const itemPath = join(fullPath, name);
            try {
                const itemStats = statSync(itemPath);
                return {
                    name,
                    path: itemPath,
                    isDirectory: itemStats.isDirectory(),
                    size: itemStats.size,
                    modified: itemStats.mtime,
                    extension: itemStats.isDirectory() ? null : extname(name).toLowerCase()
                };
            } catch (e) {
                return { name, error: 'Access denied' };
            }
        }).filter(item => !item.name.startsWith('.') && item.name !== 'node_modules');

        // Sort: directories first, then files alphabetically
        items.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        // Get parent directory - restrict to workspace root
        const parent = dirname(fullPath);
        // workspaceRoot already declared above for security check

        // Check if we're at the workspace root (don't allow navigating outside project folder)
        // Only block if we're exactly at the workspace root, not if path detection is still pending
        const isAtWorkspaceRoot = pathEquals(fullPath, workspaceRoot);
        // Check if we're at a filesystem root (e.g., C:\ or /)
        const isAtFilesystemRoot = parent === fullPath || (isWindows && fullPath.match(/^[A-Z]:\\?$/i));
        const isAtRoot = isAtWorkspaceRoot || isAtFilesystemRoot;

        // Only restart watcher if we navigated to a different folder
        if (fullPath !== watchedPath) startWatching(fullPath);

        res.json({
            path: fullPath,
            parent: isAtRoot ? null : parent,
            items,
            isRoot: isAtRoot,
            workspaceRoot: workspaceRoot  // Include for debugging
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Stop file watching
app.post('/api/files/unwatch', (req, res) => {
    stopWatching();
    res.json({ success: true });
});

// Get file content
app.get('/api/files/content', (req, res) => {
    try {
        const filePath = req.query.path;
        if (!filePath) {
            return res.status(400).json({ error: 'Path required' });
        }

        if (!existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Security: Prevent reading files outside workspace
        const resolvedPath = resolve(filePath);
        const workspaceRoot = resolve(workspacePath);
        if (!pathStartsWith(resolvedPath, workspaceRoot)) {
            return res.status(403).json({ error: 'Access denied - outside workspace' });
        }

        const stats = statSync(filePath);
        if (stats.isDirectory()) {
            return res.status(400).json({ error: 'Cannot read directory' });
        }

        // Limit file size to 1MB for safety
        if (stats.size > 1024 * 1024) {
            return res.status(400).json({ error: 'File too large (max 1MB)' });
        }

        const ext = extname(filePath).toLowerCase();
        const textExtensions = ['.txt', '.md', '.js', '.mjs', '.ts', '.json', '.html', '.css', '.py', '.sh', '.bat', '.yml', '.yaml', '.xml', '.csv', '.log', '.env', '.gitignore'];

        if (!textExtensions.includes(ext)) {
            return res.status(400).json({ error: 'Binary file - cannot display', extension: ext });
        }

        const content = readFileSync(filePath, 'utf-8');
        res.json({
            path: filePath,
            name: basename(filePath),
            extension: ext,
            size: stats.size,
            content
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Save file content
app.post('/api/files/save', (req, res) => {
    try {
        const { path: filePath, content } = req.body;
        if (!filePath) {
            return res.status(400).json({ error: 'Path required' });
        }
        if (content === undefined) {
            return res.status(400).json({ error: 'Content required' });
        }

        // Security: Prevent editing files outside workspace
        const resolvedPath = resolve(filePath);
        const workspaceRoot = resolve(workspacePath);
        if (!pathStartsWith(resolvedPath, workspaceRoot)) {
            return res.status(403).json({ error: 'Access denied - outside workspace' });
        }

        if (!existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const ext = extname(filePath).toLowerCase();
        const textExtensions = ['.txt', '.md', '.js', '.mjs', '.ts', '.json', '.html', '.css', '.py', '.sh', '.bat', '.yml', '.yaml', '.xml', '.csv', '.log', '.env', '.gitignore'];

        if (!textExtensions.includes(ext)) {
            return res.status(400).json({ error: 'Cannot edit binary files' });
        }

        writeFileSync(filePath, content, 'utf-8');
        res.json({ success: true, path: filePath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Serve raw file (for images)
app.get('/api/files/raw', (req, res) => {
    try {
        const filePath = req.query.path;
        if (!filePath) {
            return res.status(400).json({ error: 'Path required' });
        }

        // Security: Prevent accessing files outside workspace
        const resolvedPath = resolve(filePath);
        const workspaceRoot = resolve(workspacePath);
        if (!pathStartsWith(resolvedPath, workspaceRoot)) {
            return res.status(403).json({ error: 'Access denied - outside workspace' });
        }

        if (!existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const ext = extname(filePath).toLowerCase();
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];

        if (!imageExtensions.includes(ext)) {
            return res.status(400).json({ error: 'Only image files supported' });
        }

        // Limit file size to 10MB
        const stats = statSync(filePath);
        if (stats.size > 10 * 1024 * 1024) {
            return res.status(400).json({ error: 'Image too large (max 10MB)' });
        }

        // Set content type based on extension
        const mimeTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.bmp': 'image/bmp'
        };

        res.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        res.sendFile(resolvedPath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// Message Endpoints
// ============================================================================

// Broadcast a message
app.post('/api/broadcast', (req, res) => {
    const { type, content, context_summary, timestamp } = req.body;

    const msg = {
        type: type || 'agent',
        content: content || '',
        context_summary,
        timestamp: timestamp || new Date().toISOString()
    };

    messages.push(msg);
    saveMessages();
    broadcast('message', msg);

    console.log(`📡 [${type}] ${content.substring(0, 60)}...`);

    res.json({ success: true, clients: clients.size });
});

// Get messages (called by mobile UI)
app.get('/api/messages', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json({ messages: messages.slice(-limit), count: messages.length });
});

// Add message to inbox (called by mobile UI)
app.post('/api/inbox', (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    inbox.push({
        content: message,
        from: 'mobile',
        timestamp: new Date().toISOString()
    });

    broadcast('inbox_updated', { count: inbox.length });
    console.log(`📥 [INBOX] ${message.substring(0, 50)}...`);

    res.json({ success: true, inbox_count: inbox.length });
});

// Read inbox
app.get('/api/inbox/read', (req, res) => {
    const result = { messages: [...inbox], count: inbox.length };
    inbox = []; // Clear after reading
    res.json(result);
});

// Clear all messages
app.post('/api/messages/clear', (req, res) => {
    messages = [];
    saveMessages();
    broadcast('messages_cleared', {});
    res.json({ success: true });
});

// Status
app.get('/api/status', async (req, res) => {
    let cdpStatus = { available: false };
    try {
        cdpStatus = await CDP.isAvailable();
    } catch (e) { }

    res.json({
        ok: true,
        status: 'ok',
        authEnabled,
        uptime: process.uptime(),
        clients: clients.size,
        inbox_count: inbox.length,
        message_count: messages.length,
        cdp: {
            ...cdpStatus,
            targetWorkspace: Config.getConfig('server.targetWorkspace') || null
        }
    });
});

// ============================================================================
// WebSocket — with ping/pong heartbeat to drop dead clients
// ============================================================================
const WS_PING_INTERVAL_MS = 25000;

wss.on('connection', (ws) => {
    clients.add(ws);
    ws.isAlive = true;
    console.log(`🔌 Client connected. Total: ${clients.size}`);

    // Send history
    ws.send(JSON.stringify({
        event: 'history',
        data: { messages: messages.slice(-50) },
        ts: new Date().toISOString()
    }));

    ws.on('pong', () => { ws.isAlive = true; });

    // Handle messages from mobile
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());

            if (msg.action === 'inject') {
                // CDP command injection
                const result = await CDP.injectAndSubmit(msg.text);
                ws.send(JSON.stringify({ event: 'inject_result', data: result }));
            } else if (msg.action === 'screenshot') {
                // Request screenshot
                const base64 = await CDP.captureScreenshot();
                ws.send(JSON.stringify({ event: 'screenshot', data: { image: base64 } }));
            }
        } catch (e) {
            ws.send(JSON.stringify({ event: 'error', data: { message: e.message } }));
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`🔌 Client disconnected. Total: ${clients.size}`);
    });

    ws.on('error', () => {
        clients.delete(ws);
        ws.terminate();
    });
});

// Ping all clients every 25s; drop any that haven't responded
const wsPingTimer = setInterval(() => {
    for (const ws of clients) {
        if (!ws.isAlive) {
            clients.delete(ws);
            ws.terminate();
            continue;
        }
        ws.isAlive = false;
        ws.ping();
    }
}, WS_PING_INTERVAL_MS);

// ============================================================================
// Start
// ============================================================================
async function startServer() {
    // Prompt for authentication setup
    await promptForAuth();

    // Set active CDP device from config
    const devices = Config.getConfig('devices') || [];
    const activeDevice = devices.find(d => d.active);
    if (activeDevice) CDP.setActiveDevice(activeDevice.cdpPort);

    // Register Telegram bot callbacks (always, so /status etc work even if bot started later via admin panel)
    TelegramBot.registerCallbacks({
        getStatus: async () => {
            let cdpConnected = false;
            try { cdpConnected = (await CDP.isAvailable()).available; } catch (e) { }
            const uptimeMs = Date.now() - serverStartTime;
            const hours = Math.floor(uptimeMs / 3600000);
            const mins = Math.floor((uptimeMs % 3600000) / 60000);
            return { cdpConnected, uptime: `${hours}h ${mins}m`, activeClients: clients.size };
        },
        getScreenshot: async () => {
            try { return await CDP.captureScreenshot(); } catch (e) { return null; }
        },
        clickByXPath: async (xpath) => {
            try { return await CDP.clickElementByXPath(xpath); } catch (e) { return { success: false, error: e.message }; }
        },
        getQuota: async () => {
            try { return await QuotaService.getQuota(); } catch (e) { return { available: false, error: e.message, models: [] }; }
        }
    });

    // Initialize Telegram bot if enabled in config
    const tgConfig = Config.getConfig('telegram');
    if (tgConfig?.enabled && tgConfig?.botToken) {
        await TelegramBot.initBot(tgConfig);
    }

    // Auto-start tunnel if configured (only if PIN auth is enabled)
    const tunnelConfig = Config.getConfig('tunnel');
    if (tunnelConfig?.autoStart && authEnabled) {
        console.log('🌐 Auto-starting tunnel...');
        const result = await Tunnel.startTunnel(HTTP_PORT);
        if (result.success) {
            emitEvent('success', `Tunnel auto-started: ${result.url}`);
        } else {
            emitEvent('error', `Tunnel auto-start failed: ${result.error}`);
        }
    }

    httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
        console.log(`
╔════════════════════════════════════════════════════════╗
║       📱 Antigravity Mobile Bridge                     ║
╠════════════════════════════════════════════════════════╣
║  Mobile UI:    http://localhost:${HTTP_PORT}                   ║
║  Admin:        http://localhost:${HTTP_PORT}/admin              ║
║  Auth:         ${authEnabled ? '🔐 ENABLED' : '🔓 Disabled'}                            ║
║  Telegram:     ${tgConfig?.enabled ? '🤖 ENABLED' : '❌ Disabled'}                            ║
╚════════════════════════════════════════════════════════╝
    `);

        // Start workspace auto-detection
        startWorkspacePolling();

        ChatStream.setAutoAcceptCallback((label) => emitEvent('success', `Auto-accepted: "${label}"`));
        ChatStream.setDebugCallback((msg) => {
            // Only log actionable events, skip noisy polling messages
            if (msg.startsWith('Buttons found') || msg.startsWith('No accept button')) return;
            emitEvent('info', msg);
        });
        ChatStream.setErrorCallback((errorMsg) => {
            trackMetric('errors');
        });
        startScreenshotScheduler();

        // Initialize supervisor
        Supervisor.registerCallbacks({
            injectAndSubmit: CDP.injectAndSubmit,
            clickByXPath: CDP.clickElementByXPath,
            captureScreenshot: CDP.captureScreenshot,
            emitEvent,
            broadcast
        });
        const supervisorConfig = Config.getConfig('supervisor') || {};
        if (supervisorConfig.enabled) {
            Supervisor.start();
            emitEvent('supervisor', 'Supervisor auto-started');
        }

        // Auto-start chat stream with retry (CDP may not be ready immediately)
        const startChatStreamWithRetry = async (retries = 30, delayMs = 5000) => {
            for (let i = 0; i < retries; i++) {
                try {
                    const result = await ChatStream.startChatStream((chat) => {
                        broadcast('chat_update', {
                            messageCount: chat.messageCount,
                            messages: chat.messages,
                            timestamp: new Date().toISOString()
                        });
                        // Feed chat updates to supervisor
                        if (chat.html && Supervisor.isEnabled()) {
                            Supervisor.processChatUpdate(chat.html);
                        }
                    }, 2000);
                    if (result?.success) {
                        emitEvent('success', 'Chat stream connected');
                        return;
                    }
                } catch (e) { }
                await new Promise(r => setTimeout(r, delayMs));
            }
            emitEvent('info', 'Chat stream: CDP not available after retries');
        };
        setTimeout(() => startChatStreamWithRetry(), 3000);

        emitEvent('success', `HTTP server listening on port ${HTTP_PORT}`);
    });

    // Optional HTTPS server
    const httpsEnabled = Config.getConfig('server.https');
    if (httpsEnabled) {
        try {
            const { generateKeyPairSync, createCertificate } = await import('crypto');
            const CERTS_DIR = join(PROJECT_ROOT, 'data', 'certs');
            if (!existsSync(CERTS_DIR)) mkdirSync(CERTS_DIR, { recursive: true });
            const keyFile = join(CERTS_DIR, 'server.key');
            const certFile = join(CERTS_DIR, 'server.cert');

            if (!existsSync(keyFile) || !existsSync(certFile)) {
                // Generate self-signed cert using openssl
                const { execSync } = await import('child_process');
                execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyFile}" -out "${certFile}" -days 365 -nodes -subj "/CN=Antigravity Mobile"`, { stdio: 'pipe' });
                emitEvent('info', 'Generated self-signed SSL certificate');
            }

            const { createServer: createHttpsServer } = await import('https');
            const httpsServer = createHttpsServer({
                key: readFileSync(keyFile),
                cert: readFileSync(certFile)
            }, app);

            const HTTPS_PORT = HTTP_PORT + 443; // 3444 by default
            httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
                console.log(`  🔒 HTTPS: https://localhost:${HTTPS_PORT}`);
                emitEvent('success', `HTTPS server listening on port ${HTTPS_PORT}`);
            });
        } catch (e) {
            console.error('⚠️ HTTPS setup failed:', e.message);
            emitEvent('error', `HTTPS setup failed: ${e.message}`);
        }
    }
}

startServer();
