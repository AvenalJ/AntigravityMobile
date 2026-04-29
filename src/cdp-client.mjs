/**
 * CDP Client - Chrome DevTools Protocol interface for Antigravity
 * 
 * Provides:
 * - Screenshot capture (zero-token screen streaming)
 * - Command injection (type into agent input)
 * - Page inspection
 */

const CDP_PORTS = [9222, 9333, 9000, 9001, 9002, 9003];
let cdpPort = null; // auto-discovered
let preferredWorkspace = null;

/**
 * Auto-discover the active CDP port by scanning known ports.
 * Caches the result so subsequent calls are instant.
 */
async function discoverPort() {
    if (cdpPort) return cdpPort;

    for (const port of CDP_PORTS) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
                signal: AbortSignal.timeout(1500)
            });
            if (res.ok) {
                cdpPort = port;
                console.log(`🔌 CDP auto-discovered on port ${port}`);
                return port;
            }
        } catch (e) { /* port not available */ }
    }
    throw new Error(`CDP not available on any port (tried ${CDP_PORTS.join(', ')})`);
}

function getCdpUrl() {
    return `http://127.0.0.1:${cdpPort}`;
}

/**
 * Set the active CDP device port (skips auto-discovery)
 */
export function setActiveDevice(port) {
    cdpPort = parseInt(port) || 9222;
}

/**
 * Get the active CDP device port
 */
export function getActiveDevice() {
    return cdpPort;
}

/**
 * Reset cached port so next call re-discovers (useful if IDE restarts on a different port)
 */
export function resetPort() {
    cdpPort = null;
}

/**
 * Set the preferred workspace name for targeting
 * When set, findEditorTarget() will prefer windows whose title starts with this name
 */
export function setPreferredWorkspace(name) {
    preferredWorkspace = name || null;
    if (name) console.log(`🎯 CDP workspace preference set: "${name}"`);
}

/**
 * Get the current preferred workspace
 */
export function getPreferredWorkspace() {
    return preferredWorkspace;
}

/**
 * Get list of available CDP targets (pages/tabs)
 */
export async function getTargets() {
    await discoverPort();
    const response = await fetch(`${getCdpUrl()}/json/list`);
    return response.json();
}

/**
 * Get CDP version info
 */
export async function getVersion() {
    await discoverPort();
    const response = await fetch(`${getCdpUrl()}/json/version`);
    return response.json();
}

/**
 * Find the main Antigravity editor page
 * If preferredWorkspace is set, targets the window whose title starts with that name
 */
export async function findEditorTarget() {
    const targets = await getTargets();
    const pages = targets.filter(t =>
        t.type === 'page' &&
        !t.url.includes('devtools')
    );

    // 1. If preferred workspace is configured, find exact match by title prefix
    if (preferredWorkspace) {
        const preferred = pages.find(t =>
            t.title.toLowerCase().startsWith(preferredWorkspace.toLowerCase() + ' ') ||
            t.title.toLowerCase().startsWith(preferredWorkspace.toLowerCase() + ' —') ||
            t.title.toLowerCase() === preferredWorkspace.toLowerCase()
        );
        if (preferred) return preferred;
        // Log warning but don't fail — fall through to default behavior
        console.log(`⚠️ Preferred workspace "${preferredWorkspace}" not found among ${pages.length} targets`);
    }

    // 2. Fallback: find Antigravity page (excluding Launchpad/Manager)
    const editor = pages.find(t =>
        t.title.includes('Antigravity') &&
        !t.title.includes('Launchpad') &&
        !t.title.includes('Manager')
    );

    return editor || pages.find(t => t.type === 'page');
}

/**
 * Connect to a CDP target via WebSocket
 */
export async function connectToTarget(target) {
    const wsUrl = target.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('No WebSocket URL for target');

    return new Promise((resolve, reject) => {
        import('ws').then(({ default: WebSocket }) => {
            const ws = new WebSocket(wsUrl);
            let messageId = 1;
            const pending = new Map();
            let settled = false;

            const connectionTimeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    rejectAllPending(new Error('Connection timeout'));
                    ws.terminate();
                    reject(new Error('CDP connection timeout'));
                }
            }, 8000);

            function rejectAllPending(err) {
                for (const { reject: rej } of pending.values()) {
                    try { rej(err); } catch (e) { }
                }
                pending.clear();
            }

            ws.on('open', () => {
                if (settled) return;
                settled = true;
                clearTimeout(connectionTimeout);
                const client = {
                    send: (method, params = {}) => {
                        return new Promise((res, rej) => {
                            const id = messageId++;
                            pending.set(id, { resolve: res, reject: rej });
                            ws.send(JSON.stringify({ id, method, params }));
                        });
                    },
                    close: () => ws.close(),
                    ws
                };
                resolve(client);
            });

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.id && pending.has(msg.id)) {
                        const { resolve, reject } = pending.get(msg.id);
                        pending.delete(msg.id);
                        if (msg.error) reject(new Error(msg.error.message));
                        else resolve(msg.result);
                    }
                } catch (e) { }
            });

            ws.on('error', (err) => {
                clearTimeout(connectionTimeout);
                rejectAllPending(err);
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            });

            ws.on('close', () => {
                rejectAllPending(new Error('WebSocket closed'));
            });
        }).catch(reject);
    });
}

/**
 * Capture screenshot of the current page
 * Returns base64-encoded PNG
 */
export async function captureScreenshot(options = {}) {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Page.captureScreenshot', {
            format: options.format || 'png',
            quality: options.quality || 80,
            captureBeyondViewport: false
        });

        return result.data; // base64 string
    } finally {
        client.close();
    }
}

/**
 * Get page dimensions
 */
export async function getPageMetrics() {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const metrics = await client.send('Page.getLayoutMetrics');
        return metrics;
    } finally {
        client.close();
    }
}

/**
 * Inject text into the agent input field
 */
