// glass-shell/src/features/settings/audioDevicesStore.js
//
// Tiny on-disk store for the user's selected audio input device.
// Persists as JSON at app.getPath('userData')/audio-devices.json.
//
// 2026-05-26 — S4.9. Currently stores only `micDeviceId`; structured as
// an object so future fields (e.g. systemAudioDeviceId for loopback
// source selection) can be added without a schema migration.
//
// Device IDs are renderer-side mediaDevices identifiers — stable per
// origin per granted permission. Glass holds mic permission always so
// the IDs are stable across launches. If the user revokes + regrants
// permission, the saved ID may no longer match any enumerated device;
// listenCapture handles that by falling back to system default.

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(app.getPath('userData'), 'audio-devices.json');

function read() {
    try {
        const raw = fs.readFileSync(FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return {
                micDeviceId: typeof parsed.micDeviceId === 'string' ? parsed.micDeviceId : null,
            };
        }
    } catch (_) { /* fallthrough */ }
    return { micDeviceId: null };
}

function writeAtomic(obj) {
    const tmp = FILE + `.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
    fs.renameSync(tmp, FILE);
}

function getMicDeviceId() {
    return read().micDeviceId;
}

function setMicDeviceId(deviceId) {
    const current = read();
    current.micDeviceId = (typeof deviceId === 'string' && deviceId) ? deviceId : null;
    writeAtomic(current);
    return current;
}

module.exports = {
    get: read,
    getMicDeviceId,
    setMicDeviceId,
    FILE,
};
