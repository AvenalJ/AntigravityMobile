/**
 * Live Chat Stream - Captures the Antigravity chat via CDP
 * 
 * Based on Antigravity-Shit-Chat-master approach:
 * - Finds execution contexts in webviews
 * - Locates the #cascade element (chat container)
 * - Captures and streams HTML changes
 */

import WebSocket from 'ws';
import * as TelegramBot from './telegram-bot.mjs';
import * as Config from './config.mjs';
import { clickElementByXPath, getPreferredWorkspace } from './cdp-client.mjs';

// Notification state tracker (avoids duplicate alerts)
let lastNotifState = { inputNeeded: false, error: false, dialogError: false };
let lastHtmlForNotif = '';
let unchangedCount = 0;
let agentWasActive = false;
// Maps xpath → timestamp of click; entries expire after CLICK_EXPIRY_MS
const recentlyClickedXpaths = new Map();
const CLICK_EXPIRY_MS = 10000;
let autoAcceptCallback = null;
let debugCallback = null;
let errorCallback = null;

export function setAutoAcceptCallback(cb) { autoAcceptCallback = cb; }
export function setDebugCallback(cb) { debugCallback = cb; }
export function setErrorCallback(cb) { errorCallback = cb; }

const CDP_PORTS = [9222, 9333, 9000, 9001, 9002, 9003];

// State
let connection = null;
let onChatUpdate = null;
let pollInterval = null;
let lastHash = null;

/**
 * Simple hash function
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return hash.toString(36);
}

/**
 * Find CDP workbench targets
 * If a preferred workspace is configured, filters to that workspace's window
 */
async function findTargets() {
    const targets = [];
    const preferred = getPreferredWorkspace();

    for (const port of CDP_PORTS) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
                signal: AbortSignal.timeout(2000)
            });
            const list = await res.json();

            // Look for workbench pages
            const workbenches = list.filter(t =>
                t.url?.includes('workbench.html') ||
                t.title?.includes('Antigravity') ||
                t.type === 'page'
            );

            workbenches.forEach(t => targets.push({ ...t, port }));
        } catch (e) { /* port not available */ }
    }

    // If preferred workspace is set, filter to matching targets
    if (preferred && targets.length > 0) {
        const preferredTargets = targets.filter(t =>
            t.title?.toLowerCase().startsWith(preferred.toLowerCase() + ' ') ||
            t.title?.toLowerCase().startsWith(preferred.toLowerCase() + ' —') ||
            t.title?.toLowerCase() === preferred.toLowerCase()
        );
        if (preferredTargets.length > 0) {
            console.log(`🎯 Chat stream targeting workspace "${preferred}" (${preferredTargets.length} targets)`);
            return preferredTargets;
        }
        console.log(`⚠️ Preferred workspace "${preferred}" not found in chat targets, using all ${targets.length}`);
    }

    return targets;
}

/**
 * Connect to CDP and track execution contexts
 */
async function connectCDP(wsUrl) {
    const ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    let idCounter = 1;
    const contexts = [];
    let cascadeContextId = null;

    // Call CDP method
    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;
        const handler = (msg) => {
            const data = JSON.parse(msg.toString());
            if (data.id === id) {
                ws.off('message', handler);
                if (data.error) reject(new Error(data.error.message));
                else resolve(data.result);
            }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
    });

    // Track execution contexts
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data.method === 'Runtime.executionContextCreated') {
                contexts.push(data.params.context);
            } else if (data.method === 'Runtime.executionContextDestroyed') {
                const idx = contexts.findIndex(c => c.id === data.params.executionContextId);
                if (idx !== -1) contexts.splice(idx, 1);
            }
        } catch (e) { }
    });

    // Enable runtime to receive context events
    await call('Runtime.enable', {});
    await new Promise(r => setTimeout(r, 500)); // Let contexts load

    return { ws, call, contexts, getCascadeContextId: () => cascadeContextId, setCascadeContextId: (id) => cascadeContextId = id };
}

/**
 * Find the context that contains #cascade (the chat element)
 */
