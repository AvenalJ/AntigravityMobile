/* ============================================
 * App — Initialization
 * ============================================ */

async function init() {
    loadTheme();
    loadSidebarState();
    await checkAuth();
    connectWebSocket();
    startChatPolling();
    loadModelsAndModes();
    applyMobileUISettings();
    refreshTaskQueue();
    loadAssistChatHistory();
    loadAssistStatusBadge();
    // Usage (model quota) shown front-and-centre on the main view; refresh periodically.
    initUsageHero();
    if (localStorage.getItem('ag_usage_hero_closed') !== 'true') { loadQuota('usageHero'); }
    setInterval(() => loadQuota('usageHero'), 60000);
}

init();

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { });
}
