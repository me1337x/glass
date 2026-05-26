// glass-shell/src/features/listen/windowPickerService.js
//
// S6 (2026-05-27): list available windows + display(s) so the user can pick
// which one Glass should capture frames from on Listen click. We do NOT
// filter to known meeting apps — any visible window is selectable, plus
// "Whole display" as a fallback option pinned at the top.
//
// Powered by Electron's desktopCapturer; same API that getDisplayMedia
// uses underneath. The returned `id` is the chromeMediaSourceId we pass
// to getDisplayMedia.

const { desktopCapturer } = require('electron');

const THUMBNAIL_SIZE = { width: 320, height: 180 };

/**
 * @returns {Promise<Array<{
 *   id: string,
 *   name: string,
 *   kind: 'window' | 'screen',
 *   thumbnailDataUrl: string | null,
 *   appIconDataUrl: string | null,
 * }>>}
 */
async function listCaptureWindows() {
    const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: THUMBNAIL_SIZE,
        fetchWindowIcons: true,
    });

    return sources.map((src) => {
        // "screen" sources come back with ids like "screen:0:0"; "window"
        // sources with "window:12345:0". We sort screens to the top so
        // they're easy to spot.
        const kind = src.id.startsWith('screen:') ? 'screen' : 'window';
        const thumbnailDataUrl = !src.thumbnail.isEmpty()
            ? src.thumbnail.toDataURL()
            : null;
        const appIconDataUrl =
            src.appIcon && !src.appIcon.isEmpty()
                ? src.appIcon.toDataURL()
                : null;
        return {
            id: src.id,
            name: src.name,
            kind,
            thumbnailDataUrl,
            appIconDataUrl,
        };
    }).sort((a, b) => {
        // Screens first, then windows in original order.
        if (a.kind !== b.kind) return a.kind === 'screen' ? -1 : 1;
        return 0;
    });
}

module.exports = {
    listCaptureWindows,
};
