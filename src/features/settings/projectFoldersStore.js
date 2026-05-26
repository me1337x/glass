// glass-shell/src/features/settings/projectFoldersStore.js
//
// Tiny on-disk store for the user's registered "parent project folders".
// Persists as a JSON array at app.getPath('userData')/parent-project-roots.json.
//
// 2026-05-26 — S4.7. When the user picks a meeting folder via the Listen
// click picker, ListenService checks whether the chosen folder lives
// under ANY registered parent. If it does, the meeting becomes
// "project-aware" — the brain stores `project_root` in per-session
// config (immediate child of the parent containing the chosen folder)
// and future agents (Agent G in S6.5) can Grep across that project_root
// for context.
//
// No external deps. Atomic writes. Empty list if file missing or
// corrupted (better than refusing to start).

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(app.getPath('userData'), 'parent-project-roots.json');

function read() {
    try {
        const raw = fs.readFileSync(FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            // Sanity-filter: only keep strings that point at existing dirs.
            return parsed.filter(p => typeof p === 'string' && p && fs.existsSync(p));
        }
        return [];
    } catch (_) {
        return [];
    }
}

function writeAtomic(arr) {
    const tmp = FILE + `.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf-8');
    fs.renameSync(tmp, FILE);
}

function add(dirPath) {
    const normalized = path.resolve(dirPath);
    if (!fs.existsSync(normalized)) {
        throw new Error(`folder does not exist: ${normalized}`);
    }
    const stat = fs.statSync(normalized);
    if (!stat.isDirectory()) {
        throw new Error(`not a directory: ${normalized}`);
    }
    const list = read();
    if (list.includes(normalized)) {
        return list; // idempotent
    }
    list.push(normalized);
    writeAtomic(list);
    return list;
}

function remove(dirPath) {
    const normalized = path.resolve(dirPath);
    const list = read();
    const next = list.filter(p => p !== normalized);
    writeAtomic(next);
    return next;
}

/**
 * Given a chosen meetings folder, decide if it's inside any registered
 * parent. Returns { is_inside_project: boolean, project_root: string|null }.
 *
 * `project_root` is the immediate child of the parent that contains
 * `chosenDir`. Example:
 *   parent  = "C:/Users/Bozza/OneDrive/Documents/Claude/Projects"
 *   chosen  = "C:/Users/Bozza/OneDrive/Documents/Claude/Projects/acme-launch"
 *     → project_root = ".../Projects/acme-launch"
 *   chosen  = "C:/Users/Bozza/OneDrive/Documents/Claude/Projects/acme-launch/meetings"
 *     → project_root = ".../Projects/acme-launch"  (same — meetings is one
 *       level deeper; we want the project folder, not the meetings subdir)
 *
 * If `chosenDir` is ITSELF a registered parent, we treat that as
 * "not inside any project" — the user pointed at the registry root,
 * not at a specific project. Returns is_inside_project=false.
 */
function detectProjectContext(chosenDir) {
    const chosen = path.resolve(chosenDir);
    const parents = read();
    for (const parent of parents) {
        const sep = path.sep;
        // Must be STRICTLY under (not equal to) the parent.
        const parentWithSep = parent.endsWith(sep) ? parent : parent + sep;
        if (chosen.startsWith(parentWithSep)) {
            const relative = chosen.substring(parentWithSep.length);
            const firstSegment = relative.split(sep)[0];
            if (firstSegment) {
                return {
                    is_inside_project: true,
                    project_root: path.join(parent, firstSegment),
                };
            }
        }
    }
    return { is_inside_project: false, project_root: null };
}

module.exports = {
    list: read,
    add,
    remove,
    detectProjectContext,
    FILE,
};