export async function injectCommand(text) {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        // First, try to find and focus the input field
        await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    // Look for common input selectors in VS Code-like editors
                    const selectors = [
                        'textarea.inputarea',
                        'textarea[aria-label*="input"]',
                        'div[contenteditable="true"]',
                        '.monaco-inputbox textarea',
                        'textarea'
                    ];
                    
                    for (const sel of selectors) {
                        const el = document.querySelector(sel);
                        if (el) {
                            el.focus();
                            return { found: true, selector: sel };
                        }
                    }
                    
                    // If no textarea, try to click the input area
                    const inputArea = document.querySelector('.input-area, .chat-input, [class*="input"]');
                    if (inputArea) {
                        inputArea.click();
                        return { found: true, clicked: true };
                    }
                    
                    return { found: false };
                })()
            `,
            returnByValue: true
        });

        // Small delay for focus
        await new Promise(r => setTimeout(r, 100));

        // Type each character
        for (const char of text) {
            await client.send('Input.dispatchKeyEvent', {
                type: 'keyDown',
                text: char,
                key: char,
                code: `Key${char.toUpperCase()}`
            });
            await client.send('Input.dispatchKeyEvent', {
                type: 'keyUp',
                key: char,
                code: `Key${char.toUpperCase()}`
            });
        }

        return { success: true, injected: text };
    } finally {
        client.close();
    }
}

/**
 * Inject text and press Enter to submit
 */
export async function injectAndSubmit(text) {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        // Use insertText for bulk text (more reliable)
        await client.send('Input.insertText', { text });

        // Small delay
        await new Promise(r => setTimeout(r, 50));

        // Press Enter
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13
        });
        await client.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13
        });

        return { success: true, submitted: text };
    } finally {
        client.close();
    }
}

/**
 * Focus the input area (click to activate)
 */
export async function focusInput() {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    // Try multiple strategies to focus input
                    
                    // Strategy 1: Find textarea
                    const textarea = document.querySelector('textarea');
                    if (textarea) {
                        textarea.focus();
                        textarea.click();
                        return { method: 'textarea', success: true };
                    }
                    
                    // Strategy 2: Find contenteditable
                    const editable = document.querySelector('[contenteditable="true"]');
                    if (editable) {
                        editable.focus();
                        editable.click();
                        return { method: 'contenteditable', success: true };
                    }
                    
                    // Strategy 3: Simulate keyboard shortcut Ctrl+L or similar
                    document.body.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'l',
                        code: 'KeyL',
                        ctrlKey: true,
                        bubbles: true
                    }));
                    
                    return { method: 'keyboard_shortcut', success: true };
                })()
            `,
            returnByValue: true
        });

        return result.result?.value || { success: false };
    } finally {
        client.close();
    }
}

/**
 * Check if CDP is available
 */
export async function isAvailable() {
    try {
        const version = await getVersion();
        return { available: true, browser: version.Browser };
    } catch (e) {
        return { available: false, error: e.message };
    }
}

/**
 * Scrape chat messages from the Antigravity UI
 * Returns array of { role: 'user'|'agent', content: string, timestamp: string }
 */
export async function getChatMessages() {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    const messages = [];
                    
                    // Blacklist patterns - things to ignore
                    const blacklist = [
                        /^(gemini|claude|gpt|model|opus|sonnet|flash)/i,
                        /^(pro|low|high|medium|thinking)/i,
                        /^(submit|cancel|dismiss|retry)/i,
                        /^(planning|execution|verification)/i,
                        /^(agent|assistant|user)$/i,
                        /^\\d+:\\d+/,  // timestamps like 3:35 AM
                        /terminated due to error/i,
                        /troubleshooting guide/i,
                        /can plan before executing/i,
                        /deep research.*complex tasks/i,
                        /conversation mode/i,
                        /fast agent/i,
                        /\\(thinking\\)/i,
                        /ask anything/i,
                        /add context/i,
                        /workflows/i,
                        /mentions/i
                    ];
                    
                    function isBlacklisted(text) {
                        const trimmed = text.trim();
                        if (trimmed.length < 20) return true; // Too short
                        if (trimmed.split(' ').length < 4) return true; // Not enough words
                        
                        for (const pattern of blacklist) {
                            if (pattern.test(trimmed)) return true;
                        }
                        return false;
                    }
                    
                    // Look specifically for conversation content
                    // Target the main chat/agent panel area
                    const conversationSelectors = [
                        // Specific conversation containers
                        '.conversation-content',
                        '.agent-response',
                        '.assistant-message',
                        '.user-query',
                        // Monaco editor markers
                        '[data-mode-id] .view-lines',
                        // Fallback - look in right panel
                        '.auxiliary-bar .content',
                        '.panel-content'
                    ];
                    
                    // Try to find conversation elements
                    for (const sel of conversationSelectors) {
                        const els = document.querySelectorAll(sel);
                        for (const el of els) {
                            const text = el.innerText?.trim();
                            if (text && !isBlacklisted(text) && text.length > 30 && text.length < 5000) {
                                // Check if it looks like a conversation message
                                const hasProperSentences = /[.!?]/.test(text);
                                const wordCount = text.split(/\\s+/).length;
                                
                                if (hasProperSentences && wordCount > 5) {
                                    const classStr = (el.className || '').toLowerCase();
                                    let role = 'agent';
                                    if (classStr.includes('user') || classStr.includes('human')) {
                                        role = 'user';
                                    }
                                    
                                    messages.push({
                                        role,
                                        content: text.substring(0, 1500),
                                        timestamp: new Date().toISOString()
                                    });
                                }
                            }
                        }
                        if (messages.length > 0) break;
                    }
                    
                    return { 
                        messages: messages.slice(-20), 
                        count: messages.length,
                        note: 'Use MCP broadcast_interaction for reliable chat streaming'
                    };
                })()
            `,
            returnByValue: true
        });

        return result.result?.value || { messages: [], count: 0 };
    } finally {
        client.close();
    }
}

/**
 * Get the current agent panel/chat content as text
 */
export async function getAgentPanelContent() {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    // Look for the agent panel or chat view
                    const panelSelectors = [
                        '.agent-panel',
                        '.chat-panel', 
                        '[class*="agent"]',
                        '[class*="chat-view"]',
                        '.panel.right',
                        '.sidebar-right',
                        '.auxiliary-bar'
                    ];
                    
                    for (const sel of panelSelectors) {
                        const panel = document.querySelector(sel);
                        if (panel) {
                            return {
                                found: true,
                                selector: sel,
                                content: panel.innerText?.substring(0, 5000) || '',
                                html: panel.innerHTML?.substring(0, 10000) || ''
                            };
                        }
                    }
                    
                    // Fallback: get all visible text
                    return {
                        found: false,
                        content: document.body.innerText?.substring(0, 5000) || ''
                    };
                })()
            `,
            returnByValue: true
        });

        return result.result?.value || { found: false, content: '' };
    } finally {
        client.close();
    }
}

