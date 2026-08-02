/**
 * Git Service - read + write git operations for the mobile companion.
 *
 * Wraps the `git` CLI (must be on PATH). All commands run with an explicit cwd and
 * a 15s timeout. No network/push operations are exposed (per project policy).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

const OPTS = (cwd) => ({ cwd, timeout: 15000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });

async function git(cwd, args) {
    const { stdout } = await exec('git', args, OPTS(cwd));
    return stdout;
}

/** True if `dir` is inside a git work tree. */
export async function isRepo(dir) {
    try {
        const out = await git(dir, ['rev-parse', '--is-inside-work-tree']);
        return out.trim() === 'true';
    } catch (e) {
        return false;
    }
}

/**
 * Working-tree status via porcelain v2 (stable, machine-readable).
 * Returns branch info + a flat file list with staged (x) / worktree (y) codes.
 */
export async function status(dir) {
    if (!(await isRepo(dir))) {
        return { isRepo: false, branch: null, ahead: 0, behind: 0, files: [] };
    }

    let root = dir;
    try { root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim() || dir; } catch (e) { }

    let remoteUrl = null;
    try { remoteUrl = (await git(dir, ['remote', 'get-url', 'origin'])).trim(); } catch (e) { }

    const out = await git(dir, ['status', '--porcelain=v2', '--branch', '-z']);
    const entries = out.split('\0');

    let branch = null, ahead = 0, behind = 0, upstream = null;
    const files = [];

    for (let i = 0; i < entries.length; i++) {
        const line = entries[i];
        if (!line) continue;
        if (line.startsWith('# branch.head ')) {
            branch = line.slice('# branch.head '.length).trim();
        } else if (line.startsWith('# branch.upstream ')) {
            upstream = line.slice('# branch.upstream '.length).trim();
        } else if (line.startsWith('# branch.ab ')) {
            const m = line.match(/\+(\d+)\s+-(\d+)/);
            if (m) { ahead = parseInt(m[1]); behind = parseInt(m[2]); }
        } else if (line.startsWith('1 ')) {
            // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
            const parts = line.split(' ');
            const xy = parts[1];
            const path = parts.slice(8).join(' ');
            files.push({ path, x: xy[0], y: xy[1], type: 'modified' });
        } else if (line.startsWith('2 ')) {
            // renamed/copied: path then origPath is the NEXT NUL-separated token
            const parts = line.split(' ');
            const xy = parts[1];
            const path = parts.slice(9).join(' ');
            const orig = entries[++i] || '';
            files.push({ path, orig, x: xy[0], y: xy[1], type: 'renamed' });
        } else if (line.startsWith('u ')) {
            const parts = line.split(' ');
            const path = parts.slice(10).join(' ');
            files.push({ path, x: 'U', y: 'U', type: 'conflict' });
        } else if (line.startsWith('? ')) {
            files.push({ path: line.slice(2), x: '?', y: '?', type: 'untracked' });
        }
    }

    return { isRepo: true, root, branch, upstream, ahead, behind, remoteUrl, files };
}

/** Unified diff for one file. `staged` selects the index diff. */
export async function diff(dir, file, staged) {
    const args = ['diff', '--no-color'];
    if (staged) args.push('--cached');
    args.push('--', file);
    try {
        const out = await git(dir, args);
        return { file, staged: !!staged, diff: out };
    } catch (e) {
        return { file, staged: !!staged, diff: '', error: e.message };
    }
}

export async function branches(dir) {
    const out = await git(dir, ['branch', '--list', '--format=%(refname:short)%(if)%(HEAD)%(then)\t*%(end)']);
    const all = [];
    let current = null;
    for (const raw of out.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const isCurrent = line.endsWith('\t*');
        const name = isCurrent ? line.slice(0, -2) : line;
        all.push(name);
        if (isCurrent) current = name;
    }
    return { current, branches: all };
}

// --- write operations (no push) ---

export async function stage(dir, file) {
    await git(dir, ['add', '--', file]);
    return { success: true };
}

export async function unstage(dir, file) {
    await git(dir, ['reset', '-q', 'HEAD', '--', file]);
    return { success: true };
}

/** Discard working-tree changes for a tracked file, or delete an untracked one. */
export async function discard(dir, file, untracked) {
    if (untracked) {
        await git(dir, ['clean', '-f', '--', file]);
    } else {
        await git(dir, ['checkout', '--', file]);
    }
    return { success: true };
}

export async function commit(dir, message) {
    if (!message || !message.trim()) throw new Error('Commit message required');
    const out = await git(dir, ['commit', '-m', message]);
    return { success: true, output: out.trim() };
}

export async function checkout(dir, branch, create) {
    const args = create ? ['checkout', '-b', branch] : ['checkout', branch];
    const out = await git(dir, args);
    return { success: true, output: out.trim() };
}
