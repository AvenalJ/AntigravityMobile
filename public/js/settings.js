/* ============================================
 * Settings — Config, commands, quota
 * ============================================ */

        async function loadSettings() {
            try {
                const res = await authFetch(`${serverUrl}/api/cdp/status`);
                const data = await res.json();
                const el = document.getElementById('cdpStatus');
                if (data.available) {
                    el.innerHTML = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Active';
                    el.style.color = 'var(--success)';
                } else {
                    el.innerHTML = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Offline';
                    el.style.color = 'var(--error)';
                }
            } catch {
                const el = document.getElementById('cdpStatus');
                el.innerHTML = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Error';
                el.style.color = 'var(--error)';
            }
            // Also load quota when settings panel opens
            loadQuota();
            loadMobileCommands();
            loadWorkspaceTargets();
        }

        // ====================================================================
        // Workspace Target Selection
        // ====================================================================
        async function loadWorkspaceTargets() {
            try {
                const res = await authFetch('/api/cdp/targets');
                if (!res.ok) return;
                const data = await res.json();
                
                const select = document.getElementById('workspaceSelect');
                if (!select) return;
                
                // Clear existing options except Auto-detect
                while (select.options.length > 1) {
                    select.remove(1);
                }
                
                // Extract unique project names from targets
                const workspaces = new Set();
                const pages = (data.targets || []).filter(t => t.type === 'page' && !t.url.includes('devtools'));
                
                for (const page of pages) {
                    // Match "ProjectName — filename" or "ProjectName - Antigravity - filename"
                    const match = page.title.match(/^([^\u2014-]+)\s*[\u2014-]/);
                    if (match && match[1]) {
                        workspaces.add(match[1].trim());
                    }
                }
                
                // Add to dropdown
                for (const ws of workspaces) {
                    const option = document.createElement('option');
                    option.value = ws;
                    option.textContent = ws;
                    select.appendChild(option);
                }
                
                // Select the current target if set
                try {
                    const statusRes = await authFetch('/api/status');
                    const statusData = await statusRes.json();
                    if (statusData.cdp && statusData.cdp.targetWorkspace) {
                        select.value = statusData.cdp.targetWorkspace;
                    }
                } catch(e) {}
                
            } catch(e) {
                console.error('Failed to load workspace targets:', e);
            }
        }

        async function setWorkspaceTarget(workspace) {
            try {
                const res = await authFetch('/api/cdp/workspace', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workspace: workspace || null })
                });
                const data = await res.json();
                if (data.success) {
                    showToast('Workspace target updated', 'success');
                    // Force refresh to grab new workspace context
                    if (typeof fetchLiveChat === 'function') fetchLiveChat();
                } else {
                    showToast('Failed to update target', 'error');
                }
            } catch (e) {
                showToast('Network error updating target', 'error');
            }
        }

        // ====================================================================
        // Quick Commands (Mobile)
        // ====================================================================
        async function loadMobileCommands() {
            const container = document.getElementById('mobileCommandsContainer');
            try {
                const res = await authFetch('/api/admin/commands');
                const data = await res.json();
                const commands = data.commands || [];
                if (commands.length === 0) {
                    container.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">No commands configured. Add them in the Admin Panel.</div>';
                    return;
                }
                container.innerHTML = commands.map((cmd, i) => `
                        <div class="setting-row" style="cursor: pointer;" onclick="executeMobileCommand(${i}, '${cmd.prompt.replace(/'/g, "\\'")}')">
                            <div class="setting-label">
                                <h4>${cmd.icon || '⚡'} ${cmd.label}</h4>
                                <p>${cmd.prompt.slice(0, 50)}${cmd.prompt.length > 50 ? '...' : ''}</p>
                            </div>
                            <div class="setting-value" id="cmdStatus${i}" style="font-size: 12px;">▶</div>
                        </div>
                    `).join('');
            } catch (e) { container.innerHTML = '<div style="color: var(--error); padding: 8px;">Failed to load commands</div>'; }
        }

        async function executeMobileCommand(index, prompt) {
            const statusEl = document.getElementById(`cmdStatus${index}`);
            statusEl.textContent = '⏳';
            try {
                const res = await authFetch('/api/commands/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
                const result = await res.json();
                statusEl.textContent = result.success ? '✅' : '❌';
                setTimeout(() => statusEl.textContent = '▶', 3000);
            } catch (e) {
                statusEl.textContent = '❌';
                setTimeout(() => statusEl.textContent = '▶', 3000);
            }
        }

        // ====================================================================
        // Quota Display
        // ====================================================================
        let quotaData = null;
        let quotaLoading = false;

        async function loadQuota() {
            if (quotaLoading) return;
            quotaLoading = true;

            const container = document.getElementById('quotaContainer');
            container.innerHTML = `
                    <div class="quota-loading">
                        <div class="spinner"></div>
                        <div style="margin-top: 10px;">Loading quota data...</div>
                    </div>
                `;

            try {
                const res = await authFetch(`${serverUrl}/api/quota`);
                const data = await res.json();
                quotaData = data;
                renderQuota(data);
            } catch (e) {
                container.innerHTML = `
                        <div class="quota-error">
                            <div style="font-size: 32px; opacity: 0.5; margin-bottom: 10px;">⚠️</div>
                            <div>Failed to load quota data</div>
                            <div style="font-size: 11px; margin-top: 6px; opacity: 0.7;">${e.message}</div>
                        </div>
                    `;
            } finally {
                quotaLoading = false;
            }
        }

        function renderQuota(data) {
            const container = document.getElementById('quotaContainer');

            if (!data.available || !data.models || data.models.length === 0) {
                container.innerHTML = `
                        <div class="quota-error">
                            <div style="font-size: 32px; opacity: 0.5; margin-bottom: 10px;">🔌</div>
                            <div>${data.error || 'No quota data available'}</div>
                            <div style="font-size: 11px; margin-top: 6px; opacity: 0.7;">Make sure Antigravity is running</div>
                        </div>
                    `;
                return;
            }

            const circumference = 2 * Math.PI * 34; // radius = 34

            container.innerHTML = `
                    <div class="quota-grid">
                        ${data.models.map(model => {
                const percent = Math.max(0, Math.min(100, model.remainingPercent || 0));
                const offset = circumference - (percent / 100) * circumference;
                const displayName = formatModelName(model.name);
                const statusLabel = getStatusLabel(model.status);

                return `
                                <div class="quota-card">
                                    <div class="quota-ring">
                                        <svg viewBox="0 0 80 80">
                                            <circle class="ring-bg" cx="40" cy="40" r="34"></circle>
                                            <circle class="ring-progress ${model.status}" 
                                                cx="40" cy="40" r="34"
                                                stroke-dasharray="${circumference}"
                                                stroke-dashoffset="${offset}">
                                            </circle>
                                        </svg>
                                        <div class="quota-percent ${model.status}">${percent.toFixed(0)}%</div>
                                    </div>
                                    <div class="quota-model-name" title="${model.name}">${displayName}</div>
                                    <div class="quota-reset">
                                        ${model.resetIn ? `Reset: ${model.resetIn}` : ''}
                                    </div>
                                    <span class="quota-status-badge ${model.status}">${statusLabel}</span>
                                </div>
                            `;
            }).join('')}
                    </div>
                `;
        }

        function formatModelName(name) {
            // Shorten long model names
            if (!name) return 'Unknown';
            // Remove common prefixes and clean up
            return name
                .replace(/^MODEL_/, '')
                .replace(/_/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ')
                .substring(0, 20);
        }

        function getStatusLabel(status) {
            const labels = {
                'healthy': 'Healthy',
                'warning': 'Warning',
                'danger': 'Danger',
                'exhausted': 'Exhausted'
            };
            return labels[status] || status || 'Unknown';
        }

        async function clearAllData() {
            chatMessages = [];
            renderChat();
            await authFetch(`${serverUrl}/api/messages/clear`, { method: 'POST' });
            showToast('Data cleared', 'success');
        }