/**
 * Get all visible conversation text from the right-side panel/chat area
 * This looks for the actual rendered conversation content
 */
export async function getConversationText() {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    // Get text from the right side of the window (where chat typically is)
                    const rightPanel = document.querySelector('.split-view-container .split-view-view:last-child') 
                        || document.querySelector('.editor-group-container + *')
                        || document.querySelector('.auxiliary-bar-content')
                        || document.querySelector('[id*="workbench.panel"]');
                    
                    if (rightPanel) {
                        const text = rightPanel.innerText || '';
                        // Split into potential messages based on patterns
                        const lines = text.split('\\n').filter(l => l.trim().length > 20);
                        
                        return {
                            found: true,
                            rawText: text.substring(0, 8000),
                            lines: lines.slice(0, 50)
                        };
                    }
                    
                    // Try to get any visible markdown/rendered content
                    const markdownContainers = document.querySelectorAll('.rendered-markdown, .markdown-body, [class*="markdown"]');
                    if (markdownContainers.length > 0) {
                        const texts = Array.from(markdownContainers).map(el => el.innerText).filter(t => t.length > 30);
                        return {
                            found: true,
                            source: 'markdown',
                            lines: texts.slice(0, 20)
                        };
                    }
                    
                    return { found: false };
                })()
            `,
            returnByValue: true
        });

        return result.result?.value || { found: false };
    } finally {
        client.close();
    }
}

/**
 * Get the current workspace path from Antigravity IDE
 * Extracts the workspace folder from open file paths in the IDE
 */
/**
 * Get the current workspace path from Antigravity IDE
 * Extracts the workspace folder from open file paths in the IDE
 * Cross-platform: supports Windows, Mac, and Linux
 */
export async function getWorkspacePath() {
    const target = await findEditorTarget();
    if (!target) return null;

    // Extract project name from title: "ProjectName — filename" or "ProjectName - Antigravity - filename"
    const titleMatch = target.title.match(/^([^\u2014-]+)\s*[\u2014-]/);
    const projectName = titleMatch ? titleMatch[1].trim() : (preferredWorkspace || null);

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                (function() {
                    try {
                        var tabs = document.querySelectorAll('[role="tab"], [class*="tab-label"], .tab');
                        for (var i = 0; i < tabs.length; i++) {
                            var tab = tabs[i];
                            var ariaLabel = tab.getAttribute('aria-label') || '';
                            var title = tab.getAttribute('title') || '';
                            var sources = [ariaLabel, title];
                            
                            for (var j = 0; j < sources.length; j++) {
                                var src = sources[j];
                                if (!src || src.length < 5) continue;
                                
                                // Windows: look for C: or D: pattern
                                for (var k = 0; k < src.length - 1; k++) {
                                    var ch = src.charAt(k);
                                    var next = src.charAt(k + 1);
                                    if (((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) && next === ':') {
                                        var pathPart = src.substring(k);
                                        var delims = [',', ';', ' - '];
                                        var endIdx = pathPart.length;
                                        for (var d = 0; d < delims.length; d++) {
                                            var idx = pathPart.indexOf(delims[d]);
                                            if (idx > 0 && idx < endIdx) endIdx = idx;
                                        }
                                        return { path: pathPart.substring(0, endIdx).trim(), source: 'tab', isWindows: true };
                                    }
                                }
                                
                                // Unix: /home, /Users, etc.
                                var unixRoots = ['/home/', '/Users/', '/var/', '/opt/'];
                                for (var u = 0; u < unixRoots.length; u++) {
                                    var idx = src.indexOf(unixRoots[u]);
                                    if (idx >= 0) {
                                        var pathPart = src.substring(idx);
                                        var endIdx = pathPart.length;
                                        var delims = [',', ';', ' - ', "'", '"'];
                                        for (var d = 0; d < delims.length; d++) {
                                            var di = pathPart.indexOf(delims[d]);
                                            if (di > 0 && di < endIdx) endIdx = di;
                                        }
                                        return { path: pathPart.substring(0, endIdx).trim(), source: 'tab', isWindows: false };
                                    }
                                }
                            }
                        }
                        
                        // Method 2: data-uri
                        var uris = document.querySelectorAll('[data-uri]');
                        for (var i = 0; i < uris.length; i++) {
                            var uri = uris[i].getAttribute('data-uri');
                            if (uri && uri.indexOf('file:///') === 0) {
                                try {
                                    var decoded = decodeURIComponent(uri.substring(8));
                                    var isWin = decoded.length > 1 && decoded.charAt(1) === ':';
                                    if (isWin) decoded = decoded.split('/').join(String.fromCharCode(92));
                                    return { path: decoded, source: 'data-uri', isWindows: isWin };
                                } catch(e) {}
                            }
                        }
                        
                        return { path: null, error: 'No path found' };
                    } catch (err) {
                        return { path: null, error: err.message };
                    }
                })()
            `,
            returnByValue: true
        });

        const data = result.result?.value;

        if (!data?.path) {
            return null;
        }

        const filePath = data.path;
        const isWindows = data.isWindows;
        const sep = isWindows ? /[\\/]+/ : /\/+/;
        const pathParts = filePath.split(sep).filter(Boolean);

        if (projectName) {
            for (let i = 0; i < pathParts.length; i++) {
                if (pathParts[i].toLowerCase() === projectName.toLowerCase()) {
                    return isWindows
                        ? pathParts[0] + '\\' + pathParts.slice(1, i + 1).join('\\')
                        : '/' + pathParts.slice(0, i + 1).join('/');
                }
            }
        }

        // Fallback: parent directory of the detected file
        const parentParts = pathParts.slice(0, -1);
        return isWindows
            ? parentParts[0] + '\\' + parentParts.slice(1).join('\\')
            : '/' + parentParts.join('/');

    } finally {
        client.close();
    }
}

