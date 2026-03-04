/**
 * Tunnel Manager — Cloudflare Quick Tunnel (no account needed)
 * 
 * Spawns a `cloudflared tunnel` child process to expose the local server
 * on a random *.trycloudflare.com HTTPS URL.
 * 
 * Usage:
 *   import { startTunnel, stopTunnel, getTunnelStatus } from './tunnel.mjs';
 *   const result = await startTunnel(3001);
 *   // result = { success: true, url: 'https://random-words.trycloudflare.com' }
 */

import { spawn } from 'child_process';

let tunnelProcess = null;
let tunnelUrl = null;
let tunnelError = null;
let startingUp = false;

/**
 * Start a Cloudflare quick tunnel pointing at the given local port.
 * Returns a promise that resolves once the public URL is captured.
 * @param {number} port - Local port to tunnel (e.g. 3001)
 * @param {number} [timeoutMs=30000] - Max time to wait for URL
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
export function startTunnel(port, timeoutMs = 30000) {
    return new Promise((resolve) => {
        if (tunnelProcess) {
            return resolve({ success: false, error: 'Tunnel already running', url: tunnelUrl });
        }

        startingUp = true;
        tunnelUrl = null;
        tunnelError = null;

        try {
            tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });
        } catch (e) {
            startingUp = false;
            tunnelError = 'cloudflared not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/';
            return resolve({ success: false, error: tunnelError });
        }

        let resolved = false;
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                startingUp = false;
                if (!tunnelUrl) {
                    tunnelError = 'Timed out waiting for tunnel URL';
                    resolve({ success: false, error: tunnelError });
                }
            }
        }, timeoutMs);

        const handleOutput = (data) => {
            const text = data.toString();
            // cloudflared prints the URL in stderr with a line like:
            // | https://random-words.trycloudflare.com |
            // or: INF +---... https://....trycloudflare.com ...
            const urlMatch = text.match(/(https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com)/);
            if (urlMatch && !resolved) {
                resolved = true;
                startingUp = false;
                tunnelUrl = urlMatch[1];
                tunnelError = null;
                clearTimeout(timer);
                console.log(`🌐 Tunnel active: ${tunnelUrl}`);
                resolve({ success: true, url: tunnelUrl });
            }
        };

        tunnelProcess.stdout.on('data', handleOutput);
        tunnelProcess.stderr.on('data', handleOutput);

        tunnelProcess.on('error', (err) => {
            startingUp = false;
            tunnelError = err.code === 'ENOENT'
                ? 'cloudflared not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
                : `Tunnel error: ${err.message}`;
            tunnelProcess = null;
            if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                resolve({ success: false, error: tunnelError });
            }
        });

        tunnelProcess.on('exit', (code) => {
            startingUp = false;
            const wasRunning = tunnelUrl !== null;
            tunnelProcess = null;
            tunnelUrl = null;
            if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                tunnelError = `cloudflared exited with code ${code}`;
                resolve({ success: false, error: tunnelError });
            } else if (wasRunning) {
                console.log('🌐 Tunnel disconnected');
                tunnelError = 'Tunnel process exited unexpectedly';
            }
        });
    });
}

/**
 * Stop the running tunnel.
 * @returns {{success: boolean}}
 */
export function stopTunnel() {
    if (!tunnelProcess) {
        return { success: true };
    }

    const pid = tunnelProcess.pid;

    try {
        if (process.platform === 'win32') {
            // Windows: SIGTERM doesn't work — force-kill the entire process tree
            spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
        } else {
            tunnelProcess.kill('SIGTERM');
        }
    } catch (e) { /* ignore */ }

    tunnelProcess = null;
    tunnelUrl = null;
    tunnelError = null;
    startingUp = false;
    console.log('🌐 Tunnel stopped');
    return { success: true };
}

/**
 * Get the current tunnel status.
 * @returns {{running: boolean, starting: boolean, url: string|null, error: string|null}}
 */
export function getTunnelStatus() {
    return {
        running: tunnelProcess !== null && tunnelUrl !== null,
        starting: startingUp,
        url: tunnelUrl,
        error: tunnelError
    };
}