async function findCascadeContext(cdp) {
    const SCRIPT = `(() => {
        const cascade = document.getElementById('cascade') || document.getElementById('conversation');
        if (!cascade) return { found: false };
        return { 
            found: true,
            hasContent: cascade.children.length > 0
        };
    })()`;

    // Try cached context first
    if (cdp.getCascadeContextId()) {
        try {
            const res = await cdp.call('Runtime.evaluate', {
                expression: SCRIPT,
                returnByValue: true,
                contextId: cdp.getCascadeContextId()
            });
            if (res.result?.value?.found) {
                return cdp.getCascadeContextId();
            }
        } catch (e) {
            cdp.setCascadeContextId(null);
        }
    }

    // Search all contexts
    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call('Runtime.evaluate', {
                expression: SCRIPT,
                returnByValue: true,
                contextId: ctx.id
            });
            if (result.result?.value?.found) {
                cdp.setCascadeContextId(ctx.id);
                return ctx.id;
            }
        } catch (e) { }
    }

    return null;
}

/**
 * Capture the chat HTML + CSS from #cascade
 * Returns raw HTML with CSS to preserve exact IDE styling
 */
async function captureChat(cdp, contextId) {
    const SCRIPT = `(async () => {
        const cascade = document.getElementById('cascade') || document.getElementById('conversation');
        if (!cascade) return { error: 'cascade not found' };
        
        // --- PREPARE CLONE ---
        
        // Handle Terminal Canvas elements (xterm.js uses WebGL which can't be captured easily)
        // xterm.js has an accessibility layer that contains the actual text
        const terminalContainers = cascade.querySelectorAll('.xterm, [class*="terminal"], [class*="Terminal"]');
        const terminalTexts = [];
        
        terminalContainers.forEach((container, i) => {
            try {
                let text = '';
                
                // Priority 1: Look for xterm accessibility layer (has actual text)
                const accessibilityLayer = container.querySelector('.xterm-accessibility, [class*="accessibility"]');
                if (accessibilityLayer) {
                    const rows = accessibilityLayer.querySelectorAll('[role="listitem"], div');
                    const lines = [];
                    rows.forEach(row => {
                        const rowText = row.textContent;
                        if (rowText && rowText.trim() && !rowText.includes('{') && !rowText.includes(':')) {
                            lines.push(rowText);
                        }
                    });
                    text = lines.join('\\n');
                }
                
                // Priority 2: Look for xterm-rows (visible text layer)
                if (!text.trim()) {
                    const rowsLayer = container.querySelector('.xterm-rows');
                    if (rowsLayer) {
                        const rows = rowsLayer.querySelectorAll('div > span');
                        const lines = [];
                        rows.forEach(row => {
                            const rowText = row.textContent;
                            // Filter out CSS-like content
                            if (rowText && rowText.trim() && 
                                !rowText.includes('{') && 
                                !rowText.includes('background:') &&
                                !rowText.includes('.xterm')) {
                                lines.push(rowText);
                            }
                        });
                        text = lines.join('\\n');
                    }
                }
                
                // Priority 3: Look for pre/code elements (non-xterm terminals)
                if (!text.trim()) {
                    const preCode = container.querySelector('pre, code');
                    if (preCode) {
                        text = preCode.textContent || '';
                        // Filter out CSS content
                        if (text.includes('.xterm') || text.includes('background:')) {
                            text = '';
                        }
                    }
                }
                
                if (text.trim()) {
                    terminalTexts.push({
                        index: i,
                        text: text.trim(),
                        container: container
                    });
                }
            } catch(e) {}
        });
        
        // --- ANNOTATE INTERACTIVE ELEMENTS WITH XPATH ---
        // Tag every button/expandable with a unique id + xpath so mobile can forward clicks via CDP
        function getXPath(el) {
            if (!el || el === document.body) return '/html/body';
            const parts = [];
            let node = el;
            while (node && node.nodeType === 1) {
                let idx = 1;
                let sib = node.previousElementSibling;
                while (sib) { if (sib.tagName === node.tagName) idx++; sib = sib.previousElementSibling; }
                parts.unshift(node.tagName.toLowerCase() + '[' + idx + ']');
                node = node.parentElement;
            }
            return '/' + parts.join('/');
        }
        let mobileIdCounter = 0;
        const interactiveSelector = 'button, [role="button"], [aria-expanded], [data-collapsed], summary';
        cascade.querySelectorAll(interactiveSelector).forEach(el => {
            const mid = 'mid_' + (mobileIdCounter++);
            el.setAttribute('data-mid', mid);
            el.setAttribute('data-xpath', getXPath(el));
        });

        // Clone the cascade
        const clone = cascade.cloneNode(true);

        
        // --- CONVERT LOCAL IMAGES TO DATA URLs ---
        // IDE file-type icons use local URLs (vscode-file://, file://) that mobile can't access
        // Use fetch() to properly convert them (canvas fails due to cross-origin tainting)
        const origImages = cascade.querySelectorAll('img');
        const clonedImages = clone.querySelectorAll('img');
        const imgPromises = [];
        origImages.forEach((origImg, i) => {
            const clonedImg = clonedImages[i];
            if (!clonedImg) return;
            const src = origImg.src || '';
            // Skip images already accessible via http/data/blob
            if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:')) return;
            if (!src) return;
            // Fetch the image as blob and convert to data URL
            const p = fetch(src)
                .then(res => res.blob())
                .then(blob => new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                }))
                .then(dataUrl => {
                    if (dataUrl && clonedImg) {
                        clonedImg.src = dataUrl;
                    }
                })
                .catch(() => {});
            imgPromises.push(p);
        });
        await Promise.all(imgPromises);
        
        // Replace terminal canvases with styled pre elements containing the text
        const clonedTerminals = clone.querySelectorAll('.xterm, [class*="terminal"], [class*="Terminal"]');
        terminalTexts.forEach(item => {
            if (clonedTerminals[item.index]) {
                const terminal = clonedTerminals[item.index];
                
                // Create a styled pre element with the terminal text
                const pre = document.createElement('pre');
                pre.textContent = item.text;
                pre.style.cssText = \`
                    background: #1e1e1e;
                    color: #d4d4d4;
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    font-size: 13px;
                    line-height: 1.4;
                    padding: 12px;
                    margin: 0;
                    overflow-x: auto;
                    white-space: pre-wrap;
                    word-break: break-all;
                    border-radius: 6px;
                \`;
                
                // Replace the canvas-based terminal with our text version
                const canvases = terminal.querySelectorAll('canvas');
                if (canvases.length > 0) {
                    // Replace the first canvas's parent or the canvas itself
                    canvases[0].parentNode.replaceChild(pre, canvases[0]);
                    // Remove other canvases (xterm has multiple layers)
                    for (let i = 1; i < canvases.length; i++) {
                        canvases[i].remove();
                    }
                }
            }
        });
        
        // Also handle any remaining canvases (charts, etc.) with the old method
        const remainingCanvases = cascade.querySelectorAll('canvas');
        const canvasReplacements = [];
        remainingCanvases.forEach((canvas, i) => {
            // Skip if already handled by terminal extraction
            if (canvas.closest('.xterm, [class*="terminal"], [class*="Terminal"]')) return;
            
            try {
                if (canvas.width > 0 && canvas.height > 0) {
                    const dataUrl = canvas.toDataURL();
                    if (dataUrl && dataUrl.length > 100) {
                        canvasReplacements.push({ index: i, dataUrl });
                    }
                }
            } catch(e) {}
        });
        
        // Apply non-terminal canvas replacements
        const clonedCanvases = clone.querySelectorAll('canvas');
        canvasReplacements.forEach(item => {
            if (clonedCanvases[item.index]) {
                const img = document.createElement('img');
                img.src = item.dataUrl;
                img.style.display = 'block';
                clonedCanvases[item.index].parentNode.replaceChild(img, clonedCanvases[item.index]);
            }
        });

        // --- MINIMAL CLEANUP ---

        // Find the contenteditable input and remove its parent container
        const contentEditable = clone.querySelector('[contenteditable="true"]');
        if (contentEditable) {
            // Walk up to find a reasonable container (the input bar wrapper)
            let container = contentEditable.parentElement;
            // Go up a few levels to get the whole input area
            for (let i = 0; i < 5 && container && container !== clone; i++) {
                if (container.querySelector('[contenteditable]') && 
                    (container.className.includes('input') || 
                     container.className.includes('Input') ||
                     container.className.includes('Composer') ||
                     container.style.position === 'sticky')) {
                    container.remove();
                    break;
                }
                container = container.parentElement;
            }
            // If we didn't find a good container, just remove the contenteditable itself
            if (clone.querySelector('[contenteditable="true"]')) {
                clone.querySelector('[contenteditable="true"]').remove();
            }
        }
        
        // Remove textarea/input elements
        clone.querySelectorAll('textarea, input').forEach(el => el.remove());
        
        // --- SAFE FOOTER REMOVAL (structural/position-based only, won't affect messages) ---
        
        // Remove feedback buttons ONLY (thumbs up/down - these are truly useless on mobile)
        clone.querySelectorAll('button').forEach(btn => {
            const text = btn.textContent.trim();
            if (text === 'Good' || text === 'Bad') {
                btn.remove();
            }
        });
        
        // Remove by attributes (structural - these can't be in chat messages)
        clone.querySelectorAll('[placeholder]').forEach(el => el.remove());
        clone.querySelectorAll('[data-placeholder]').forEach(el => el.remove());
        clone.querySelectorAll('[contenteditable]').forEach(el => {
            // Remove the contenteditable and walk up to find its container
            let container = el;
            for (let i = 0; i < 5 && container.parentElement && container.parentElement !== clone; i++) {
                container = container.parentElement;
            }
            container.remove();
        });
        
        // Remove by class patterns (structural)
        clone.querySelectorAll('[class*="Composer"], [class*="composer"]').forEach(el => el.remove());
        clone.querySelectorAll('[class*="InputBar"], [class*="inputBar"], [class*="input-bar"]').forEach(el => el.remove());
        clone.querySelectorAll('[class*="ChatInput"], [class*="chatInput"], [class*="chat-input"]').forEach(el => el.remove());
        
        // Remove position:sticky elements (the footer is sticky at bottom)
        clone.querySelectorAll('*').forEach(el => {
            const style = el.getAttribute('style') || '';
            if (style.includes('position: sticky') || style.includes('position:sticky')) {
                el.remove();
            }
        });
        
        // Remove the last child if it looks like an input container (has no actual message content)
        // This catches the footer bar by structure, not by text
        const lastChild = clone.lastElementChild;
        if (lastChild) {
            const hasMessageContent = lastChild.querySelector('[class*="message"], [class*="Message"], [data-message]');
            const hasInputElements = lastChild.querySelector('[contenteditable], [placeholder], button, select');
            if (!hasMessageContent && hasInputElements) {
                lastChild.remove();
            }
        }

        // --- PRE-EXPAND COLLAPSED SECTIONS ---
        // Open all <details> elements so content is visible on mobile
        clone.querySelectorAll('details').forEach(el => el.setAttribute('open', ''));
        
        // Mark all aria-expanded=false elements with a data attribute so mobile can identify and forward clicks
        clone.querySelectorAll('[aria-expanded="false"]').forEach((el, i) => {
            el.setAttribute('data-mobile-expandable', i.toString());
            el.setAttribute('aria-expanded', 'false'); // keep so mobile knows it's collapsed
        });
        // Also tag aria-expanded=true elements so mobile knows they're expanded
        clone.querySelectorAll('[aria-expanded="true"]').forEach((el, i) => {
            el.setAttribute('data-mobile-expandable-open', i.toString());
        });

        // --- CAPTURE CSS ---

        let css = '';
        for (const sheet of document.styleSheets) {
            try { 
                for (const rule of sheet.cssRules) {
                    let text = rule.cssText;
                    text = text.replace(/(^|[\\s,}])body(?=[\\s,{])/gi, '$1#cascade-container');
                    text = text.replace(/(^|[\\s,}])html(?=[\\s,{])/gi, '$1#cascade-container');
                    css += text + '\\n'; 
                }
            } catch (e) { }
        }
        
        const computed = window.getComputedStyle(document.body);
        let variables = ':root {';
        for (let i = 0; i < computed.length; i++) {
            const prop = computed[i];
            if (prop.startsWith('--')) {
                variables += \`\${prop}: \${computed.getPropertyValue(prop)};\`;
            }
        }
        variables += '}';
        
        // Final aggressive scrubbing of inline heights and overflows directly from the HTML string
        let finalHtml = clone.outerHTML;
        finalHtml = finalHtml.replace(/touch-action:\\s*none;?/gi, '');
        finalHtml = finalHtml.replace(/overflow:\\s*hidden;?/gi, '');
        
        // Strip the touch constraints from the exported stylesheet CSS
        let finalCss = variables + css;
        finalCss = finalCss.replace(/touch-action:\\s*none;?/gi, '');
        finalCss = finalCss.replace(/overscroll-behavior:\\s*none;?/gi, '');
        finalCss = finalCss.replace(/overflow:\\s*hidden;?/gi, '');
        
        return {
            html: finalHtml,
            css: finalCss,
            bodyBg: computed.backgroundColor,
            bodyColor: computed.color
        };
    })()`;

    try {
        const result = await cdp.call('Runtime.evaluate', {
            expression: SCRIPT,
            returnByValue: true,
            awaitPromise: true,
            contextId: contextId
        });

        if (result.result?.value && !result.result.value.error) {
            return result.result.value;
        }
    } catch (e) { }

    return null;
}