/**
 * Get the current model and mode from the IDE input area
 * Searches through all execution contexts (including webviews) to find the model selector
 * Returns: { model: string, mode: string }
 */
export async function getModelAndMode() {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    return new Promise(async (resolve) => {
        const { default: WebSocket } = await import('ws');
        const ws = new WebSocket(target.webSocketDebuggerUrl);

        const contexts = [];
        let messageId = 1;
        const pending = new Map();

        const call = (method, params = {}) => new Promise((res, rej) => {
            const id = messageId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
            // Timeout after 3s
            setTimeout(() => {
                if (pending.has(id)) {
                    pending.delete(id);
                    rej(new Error('Timeout'));
                }
            }, 3000);
        });

        ws.on('message', (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.id && pending.has(data.id)) {
                    const { resolve, reject } = pending.get(data.id);
                    pending.delete(data.id);
                    if (data.error) reject(new Error(data.error.message));
                    else resolve(data.result);
                } else if (data.method === 'Runtime.executionContextCreated') {
                    contexts.push(data.params.context);
                }
            } catch (e) { }
        });

        ws.on('open', async () => {
            try {
                // Enable runtime to receive execution context events
                await call('Runtime.enable', {});
                await new Promise(r => setTimeout(r, 500)); // Let contexts load

                const SCRIPT = `
                    (function() {
                        let model = null;
                        let mode = null;
                        
                        // Look for model selector - it's a P or SPAN with class containing "ellipsis"
                        // The text is like "Claude Opus 4.6 (Thinking)" without chevron
                        const allElements = document.querySelectorAll('p, span, div, button');
                        
                        for (const el of allElements) {
                            const text = (el.innerText || el.textContent || '').trim();
                            
                            // Skip empty or very long text (min 4 chars for "Fast")
                            if (text.length < 4 || text.length > 50) continue;
                            
                            // Check for model patterns (Claude/Gemini/GPT + variant)
                            if (!model && /^(claude|gemini|gpt)/i.test(text) && 
                                /(opus|sonnet|flash|pro|thinking|high|low|medium)/i.test(text)) {
                                model = text;
                            }
                            
                            // Check for mode - take first match (selected mode appears before dropdown)
                            // The selected mode is typically the first occurrence in DOM order
                            if (!mode && /^(planning|fast)$/i.test(text)) {
                                mode = text;
                            }
                            
                            if (model && mode) break;
                        }
                        
                        return { 
                            model: model || null,
                            mode: mode || null
                        };
                    })()
                `;

                // Search all execution contexts for model/mode
                for (const ctx of contexts) {
                    try {
                        const result = await call('Runtime.evaluate', {
                            expression: SCRIPT,
                            returnByValue: true,
                            contextId: ctx.id
                        });

                        if (result.result?.value?.model) {
                            ws.close();
                            resolve(result.result.value);
                            return;
                        }
                    } catch (e) { }
                }

                // If no context had model, return default
                ws.close();
                resolve({ model: 'Unknown', mode: 'Planning' });
            } catch (e) {
                ws.close();
                resolve({ model: 'Unknown', mode: 'Planning' });
            }
        });

        ws.on('error', () => {
            resolve({ model: 'Unknown', mode: 'Planning' });
        });
    });
}

/**
 * Get list of available models
 * Returns: { models: string[], current: string }
 * Note: Returns hardcoded list since dynamic scraping was picking up wrong UI elements
 */
export async function getAvailableModels() {
    // Known models for Antigravity - these are the models the IDE supports
    const knownModels = [
        'Gemini 3.1 Pro (High)',
        'Gemini 3.1 Pro (Low)',
        'Gemini 3 Flash',
        'Claude Sonnet 4.6',
        'Claude Sonnet 4.6 (Thinking)',
        'Claude Opus 4.6 (Thinking)',
        'GPT-OSS 120B (Medium)'
    ];

    // Get current model/mode from the actual UI
    try {
        const current = await getModelAndMode();
        return {
            models: knownModels,
            current: current.model || 'Unknown'
        };
    } catch (e) {
        return {
            models: knownModels,
            current: 'Unknown'
        };
    }
}

/**
 * Set the active model by clicking dropdown and selecting option
 * Searches through all execution contexts (including webviews)
 */
