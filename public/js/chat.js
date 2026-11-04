/* ============================================
 * Chat — Messages, rendering, activity
 * ============================================ */

        function addChatMessage(msg, animate = true) {
            chatMessages.push(msg);
            if (chatMessages.length > 100) chatMessages.shift();

            // Track user prompts for remote history display
            if (msg.type === 'user' || msg.type === 'mobile_command') {
                // Only process unique prompts to prevent duplicates from history sync
                const isDuplicate = remotePrompts.length > 0 && remotePrompts[remotePrompts.length - 1].content === msg.content;
                if (!isDuplicate) {
                    remotePrompts.push(msg);
                    renderRemotePrompts();
                }
            }

            renderChat(animate);
        }

        let remotePrompts = [];

        function renderRemotePrompts() {
            const container = document.getElementById('remotePrompts');
            if (!container) return;

            // Keep only the last 3 prompts
            if (remotePrompts.length > 3) {
                remotePrompts.shift();
            }

            if (remotePrompts.length === 0) {
                container.innerHTML = '';
                return;
            }

            container.innerHTML = remotePrompts.map(msg => `
                    <div class="remote-prompt-item">${escapeHtml(msg.content)}</div>
                `).join('');

            // Smoothly pin to bottom when a new one is added
            container.scrollTop = container.scrollHeight;
        }

        function renderChat(animate = true) {
            const container = document.getElementById('chatMessages');
            if (!container) return; // Guard against null

            if (chatMessages.length === 0) {
                container.innerHTML = `
                    <div class="chat-empty">
                        <span class="icon">💬</span>
                        <span>Chat messages will appear here</span>
                    </div>
                `;
                return;
            }

            container.innerHTML = chatMessages.map((msg, i) => {
                const isNew = animate && i === chatMessages.length - 1;
                const type = msg.type || 'agent';
                let className = 'agent';
                if (type === 'user' || type === 'mobile_command') className = 'user';
                else if (type === 'status') className = 'status';
                else if (type === 'error') className = 'error';

                return `
                    <div class="chat-msg ${className}" ${isNew ? 'style="animation: msgIn 0.3s ease"' : ''}>
                        ${escapeHtml(msg.content)}
                        <div class="chat-msg-time">${formatTime(msg.timestamp)}</div>
                    </div>
                `;
            }).join('');

            container.scrollTop = container.scrollHeight;
        }

        async function sendChatMessage() {
            const input = document.getElementById('chatInput');
            const text = input.value.trim();
            if (!text) return;

            try {
                const res = await authFetch(`${serverUrl}/api/cdp/inject`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, submit: true })
                });

                const result = await res.json();
                if (result.success) {
                    input.value = '';
                    showToast('Sent!', 'success');
                } else {
                    throw new Error(result.error);
                }
            } catch (e) {
                showToast('Failed to send', 'error');
            }
        }

        async function sendQuick(cmd) {
            const c = (cmd || '').toLowerCase().trim();

            // 1. If "stop", abort/stop the running agent
            if (c === 'stop') {
                try {
                    const res = await authFetch('/api/chat/stop-agent', { method: 'POST' });
                    const r = await res.json();
                    if (r.success) {
                        showToast('Agent stopped', 'success');
                        return;
                    }
                } catch (e) { }
            }

            // 2. Check if there is an active question prompt
            const prompt = window.latestPrompt;
            if (prompt) {
                if (c === 'yes' || c === 'continue') {
                    const opt = (prompt.options || []).find(o =>
                        /\b(yes|proceed|continue|allow|approve|agree|ok)\b/i.test(o.label) ||
                        /\(recommended\)/i.test(o.label)
                    ) || (prompt.options && prompt.options[0]);
                    if (opt && typeof window.answerPrompt === 'function') {
                        await window.answerPrompt({ kind: 'option', optionXpath: opt.xpath, submitXpath: prompt.submitXpath });
                        return;
                    } else if (prompt.submitXpath && typeof window.answerPrompt === 'function') {
                        await window.answerPrompt({ kind: 'submit', submitXpath: prompt.submitXpath });
                        return;
                    }
                } else if (c === 'no') {
                    const opt = (prompt.options || []).find(o =>
                        /\b(no|deny|reject|cancel|disagree|skip)\b/i.test(o.label)
                    );
                    if (opt && typeof window.answerPrompt === 'function') {
                        await window.answerPrompt({ kind: 'option', optionXpath: opt.xpath, submitXpath: prompt.submitXpath });
                        return;
                    } else if (prompt.skipXpath && typeof window.answerPrompt === 'function') {
                        await window.answerPrompt({ kind: 'skip', skipXpath: prompt.skipXpath });
                        return;
                    }
                }
            }

            // 3. Check if there are active message action buttons (Run / Accept / Reject)
            const actions = window.latestActions || [];
            if (actions.length > 0 && typeof window.forwardAction === 'function') {
                if (c === 'yes' || c === 'continue') {
                    const accept = actions.find(a => a.kind === 'accept' || /^(run|accept|allow|yes|continue|proceed|approve|ok)\b/i.test(a.label));
                    if (accept) {
                        await window.forwardAction(accept.xpath, accept.label);
                        return;
                    }
                } else if (c === 'no') {
                    const reject = actions.find(a => a.kind === 'reject' || /^(reject|deny|no|cancel|discard)\b/i.test(a.label));
                    if (reject) {
                        await window.forwardAction(reject.xpath, reject.label);
                        return;
                    }
                }
            }

            // 4. Default fallback: send as chat message
            document.getElementById('chatInput').value = cmd;
            sendChatMessage();
        }

        // ====================================================================
        // Activity
        // ====================================================================
        function renderActivity() {
            const feed = document.getElementById('activityFeed');

            if (chatMessages.length === 0) {
                feed.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
                        <div style="font-size: 48px; margin-bottom: 12px; opacity: 0.4;">📭</div>
                        <p>No activity yet</p>
                    </div>
                `;
                return;
            }

            feed.innerHTML = [...chatMessages].reverse().map(msg => `
                <div class="card" style="margin-bottom: 8px; padding: 12px 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; background: rgba(139, 92, 246, 0.2); color: var(--accent-primary);">${msg.type}</span>
                        <span style="font-size: 11px; color: var(--text-muted);">${formatTime(msg.timestamp)}</span>
                    </div>
                    <div style="font-size: 14px; line-height: 1.5;">${escapeHtml(msg.content)}</div>
                </div>
            `).join('');
        }

        // ====================================================================
        // Settings
        // ====================================================================
