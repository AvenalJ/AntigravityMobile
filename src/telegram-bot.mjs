/**
 * Telegram Bot - Notifications + on-demand commands for Antigravity
 * 
 * Features:
 * - Commands: /start, /help, /status, /quota, /screenshot
 * - Notifications: process complete, errors, input needed (buttons)
 * - Rate limiting: per-user cooldown (15 commands / 60s window)
 * - Persistent bot menu via setMyCommands()
 * - Message threading: group related notifications into reply chains
 */

let TelegramBot;
let bot = null;
let botConfig = null;

// Lazy-load dependency to avoid crash if not installed
async function loadDependency() {
    if (TelegramBot) return true;
    try {
        const mod = await import('node-telegram-bot-api');
        TelegramBot = mod.default;
        return true;
    } catch (e) {
        console.error('⚠️ node-telegram-bot-api not installed. Run: npm install node-telegram-bot-api');
        return false;
    }
}

// Callback hooks (set by http-server)
let getStatusFn = null;
let getScreenshotFn = null;
let clickByXPathFn = null;
let getQuotaFn = null;

/**
 * Register callback functions for bot commands
 */
export function registerCallbacks({ getStatus, getScreenshot, clickByXPath, getQuota }) {
    getStatusFn = getStatus || null;
    getScreenshotFn = getScreenshot || null;
    clickByXPathFn = clickByXPath || null;
    getQuotaFn = getQuota || null;
}

// ============================================================================
// Rate Limiting — per-user cooldown
// ============================================================================
const RATE_LIMIT_MAX = 15;       // max commands per window
const RATE_LIMIT_WINDOW = 60000; // 60 second window
const rateLimits = new Map();

/**
 * Check rate limit for a chat. Returns true if allowed, false if throttled.
 * Sends a warning message on first throttle within the window.
 */
function checkRateLimit(chatId) {
    const now = Date.now();
    let entry = rateLimits.get(chatId);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
        rateLimits.set(chatId, { count: 1, windowStart: now, warned: false });
        return true;
    }

    entry.count++;

    if (entry.count > RATE_LIMIT_MAX) {
        if (!entry.warned) {
            entry.warned = true;
            const remainingSec = Math.ceil((RATE_LIMIT_WINDOW - (now - entry.windowStart)) / 1000);
            bot.sendMessage(chatId,
                `⏳ *Rate limit reached*\nMax ${RATE_LIMIT_MAX} commands per minute.\nPlease wait ${remainingSec}s.`,
                { parse_mode: 'Markdown' }
            );
        }
        return false;
    }

    return true;
}

// Clean up stale rate-limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [chatId, entry] of rateLimits) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW * 2) {
            rateLimits.delete(chatId);
        }
    }
}, 300000);

// ============================================================================
// Message Threading — group related notifications into reply chains
// ============================================================================
const THREAD_EXPIRY = 3600000; // 1 hour
const notificationThreads = new Map();

/**
 * Get the reply-to message ID for a thread key, if one exists and isn't expired.
 */
function getThreadMessageId(threadKey) {
    if (!threadKey) return null;
    const entry = notificationThreads.get(threadKey);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > THREAD_EXPIRY) {
        notificationThreads.delete(threadKey);
        return null;
    }
    return entry.messageId;
}

/**
 * Store a message ID as the head of a notification thread.
 */
function setThreadMessageId(threadKey, messageId) {
    if (!threadKey || !messageId) return;
    notificationThreads.set(threadKey, { messageId, createdAt: Date.now() });
}

/**
 * Clear a specific notification thread (e.g. when a new task begins).
 */
export function clearThread(threadKey) {
    notificationThreads.delete(threadKey);
}

// ============================================================================
// Bot Commands Definition
// ============================================================================
const BOT_COMMANDS = [
    { command: 'help', description: 'Show command reference' },
    { command: 'status', description: 'Connection & server status' },
    { command: 'quota', description: 'AI model quota usage' },
    { command: 'screenshot', description: 'Capture IDE screenshot' },
];

/**
 * Initialize the Telegram bot
 * @param {object} config - { botToken, chatId, notifications }
 */
