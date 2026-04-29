        let chatLiveInitialized = false;

        async function initChatLive() {
            if (chatLiveInitialized) return;
            chatLiveInitialized = true;

            loadModelsAndModes();
            startChatPolling();
        }

        async function loadModelsAndModes() {
            try {
                const res = await authFetch('/api/models');
                const data = await res.json();

                availableModels = data.models || [];
                currentModel = data.currentModel || 'Unknown';
                currentMode = data.currentMode || 'Planning';

                document.getElementById('currentModelLabel').textContent = currentModel;
                document.getElementById('currentModeLabel').textContent = currentMode.replace(/\s+/g, ' ').split(' ')[0];

                const modelList = document.getElementById('modelList');
                modelList.innerHTML = availableModels.map(model => `
                        <div class="dropdown-item ${model === currentModel ? 'active' : ''}" onclick="selectModel('${escapeHtml(model)}')">
                            ${escapeHtml(model)}
                        </div>
                    `).join('');
            } catch (e) {
                document.getElementById('currentModelLabel').textContent = 'Not connected';
            }
        }

        let dropdownDebounce = false;
        function toggleModelDropdown(event) {
            if (event) event.stopPropagation();
            if (dropdownDebounce) return;
            dropdownDebounce = true;
            setTimeout(() => dropdownDebounce = false, 100);

            const dropdown = document.getElementById('modelDropdown');
            const modeDropdown = document.getElementById('modeDropdown');
            modeDropdown.style.display = 'none';
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
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

        let modelChanging = false;
        let modeChanging = false;

        async function selectModel(modelName) {
            if (modelChanging) return;
            modelChanging = true;
            closeAllDropdowns();
            document.getElementById('currentModelLabel').textContent = 'Changing...';

            try {
                const res = await authFetch('/api/models/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: modelName })
                });
                const result = await res.json();

                if (result.success) {
                    currentModel = result.selected || modelName;
                    document.getElementById('currentModelLabel').textContent = currentModel;
                    showToast(`Model: ${currentModel}`, 'success');
                } else {
                    document.getElementById('currentModelLabel').textContent = currentModel;
                    showToast(result.error || 'Failed to change model', 'error');
                }
            } catch (e) {
                document.getElementById('currentModelLabel').textContent = currentModel;
                showToast('Network error', 'error');
            } finally {
                modelChanging = false;
            }
        }

        async function selectMode(modeName) {
            if (modeChanging) return;
            modeChanging = true;
            closeAllDropdowns();
            document.getElementById('currentModeLabel').textContent = '...';

            try {
                const res = await authFetch('/api/modes/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: modeName })
                });
                const result = await res.json();

                if (result.success) {
                    currentMode = modeName;
                    document.getElementById('currentModeLabel').textContent = modeName;
                    showToast(`Mode: ${modeName}`, 'success');
                } else {
                    document.getElementById('currentModeLabel').textContent = currentMode;
                    showToast(result.error || 'Failed to change mode', 'error');
                }
            } catch (e) {
                document.getElementById('currentModeLabel').textContent = currentMode;
                showToast('Network error', 'error');
            } finally {
                modeChanging = false;
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
                // Skip elements already bound to prevent duplicate listeners on re-render
                if (el.dataset.bound) return;

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

                // Tag for CSS styling and deduplication
                el.setAttribute('data-mobile-action', action);
                el.dataset.bound = '1';

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
            const icon = document.createElement('span');
            icon.textContent = type === 'success' ? '✓' : '✕';
            toast.appendChild(icon);
            toast.appendChild(document.createTextNode(' ' + message));
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

        function quickHash(str) {
            let h = 0;
            for (let i = 0; i < str.length; i++) {
                h = ((h << 5) - h) + str.charCodeAt(i);
                h = h & h;
            }
            return h.toString(36);
        }

        // ====================================================================
        // UI Sanitizer for Mobile
        // ====================================================================
        function sanitizeIDEView(container) {
            if (!container) return;

            // 1. Hide <bdi> elements (file paths in list rows)
            container.querySelectorAll('bdi').forEach(el => {
                el.style.display = 'none';
            });

            // 2. Hide codicon text labels (icon font ligatures that render as text on mobile)
            const ICON_LABELS = new Set(['undo', 'redo', 'thumb_up', 'thumb_down', 'content_copy', 'chevron_right', 'chevron_left']);
            container.querySelectorAll('.codicon, [class*="codicon-"]').forEach(el => {
                const text = (el.textContent || '').trim().toLowerCase();
                if (ICON_LABELS.has(text)) el.style.display = 'none';
            });

            // 3. Flatten list rows to prevent merging
            container.querySelectorAll('.monaco-list-row').forEach(row => {
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.overflow = 'hidden';
            });
        }

        async function fetchLiveChat() {
            if (!chatPollingActive) return;

            try {
                const res = await authFetch(`${serverUrl}/api/chat/snapshot`);
                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    document.getElementById('cascade-container').innerHTML = `
                        <div class="chat-empty">
                            <span class="icon">⚠️</span>
                            <span>${errorData.error || 'Connection error (' + res.status + ')'}</span>
                        </div>
                    `;
                    return;
                }
                const data = await res.json();

                if (data.html) {
                    const hash = quickHash(data.html);
                    if (hash !== lastCascadeHash) {
                        lastCascadeHash = hash;

                        // Inject CSS (always update to apply fixes)
                        if (data.css) {
                            const styleEl = document.getElementById('cascadeStyles');
                            styleEl.textContent = `
                                ${data.css}
                                /* Fixes for empty space and scrolling */
                                #cascade-container {
                                    background: transparent !important;
                                    width: 100% !important;
                                    height: auto !important;
                                    overflow-y: auto !important;
                                    overflow-x: hidden !important;
                                    max-height: none !important;
                                    position: relative !important;
                                    overscroll-behavior-y: contain !important;
                                }

                                /* Hide virtualized scroll placeholders */
                                #cascade-container [style*="min-height"] {
                                    min-height: 0 !important;
                                }
                                #cascade-container .bg-gray-500\\/10:not(:has(*)),
                                #cascade-container [class*="bg-gray-500"]:not(:has(*)) {
                                    display: none !important;
                                }

                                /* Remove redundant file paths that merge with text on mobile */
                                #cascade-container .label-description,
                                #cascade-container .monaco-icon-label-description-container,
                                #cascade-container .monaco-list-row .description,
                                #cascade-container [class*="description"],
                                #cascade-container [class*="path-label"] {
                                    display: none !important;
                                }

                                /* Ensure text doesn't overflow and merge */
                                #cascade-container .monaco-list-row {
                                    overflow: hidden !important;
                                    text-overflow: ellipsis !important;
                                    white-space: nowrap !important;
                                }

                                /* 1. Define the missing variable so ALL text using it becomes visible */
                                #cascade-container {
                                    --ide-text-color: var(--text-primary) !important;
                                }

                                /* Ensure codicon font renders properly on mobile */
                                #cascade-container .codicon,
                                #cascade-container [class*="codicon-"],
                                #cascade-container [class*="icon-"] {
                                    font-family: 'codicon' !important;
                                    font-style: normal !important;
                                    font-weight: normal !important;
                                    display: inline-block !important;
                                    text-transform: none !important;
                                    line-height: 1 !important;
                                    -webkit-font-smoothing: antialiased !important;
                                }

                                /* Fix for specific double-rendering or blurry icons */
                                #cascade-container .codicon:before,
                                #cascade-container [class*="codicon-"]:before {
                                    display: inline-block !important;
                                    vertical-align: middle !important;
                                }
                            `;
                        }

                        const container = document.getElementById('cascade-container');
                        const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

                        container.innerHTML = data.html;

                        // Sanitize UI for mobile (hide labels/paths that CSS might miss)
                        sanitizeIDEView(container);

                        // Attach click handlers for approval buttons in the injected content
                        attachInteractiveHandlers(container);

                        // Scroll to bottom if was at bottom
                        if (isAtBottom) {
                            setTimeout(() => {
                                if (container.lastElementChild) {
                                    container.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
                                } else {
                                    container.scrollTop = container.scrollHeight;
                                }
                            }, 100);
                        }
                    }
                } else if (data.error) {
                    document.getElementById('cascade-container').innerHTML = `
                        <div class="chat-empty">
                            <span class="icon">⚠️</span>
                            <span>${data.error}</span>
                        </div>
                    `;
                }
            } catch (e) {
                // Silently handle network errors during polling
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

        // initChatLive() is called from app.js after auth completes
