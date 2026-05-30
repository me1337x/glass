// src/features/listen/summary/meetingFilesService.js
//
// S9 (2026-05-30): feeds Glass's native "Live Insights" panel (SummaryView)
// from the brain's per-meeting markdown files, replacing the old LLM-backed
// summaryService analysis path (which called an LLM directly from Glass JS —
// an ADR-012 violation). See ADR-013.
//
// Runs in the MAIN process, where Node `fs` is available (the Listen renderer
// has no nodeIntegration). Mirrors the S4.5 Insight HUD's discovery, but
// properly: find the newest <stamp>_<session> dir under <chosenRoot>/meetings/,
// watch the agent output files, and push their contents to the Listen renderer
// over the 'meeting-files-update' IPC channel whenever any of them change.

const fs = require('node:fs');
const path = require('node:path');

const POLL_MS = 500; // file-watch granularity (matches the HUD)
const RESCAN_MS = 2000; // how often to look for a newer session dir

// The agent output files we surface, in display order. `key` is what the
// renderer reads, `file` is the on-disk name. The renderer keeps its own
// copy of the titles (it can't require this main-process module).
const MEETING_FILES = [
    { key: 'summary', file: 'summary.md' },
    { key: 'actions', file: 'actions.md' },
    { key: 'decisions', file: 'decisions.md' },
    { key: 'timeline', file: 'timeline.md' },
    { key: 'suggestions', file: 'suggestions.md' },
    { key: 'roster', file: 'roster.md' },
    { key: 'visualContext', file: 'visual-context.md' },
    { key: 'advisor', file: 'advisor.md' },
];

/**
 * Return the newest (by mtime) immediate subdirectory of `meetingsRoot`,
 * as `{ name, full, mtimeMs }`, or null if the root is missing/empty.
 */
function findNewestMeetingDir(meetingsRoot) {
    try {
        const entries = fs.readdirSync(meetingsRoot, { withFileTypes: true });
        const dirs = entries
            .filter(e => e.isDirectory())
            .map(e => {
                const full = path.join(meetingsRoot, e.name);
                return { name: e.name, full, mtimeMs: fs.statSync(full).mtimeMs };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
        return dirs[0] || null;
    } catch (_) {
        return null;
    }
}

function _readFileOrNull(p) {
    try {
        const text = fs.readFileSync(p, 'utf-8');
        return text.trim() === '' ? null : text;
    } catch (_) {
        return null;
    }
}

/**
 * Read all known agent output files from `meetingDir`. Returns an object
 * keyed by MEETING_FILES[].key; each value is the file's text, or null when
 * the file is missing or empty.
 */
function readMeetingFiles(meetingDir) {
    const out = {};
    for (const { key, file } of MEETING_FILES) {
        out[key] = _readFileOrNull(path.join(meetingDir, file));
    }
    return out;
}

/**
 * Parse the `## Confirmed` section of roster.md into a { spk_N: name } map.
 * Only high-confidence Confirmed mappings are surfaced — tentative/unknown are
 * ignored so the live transcript label only upgrades to a real name once
 * Agent F is sure. Lines look like:
 *   - **spk_2 → Alice Chen** (confidence: high, 7 co-occurrences)
 */
function parseConfirmedSpeakers(rosterMd) {
    const out = {};
    if (!rosterMd) return out;
    const confirmed = rosterMd.split(/^##\s+/m).find(s => /^Confirmed\b/i.test(s));
    if (!confirmed) return out;
    const re = /\*\*\s*(spk_\d+)\s*(?:→|->)\s*([^*]+?)\s*\*\*/g;
    let m;
    while ((m = re.exec(confirmed)) !== null) {
        const name = m[2].trim();
        if (name) out[m[1]] = name;
    }
    return out;
}

class MeetingFilesService {
    constructor() {
        this.meetingsRoot = null;
        this.currentDir = null;
        this._rescan = null;
        this._watched = []; // file paths currently watched
    }

    sendToRenderer(channel, data) {
        const { windowPool } = require('../../../window/windowManager');
        const listenWindow = windowPool?.get('listen');
        if (listenWindow && !listenWindow.isDestroyed()) {
            listenWindow.webContents.send(channel, data);
        }
    }

    /**
     * Begin watching. `chosenRoot` is the user-picked folder; the brain writes
     * sessions under <chosenRoot>/meetings/<stamp>_<session>/ (see
     * listenService: it sends the brain `path.join(meetingsDir, 'meetings')`).
     */
    start(chosenRoot) {
        this._teardown();
        this.meetingsRoot = path.join(chosenRoot, 'meetings');
        console.log(`[MeetingFilesService] watching ${this.meetingsRoot}`);
        this._tick();
        this._rescan = setInterval(() => this._tick(), RESCAN_MS);
    }

    _tick() {
        const dir = findNewestMeetingDir(this.meetingsRoot);
        if (!dir) return;
        if (!this.currentDir || this.currentDir.full !== dir.full) {
            this.currentDir = dir;
            console.log(`[MeetingFilesService] meeting dir: ${dir.name}`);
            this._attachWatchers(dir.full);
            this._pushUpdate(); // immediate render
        }
    }

    _attachWatchers(meetingDir) {
        this._unwatchAll();
        for (const { file } of MEETING_FILES) {
            const p = path.join(meetingDir, file);
            this._watched.push(p);
            fs.watchFile(p, { interval: POLL_MS }, () => this._pushUpdate());
        }
    }

    _pushUpdate() {
        if (!this.currentDir) return;
        const files = readMeetingFiles(this.currentDir.full);
        this.sendToRenderer('meeting-files-update', {
            meetingName: this.currentDir.name,
            files,
        });
        // S9: publish the confirmed spk_N -> name map so the live transcript
        // view can label speakers (it falls back to raw spk_N when empty).
        this.sendToRenderer('speaker-names-update', parseConfirmedSpeakers(files.roster));
    }

    _unwatchAll() {
        for (const p of this._watched) {
            try {
                fs.unwatchFile(p);
            } catch (_) {
                /* ignore */
            }
        }
        this._watched = [];
    }

    // Meeting stopped (user pressed Stop). Stop hunting for new meeting dirs,
    // but KEEP the file watchers alive and DO NOT clear the panel: the user
    // reviews the insights after the meeting, and the end-of-meeting
    // reconciler may rewrite summary.md / actions.md with final speaker names,
    // which should still flow to the panel. The panel is reset by ListenView
    // (summaryView.resetAnalysis) when the NEXT session starts.
    stop() {
        if (this._rescan) {
            clearInterval(this._rescan);
            this._rescan = null;
        }
    }

    // Full teardown — used when switching to a new meeting (via start()).
    _teardown() {
        if (this._rescan) {
            clearInterval(this._rescan);
            this._rescan = null;
        }
        this._unwatchAll();
        this.currentDir = null;
        this.meetingsRoot = null;
    }
}

module.exports = MeetingFilesService;
module.exports.findNewestMeetingDir = findNewestMeetingDir;
module.exports.readMeetingFiles = readMeetingFiles;
module.exports.parseConfirmedSpeakers = parseConfirmedSpeakers;
module.exports.MEETING_FILES = MEETING_FILES;