export async function initBot(config) {
    if (bot) await stopBot();

    if (!config?.botToken) {
        console.log('ℹ️ Telegram bot: no token configured');
        return false;
    }

    const loaded = await loadDependency();
    if (!loaded) return false;

    botConfig = config;

    try {
        bot = new TelegramBot(config.botToken, { polling: true });

        // Error handler
        bot.on('polling_error', (err) => {
            console.error('🤖 Telegram polling error:', err.code || err.message);
        });

        // Register persistent command menu
        try {
            await bot.setMyCommands(BOT_COMMANDS);
            console.log('🤖 Telegram bot menu registered');
        } catch (e) {
            console.error('🤖 Failed to set bot commands:', e.message);
        }

        // /start command — welcome message
        bot.onText(/\/start/, (msg) => {
            if (!isAuthorized(msg)) return;
            if (!checkRateLimit(msg.chat.id)) return;
            bot.sendMessage(msg.chat.id,
                `✅ *Antigravity Mobile Bot Active*\n\n` +
                `Your Chat ID: \`${msg.chat.id}\`\n\n` +
                `🔗 [GitHub](https://github.com/AvenalJ/AntigravityMobile)\n\n` +
                `Type /help for available commands.`,
                { parse_mode: 'Markdown' }
            );
        });

        // /help command — categorized command reference
        bot.onText(/\/help/, (msg) => {
            if (!isAuthorized(msg)) return;
            if (!checkRateLimit(msg.chat.id)) return;
            bot.sendMessage(msg.chat.id,
                `📖 *Command Reference*\n\n` +
                `*📊 Monitoring*\n` +
                `/status — Server & CDP connection status\n` +
                `/quota — AI model quota remaining\n` +
                `/screenshot — Capture IDE screen\n\n` +
                `*ℹ️ Info*\n` +
                `/start — Show welcome & chat ID\n` +
                `/help — This message`,
                { parse_mode: 'Markdown' }
            );
        });

        // /status command
        bot.onText(/\/status/, async (msg) => {
            if (!isAuthorized(msg)) return;
            if (!checkRateLimit(msg.chat.id)) return;
            try {
                const status = getStatusFn ? await getStatusFn() : { error: 'Status not available' };
                const text = status.error
                    ? `❌ ${status.error}`
                    : `🟢 *Antigravity Status*\n\n` +
                    `CDP: ${status.cdpConnected ? '✅ Connected' : '❌ Disconnected'}\n` +
                    `Uptime: ${status.uptime || 'N/A'}\n` +
                    `Clients: ${status.activeClients || 0}`;
                bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
            } catch (e) {
                bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
            }
        });

        // /quota command — AI model quota status
        bot.onText(/\/quota/, async (msg) => {
            if (!isAuthorized(msg)) return;
            if (!checkRateLimit(msg.chat.id)) return;
            try {
                bot.sendChatAction(msg.chat.id, 'typing');
                const quota = getQuotaFn ? await getQuotaFn() : null;

                if (!quota || !quota.available) {
                    bot.sendMessage(msg.chat.id,
                        `❌ *Quota Unavailable*\n\n${quota?.error || 'Quota service not connected. Is Antigravity running?'}`,
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }

                if (!quota.models || quota.models.length === 0) {
                    bot.sendMessage(msg.chat.id, '📊 No model quota data available.');
                    return;
                }

                const statusIcons = {
                    healthy: '🟢',
                    warning: '🟡',
                    danger: '🔴',
                    exhausted: '⚫'
                };

                let text = '📊 *Model Quota Status*\n\n';
                for (const model of quota.models) {
                    const icon = statusIcons[model.status] || '⚪';
                    const bar = buildProgressBar(model.remainingPercent);
                    text += `${icon} *${escapeMarkdown(model.name)}*\n`;
                    text += `   ${bar} ${model.remainingPercent}%`;
                    if (model.resetIn) {
                        text += ` \\(resets in ${escapeMarkdown(model.resetIn)}\\)`;
                    }
                    text += '\n\n';
                }

                // Truncate if needed (Telegram 4096 char limit)
                if (text.length > 4000) {
                    text = text.slice(0, 3950) + '\n\n_(truncated)_';
                }

                bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
            } catch (e) {
                bot.sendMessage(msg.chat.id, `❌ Quota error: ${e.message}`);
            }
        });

        // /screenshot command
        bot.onText(/\/screenshot/, async (msg) => {
            if (!isAuthorized(msg)) return;
            if (!checkRateLimit(msg.chat.id)) return;
            try {
                bot.sendChatAction(msg.chat.id, 'upload_photo');
                const base64 = getScreenshotFn ? await getScreenshotFn() : null;
                if (!base64) {
                    bot.sendMessage(msg.chat.id, '❌ Could not capture screenshot');
                    return;
                }
                const buffer = Buffer.from(base64, 'base64');
                bot.sendPhoto(msg.chat.id, buffer, { caption: '📸 IDE Screenshot' });
            } catch (e) {
                bot.sendMessage(msg.chat.id, `❌ Screenshot error: ${e.message}`);
            }
        });



        // Handle inline keyboard button presses (from input-needed notifications)
        bot.on('callback_query', async (query) => {
            if (!isAuthorized(query)) return;
            try {
                const data = JSON.parse(query.data);
                if (data.action === 'click_xpath' && data.xpath && clickByXPathFn) {
                    const result = await clickByXPathFn(data.xpath);
                    const label = data.label || 'element';
                    if (result?.success) {
                        await bot.answerCallbackQuery(query.id, { text: `✅ Clicked: ${label}` });
                        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                            chat_id: query.message.chat.id,
                            message_id: query.message.message_id
                        });
                    } else {
                        await bot.answerCallbackQuery(query.id, { text: `❌ ${result?.error || 'Click failed'}`, show_alert: true });
                    }
                } else {
                    await bot.answerCallbackQuery(query.id, { text: 'Action not available' });
                }
            } catch (e) {
                await bot.answerCallbackQuery(query.id, { text: `❌ Error: ${e.message}`, show_alert: true });
            }
        });

        console.log('🤖 Telegram bot started');
        return true;
    } catch (e) {
        console.error('🤖 Telegram bot init failed:', e.message);
        bot = null;
        return false;
    }
}

