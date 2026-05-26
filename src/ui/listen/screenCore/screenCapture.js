// glass-shell/src/ui/listen/screenCore/screenCapture.js
//
// S6 (2026-05-27): periodic screen capture. Mirrors audioCore/listenCapture.js
// structure: get a media stream via getDisplayMedia, periodically sample
// the video track onto a canvas, JPEG-encode, ship to brain via the main
// process (which stamps session_id from listenService.currentSessionId).
//
// Chromium's getDisplayMedia call shows the native picker — same one
// Discord / browser screen-share use. We don't render our own picker UI;
// the user picks from Chromium's chooser. The picked track's `label`
// gives us the window title for capture_window_title.

const CAPTURE_INTERVAL_MS = 5000;
const JPEG_QUALITY = 0.8;
const TARGET_MAX_DIMENSION = 1920; // downscale if either dim > this; saves bandwidth

let videoEl = null;
let canvasEl = null;
let mediaStream = null;
let intervalHandle = null;
let started = false;

/** Notify main when the user picks a window so meeting.start can be amended. */
async function _notifyMainOfPick() {
    if (!mediaStream) return;
    const videoTracks = mediaStream.getVideoTracks();
    if (videoTracks.length === 0) return;
    const track = videoTracks[0];
    const settings = track.getSettings ? track.getSettings() : {};
    const captureWindowTitle = track.label || settings.displayLabel || null;
    const captureWindowId = settings.deviceId || null;
    try {
        await window.api.brain.notifyWindowPicked({
            captureWindowTitle,
            captureWindowId,
        });
        console.log(`[ScreenCapture] notified main of picked window: ${captureWindowTitle}`);
    } catch (e) {
        console.warn('[ScreenCapture] notifyWindowPicked IPC failed:', e.message);
    }
}

/** Draw the current frame on the canvas, JPEG-encode, ship via IPC. */
async function _captureAndShip() {
    if (!started || !videoEl || !canvasEl || !mediaStream) return;
    if (videoEl.readyState < 2 /* HAVE_CURRENT_DATA */) return;

    const vw = videoEl.videoWidth || 1280;
    const vh = videoEl.videoHeight || 720;
    if (vw === 0 || vh === 0) return;

    // Downscale if either dimension exceeds TARGET_MAX_DIMENSION.
    let cw = vw;
    let ch = vh;
    const longest = Math.max(vw, vh);
    if (longest > TARGET_MAX_DIMENSION) {
        const scale = TARGET_MAX_DIMENSION / longest;
        cw = Math.round(vw * scale);
        ch = Math.round(vh * scale);
    }
    canvasEl.width = cw;
    canvasEl.height = ch;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, cw, ch);

    // canvas.toBlob is async + spec-stable. Wrap in a Promise.
    const blob = await new Promise((resolve) => canvasEl.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) {
        console.warn('[ScreenCapture] toBlob returned null — skipping this frame');
        return;
    }
    const arrBuf = await blob.arrayBuffer();
    const b64 = _arrayBufferToBase64(arrBuf);

    try {
        // session_id is stamped on by featureBridge using listenService.currentSessionId.
        await window.api.brain.sendScreenFrame({
            format: 'jpeg',
            width: cw,
            height: ch,
            quality: Math.round(JPEG_QUALITY * 100),
            payload_b64: b64,
        });
    } catch (e) {
        console.warn('[ScreenCapture] sendScreenFrame IPC failed:', e.message);
    }
}

function _arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

/**
 * Start screen capture. Triggers Chromium's native window/screen picker.
 * If the user cancels, returns false and no capture runs.
 *
 * @returns {Promise<boolean>} true if capture started, false if user
 *   cancelled or capture failed.
 */
async function startScreenCapture() {
    if (started) {
        console.warn('[ScreenCapture] already started — ignoring start request');
        return true;
    }

    try {
        // video: true → Chromium shows the native picker.
        // No audio in this stream — audio is captured separately by listenCapture.
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
        });
    } catch (e) {
        if (e.name === 'NotAllowedError' || e.name === 'AbortError') {
            console.log('[ScreenCapture] user cancelled the window picker');
            return false;
        }
        console.error('[ScreenCapture] getDisplayMedia failed:', e);
        return false;
    }

    videoEl = document.createElement('video');
    videoEl.muted = true;
    videoEl.srcObject = mediaStream;
    await videoEl.play();

    canvasEl = document.createElement('canvas');

    started = true;
    await _notifyMainOfPick();

    intervalHandle = setInterval(_captureAndShip, CAPTURE_INTERVAL_MS);
    console.log(`[ScreenCapture] started (interval ${CAPTURE_INTERVAL_MS}ms)`);
    return true;
}

function stopScreenCapture() {
    if (!started) return;
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
        mediaStream = null;
    }
    if (videoEl) {
        videoEl.srcObject = null;
        videoEl = null;
    }
    canvasEl = null;
    started = false;
    console.log('[ScreenCapture] stopped');
}

module.exports = { startScreenCapture, stopScreenCapture };
