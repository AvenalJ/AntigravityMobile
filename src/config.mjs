/**
 * Config Manager - Centralized configuration with JSON file persistence
 * 
 * Stores config in data/config.json
 * Provides load/save/get/update methods
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, 'data', 'config.json');

const DEFAULT_CONFIG = {
    server: {
        port: 3001,
        pin: null  // null = no auth, string = PIN hash
    },
    telegram: {
        enabled: false,
        botToken: '',
        chatId: '',
        notifications: {
            onComplete: true,
            onError: true,
            onInputNeeded: true
        }
    },
    dashboard: {
        refreshInterval: 2000,
        theme: 'dark'
    },
    devices: [
        { name: 'Default', cdpPort: 9222, active: true }
    ],
    quickCommands: [
        { label: 'Run Tests', prompt: 'Run all tests and report results', icon: '🧪' },
        { label: 'Git Status', prompt: 'Show git status, recent commits, and any uncommitted changes', icon: '📊' },
        { label: 'Build', prompt: 'Build the project and report any errors', icon: '🔨' }
    ],
    scheduledScreenshots: {
        enabled: true,
        intervalMs: 30000
    },
    mobileUI: {
        showQuickActions: true,
        navigationMode: 'sidebar',  // 'sidebar' or 'topbar'
        theme: 'dark'
    },
    autoAcceptCommands: false,
    tunnel: {
        autoStart: false
    }
};

let config = null;

/**
 * Deep merge source into target (target values are overwritten by source)
 */
function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
            && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
            result[key] = deepMerge(target[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

/**
 * Load config from disk, merging with defaults for any missing keys
 */
export function loadConfig() {
    const dataDir = join(__dirname, 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    if (existsSync(CONFIG_FILE)) {
        try {
            const raw = readFileSync(CONFIG_FILE, 'utf-8');
            const saved = JSON.parse(raw);
            config = deepMerge(DEFAULT_CONFIG, saved);
            console.log('📋 Config loaded from', CONFIG_FILE);
        } catch (e) {
            console.error('⚠️ Failed to parse config, using defaults:', e.message);
            config = { ...DEFAULT_CONFIG };
        }
    } else {
        config = { ...DEFAULT_CONFIG };
        saveConfig();
        console.log('📋 Created default config at', CONFIG_FILE);
    }

    return config;
}

/**
 * Save current config to disk
 */
export function saveConfig() {
    const dataDir = join(__dirname, 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    try {
        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (e) {
        console.error('⚠️ Failed to save config:', e.message);
    }
}

/**
 * Get current config (or a nested path)
 * @param {string} [path] - Dot-separated path like 'telegram.botToken'
 */
export function getConfig(path) {
    if (!config) loadConfig();
    if (!path) return config;

    return path.split('.').reduce((obj, key) => obj?.[key], config);
}

/**
 * Update a config value by dot-path and save
 * @param {string} path - Dot-separated path like 'telegram.enabled'
 * @param {*} value - New value
 */
export function updateConfig(path, value) {
    if (!config) loadConfig();

    const keys = path.split('.');
    let obj = config;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') {
            obj[keys[i]] = {};
        }
        obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    saveConfig();
}

/**
 * Bulk update config (partial merge) and save
 * @param {object} partial - Partial config object to merge
 */
export function mergeConfig(partial) {
    if (!config) loadConfig();
    config = deepMerge(config, partial);
    saveConfig();
    return config;
}