export async function setModel(modelName) {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    return new Promise(async (resolve) => {
        const { default: WebSocket } = await import('ws');
        const ws = new WebSocket(target.webSocketDebuggerUrl);

        const contexts = [];
        let messageId = 1;
        const pending = new Map();

        const call = (method, params = {}) => new Promise((res, rej) => {
            const id = messageId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (pending.has(id)) {
                    pending.delete(id);
                    rej(new Error('Timeout'));
                }
            }, 5000);
        });

        ws.on('message', (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.id && pending.has(data.id)) {
                    const { resolve, reject } = pending.get(data.id);
                    pending.delete(data.id);
                    if (data.error) reject(new Error(data.error.message));
                    else resolve(data.result);
                } else if (data.method === 'Runtime.executionContextCreated') {
                    contexts.push(data.params.context);
                }
            } catch (e) { }
        });

        ws.on('open', async () => {
            try {
                await call('Runtime.enable', {});
                await new Promise(r => setTimeout(r, 500));

                const SCRIPT = `
                    (async function() {
                        const targetModel = ${JSON.stringify(modelName)}.toLowerCase();
                        console.log('[MobileSetModel] Target:', targetModel);
                        
                        // Check if this context has the model selector (look for cascade)
                        // If we can't find cascade-related elements, this might be the wrong context, 
                        // but we should still try to find the model button just in case.
                        
                        // Find model selector button - look for P with ellipsis class containing model name
                        // OR looking for specific button-like elements that contain model keywords
                        let modelButton = null;
                        const allElements = document.querySelectorAll('button, div[role="button"], p, span');
                        
                        // Common model keywords to identify the button
                        const modelKeywords = ['gemini', 'claude', 'gpt', 'opus', 'sonnet', 'flash', 'model'];
                        
                        for (const el of allElements) {
                            const text = (el.innerText || '').trim().toLowerCase();
                            // Skip if too short or too long
                            if (text.length < 3 || text.length > 60) continue;
                            
                            if (modelKeywords.some(k => text.includes(k))) {
                                // Found a potential label/text. Find its clickable parent or itself.
                                const clickable = el.closest('button') || el.closest('[role="button"]') || el;
                                // If it's just a P tag with no clickable role/tag, it might not be the trigger,
                                // but often in this UI the P tag itself receives the click or is inside a div that does.
                                modelButton = clickable;
                                console.log('[MobileSetModel] Found model button:', text);
                                break;
                            }
                        }
                        
                        if (!modelButton) {
                            console.log('[MobileSetModel] Model button not found');
                            return { found: true, success: false, error: 'Model button not found' };
                        }
                        
                        // Click to open dropdown
                        console.log('[MobileSetModel] Clicking model button...');
                        modelButton.click();
                        
                        // Wait for dropdown to appear - increased to ensure render
                        await new Promise(r => setTimeout(r, 600));
                        
                        // Try to find the option in the dropdown
                        // The actual clickable items have cursor-pointer class
                        
                        // Collect all potential items first
                        let candidates = [];
                        
                        // Helper to get normalized text
                        const getNorm = (el) => (el.innerText || el.textContent || '').trim().toLowerCase();

                        // First, look for elements with cursor-pointer (the actual clickable items)
                        const cursorPointerItems = document.querySelectorAll('[class*="cursor-pointer"]');
                        console.log('[MobileSetModel] Found', cursorPointerItems.length, 'cursor-pointer elements');
                        
                        for (const item of cursorPointerItems) {
                            const text = getNorm(item);
                            // Look for model name patterns in the text
                            if (text.length > 3 && text.length < 100 && 
                                modelKeywords.some(k => text.includes(k))) {
                                candidates.push({ el: item, text });
                                console.log('[MobileSetModel] Cursor-pointer candidate:', text.substring(0, 50));
                            }
                        }
                        
                        // If no cursor-pointer items found with model keywords, fall back to role-based selectors
                        if (candidates.length === 0) {
                            const menuSelectors = [
                                '[role="listbox"] [role="option"]',
                                '[role="menu"] [role="menuitem"]',
                                '.monaco-list-row',
                                '.action-item'
                            ];
                            
                            for (const sel of menuSelectors) {
                                const items = document.querySelectorAll(sel);
                                for (const item of items) {
                                    const text = getNorm(item);
                                    if (text.length > 3 && text.length < 80) {
                                      if (!candidates.some(c => c.el === item)) {
                                          candidates.push({ el: item, text });
                                      }
                                    }
                                }
                                if (candidates.length > 0) break; 
                            }
                        }
                        
                        console.log('[MobileSetModel] Total candidates:', candidates.length);

                        console.log('[MobileSetModel] Found', candidates.length, 'candidates:', candidates.slice(0, 10).map(c => c.text));

                        // Now find the best candidate
                        let bestMatch = null;
                        
                        // targetModel e.g. "Claude Sonnet 4.6"
                        // Split by non-alphanumeric to handle punctuation differences
                        const targetParts = targetModel.split(/[^a-z0-9]+/i).filter(p => p.length > 1);
                        console.log('[MobileSetModel] Target parts:', targetParts);
                        
                        for (const cand of candidates) {
                            const candText = cand.text;
                            
                            // Check 1: Exact match?
                            if (candText === targetModel) {
                                bestMatch = cand.el;
                                console.log('[MobileSetModel] Exact match found!');
                                break;
                            }
                            
                            // Check 2: Contains all parts?
                            // e.g. target="Claude Sonnet 4.6", cand="claude 3.5 sonnet" -> matches "claude", "sonnet"
                            // We need to be careful not to match "gemini pro" against "gemini flash"
                            
                            const allPartsMatch = targetParts.every(part => candText.includes(part));
                            
                            if (allPartsMatch) {
                                bestMatch = cand.el;
                                console.log('[MobileSetModel] All parts match:', candText);
                                break;
                            }
                            
                            // Check 3: Relaxed match
                            // If we match the first word (Model Family) AND at least one other significant word
                            if (targetParts.length >= 2) {
                                if (candText.includes(targetParts[0])) {
                                    // Check for other parts
                                    let matchCount = 0;
                                    for (let i = 1; i < targetParts.length; i++) {
                                        if (candText.includes(targetParts[i])) matchCount++;
                                    }
                                    
                                    // If we matched Family + >50% of variant words
                                    if (matchCount >= (targetParts.length - 1) / 2) {
                                        bestMatch = cand.el;
                                        console.log('[MobileSetModel] Relaxed match:', candText);
                                    }
                                }
                            }
                        }
                        
                        if (bestMatch) {
                             console.log('[MobileSetModel] Clicking:', bestMatch.innerText);
                             const debugInfo = {
                                 tagName: bestMatch.tagName,
                                 className: bestMatch.className,
                                 outerHTML: bestMatch.outerHTML.substring(0, 200)
                             };
                             bestMatch.scrollIntoView({block: 'center', inline: 'center'});
                             await new Promise(r => setTimeout(r, 100)); // Wait for scroll
                             bestMatch.click();
                             return { found: true, success: true, selected: bestMatch.innerText, debug: debugInfo };
                        }
                        
                        console.log('[MobileSetModel] No match found!');
                        
                        // Try pressing Escape to close dropdown if we failed
                        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                        return { found: true, success: false, error: 'Model option not found' };
                    })()
                `;

                // Search all execution contexts for the model selector
                for (const ctx of contexts) {
                    try {
                        const result = await call('Runtime.evaluate', {
                            expression: SCRIPT,
                            returnByValue: true,
                            awaitPromise: true,
                            contextId: ctx.id
                        });

                        if (result.result?.value?.found) {
                            ws.close();
                            resolve(result.result.value);
                            return;
                        }
                    } catch (e) { }
                }

                ws.close();
                resolve({ success: false, error: 'Webview context not found' });
            } catch (e) {
                ws.close();
                resolve({ success: false, error: e.message });
            }
        });

        ws.on('error', () => {
            resolve({ success: false, error: 'WebSocket error' });
        });
    });
}

