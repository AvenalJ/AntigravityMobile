/* ============================================
 * Chat Live — Models, polling, live view
 * ============================================ */

        async function loadModelsAndModes() {
            console.log('[Debug] loadModelsAndModes called');
            try {
                // Fetch both models and quota
                const [modelsRes, quotaRes] = await Promise.all([
                    authFetch('/api/models'),
                    authFetch('/api/quota').catch(() => null)
                ]);
                
                const data = await modelsRes.json();
                let quotaData = null;
                if (quotaRes && quotaRes.ok) {
                    quotaData = await quotaRes.json();
                }

                console.log('[Debug] Models API response:', data);

                availableModels = data.models || [];
                currentModel = data.currentModel || 'Unknown';
                currentMode = data.currentMode || 'Planning';

                console.log('[Debug] Setting model:', currentModel, 'mode:', currentMode);

                // Update UI
                document.getElementById('currentModelLabel').textContent = currentModel;
                document.getElementById('currentModeLabel').textContent = currentMode.replace(/\s+/g, ' ').split(' ')[0];

                // Populate model list
                const modelList = document.getElementById('modelList');
                console.log('[Debug] modelList element:', modelList);
                modelList.innerHTML = availableModels.map(model => {
                    let quotaInfo = '';
                    if (quotaData && quotaData.models) {
                        const qModel = quotaData.models.find(q => q.name === model || q.name.includes(model) || model.includes(q.name));
                        if (qModel) {
                            const percent = Math.max(0, Math.min(100, qModel.remainingPercent || 0)).toFixed(0);
                            let color = 'var(--success)';
                            if (qModel.status === 'warning') color = 'var(--warning)';
                            if (qModel.status === 'danger' || qModel.status === 'exhausted') color = 'var(--error)';
                            quotaInfo = `<div style="font-size: 11px; color: ${color}; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 10px; margin-left: auto;">${percent}%</div>`;
                        }
                    }

                    return `
                        <div class="dropdown-item ${model === currentModel ? 'active' : ''}" onclick="selectModel('${escapeHtml(model)}')" style="display: flex; justify-content: flex-start; align-items: center; gap: 8px;">
                            <span>${escapeHtml(model)}</span>
                            ${quotaInfo}
                        </div>
                    `;
                }).join('');
                console.log('[Debug] Models loaded:', availableModels.length);
            } catch (e) {
                console.log('[Debug] Failed to load models:', e);
                document.getElementById('currentModelLabel').textContent = 'Not connected';
            }
        }

        let dropdownDebounce = false;
        function toggleModelDropdown(event) {
            if (event) event.stopPropagation();
            if (dropdownDebounce) return;
            dropdownDebounce = true;
            setTimeout(() => dropdownDebounce = false, 100);

            console.log('[Debug] toggleModelDropdown called');
            const dropdown = document.getElementById('modelDropdown');
            const modeDropdown = document.getElementById('modeDropdown');
            console.log('[Debug] dropdown element:', dropdown, 'current display:', dropdown?.style?.display);
            modeDropdown.style.display = 'none';
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
            console.log('[Debug] dropdown display after toggle:', dropdown.style.display);
        }

        function toggleModeDropdown(event) {
            if (event) event.stopPropagation();
            if (dropdownDebounce) return;
            dropdownDebounce = true;
            setTimeout(() => dropdownDebounce = false, 100);

            const dropdown = document.getElementById('modeDropdown');
            const modelDropdown = document.getElementById('modelDropdown');
            modelDropdown.style.display = 'none';
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
        }

        function closeAllDropdowns() {
            document.getElementById('modelDropdown').style.display = 'none';
            document.getElementById('modeDropdown').style.display = 'none';
        }

        async function selectModel(modelName) {
            console.log('[selectModel] Requesting model change to:', modelName);
            closeAllDropdowns();
            document.getElementById('currentModelLabel').textContent = 'Changing...';

            try {
                const res = await authFetch('/api/models/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: modelName })
                });
                const result = await res.json();
                console.log('[selectModel] API response:', result);
                if (result.debug) {
                    console.log('[selectModel] CLICKED ELEMENT:', JSON.stringify(result.debug, null, 2));
                }

                if (result.success) {
                    currentModel = result.selected || modelName;
                    document.getElementById('currentModelLabel').textContent = currentModel;
                    showToast(`Model: ${currentModel}`, 'success');
                    console.log('[selectModel] Success! Model set to:', currentModel);
                } else {
                    document.getElementById('currentModelLabel').textContent = currentModel;
                    showToast(result.error || 'Failed to change model', 'error');
                    console.log('[selectModel] Failed:', result.error);
                }
            } catch (e) {
                document.getElementById('currentModelLabel').textContent = currentModel;
                showToast('Network error', 'error');
                console.log('[selectModel] Network error:', e);
            }
        }

        async function selectMode(modeName) {
            console.log('[selectMode] Requesting mode change to:', modeName);
            closeAllDropdowns();
            document.getElementById('currentModeLabel').textContent = '...';

            try {
                const res = await authFetch('/api/modes/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: modeName })
                });
                const result = await res.json();
                console.log('[selectMode] API response:', result);
                if (result.debug) {
                    console.log('[selectMode] CLICKED ELEMENT:', JSON.stringify(result.debug, null, 2));
                }

                if (result.success) {
                    currentMode = modeName;
                    document.getElementById('currentModeLabel').textContent = modeName;
                    showToast(`Mode: ${modeName}`, 'success');
                    console.log('[selectMode] Success! Mode set to:', modeName);
                } else {
                    document.getElementById('currentModeLabel').textContent = currentMode;
                    showToast(result.error || 'Failed to change mode', 'error');
                    console.log('[selectMode] Failed:', result.error);
                    if (result.candidatesFound) {
                        console.log('[selectMode] Candidates found:', result.candidatesFound);
                    }
                    if (result.allTexts) {
                        console.log('[selectMode] All cursor-pointer texts:', result.allTexts);
                    }
                }
            } catch (e) {
                document.getElementById('currentModeLabel').textContent = currentMode;
                showToast('Network error', 'error');
                console.log('[selectMode] Network error:', e);
            }
        }

        // ====================================================================
        // Command Approval Functions (for buttons in injected IDE content)
        // ====================================================================

        // Forward any tap in injected IDE content to the real IDE via CDP click
        function attachInteractiveHandlers(container) {
            // Every interactive element was tagged at capture time with data-xpath
            // Tap → POST /api/cdp/click → IDE evaluates el.click() on the real element

            // Buttons to ignore (UI chrome, not user-actionable)
            const IGNORED = /^(always run|cancel|relocate|review changes|planning|claude|model|copy)/i;
            // Accept/positive action buttons
            const ACCEPT = /^(run|accept|allow once|allow this conversation|yes|continue|approve|confirm|ok|proceed|good|expand|collapse|dismiss)/i;
            // Reject/negative action buttons
            const REJECT = /^(reject|deny|bad|no\b)/i;
            // Dynamic patterns (e.g. "Thought for 3s")
            const NEUTRAL_DYNAMIC = /^(thought for|expand all|collapse all)/i;

            container.querySelectorAll('[data-xpath]').forEach(el => {
                const xpath = el.getAttribute('data-xpath');
                const label = (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 60);
                if (!xpath || !label) return;

                // Skip ignored buttons
                if (IGNORED.test(label)) return;

                // Classify button
                let action = null;
                if (ACCEPT.test(label)) action = 'accept';
                else if (REJECT.test(label)) action = 'reject';
                else if (NEUTRAL_DYNAMIC.test(label)) action = 'neutral';
                else return; // Not a recognized actionable button

                // Tag for CSS styling
                el.setAttribute('data-mobile-action', action);

                el.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    // Visual feedback
                    const prev = el.style.opacity;
                    el.style.opacity = '0.5';

                    // Toggle aria-expanded visually while waiting for refresh
                    if (el.hasAttribute('aria-expanded')) {
                        const cur = el.getAttribute('aria-expanded');
                        el.setAttribute('aria-expanded', cur === 'true' ? 'false' : 'true');
                    }

                    try {
                        const res = await authFetch('/api/cdp/click', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ xpath, text: label })
                        });
                        const result = await res.json();
                        if (result.success) {
                            showToast(`✓ ${label}`, 'success');
                        } else {
                            showToast(result.error || 'Click failed', 'error');
                            el.style.opacity = prev;
                        }
                    } catch (err) {
                        showToast('Network error', 'error');
                        el.style.opacity = prev;
                    } finally {
                        setTimeout(() => { el.style.opacity = prev; }, 500);
                    }
                });
            });
        }

        // Keep old name as alias for any remaining callers
        function attachApprovalHandlers(container) {
            attachInteractiveHandlers(container);
        }



        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.model-selector') && !e.target.closest('.mode-selector') &&
                !e.target.closest('.model-dropdown') && !e.target.closest('.mode-dropdown')) {
                closeAllDropdowns();
            }
        });

        // ====================================================================
        // Helpers
        // ====================================================================
        function formatTime(ts) {
            return ts ? new Date(ts).toLocaleTimeString() : '';
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function showToast(message, type = 'info') {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerHTML = `<span>${type === 'success' ? '✓' : '✕'}</span> ${message}`;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
        }

        // ====================================================================
        // Live Chat Polling from IDE (#cascade element)
        // Renders the raw HTML + CSS exactly like the IDE
        // ====================================================================
        let chatPollingActive = false;
        let chatPollTimer = null;
        let lastCascadeHash = null;
        let cssLoaded = false;




        // Icon per agent-activity kind
        const ACTIVITY_ICON = {
            edit: '✏️', run: '⚡', thought: '💭', explore: '🔍', step: '•'
        };

        // Build the DOM for one message in the structured conversation model
        function renderMessage(m) {
            if (m.role === 'user') {
                const el = document.createElement('div');
                el.className = 'sc-msg sc-user';
                el.innerHTML = `<div class="sc-bubble">${escapeHtml(m.text)}</div>`;
                return el;
            }

            // agent
            const el = document.createElement('div');
            el.className = 'sc-msg sc-agent' + (m.working ? ' sc-working' : '');

            let html = '';

            // activity summary ("Worked for Xs") + step timeline (when expanded in IDE)
            if (m.worked || (m.activity && m.activity.length)) {
                html += `<div class="sc-activity">`;
                if (m.worked) {
                    html += `<div class="sc-worked">${m.working ? '<span class="sc-spinner"></span>' : '✓'} ${escapeHtml(m.worked)}</div>`;
                }
                if (m.activity && m.activity.length) {
                    html += `<div class="sc-steps">` + m.activity.map(a =>
                        `<div class="sc-step sc-step-${a.kind}"><span class="sc-step-ico">${ACTIVITY_ICON[a.kind] || '•'}</span>${escapeHtml(a.text)}</div>`
                    ).join('') + `</div>`;
                }
                html += `</div>`;
            }

            // answer prose (already simplified to whitelisted tags on the server)
            if (m.text) {
                html += `<div class="sc-prose">${m.text}</div>`;
            }

            // change summary (files changed +adds/-dels)
            if (m.changes) {
                const add = m.changes.add ? `<span class="sc-add">+${escapeHtml(String(m.changes.add))}</span>` : '';
                const del = m.changes.del ? `<span class="sc-del">−${escapeHtml(String(m.changes.del))}</span>` : '';
                html += `<div class="sc-changes">📝 ${escapeHtml(m.changes.summary)} ${add} ${del}</div>`;
            }

            el.innerHTML = html;

            // live action buttons (Run / Accept / Reject) forwarded to the IDE
            if (m.actions && m.actions.length) {
                const bar = document.createElement('div');
                bar.className = 'sc-actions';
                m.actions.forEach(a => {
                    const btn = document.createElement('button');
                    btn.className = 'sc-action sc-action-' + a.kind;
                    btn.textContent = a.label;
                    btn.addEventListener('click', () => forwardAction(a.xpath, a.label, btn));
                    bar.appendChild(btn);
                });
                el.appendChild(bar);
            }
            return el;
        }

        // Forward an action-button tap to the real IDE via CDP click
        async function forwardAction(xpath, label, btn) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            try {
                const res = await authFetch('/api/cdp/click', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ xpath, text: label })
                });
                const result = await res.json();
                showToast(result.success ? `✓ ${label}` : (result.error || 'Click failed'), result.success ? 'success' : 'error');
            } catch (e) {
                showToast('Network error', 'error');
            } finally {
                setTimeout(() => { btn.disabled = false; btn.style.opacity = ''; }, 600);
            }
        }

        // Render a pending multiple-choice prompt as tappable options + custom answer
        function renderPrompt(p) {
            const el = document.createElement('div');
            el.className = 'sc-prompt';
            let html = `<div class="sc-prompt-q">❓ ${escapeHtml(p.question || 'The agent is asking a question')}</div>`;
            html += `<div class="sc-prompt-opts"></div>`;
            if (p.otherXpath) {
                html += `<div class="sc-prompt-other">
                    <input type="text" class="sc-prompt-input" placeholder="Write your own answer…">
                    <button class="sc-action sc-action-accept sc-prompt-send">Send</button>
                </div>`;
            }
            if (p.skipXpath) html += `<button class="sc-prompt-skip">Skip</button>`;
            el.innerHTML = html;

            const optsBox = el.querySelector('.sc-prompt-opts');
            (p.options || []).forEach(o => {
                const b = document.createElement('button');
                b.className = 'sc-action sc-prompt-opt';
                b.textContent = o.label;
                b.addEventListener('click', () => answerPrompt({ kind: 'option', optionXpath: o.xpath, submitXpath: p.submitXpath }, b, el));
                optsBox.appendChild(b);
            });

            if (p.otherXpath) {
                const input = el.querySelector('.sc-prompt-input');
                const send = el.querySelector('.sc-prompt-send');
                const doSend = () => {
                    const text = input.value.trim();
                    if (!text) return;
                    answerPrompt({ kind: 'other', otherXpath: p.otherXpath, text, submitXpath: p.submitXpath }, send, el);
                };
                send.addEventListener('click', doSend);
                input.addEventListener('keypress', e => { if (e.key === 'Enter') doSend(); });
            }
            if (p.skipXpath) {
                el.querySelector('.sc-prompt-skip').addEventListener('click', (e) =>
                    answerPrompt({ kind: 'skip', skipXpath: p.skipXpath }, e.target, el));
            }
            return el;
        }

        async function answerPrompt(payload, btn, card) {
            card.querySelectorAll('button, input').forEach(b => b.disabled = true);
            card.style.opacity = '0.6';
            try {
                const res = await authFetch('/api/chat/answer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();
                if (result.success) {
                    showToast('✓ Answer sent', 'success');
                    lastCascadeHash = null;       // force re-render on next poll
                    setTimeout(fetchLiveChat, 400);
                } else {
                    showToast(result.error || 'Failed to send', 'error');
                    card.querySelectorAll('button, input').forEach(b => b.disabled = false);
                    card.style.opacity = '';
                }
            } catch (e) {
                showToast('Network error', 'error');
                card.querySelectorAll('button, input').forEach(b => b.disabled = false);
                card.style.opacity = '';
            }
        }

        // ---- Artifact viewer (walkthroughs, reports, docs) ----------------
        let artifactOverlayOpen = false;

        function renderArtifactBanner(art) {
            const el = document.createElement('div');
            el.className = 'sc-artifact-banner';
            el.innerHTML = `<span class="sc-art-ico">📄</span><span class="sc-art-title">${escapeHtml(art.title)}</span><span class="sc-art-open">View ▸</span>`;
            el.addEventListener('click', () => openArtifactOverlay(art));
            return el;
        }

        function openArtifactOverlay(art) {
            artifactOverlayOpen = true;
            let ov = document.getElementById('scArtifactOverlay');
            if (!ov) {
                ov = document.createElement('div');
                ov.id = 'scArtifactOverlay';
                ov.className = 'sc-art-overlay';
                document.body.appendChild(ov);
            }
            ov.innerHTML = `
                <div class="sc-art-head">
                    <button class="sc-art-close" aria-label="Close">✕</button>
                    <div class="sc-art-head-title">${escapeHtml(art.title)}</div>
                    <div class="sc-art-nav">
                        <button class="sc-art-prev" ${art.prevXpath ? '' : 'disabled'}>‹ Prev</button>
                        <button class="sc-art-next" ${art.nextXpath ? '' : 'disabled'}>Next ›</button>
                    </div>
                </div>
                <div class="sc-art-body sc-prose">${art.html}</div>`;
            ov.style.display = 'flex';
            ov.querySelector('.sc-art-close').onclick = closeArtifactOverlay;
            const prev = ov.querySelector('.sc-art-prev');
            const next = ov.querySelector('.sc-art-next');
            if (art.prevXpath) prev.onclick = () => navArtifact(art.prevXpath);
            if (art.nextXpath) next.onclick = () => navArtifact(art.nextXpath);
        }

        function closeArtifactOverlay() {
            artifactOverlayOpen = false;
            const ov = document.getElementById('scArtifactOverlay');
            if (ov) ov.style.display = 'none';
        }

        async function navArtifact(xpath) {
            try {
                await authFetch('/api/cdp/click', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ xpath, text: 'artifact-nav' })
                });
                lastCascadeHash = null;            // force re-render to pull the new artifact
                setTimeout(fetchLiveChat, 400);
            } catch (e) { showToast('Network error', 'error'); }
        }

        async function fetchLiveChat() {
            if (!chatPollingActive) return;

            try {
                const res = await authFetch(`${serverUrl}/api/chat/structured`);
                const data = await res.json();
                const container = document.getElementById('cascade-container');

                if (data.found && data.messages) {
                    // Hash on message count + last text/activity + pending prompt
                    const last = data.messages[data.messages.length - 1] || {};
                    const promptKey = data.prompt ? 'P:' + (data.prompt.question || '') + '|' +
                        (data.prompt.options || []).map(o => o.label).join(',') : '';
                    const artKey = data.artifact ? 'A:' + data.artifact.title + '|' + data.artifact.html.length : '';
                    const hash = data.messages.length + '|' + (last.text || '').length + '|' +
                        (last.worked || '') + '|' + (last.actions || []).map(a => a.label).join(',') + '|' + promptKey + '|' + artKey;
                    if (hash === lastCascadeHash) return;
                    lastCascadeHash = hash;

                    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;

                    // Update model label if provided
                    if (data.model) {
                        const lbl = document.getElementById('currentModelLabel');
                        if (lbl && lbl.textContent !== data.model) lbl.textContent = data.model;
                    }

                    container.innerHTML = '';

                    // artifact banner (tap to open the reader) + live overlay refresh
                    if (data.artifact && data.artifact.open) {
                        container.appendChild(renderArtifactBanner(data.artifact));
                        if (artifactOverlayOpen) openArtifactOverlay(data.artifact);
                    } else if (artifactOverlayOpen) {
                        closeArtifactOverlay();   // artifact was closed in the IDE
                    }

                    if (data.messages.length === 0 && !data.artifact) {
                        container.innerHTML = `<div class="chat-empty"><span>No messages yet</span></div>`;
                    } else {
                        const frag = document.createDocumentFragment();
                        data.messages.forEach(m => frag.appendChild(renderMessage(m)));
                        container.appendChild(frag);
                    }

                    // pending multiple-choice prompt (sticks to the end)
                    if (data.prompt) container.appendChild(renderPrompt(data.prompt));

                    if (isAtBottom) {
                        setTimeout(() => { container.scrollTop = container.scrollHeight; }, 60);
                    }
                } else if (data.error) {
                    if (lastCascadeHash !== 'err:' + data.error) {
                        lastCascadeHash = 'err:' + data.error;
                        container.innerHTML = `<div class="chat-empty"><span class="icon">⚠️</span><span>${escapeHtml(data.error)}</span></div>`;
                    }
                }
            } catch (e) {
                console.log('Chat fetch error:', e);
            }
        }

        function startChatPolling() {
            if (chatPollTimer) return;
            chatPollingActive = true;
            lastCascadeHash = null;
            fetchLiveChat();
            const interval = parseInt(document.getElementById('refreshInterval').value) || 2000;
            chatPollTimer = setInterval(fetchLiveChat, interval);
        }

        function restartChatPolling() {
            // Restart polling with new interval
            if (chatPollTimer) {
                clearInterval(chatPollTimer);
                chatPollTimer = null;
            }
            if (chatPollingActive) {
                const interval = parseInt(document.getElementById('refreshInterval').value) || 2000;
                chatPollTimer = setInterval(fetchLiveChat, interval);
            }
        }

        // Wire up refresh interval change
        document.getElementById('refreshInterval').addEventListener('change', restartChatPolling);

        function stopChatPolling() {
            chatPollingActive = false;
            if (chatPollTimer) {
                clearInterval(chatPollTimer);
                chatPollTimer = null;
            }
        }


        // ====================================================================
        // File Browser
        // ====================================================================
        let currentFilePath = null;
        let previousActivePanel = 'chat'; // Track what was active before Files opened