/**
 * Check captured chat HTML for state changes, auto-accept commands, and send Telegram notifications.
 * Only triggers on transitions (e.g., first error detection) to avoid spam.
 */
function checkAndNotify(html) {
    // Strip HTML tags for text analysis
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    // Extract button labels + xpaths for inline actions
    const hasButtons = html.includes('data-xpath');
    let buttons = [];
    if (hasButtons) {
        const btnRegex = /data-xpath="([^"]+)"[^>]*>([\s\S]{1,200}?)<\/(?:button|div|span|a|summary)\b/gi;
        let m;
        while ((m = btnRegex.exec(html)) !== null) {
            const label = m[2].replace(/<[^>]*>/g, '').trim();
            const xpath = m[1];
            if (label && xpath && label.length <= 60 && !label.includes('\n')) buttons.push({ label, xpath });
        }
    }

    // Auto-accept commands — runs independently of Telegram
    if (hasButtons && buttons.length > 0 && Config.getConfig('autoAcceptCommands')) {
        // Reject patterns — never auto-click these (they change permanent permissions)
        const rejectPatterns = /^(always run|always allow|ask every time)$/i;
        // Accept patterns — prefer exact matches for safer options
        const acceptPatterns = /^(run|accept|allow once|allow this conversation|yes|continue|approve|confirm|ok|allow|proceed)$/i;

        // Filter out reject buttons first
        const safeButtons = buttons.filter(b => !rejectPatterns.test(b.label));
        const btnLabels = safeButtons.map(b => b.label).join(', ');
        if (debugCallback) debugCallback(`Buttons found: [${btnLabels}]`);

        // Find all accept buttons (there may be multiple for simultaneous commands)
        const acceptBtns = safeButtons.filter(b => acceptPatterns.test(b.label));

        // Expire stale entries on every pass
        const now = Date.now();
        for (const [xpath, ts] of recentlyClickedXpaths) {
            if (now - ts > CLICK_EXPIRY_MS) recentlyClickedXpaths.delete(xpath);
        }

        for (const acceptBtn of acceptBtns) {
            if (recentlyClickedXpaths.has(acceptBtn.xpath)) {
                if (debugCallback) debugCallback(`Skip: already clicked "${acceptBtn.label}"`);
                continue;
            }
            recentlyClickedXpaths.set(acceptBtn.xpath, Date.now());
            if (debugCallback) debugCallback(`Auto-clicking: "${acceptBtn.label}"`);

            // Use increasing delays for simultaneous buttons to avoid race conditions
            const delay = 500 + (acceptBtns.indexOf(acceptBtn) * 800);
            setTimeout(async () => {
                try {
                    const result = await clickElementByXPath(acceptBtn.xpath);
                    if (result?.success) {
                        if (autoAcceptCallback) autoAcceptCallback(acceptBtn.label);
                    } else {
                        if (debugCallback) debugCallback(`Click failed: ${result?.error || 'unknown'}`);
                        recentlyClickedXpaths.delete(acceptBtn.xpath);
                    }
                } catch (e) {
                    if (debugCallback) debugCallback(`Click error: ${e.message}`);
                    recentlyClickedXpaths.delete(acceptBtn.xpath);
                }
            }, delay);
        }

        if (acceptBtns.length === 0) {
            if (debugCallback) debugCallback(`No accept button matched in: [${btnLabels}]`);
        }
    }
    if (!hasButtons) recentlyClickedXpaths.clear();

    // --- Detect agent activity via text content changes (ignore dynamic HTML attrs) ---
    const textForCompare = text.slice(-500); // last 500 chars of text content to detect changes
    const htmlChanged = textForCompare !== lastHtmlForNotif;
    lastHtmlForNotif = textForCompare;
    if (htmlChanged) {
        unchangedCount = 0;
        agentWasActive = true;
    } else {
        unchangedCount++;
    }
    // Agent is considered stopped after 3 consecutive unchanged polls (~6 seconds)
    const agentJustStopped = agentWasActive && unchangedCount === 3;
    if (unchangedCount >= 3) agentWasActive = false;

    // Detect actionable input buttons (Run, Reject, Allow, Deny) via data-xpath
    const inputButtonPatterns = /^(run|reject|allow once|allow this conversation|always allow|deny|accept|yes|no|configure)\b/i;
    const actionButtons = buttons.filter(b => inputButtonPatterns.test(b.label));

    // Also detect command/permission dialogs via text patterns (these buttons lack data-xpath)
    const hasCommandDialog = /Run command\?/i.test(html) && /Waiting/i.test(html);
    const hasPermissionDialog = /needs permission/i.test(html) && /Waiting/i.test(html);
    const hasActionableInput = actionButtons.length > 0 || hasCommandDialog || hasPermissionDialog;

    // Save previous state, then update
    const prevState = { ...lastNotifState };
    lastNotifState = { inputNeeded: hasActionableInput };

    // --- Telegram notifications ---
    if (!TelegramBot.isRunning()) return;
    const tgConfig = Config.getConfig('telegram');
    if (!tgConfig?.enabled) return;
    const notifications = tgConfig.notifications || {};

    // 1. Input needed: actionable buttons or dialogs just appeared
    if (hasActionableInput && !prevState.inputNeeded && notifications.onInputNeeded !== false) {
        if (debugCallback) debugCallback('Sending INPUT_NEEDED notification');
        let msg = 'Your input is required in the chat.';
        if (hasCommandDialog) msg = 'Your input is required — Run command?';
        else if (hasPermissionDialog) msg = 'Your input is required — Permission needed.';
        else if (actionButtons.length > 0) msg = `Your input is required — ${actionButtons.map(b => b.label).join(', ')}`;
        TelegramBot.sendNotification('input_needed', msg);
    }

    // 2. Agent just stopped (HTML unchanged for 3 polls after activity) — completion only
    //    Error detection is handled separately by checkErrorDialogs() which looks at actual UI dialogs
    if (agentJustStopped && notifications.onComplete !== false) {
        if (debugCallback) debugCallback('Sending COMPLETE notification');
        TelegramBot.sendNotification('complete', 'Agent has completed the process.');
    }
}

