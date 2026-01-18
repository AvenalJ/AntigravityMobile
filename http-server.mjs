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
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname, extname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, watch } from 'fs';
import { createInterface } from 'readline';
import { createHash, randomBytes } from 'crypto';
import multer from 'multer';
import * as CDP from './cdp-client.mjs';
import * as ChatStream from './chat-stream.mjs';
import * as QuotaService from './quota-service.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Configuration
// ============================================================================
const HTTP_PORT = 3001;
const DATA_DIR = join(__dirname, 'data');
const UPLOADS_DIR = join(__dirname, 'uploads');
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

    // Skip prompt if not running in an interactive terminal
    if (!process.stdin.isTTY) {
        console.log('ℹ️ Non-interactive mode - auth disabled (set MOBILE_PIN env to enable)');
        return;
    }

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (q) => new Promise(resolve => rl.question(q, resolve));

    console.log('\n' + '═'.repeat(50));
    console.log('🔐 Authentication Setup');
    console.log('═'.repeat(50));

    const enableAuth = await question('Enable PIN authentication? (y/N): ');

    if (enableAuth.toLowerCase() === 'y') {
        const pin = await question('Enter a 4-6 digit PIN: ');

        if (pin.length >= 4 && pin.length <= 6 && /^\d+$/.test(pin)) {
            authEnabled = true;
            authPinHash = hashPin(pin);
            console.log('✅ Authentication enabled! PIN set successfully.');
        } else {
            console.log('⚠️ Invalid PIN (must be 4-6 digits). Continuing without auth.');
        }
    } else {
        console.log('ℹ️ Continuing without authentication.');
    }

    console.log('═'.repeat(50) + '\n');
    rl.close();
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
let workspacePath = join(__dirname, '..');
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
app.use(express.static(join(__dirname, 'public')));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

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

    const { pin } = req.body;
    if (!pin) {
        return res.status(400).json({ error: 'PIN required' });
    }

    if (hashPin(pin) === authPinHash) {
        const token = generateSessionToken();
        validSessions.add(token);
        console.log('🔓 New session authenticated');
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: 'Invalid PIN' });
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

// Health check endpoint (before auth middleware - allows launcher to verify server is running)
app.get('/api/status', (req, res) => {
    res.json({
        status: 'ok',
        authEnabled,
        uptime: process.uptime()
    });
});

// Auth middleware - protect all other API routes
app.use('/api', (req, res, next) => {
    // Skip auth check for auth endpoints
    if (req.path.startsWith('/auth/')) {
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

// Capture screenshot
app.get('/api/cdp/screenshot', async (req, res) => {
    try {
        const format = req.query.format || 'png';
        const quality = parseInt(req.query.quality) || 80;

        const base64 = await CDP.captureScreenshot({ format, quality });

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

// Set workspace path
app.post('/api/workspace', (req, res) => {
    const { path } = req.body;
    if (path && existsSync(path)) {
        workspacePath = path;
        res.json({ success: true, workspace: workspacePath });
    } else {
        res.status(400).json({ error: 'Invalid path' });
    }
});

// Get current workspace
app.get('/api/workspace', (req, res) => {
    res.json({ workspace: workspacePath });
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

        // Auto-start watching this folder for changes
        startWatching(fullPath);

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
        clients: clients.size,
        inbox_count: inbox.length,
        message_count: messages.length,
        cdp: cdpStatus
    });
});

// ============================================================================
// WebSocket
// ============================================================================
wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`🔌 Client connected. Total: ${clients.size}`);

    // Send history
    ws.send(JSON.stringify({
        event: 'history',
        data: { messages: messages.slice(-50) },
        ts: new Date().toISOString()
    }));

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
});

// ============================================================================
// Start
// ============================================================================
async function startServer() {
    // Prompt for authentication setup
    await promptForAuth();

    httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
        console.log(`
╔════════════════════════════════════════════════════════╗
║       📱 Antigravity Mobile Bridge                     ║
╠════════════════════════════════════════════════════════╣
║  Mobile UI:    http://localhost:${HTTP_PORT}                   ║
║  Screenshot:   http://localhost:${HTTP_PORT}/api/cdp/screen.png║
║  API Status:   http://localhost:${HTTP_PORT}/api/status        ║
║  Auth:         ${authEnabled ? '🔐 ENABLED' : '🔓 Disabled'}                            ║
╚════════════════════════════════════════════════════════╝
    `);

        // Start workspace auto-detection
        startWorkspacePolling();
    });
}

startServer();
