// glass-shell/src/features/listen/screenCapturePicker.js
//
// S6.1 (2026-05-27): per-meeting screen-capture-source picker.
//
// Opens a modal BrowserWindow loading ../ui/window-picker/picker.html.
// The picker renderer calls window.api.brain.pickerConfirm({id, name})
// or window.api.brain.pickerCancel(); both resolve the promise returned
// by pickCaptureSource() and close the window.
//
// Returns: { id, name } on confirm, null on cancel or window-close.

const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const PICKER_IPC_CONFIRM = 'brain:pickerConfirm';
const PICKER_IPC_CANCEL  = 'brain:pickerCancel';

let activePicker = null;          // BrowserWindow | null
let activeResolver = null;        // (result) => void | null

function _cleanup() {
    if (activePicker && !activePicker.isDestroyed()) {
        try { activePicker.close(); } catch (_) { /* ignore */ }
    }
    activePicker = null;
    activeResolver = null;
}

function _resolve(result) {
    if (activeResolver) {
        const r = activeResolver;
        activeResolver = null;
        r(result);
    }
    _cleanup();
}

// Register the IPC handlers once. We accept multiple invocations across
// session restarts; the cleanup logic above stays consistent because we
// track activePicker / activeResolver as module state.
ipcMain.handle(PICKER_IPC_CONFIRM, async (event, { sourceId, sourceName, id, name }) => {
    // Accept either { id, name } (legacy/short form) or { sourceId, sourceName }.
    const sId = sourceId || id;
    const sName = sourceName || name;
    if (!sId) {
        return { success: false, reason: 'missing_source_id' };
    }
    _resolve({ id: sId, name: sName || '' });
    return { success: true };
});

ipcMain.handle(PICKER_IPC_CANCEL, async () => {
    _resolve(null);
    return { success: true };
});

/**
 * Open the picker modal and wait for the user to pick a source or cancel.
 *
 * @param {Electron.BrowserWindow|null} parent - if provided, picker is modal to it.
 * @returns {Promise<{id: string, name: string} | null>}
 */
async function pickCaptureSource(parent = null) {
    // If a picker is already open (e.g. user double-clicked Listen), close it
    // and surface a null to the prior caller, then open a fresh one.
    if (activePicker) {
        _resolve(null);
    }

    return new Promise((resolve) => {
        activeResolver = resolve;

        const win = new BrowserWindow({
            width: 760,
            height: 560,
            parent: parent && !parent.isDestroyed() ? parent : undefined,
            modal: parent ? true : false,
            show: false,
            frame: true,
            title: 'Pick capture source',
            resizable: true,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: false,
            autoHideMenuBar: true,
            webPreferences: {
                preload: path.join(__dirname, '../../preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
            },
        });
        activePicker = win;

        win.once('ready-to-show', () => {
            try {
                win.show();
                win.focus();
            } catch (_) { /* ignore */ }
        });

        win.on('closed', () => {
            // User clicked the OS close button — treat as cancel if not
            // already resolved.
            if (activeResolver) {
                _resolve(null);
            }
        });

        win.loadFile(path.join(__dirname, '../../ui/window-picker/picker.html'))
            .catch((err) => {
                console.error('[ScreenCapturePicker] failed to load picker.html:', err);
                _resolve(null);
            });
    });
}

module.exports = {
    pickCaptureSource,
};
