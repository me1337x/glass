// glass-shell/src/ui/listen/screenCore/screenCapture.js
//
// S6 (2026-05-27): periodic screen capture for the brain's frame pipeline.
//
// Capture mechanism (revised after smoke test freeze):
//   1. Ask main for the list of capture sources via brain.listCaptureWindows
//      (wraps Electron's desktopCapturer.getSources).
//   2. Auto-pick the primary screen (first 'screen' entry). A real picker
//      UI is queued as an S6.1 follow-up.
//   3. Call navigator.mediaDevices.getUserMedia with chromeMediaSource:
//      'desktop' + chromeMediaSourceId. This is Electron's documented
//      desktop-capture API and bypasses setDisplayMediaRequestHandler
//      entirely (which was causing freezes with useSystemPicker: true).
//   4. Every CAPTURE_INTERVAL_MS, draw the active video track onto a
//      canvas, JPEG-encode, ship via brain.sendScreenFrame IPC.
//
// session_id is stamped on the screen.frame envelope by featureBridge from
// listenService.currentSessionId — same as audio.frame.

const CAPTURE_INTERVAL_MS = 5000;
// S6.2 (2026-05-27): switched from JPEG to PNG. PNG is lossless and
// preserves the sharp edges of name-plate text + UI labels that Sonnet
// vision will OCR in S6.5. Screenshots also compress well in PNG
// (large flat-color regions + crisp text — exactly what deflate is good
// at), so file size is reasonable (~100-200 KB per kept frame).
const FRAME_FORMAT = 'png';
const FRAME_MIME = 'image/png';
const TARGET_MAX_DIMENSION = 1920; // downscale if either dim > this; saves bandwidth

let videoEl = null;
let canvasEl = null;
let mediaStream = null;
let intervalHandle = null;
let started = false;

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

    // canvas.toBlob is async + spec-stable. Wrap in a Promise. PNG ignores
    // the quality argument so we omit it.
    const blob = await new Promise((resolve) => canvasEl.toBlob(resolve, FRAME_MIME));
    if (!blob) {
        console.warn('[ScreenCapture] toBlob returned null — skipping this frame');
        return;
    }
    const arrBuf = await blob.arrayBuffer();
    const b64 = _arrayBufferToBase64(arrBuf);

    try {
        // session_id is stamped on by featureBridge using listenService.currentSessionId.
        await window.api.brain.sendScreenFrame({
            format: FRAME_FORMAT,
            width: cw,
            height: ch,
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
 * Start screen capture. Uses the source the user picked in the modal
 * (listenService.activeCaptureSource, read via brain:getActiveCaptureSource).
 * If the user cancelled the picker, this returns false silently and no
 * screen capture happens for this meeting (audio-only).
 *
 * Uses Electron's getUserMedia + chromeMediaSource desktop API.
 *
 * @returns {Promise<boolean>} true if capture started, false if no
 *   source picked, source unavailable, or getUserMedia failed.
 */
async function startScreenCapture() {
    if (started) {
        console.warn('[ScreenCapture] already started — ignoring start request');
        return true;
    }

    // 1. Read the user's pick from listenService (via main IPC).
    let picked;
    try {
        picked = await window.api.brain.getActiveCaptureSource();
    } catch (e) {
        console.error('[ScreenCapture] getActiveCaptureSource IPC failed:', e);
        return false;
    }
    if (!picked || !picked.id) {
        // Picker was cancelled — audio-only meeting. Not an error.
        console.log('[ScreenCapture] no capture source picked — skipping screen capture this meeting');
        return false;
    }
    console.log(`[ScreenCapture] capturing source: ${picked.name} (${picked.id})`);

    // 3. Capture via Electron's desktop-capture getUserMedia. This API
    //    bypasses setDisplayMediaRequestHandler — no useSystemPicker hang.
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: picked.id,
                },
            },
        });
    } catch (e) {
        console.error('[ScreenCapture] getUserMedia failed:', e);
        return false;
    }

    videoEl = document.createElement('video');
    videoEl.muted = true;
    videoEl.srcObject = mediaStream;
    await videoEl.play();

    canvasEl = document.createElement('canvas');

    started = true;

    // 4. Notify main so meeting.start gets enriched with capture_window_title.
    try {
        await window.api.brain.notifyWindowPicked({
            captureWindowTitle: picked.name,
            captureWindowId: picked.id,
        });
        console.log(`[ScreenCapture] notified main: ${picked.name}`);
    } catch (e) {
        console.warn('[ScreenCapture] notifyWindowPicked failed:', e.message);
    }

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
