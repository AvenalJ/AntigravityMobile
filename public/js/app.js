/* ============================================
 * App — Initialization
 * ============================================ */

async function init() {
    loadTheme();
    loadSidebarState();
    await checkAuth();
    connectWebSocket();
    applyMobileUISettings();
    refreshTaskQueue();
    loadAssistChatHistory();
    loadAssistStatusBadge();

    if (typeof initChatLive === 'function') {
        initChatLive();
    }
}

init();

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { });
}