/**
 * Get available conversation modes
 * Returns: { modes: [{name, description}], current: string }
 */
export async function getAvailableModes() {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    const client = await connectToTarget(target);

    try {
        const result = await client.send('Runtime.evaluate', {
            expression: `
                    (function () {
                        // Known modes
                        const knownModes = [
                            { name: 'Planning', description: 'Agent can plan before executing. Use for deep research, complex tasks.' },
                            { name: 'Fast', description: 'Agent will execute tasks directly. Use for simple tasks.' }
                        ];

                        // Try to find current mode
                        let currentMode = null;
                        const modeKeywords = ['planning', 'fast'];

                        const buttons = document.querySelectorAll('button, [role="button"]');
                        for (const btn of buttons) {
                            const text = (btn.innerText || btn.textContent || '').toLowerCase();
                            if (modeKeywords.some(k => text.includes(k))) {
                                currentMode = btn.innerText || btn.textContent;
                                break;
                            }
                        }

                        return {
                            modes: knownModes,
                            current: currentMode ? currentMode.trim() : 'Planning'
                        };
                    })()
                    `,
            returnByValue: true
        });

        return result.result?.value || { modes: [], current: 'Unknown' };
    } finally {
        client.close();
    }
}

/**
 * Set the conversation mode
 * Searches through all execution contexts (including webviews) to find the mode selector
 */
export async function setMode(modeName) {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    return new Promise(async (resolve) => {
        const { default: WebSocket } = await import('ws');
        const ws = new WebSocket(target.webSocketDebuggerUrl);

        const contexts = [];
        let messageId = 1;
        const pending = new Map();

        const call = (method, params = {}) => new Promise((res, rej) => {
            const id = messageId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (pending.has(id)) {
                    pending.delete(id);
                    rej(new Error('Timeout'));
                }
            }, 5000);
        });

        ws.on('message', (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.id && pending.has(data.id)) {
                    const { resolve, reject } = pending.get(data.id);
                    pending.delete(data.id);
                    if (data.error) reject(new Error(data.error.message));
                    else resolve(data.result);
                } else if (data.method === 'Runtime.executionContextCreated') {
                    contexts.push(data.params.context);
                }
            } catch (e) { }
        });

        ws.on('open', async () => {
            try {
                await call('Runtime.enable', {});
                await new Promise(r => setTimeout(r, 500));

                const SCRIPT = `
                    (async function() {
                        const targetMode = ${JSON.stringify(modeName)}.toLowerCase();
                        console.log('[MobileSetMode] Target:', targetMode);
                        
                        // Find mode button - look for Planning/Fast text
                        const modeKeywords = ['planning', 'fast'];
                        let modeButton = null;
                        const allElements = document.querySelectorAll('button, div[role="button"], p, span');
                        
                        for (const el of allElements) {
                            const text = (el.innerText || '').trim().toLowerCase();
                            if (text.length < 2 || text.length > 30) continue;
                            
                            if (modeKeywords.some(k => text === k || text.startsWith(k))) {
                                const clickable = el.closest('button') || el.closest('[role="button"]') || el;
                                modeButton = clickable;
                                console.log('[MobileSetMode] Found mode button:', text);
                                break;
                            }
                        }
                        
                        if (!modeButton) {
                            console.log('[MobileSetMode] Mode button not found');
                            return { found: true, success: false, error: 'Mode button not found' };
                        }
                        
                        // Click to open dropdown
                        console.log('[MobileSetMode] Clicking mode button...');
                        modeButton.click();
                        
                        // Wait for dropdown to appear
                        await new Promise(r => setTimeout(r, 600));
                        
                        // Look for cursor-pointer elements in the dropdown
                        let candidates = [];
                        let allCursorPointerTexts = [];
                        const getNorm = (el) => (el.innerText || el.textContent || '').trim().toLowerCase();
                        
                        const cursorPointerItems = document.querySelectorAll('[class*="cursor-pointer"]');
                        console.log('[MobileSetMode] Found', cursorPointerItems.length, 'cursor-pointer elements');
                        
                        // First collect ALL cursor-pointer element texts for debugging
                        for (const item of cursorPointerItems) {
                            const text = getNorm(item);
                            if (text.length > 1 && text.length < 150) {
                                allCursorPointerTexts.push(text.substring(0, 60));
                                // Add to candidates if it looks like a mode option
                                // (either contains mode keywords OR is short text that could be a mode name)
                                if (modeKeywords.some(k => text.includes(k)) || 
                                    text.length < 30) {
                                    candidates.push({ el: item, text });
                                    console.log('[MobileSetMode] Candidate:', text.substring(0, 50));
                                }
                            }
                        }
                        
                        console.log('[MobileSetMode] All cursor-pointer texts:', allCursorPointerTexts);
                        console.log('[MobileSetMode] Total candidates:', candidates.length);
                        
                        // Find best match
                        let bestMatch = null;
                        for (const cand of candidates) {
                            if (cand.text.includes(targetMode)) {
                                bestMatch = cand.el;
                                console.log('[MobileSetMode] Match found:', cand.text);
                                break;
                            }
                        }
                        
                        if (bestMatch) {
                            console.log('[MobileSetMode] Clicking:', bestMatch.innerText);
                            const debugInfo = {
                                tagName: bestMatch.tagName,
                                className: bestMatch.className,
                                outerHTML: bestMatch.outerHTML.substring(0, 200)
                            };
                            bestMatch.scrollIntoView({block: 'center', inline: 'center'});
                            await new Promise(r => setTimeout(r, 100));
                            bestMatch.click();
                            return { found: true, success: true, selected: bestMatch.innerText, debug: debugInfo };
                        }
                        
                        console.log('[MobileSetMode] No match found!');
                        const candidateTexts = candidates.map(c => c.text.substring(0, 50));
                        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                        return { found: true, success: false, error: 'Mode option not found', candidatesFound: candidateTexts, allTexts: allCursorPointerTexts.slice(0, 10) };
                    })()
                `;

                // Search all execution contexts
                for (const ctx of contexts) {
                    try {
                        const result = await call('Runtime.evaluate', {
                            expression: SCRIPT,
                            returnByValue: true,
                            awaitPromise: true,
                            contextId: ctx.id
                        });

                        if (result.result?.value?.found) {
                            ws.close();
                            resolve(result.result.value);
                            return;
                        }
                    } catch (e) { }
                }

                ws.close();
                resolve({ success: false, error: 'Webview context not found' });
            } catch (e) {
                ws.close();
                resolve({ success: false, error: e.message });
            }
        });

        ws.on('error', () => {
            resolve({ success: false, error: 'WebSocket error' });
        });
    });
}