/**
 * Check for full-page error dialogs (modal overlays outside #cascade).
 * These include "Agent terminated due to error", "Model quota reached", etc.
 * Runs every poll cycle and sends Telegram notifications on transition.
 */
async function checkErrorDialogs(cdp, contextId) {
    if (!TelegramBot.isRunning()) return;
    const tgConfig = Config.getConfig('telegram');
    if (!tgConfig?.enabled || tgConfig.notifications?.onError === false) return;

    const DIALOG_SCRIPT = `(function() {
        // Look for dialog/modal elements with error text
        const dialogs = document.querySelectorAll('[role="dialog"], .dialog-shadow, .monaco-dialog-box, [class*="dialog"], [class*="notification"]');
        for (const d of dialogs) {
            const text = (d.innerText || '').toLowerCase();
            if (text.includes('terminated due to error')) return { error: 'Agent terminated due to error', type: 'terminated' };
            if (text.includes('model quota reached') || text.includes('quota reached')) return { error: 'Model quota reached', type: 'quota' };
            if (text.includes('quota exhausted') || text.includes('quota exceeded')) return { error: 'Model quota exhausted', type: 'quota' };
            if (text.includes('rate limit') || text.includes('too many requests')) return { error: 'Rate limit reached', type: 'quota' };
            if (text.includes('high traffic')) return { error: 'Servers experiencing high traffic', type: 'error' };
            if (text.includes('internal server error')) return { error: 'Internal server error', type: 'error' };
        }
        return null;
    })()`;

    try {
        let dialogError = null;

        // Scan ALL contexts — the error dialog can appear in any context
        // (main VS Code page, webview, or other frames)
        const contextsToCheck = [contextId, ...cdp.contexts.map(c => c.id)];
        const seen = new Set();

        for (const ctxId of contextsToCheck) {
            if (!ctxId || seen.has(ctxId)) continue;
            seen.add(ctxId);
            try {
                const result = await cdp.call('Runtime.evaluate', {
                    expression: DIALOG_SCRIPT,
                    returnByValue: true,
                    contextId: ctxId
                });
                if (result.result?.value) {
                    dialogError = result.result.value;
                    break;
                }
            } catch (e) { /* context may be invalid */ }
        }

        if (dialogError && !lastNotifState.dialogError) {
            // New error dialog detected — send notification
            lastNotifState.dialogError = true;
            if (debugCallback) debugCallback(`Error dialog detected: ${dialogError.error}`);
            if (errorCallback) errorCallback(dialogError.error);
            TelegramBot.sendNotification('error', dialogError.error);
        } else if (!dialogError && lastNotifState.dialogError) {
            // Dialog dismissed
            lastNotifState.dialogError = false;
        }
    } catch (e) {
        // Silently fail — dialog check is best-effort
    }
}

