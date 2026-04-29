/* ============================================
 * Files — Browser, viewer, editor, zoom
 * ============================================ */

        function openFilesPanel() {
            // Remember what panel was active before opening files
            const activeBtn = document.querySelector('.sidebar-item.active');
            if (activeBtn && activeBtn.dataset.panel !== 'files') {
                previousActivePanel = activeBtn.dataset.panel;
            }

            document.getElementById('filesOverlay').classList.add('open');
            document.getElementById('filesPanel').classList.add('open');
            document.body.classList.add('no-scroll'); // Prevent background scroll
            if (!currentFilePath) {
                loadFiles();
            }
        }

        function closeFilesPanel() {
            document.getElementById('filesOverlay').classList.remove('open');
            document.getElementById('filesPanel').classList.remove('open');
            document.body.classList.remove('no-scroll'); // Restore background scroll

            // Restore previous active nav button (only if Files was active)
            const filesBtn = document.querySelector('.sidebar-item[data-panel="files"]');
            if (filesBtn && filesBtn.classList.contains('active')) {
                document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
                document.querySelector(`.sidebar-item[data-panel="${previousActivePanel}"]`).classList.add('active');
            }

            // Stop file watching to save resources
            authFetch(`${serverUrl}/api/files/unwatch`, { method: 'POST' }).catch(() => { });
        }

        async function loadFiles(path = null) {
            try {
                const url = path ? `${serverUrl}/api/files?path=${encodeURIComponent(path)}` : `${serverUrl}/api/files`;
                const res = await authFetch(url);
                const data = await res.json();

                if (data.error) {
                    document.getElementById('filesList').innerHTML = `<div class="quota-error">${data.error}</div>`;
                    return;
                }

                currentFilePath = data.path;

                // Show breadcrumb (shortened)
                const breadcrumb = data.path.length > 40 ? '...' + data.path.slice(-37) : data.path;
                document.getElementById('filesBreadcrumb').textContent = breadcrumb;

                // Render file list
                let html = '';

                // Add "go up" option if not at root
                if (data.parent && data.parent !== data.path) {
                    html += `<div class="file-item" onclick="loadFiles('${escapeQuotes(data.parent)}')">
                            <span class="file-icon">⬆️</span>
                            <span class="file-name">..</span>
                        </div>`;
                }

                html += data.items.map(item => {
                    const icon = getFileIcon(item);
                    const size = item.isDirectory ? '' : formatSize(item.size);
                    const clickAction = item.isDirectory
                        ? `loadFiles('${escapeQuotes(item.path)}')`
                        : `viewFile('${escapeQuotes(item.path)}', '${item.extension || ''}')`;
                    return `<div class="file-item" onclick="${clickAction}">
                            <span class="file-icon">${icon}</span>
                            <span class="file-name">${escapeHtml(item.name)}</span>
                            <span class="file-size">${size}</span>
                        </div>`;
                }).join('');

                document.getElementById('filesList').innerHTML = html || '<div class="quota-error">Empty folder</div>';
            } catch (e) {
                document.getElementById('filesList').innerHTML = `<div class="quota-error">Error: ${e.message}</div>`;
            }
        }

        function getFileIcon(item) {
            if (item.isDirectory) return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
            const ext = (item.extension || '').toLowerCase();
            const docIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
            const codeIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';
            const imgIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
            const configIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v10M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m6 0h10M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"></path></svg>';

            const icons = {
                '.js': codeIcon, '.mjs': codeIcon, '.ts': codeIcon, '.jsx': codeIcon, '.tsx': codeIcon,
                '.json': docIcon, '.md': docIcon, '.txt': docIcon,
                '.html': codeIcon, '.css': codeIcon,
                '.py': codeIcon, '.sh': configIcon, '.bat': configIcon,
                '.png': imgIcon, '.jpg': imgIcon, '.jpeg': imgIcon, '.gif': imgIcon, '.webp': imgIcon, '.svg': imgIcon,
                '.yml': configIcon, '.yaml': configIcon, '.toml': configIcon
            };
            return icons[ext] || docIcon;
        }

        function formatSize(bytes) {
            if (!bytes) return '';
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        function escapeQuotes(str) {
            if (!str) return '';
            return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        }

        // ====================================================================
        // File Viewer
        // ====================================================================
        let currentViewingFile = null; // Track currently open file for editing

        // Map extensions to Highlight.js language names
        function getLanguage(ext) {
            const langMap = {
                '.js': 'javascript', '.mjs': 'javascript', '.ts': 'typescript',
                '.json': 'json', '.html': 'html', '.css': 'css',
                '.py': 'python', '.sh': 'bash', '.bat': 'dos',
                '.md': 'markdown', '.yml': 'yaml', '.yaml': 'yaml',
                '.xml': 'xml', '.sql': 'sql',
                '.txt': 'plaintext', '.log': 'plaintext', '.env': 'plaintext'
            };
            return langMap[ext] || 'plaintext';
        }
        // Image extensions
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];

        function isImageFile(ext) {
            return imageExtensions.includes((ext || '').toLowerCase());
        }

        async function viewFile(path, ext) {
            // Check if it's an image file
            if (isImageFile(ext)) {
                viewImageFile(path, ext);
                return;
            }

            // Text file handling
            try {
                const res = await authFetch(`${serverUrl}/api/files/content?path=${encodeURIComponent(path)}`);
                const data = await res.json();

                if (data.error) {
                    showToast(data.error, 'error');
                    return;
                }

                // Store current file path for editing
                currentViewingFile = path;

                const lang = getLanguage(data.extension);
                const codeEl = document.getElementById('fileViewerContent');

                // Reset the element for re-highlighting
                codeEl.removeAttribute('data-highlighted');
                codeEl.innerHTML = ''; // Clear previous highlighted HTML

                document.getElementById('fileViewerTitle').textContent = data.name;
                codeEl.textContent = data.content;
                codeEl.className = `language-${lang}`;

                // Apply syntax highlighting
                if (typeof hljs !== 'undefined' && lang !== 'plaintext') {
                    hljs.highlightElement(codeEl);
                }

                // Show text viewer, hide image viewer
                document.getElementById('viewerContent').style.display = 'block';
                document.getElementById('imageContent').style.display = 'none';
                document.getElementById('editBtn').style.display = 'inline-flex';

                document.getElementById('fileViewer').classList.add('open');
            } catch (e) {
                showToast('Failed to load file', 'error');
            }
        }

        async function viewImageFile(path, ext) {
            const filename = path.split(/[/\\]/).pop();
            document.getElementById('fileViewerTitle').textContent = filename;

            // Show image viewer, hide text viewer
            document.getElementById('viewerContent').style.display = 'none';
            document.getElementById('imageContent').style.display = 'flex';
            document.getElementById('editBtn').style.display = 'none'; // Can't edit images
            document.getElementById('editorContent').style.display = 'none';
            document.getElementById('editorActions').style.display = 'none';

            currentViewingFile = null; // Images not editable

            document.getElementById('fileViewer').classList.add('open');

            // Remove any existing overlay first
            const existingOverlay = document.getElementById('imageOverlay');
            if (existingOverlay) existingOverlay.remove();

            // Create loading overlay
            const overlay = document.createElement('div');
            overlay.id = 'imageOverlay';
            overlay.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: #000 !important;
        z-index: 99999 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
    `;

            // Show loading spinner first
            overlay.innerHTML = `
        <div style="position: absolute; top: 10px; left: 10px; right: 10px; display: flex; justify-content: space-between; align-items: center; z-index: 10;">
            <span style="color: white; font-size: 14px; font-weight: 600;">${filename}</span>
            <button onclick="closeImageOverlay()" style="width: 40px; height: 40px; border: none; background: rgba(255,255,255,0.2); color: white; font-size: 20px; border-radius: 50%; cursor: pointer;">✕</button>
        </div>
        <div id="imageLoader" style="display: flex; flex-direction: column; align-items: center; gap: 16px;">
            <div style="width: 48px; height: 48px; border: 3px solid rgba(255,255,255,0.1); border-top-color: #0ea5e9; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <span style="color: rgba(255,255,255,0.7); font-size: 14px;">Loading image...</span>
        </div>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
            document.body.appendChild(overlay);

            // Fetch image with auth token
            try {
                const imgUrl = `${serverUrl}/api/files/raw?path=${encodeURIComponent(path)}`;
                const res = await authFetch(imgUrl);

                if (!res.ok) {
                    showToast('Failed to load image', 'error');
                    closeImageOverlay();
                    return;
                }

                const blob = await res.blob();
                const objectUrl = URL.createObjectURL(blob);

                // Replace loading with actual image content
                overlay.innerHTML = `
            <div style="position: absolute; top: 10px; left: 10px; right: 10px; display: flex; justify-content: space-between; align-items: center; z-index: 10;">
                <span style="color: white; font-size: 14px; font-weight: 600;">${filename}</span>
                <button onclick="closeImageOverlay()" style="width: 40px; height: 40px; border: none; background: rgba(255,255,255,0.2); color: white; font-size: 20px; border-radius: 50%; cursor: pointer;">✕</button>
            </div>
            <div style="position: absolute; top: 60px; display: flex; gap: 8px; padding: 6px 12px; background: rgba(0,0,0,0.7); border-radius: 20px; z-index: 10;">
                <button onclick="zoomImage(-1)" style="width: 32px; height: 32px; border: none; background: rgba(255,255,255,0.15); color: white; font-size: 18px; border-radius: 50%; cursor: pointer;">−</button>
                <span id="zoomLevel" style="color: white; font-size: 13px; font-weight: 600; min-width: 50px; text-align: center; line-height: 32px;">100%</span>
                <button onclick="zoomImage(1)" style="width: 32px; height: 32px; border: none; background: rgba(255,255,255,0.15); color: white; font-size: 18px; border-radius: 50%; cursor: pointer;">+</button>
                <button onclick="resetZoom()" style="width: 32px; height: 32px; border: none; background: rgba(255,255,255,0.15); color: white; font-size: 18px; border-radius: 50%; cursor: pointer;">↺</button>
            </div>
            <div id="imageWrapper" style="flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; height: calc(100% - 120px); padding: 20px; overflow: auto;">
                <img src="${objectUrl}" alt="Image preview" id="zoomableImage" style="max-width: 100%; max-height: 100%; object-fit: contain; transition: transform 0.15s ease-out;">
            </div>
            <div style="position: absolute; bottom: 12px; color: rgba(255,255,255,0.5); font-size: 11px; padding: 4px 12px; background: rgba(0,0,0,0.5); border-radius: 12px;">Pinch to zoom • Double-tap to fit</div>
        `;

                initImageZoom();
            } catch (e) {
                showToast('Error loading image', 'error');
                closeImageOverlay();
            }
        }

        function closeImageOverlay() {
            const overlay = document.getElementById('imageOverlay');
            if (overlay) overlay.remove();
            closeFileViewer();
        }

        // ====================================================================
        // Image Zoom Functionality
        // ====================================================================
        let currentZoom = 1;
        let imageTranslateX = 0;
        let imageTranslateY = 0;

        function initImageZoom() {
            currentZoom = 1;
            imageTranslateX = 0;
            imageTranslateY = 0;

            const wrapper = document.getElementById('imageWrapper');
            const img = document.getElementById('zoomableImage');
            if (!wrapper || !img) return;

            let lastTouchEnd = 0;
            let initialDistance = 0;
            let initialZoom = 1;

            // Double-tap to toggle fit/actual size
            wrapper.addEventListener('touchend', (e) => {
                const now = Date.now();
                if (now - lastTouchEnd < 300 && e.changedTouches.length === 1) {
                    e.preventDefault();
                    if (currentZoom === 1) {
                        // Fit to width
                        const containerWidth = wrapper.clientWidth;
                        const imgWidth = img.naturalWidth;
                        currentZoom = Math.min(containerWidth / imgWidth, 3);
                    } else {
                        resetZoom();
                    }
                    updateZoom();
                }
                lastTouchEnd = now;
            });

            // Pinch to zoom
            wrapper.addEventListener('touchstart', (e) => {
                if (e.touches.length === 2) {
                    initialDistance = getDistance(e.touches[0], e.touches[1]);
                    initialZoom = currentZoom;
                }
            });

            wrapper.addEventListener('touchmove', (e) => {
                if (e.touches.length === 2) {
                    e.preventDefault();
                    const distance = getDistance(e.touches[0], e.touches[1]);
                    const scale = distance / initialDistance;
                    currentZoom = Math.min(Math.max(initialZoom * scale, 0.5), 5);
                    updateZoom();
                }
            }, { passive: false });

            // Mouse wheel zoom for desktop
            wrapper.addEventListener('wheel', (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.2 : 0.2;
                currentZoom = Math.min(Math.max(currentZoom + delta, 0.5), 5);
                updateZoom();
            }, { passive: false });
        }

        function getDistance(touch1, touch2) {
            const dx = touch1.clientX - touch2.clientX;
            const dy = touch1.clientY - touch2.clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function zoomImage(direction) {
            currentZoom = Math.min(Math.max(currentZoom + direction * 0.25, 0.5), 5);
            updateZoom();
        }

        function resetZoom() {
            currentZoom = 1;
            imageTranslateX = 0;
            imageTranslateY = 0;
            updateZoom();
        }

        function updateZoom() {
            const img = document.getElementById('zoomableImage');
            const levelEl = document.getElementById('zoomLevel');
            if (img) {
                img.style.transform = `scale(${currentZoom}) translate(${imageTranslateX}px, ${imageTranslateY}px)`;
            }
            if (levelEl) {
                levelEl.textContent = Math.round(currentZoom * 100) + '%';
            }
        }

        function closeFileViewer() {
            document.getElementById('fileViewer').classList.remove('open');
            // Reset to view mode when closing
            cancelEditing();
            // Clear image src to free memory
            document.getElementById('imagePreview').src = '';
        }

        // ====================================================================
        // File Editing
        // ====================================================================
        let isEditing = false;

        function startEditing() {
            if (!currentViewingFile) return;

            isEditing = true;
            const content = document.getElementById('fileViewerContent').textContent;
            document.getElementById('fileEditor').value = content;

            // Show editor, hide viewer
            document.getElementById('viewerContent').style.display = 'none';
            document.getElementById('editorContent').style.display = 'block';
            document.getElementById('editorActions').style.display = 'flex';
            document.getElementById('editBtn').style.display = 'none';
        }

        function cancelEditing() {
            isEditing = false;
            document.getElementById('viewerContent').style.display = 'block';
            document.getElementById('editorContent').style.display = 'none';
            document.getElementById('editorActions').style.display = 'none';
            document.getElementById('editBtn').style.display = 'inline-flex';
        }

        async function saveFile() {
            if (!currentViewingFile) return;

            const content = document.getElementById('fileEditor').value;

            try {
                const res = await authFetch(`${serverUrl}/api/files/save`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: currentViewingFile, content })
                });
                const data = await res.json();

                if (data.error) {
                    showToast(data.error, 'error');
                    return;
                }

                showToast('File saved!', 'success');

                // Update the viewer with new content
                document.getElementById('fileViewerContent').textContent = content;
                cancelEditing();

                // Re-apply syntax highlighting
                const codeEl = document.getElementById('fileViewerContent');
                codeEl.removeAttribute('data-highlighted');
                if (typeof hljs !== 'undefined') {
                    hljs.highlightElement(codeEl);
                }
            } catch (e) {
                showToast('Save failed', 'error');
            }
        }

        // ====================================================================
        // Init
        // ====================================================================
        async function applyMobileUISettings() {
            try {
                const res = await authFetch('/api/admin/mobile-ui');
                const settings = await res.json();

                // Quick actions visibility — use CSS class so it persists through DOM updates
                if (settings.showQuickActions === false) {
                    document.body.classList.add('hide-quick-actions');
                } else {
                    document.body.classList.remove('hide-quick-actions');
                }

                // Navigation mode
                if (settings.navigationMode === 'topbar') {
                    document.body.classList.add('topbar-mode');
                    document.body.classList.remove('sidebar-mode');
                } else {
                    document.body.classList.add('sidebar-mode');
                    document.body.classList.remove('topbar-mode');
                }

                // Assist tab visibility
                const showAssist = settings.showAssistTab || false;
                const sidebarAssistBtn = document.getElementById('sidebarAssistBtn');
                const topbarAssistBtn = document.getElementById('topbarAssistBtn');
                if (sidebarAssistBtn) sidebarAssistBtn.style.display = showAssist ? '' : 'none';
                if (topbarAssistBtn) topbarAssistBtn.style.display = showAssist ? '' : 'none';
                // Re-bind events for dynamically shown assist buttons
                if (showAssist) {
                    if (sidebarAssistBtn && !sidebarAssistBtn._bound) {
                        sidebarAssistBtn.addEventListener('click', () => switchPanel('assist', '.sidebar-item'));
                        sidebarAssistBtn._bound = true;
                    }
                    if (topbarAssistBtn && !topbarAssistBtn._bound) {
                        topbarAssistBtn.addEventListener('click', () => switchPanel('assist', '.topbar-btn'));
                        topbarAssistBtn._bound = true;
                    }
                }
            } catch (e) { }
        }

        // ====================================================================
        // Assist Chat Functions
        // ====================================================================