/**
 * Get pending command approvals from the IDE
 * Returns info about commands waiting for user input
 */
export async function getPendingApprovals() {
    const target = await findEditorTarget();
    if (!target) return { pending: false, count: 0, error: 'No editor target' };

    return new Promise(async (resolve) => {
        const { default: WebSocket } = await import('ws');
        const ws = new WebSocket(target.webSocketDebuggerUrl);

        const contexts = [];
        let messageId = 1;
        const pending = new Map();

        const call = (method, params = {}) => new Promise((res, rej) => {
            const id = messageId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (pending.has(id)) {
                    pending.delete(id);
                    rej(new Error('Timeout'));
                }
            }, 5000);
        });

        ws.on('message', (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.id && pending.has(data.id)) {
                    const { resolve, reject } = pending.get(data.id);
                    pending.delete(data.id);
                    if (data.error) reject(new Error(data.error.message));
                    else resolve(data.result);
                } else if (data.method === 'Runtime.executionContextCreated') {
                    contexts.push(data.params.context);
                }
            } catch (e) { }
        });

        ws.on('open', async () => {
            try {
                await call('Runtime.enable', {});
                await new Promise(r => setTimeout(r, 500));

                const SCRIPT = `
                    (function() {
                        // Look for various approval/input indicators
                        const allText = document.body.innerText || '';
                        
                        // Check for multiple patterns that indicate pending approval
                        // Pattern 1: "X step requires input" (original)
                        const hasStepRequiresInput = /\\d+\\s*step.*requires.*input/i.test(allText);
                        // Pattern 2: "Suggested sending input to command" 
                        const hasSendingInput = /suggested.*sending.*input.*command/i.test(allText);
                        // Pattern 3: "Send command input?"
                        const hasSendCommandInput = /send.*command.*input/i.test(allText);
                        
                        const hasPendingApproval = hasStepRequiresInput || hasSendingInput || hasSendCommandInput;
                        
                        if (!hasPendingApproval) {
                            return { found: true, pending: false, count: 0, debug: { allTextSample: allText.substring(0, 500) } };
                        }
                        
                        // Extract the count if possible (for "X step requires input" pattern)
                        const match = allText.match(/(\\d+)\\s*step.*requires.*input/i);
                        const count = match ? parseInt(match[1]) : 1;
                        
                        // Look for approve/reject buttons
                        // Common patterns: "Run", "Accept", "Approve", "Yes", "Cancel", "Reject", "No"
                        const buttons = document.querySelectorAll('button, [role="button"], [class*="cursor-pointer"]');
                        let approveBtn = null;
                        let rejectBtn = null;
                        
                        const approveKeywords = ['run', 'accept', 'approve', 'yes', 'confirm', 'allow'];
                        const rejectKeywords = ['cancel', 'reject', 'no', 'deny', 'skip'];
                        
                        for (const btn of buttons) {
                            const text = (btn.innerText || btn.textContent || '').toLowerCase().trim();
                            if (text.length < 20) {
                                if (approveKeywords.some(k => text === k || text.includes(k))) {
                                    approveBtn = { text, found: true };
                                }
                                if (rejectKeywords.some(k => text === k || text.includes(k))) {
                                    rejectBtn = { text, found: true };
                                }
                            }
                        }
                        
                        return {
                            found: true,
                            pending: true,
                            count: count,
                            approveButton: approveBtn,
                            rejectButton: rejectBtn
                        };
                    })()
                `;

                for (const ctx of contexts) {
                    try {
                        const result = await call('Runtime.evaluate', {
                            expression: SCRIPT,
                            returnByValue: true,
                            contextId: ctx.id
                        });

                        if (result.result?.value?.found && result.result.value.pending) {
                            ws.close();
                            resolve(result.result.value);
                            return;
                        }
                    } catch (e) { }
                }

                ws.close();
                resolve({ pending: false, count: 0 });
            } catch (e) {
                ws.close();
                resolve({ pending: false, count: 0, error: e.message });
            }
        });

        ws.on('error', () => {
            resolve({ pending: false, count: 0, error: 'WebSocket error' });
        });
    });
}