/**
 * Start streaming chat updates
 */
export async function startChatStream(updateCallback, pollMs = 2000) {
    onChatUpdate = updateCallback;

    // Find and connect to target
    const targets = await findTargets();
    if (targets.length === 0) {
        return { success: false, error: 'No CDP targets found' };
    }

    // Try each target until we find one with #cascade
    for (const target of targets) {
        try {
            console.log(`🔍 Checking ${target.title}`);
            const cdp = await connectCDP(target.webSocketDebuggerUrl);
            const contextId = await findCascadeContext(cdp);

            if (contextId) {
                console.log(`✅ Found cascade in context ${contextId}`);
                connection = cdp;

                // Start polling
                const poll = async () => {
                    if (!connection) return;

                    const contextId = await findCascadeContext(connection);
                    if (!contextId) return;

                    const chat = await captureChat(connection, contextId);
                    if (chat && chat.html) {
                        const hash = hashString(chat.html);
                        if (hash !== lastHash) {
                            lastHash = hash;
                            if (onChatUpdate) {
                                onChatUpdate(chat);
                            }
                            // Telegram notifications on state changes
                            checkAndNotify(chat.html);
                        }
                    }

                    // Check for full-page error dialogs (outside #cascade)
                    await checkErrorDialogs(connection, contextId);
                };

                // Initial capture
                await poll();

                // Start polling interval
                pollInterval = setInterval(poll, pollMs);

                return { success: true, target: target.title };
            } else {
                cdp.ws.close();
            }
        } catch (e) {
            console.error(`Failed: ${e.message}`);
        }
    }

    return { success: false, error: 'No cascade element found in any target' };
}

/**
 * Stop streaming
 */
export function stopChatStream() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    if (connection) {
        connection.ws.close();
        connection = null;
    }
    lastHash = null;
    onChatUpdate = null;
}

/**
 * Get current chat snapshot
 */
export async function getChatSnapshot() {
    if (!connection) {
        // Try to get a one-shot snapshot
        const targets = await findTargets();
        for (const target of targets) {
            try {
                const cdp = await connectCDP(target.webSocketDebuggerUrl);
                const contextId = await findCascadeContext(cdp);
                if (contextId) {
                    const chat = await captureChat(cdp, contextId);
                    cdp.ws.close();
                    return chat;
                }
                cdp.ws.close();
            } catch (e) { }
        }
        return null;
    }

    const contextId = await findCascadeContext(connection);
    if (!contextId) return null;
    return await captureChat(connection, contextId);
}

/**
 * Check if stream is active
 */
export function isStreaming() {
    return connection !== null && pollInterval !== null;
}
