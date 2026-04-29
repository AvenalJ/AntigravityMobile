/* ============================================
 * App — Initialization
 * ============================================ */

async function init() {
    loadTheme();
    loadSidebarState();
    await checkAuth();
    connectWebSocket();
    loadModelsAndModes();
    applyMobileUISettings();
    refreshTaskQueue();
    loadAssistChatHistory();
    loadAssistStatusBadge();
    
    // Initialize Chat Live components
    if (typeof initChatLive === 'function') {
        initChatLive();
    }
}

init();

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { });
}