/**
 * Respond to a pending approval (approve or reject)
 */
export async function respondToApproval(action) {
    const target = await findEditorTarget();
    if (!target) return { success: false, error: 'No editor target' };

    return new Promise(async (resolve) => {
        const { default: WebSocket } = await import('ws');
        const ws = new WebSocket(target.webSocketDebuggerUrl);

        const contexts = [];
        let messageId = 1;
        const pending = new Map();

        const call = (method, params = {}) => new Promise((res, rej) => {
            const id = messageId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (pending.has(id)) {
                    pending.delete(id);
                    rej(new Error('Timeout'));
                }
            }, 5000);
        });

        ws.on('message', (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.id && pending.has(data.id)) {
                    const { resolve, reject } = pending.get(data.id);
                    pending.delete(data.id);
                    if (data.error) reject(new Error(data.error.message));
                    else resolve(data.result);
                } else if (data.method === 'Runtime.executionContextCreated') {
                    contexts.push(data.params.context);
                }
            } catch (e) { }
        });

        ws.on('open', async () => {
            try {
                await call('Runtime.enable', {});
                await new Promise(r => setTimeout(r, 500));

                const isApprove = action === 'approve';
                const keywords = isApprove
                    ? ['run', 'accept', 'approve', 'yes', 'confirm', 'allow']
                    : ['cancel', 'reject', 'no', 'deny', 'skip'];

                const SCRIPT = `
                    (async function() {
                        const keywords = ${JSON.stringify(keywords)};
                        const isApprove = ${isApprove};
                        
                        // Find buttons with matching text
                        const buttons = document.querySelectorAll('button, [role="button"], [class*="cursor-pointer"]');
                        let targetBtn = null;
                        
                        for (const btn of buttons) {
                            const text = (btn.innerText || btn.textContent || '').toLowerCase().trim();
                            if (text.length < 20 && keywords.some(k => text === k || text.includes(k))) {
                                targetBtn = btn;
                                break;
                            }
                        }
                        
                        if (targetBtn) {
                            targetBtn.scrollIntoView({ block: 'center' });
                            await new Promise(r => setTimeout(r, 100));
                            targetBtn.click();
                            return { 
                                found: true, 
                                success: true, 
                                action: isApprove ? 'approved' : 'rejected',
                                buttonText: targetBtn.innerText 
                            };
                        }
                        
                        return { found: true, success: false, error: 'Button not found' };
                    })()
                `;

                for (const ctx of contexts) {
                    try {
                        const result = await call('Runtime.evaluate', {
                            expression: SCRIPT,
                            returnByValue: true,
                            awaitPromise: true,
                            contextId: ctx.id
                        });

                        if (result.result?.value?.found && result.result.value.success) {
                            ws.close();
                            resolve(result.result.value);
                            return;
                        }
                    } catch (e) { }
                }

                ws.close();
                resolve({ success: false, error: 'Could not find approval button' });
            } catch (e) {
                ws.close();
                resolve({ success: false, error: e.message });
            }
        });

        ws.on('error', () => {
            resolve({ success: false, error: 'WebSocket error' });
        });
    });
}

/**
 * Click an element in the Antigravity chat by XPath
 * Searches all execution contexts for #cascade, then clicks the element
 */
export async function clickElementByXPath(xpath) {
    const target = await findEditorTarget();
    if (!target) throw new Error('No editor target found');

    return new Promise(async (resolve) => {
        const { default: WebSocket } = await import('ws');
        const ws = new WebSocket(target.webSocketDebuggerUrl);

        const contexts = [];
        let messageId = 1;
        const pending = new Map();

        const call = (method, params = {}) => new Promise((res, rej) => {
            const id = messageId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (pending.has(id)) { pending.delete(id); rej(new Error('Timeout')); }
            }, 4000);
        });

        ws.on('message', (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.id && pending.has(data.id)) {
                    const { resolve, reject } = pending.get(data.id);
                    pending.delete(data.id);
                    if (data.error) reject(new Error(data.error.message));
                    else resolve(data.result);
                } else if (data.method === 'Runtime.executionContextCreated') {
                    contexts.push(data.params.context);
                }
            } catch (e) { }
        });

        ws.on('open', async () => {
            try {
                await call('Runtime.enable', {});
                await new Promise(r => setTimeout(r, 400));

                const SCRIPT = `(() => {
                    const cascade = document.getElementById('cascade') || document.getElementById('conversation');
                    if (!cascade) return { found: false };
                    try {
                        const el = document.evaluate(
                            ${JSON.stringify(xpath)},
                            document,
                            null,
                            XPathResult.FIRST_ORDERED_NODE_TYPE,
                            null
                        ).singleNodeValue;
                        if (!el) return { found: true, clicked: false, error: 'XPath not found' };
                        el.click();
                        return { found: true, clicked: true, tag: el.tagName, text: (el.innerText || '').slice(0, 60) };
                    } catch(e) {
                        return { found: true, clicked: false, error: e.message };
                    }
                })()`;

                for (const ctx of contexts) {
                    try {
                        const result = await call('Runtime.evaluate', {
                            expression: SCRIPT,
                            returnByValue: true,
                            contextId: ctx.id
                        });
                        const val = result.result?.value;
                        if (val?.found) {
                            ws.close();
                            resolve(val.clicked
                                ? { success: true, tag: val.tag, text: val.text }
                                : { success: false, error: val.error });
                            return;
                        }
                    } catch (e) { }
                }

                ws.close();
                resolve({ success: false, error: 'Cascade context not found' });
            } catch (e) {
                ws.close();
                resolve({ success: false, error: e.message });
            }
        });

        ws.on('error', () => resolve({ success: false, error: 'WebSocket error' }));
    });
}