/**
 * Stop the Telegram bot
 */
export async function stopBot() {
    if (!bot) return;
    try {
        await bot.stopPolling();
    } catch (e) { /* ignore */ }
    bot = null;
    console.log('🤖 Telegram bot stopped');
}

/**
 * Check if a message is from the authorized chat
 */
function isAuthorized(msg) {
    if (!botConfig?.chatId) return true; // No chatId restriction
    return String(msg.chat.id) === String(botConfig.chatId);
}

/**
 * Send a notification to the configured chat
 * @param {'complete'|'error'|'input_needed'|'progress'|'warning'} type
 * @param {string} message
 * @param {string} [screenshotBase64] - Optional screenshot to attach
 * @param {Array<{label: string, xpath: string}>} [buttons] - Optional inline buttons for input_needed
 * @param {string} [threadKey] - Optional thread key to group related notifications
 */
export async function sendNotification(type, message, screenshotBase64, buttons, threadKey) {
    if (!bot || !botConfig?.chatId) return false;

    // Check if this notification type is enabled
    const notifs = botConfig.notifications || {};
    if (type === 'complete' && !notifs.onComplete) return false;
    if (type === 'error' && !notifs.onError) return false;
    if (type === 'input_needed' && !notifs.onInputNeeded) return false;

    const icons = { complete: '✅', error: '❌', input_needed: '🔔', progress: '⏳', warning: '⚠️' };
    const titles = { complete: 'Process Complete', error: 'Error', input_needed: 'Input Needed', progress: 'Progress', warning: 'Warning' };
    const icon = icons[type] || 'ℹ️';
    const title = titles[type] || 'Notification';

    try {
        const text = `${icon} *${title}*\n\n${escapeMarkdown(message)}`;

        // Build inline keyboard for input_needed with extracted buttons
        const opts = { parse_mode: 'Markdown' };

        // Thread support: reply to existing thread message if one exists
        const replyTo = getThreadMessageId(threadKey);
        if (replyTo) {
            opts.reply_to_message_id = replyTo;
            opts.allow_sending_without_reply = true; // graceful fallback if original was deleted
        }

        if (type === 'input_needed' && buttons && buttons.length > 0) {
            const inlineButtons = buttons.slice(0, 8).map(b => ({
                text: b.label,
                callback_data: JSON.stringify({ action: 'click_xpath', xpath: b.xpath, label: b.label })
            }));
            // Arrange buttons in rows of 2
            const keyboard = [];
            for (let i = 0; i < inlineButtons.length; i += 2) {
                keyboard.push(inlineButtons.slice(i, i + 2));
            }
            opts.reply_markup = { inline_keyboard: keyboard };
        }

        let sentMessage;
        if (screenshotBase64) {
            const buffer = Buffer.from(screenshotBase64, 'base64');
            sentMessage = await bot.sendPhoto(botConfig.chatId, buffer, {
                caption: text,
                parse_mode: 'Markdown',
                ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
                ...(opts.reply_to_message_id ? { reply_to_message_id: opts.reply_to_message_id, allow_sending_without_reply: true } : {})
            });
        } else {
            sentMessage = await bot.sendMessage(botConfig.chatId, text, opts);
        }

        // Store as thread head if this is the first message in the thread
        if (threadKey && !replyTo && sentMessage?.message_id) {
            setThreadMessageId(threadKey, sentMessage.message_id);
        }

        return true;
    } catch (e) {
        console.error('🤖 Notification send error:', e.message);
        return false;
    }
}

/**
 * Send a test message
 */
export async function sendTestMessage(chatId) {
    if (!bot) return { success: false, error: 'Bot not initialized' };
    try {
        await bot.sendMessage(chatId || botConfig?.chatId,
            '🧪 *Test Message*\n\nAntigravity Mobile bot is working!',
            { parse_mode: 'Markdown' }
        );
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Check if the bot is running
 */
export function isRunning() {
    return bot !== null;
}

/**
 * Build a text-based progress bar for Telegram
 * @param {number} percent - 0 to 100
 * @returns {string}
 */
function buildProgressBar(percent) {
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Escape Markdown v1 special characters for Telegram
 * Only _ * ` [ need escaping in parse_mode: 'Markdown'
 */
function escapeMarkdown(text) {
    return text.replace(/([_*`\[])/g, '\\$1');
}
