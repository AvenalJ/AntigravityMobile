/* ============================================
 * WebSocket — Connection, message handling
 * ============================================ */

        let wsReconnectDelay = 2000;
        const WS_MAX_DELAY = 30000;
        let wsReconnectTimer = null;

        function connectWebSocket() {
            if (wsReconnectTimer) {
                clearTimeout(wsReconnectTimer);
                wsReconnectTimer = null;
            }

            const wsUrl = serverUrl.replace(/^http/, 'ws');
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                wsReconnectDelay = 2000; // reset backoff on successful connect
                updateStatus(true);
                const wsEl = document.getElementById('wsStatus');
                wsEl.innerHTML = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Connected';
                wsEl.style.color = 'var(--success)';
            };

            ws.onclose = () => {
                updateStatus(false);
                const wsEl = document.getElementById('wsStatus');
                wsEl.innerHTML = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Disconnected';
                wsEl.style.color = 'var(--error)';
                scheduleWsReconnect();
            };

            ws.onerror = () => updateStatus(false);

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                } catch (e) { }
            };
        }

        function scheduleWsReconnect() {
            // Don't hammer reconnects while tab is hidden; wake up on visibility restore
            if (document.hidden) {
                const onVisible = () => {
                    document.removeEventListener('visibilitychange', onVisible);
                    connectWebSocket();
                };
                document.addEventListener('visibilitychange', onVisible);
                return;
            }
            wsReconnectTimer = setTimeout(() => {
                wsReconnectTimer = null;
                connectWebSocket();
            }, wsReconnectDelay);
            // Exponential backoff: 2s → 4s → 8s → … → 30s max
            wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_MAX_DELAY);
        }

        function handleMessage(data) {
            if (data.event === 'history') {
                data.data.messages.forEach(msg => addChatMessage(msg, false));
            } else if (data.event === 'message' || data.event === 'mobile_command') {
                addChatMessage(data.data, true);
            } else if (data.event === 'file_changed') {
                handleFileChanged(data.data);
            } else if (data.event === 'workspace_changed') {
                handleWorkspaceChanged(data.data);
            }
        }

        function handleWorkspaceChanged(data) {
            const workspaceLabel = document.getElementById('workspaceLabel');
            if (workspaceLabel) {
                workspaceLabel.textContent = data.projectName || 'Files';
            }

            const filesPanel = document.getElementById('filesPanel');
            if (filesPanel.classList.contains('open')) {
                currentFilePath = '';
                loadFiles('');
                showToast('Switched to: ' + data.projectName, 'status');
            }
        }

        function handleFileChanged(data) {
            const filesPanel = document.getElementById('filesPanel');
            if (!filesPanel.classList.contains('open')) return;

            if (currentFilePath) {
                loadFiles(currentFilePath);
            }

            if (currentViewingFile && data.filename) {
                const viewingFilename = currentViewingFile.split(/[/\\]/).pop();
                if (viewingFilename === data.filename) {
                    showToast('File changed - tap to reload', 'status');
                }
            }
        }
