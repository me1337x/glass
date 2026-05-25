// glass-shell/src/brain-bridge/index.js
//
// WebSocket client to the Python brain sidecar.
//
// Per ../../docs/PROTOCOL.md (in the outer repo, not this one):
//   - URL:        ws://127.0.0.1:8765
//   - Envelope:   { v, type, id, ts, data }
//   - Loopback only, single client
//   - Reconnect:  exponential backoff (250ms start, 5000ms cap, forever)
//
// S2 scope: connect, send `hello`, log `hello.ack`, reconnect on disconnect.
// Later sessions add: audio.frame fan-out (S3), transcript subscription (S4),
// screen.frame (S6), synthesis.ready (S8), command.trigger / command.config (S8),
// cost.update + status banner (S9).
//
// This file exports a *singleton*. Glass only ever needs one brain connection
// per ADR-002. Direct usage from src/index.js:
//
//     const brainBridge = require('./brain-bridge');
//     brainBridge.connect();              // app startup
//     brainBridge.disconnect();           // graceful shutdown
//     brainBridge.send('audio.frame', data);  // when frames flow (S3+)
//     brainBridge.on('message:transcript.final', ({text, speaker_id}) => ...);

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const WebSocket = require('ws');

const PROTOCOL_VERSION = 1;
const DEFAULT_URL = process.env.BRAIN_URL || 'ws://127.0.0.1:8765';
const CLIENT_NAME = 'glass-shell';
const BRIDGE_VERSION = '0.1.0';

const RECONNECT_INITIAL_MS = 250;
const RECONNECT_CAP_MS = 5000;

class BrainBridge extends EventEmitter {
    constructor({ url = DEFAULT_URL } = {}) {
        super();
        this.url = url;
        /** @type {WebSocket|null} */
        this.ws = null;
        this.connected = false;
        /** Mirrors the brain's hello.ack `ready` flag — false until brain has its models loaded. */
        this.ready = false;
        this.shouldReconnect = false;
        this.reconnectDelay = RECONNECT_INITIAL_MS;
        /** @type {NodeJS.Timeout|null} */
        this.reconnectTimer = null;
    }

    /** Open the connection and start the reconnect loop. Safe to call multiple times. */
    connect() {
        if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
            // Already opening / open. No-op.
            return;
        }
        this.shouldReconnect = true;
        this._openSocket();
    }

    /** Send a `bye`, close the socket, stop reconnecting. */
    disconnect() {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            const ws = this.ws;
            if (this.connected) {
                try {
                    this._send('bye', {});
                } catch (_) {
                    // Socket may already be broken; fine.
                }
            }
            try {
                ws.close();
            } catch (_) { /* ignore */ }
        }
        this.ws = null;
        this.connected = false;
        this.ready = false;
    }

    /**
     * Send a typed envelope. Returns true if sent, false if not connected
     * (caller decides whether to buffer or drop — for audio frames we drop).
     */
    send(type, data = {}) {
        if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        return this._send(type, data);
    }

    _send(type, data) {
        const envelope = {
            v: PROTOCOL_VERSION,
            type,
            id: crypto.randomUUID(),
            ts: Date.now(),
            data,
        };
        this.ws.send(JSON.stringify(envelope));
        return true;
    }

    _openSocket() {
        console.log(`[BrainBridge] connecting to ${this.url}`);
        let ws;
        try {
            ws = new WebSocket(this.url);
        } catch (err) {
            console.error(`[BrainBridge] failed to create WebSocket: ${err.message}`);
            this._scheduleReconnect();
            return;
        }
        this.ws = ws;

        ws.on('open', () => {
            console.log('[BrainBridge] socket open, sending hello');
            this.connected = true;
            this.reconnectDelay = RECONNECT_INITIAL_MS; // reset backoff on success
            this._send('hello', {
                client: CLIENT_NAME,
                client_version: BRIDGE_VERSION,
                platform: process.platform,
                capabilities: ['audio', 'screen', 'manual_trigger'],
            });
        });

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch (e) {
                console.error('[BrainBridge] bad JSON from brain:', e.message);
                return;
            }
            if (msg.v !== PROTOCOL_VERSION) {
                console.error(
                    `[BrainBridge] protocol version mismatch: brain=${msg.v}, expected=${PROTOCOL_VERSION}`
                );
                return;
            }

            if (msg.type === 'hello.ack') {
                this.ready = msg.data?.ready === true;
                console.log(
                    `[BrainBridge] connected to brain, ack received. ` +
                    `server=${msg.data?.server}/${msg.data?.server_version} ready=${this.ready}`
                );
                if (msg.data?.models) {
                    console.log(
                        `[BrainBridge]   models: stt=${msg.data.models.stt}, ` +
                        `diarization=${msg.data.models.diarization}, ` +
                        `vlm=${msg.data.models.vlm}, synthesis=${msg.data.models.synthesis}`
                    );
                }
                this.emit('connected', msg.data);
            } else if (msg.type === 'error') {
                console.error(
                    `[BrainBridge] error from brain: code=${msg.data?.code} ` +
                    `severity=${msg.data?.severity} message=${msg.data?.message}`
                );
                this.emit('error-from-brain', msg.data);
            } else {
                // Forward all other typed messages. Later sessions wire subscribers:
                //   brainBridge.on('message:transcript.final', cb)  (S4)
                //   brainBridge.on('message:synthesis.ready',  cb)  (S8)
                this.emit('message', msg);
                this.emit(`message:${msg.type}`, msg.data);
            }
        });

        ws.on('close', (code, reasonBuf) => {
            const reason = reasonBuf?.toString?.() || '';
            const wasConnected = this.connected;
            this.connected = false;
            this.ready = false;
            if (wasConnected) {
                console.log(`[BrainBridge] socket closed (code=${code}, reason=${reason || '<none>'})`);
            }
            this.emit('disconnected', { code, reason });
            if (this.shouldReconnect) {
                this._scheduleReconnect();
            }
        });

        ws.on('error', (err) => {
            // ECONNREFUSED is the common case when the brain isn't running yet — be quiet.
            if (err.code === 'ECONNREFUSED') {
                console.warn(`[BrainBridge] brain not reachable at ${this.url} (will retry)`);
            } else {
                console.error(`[BrainBridge] socket error: ${err.message}`);
            }
            // 'close' fires next; reconnect is scheduled there.
        });
    }

    _scheduleReconnect() {
        if (this.reconnectTimer) return;
        const delay = this.reconnectDelay;
        console.log(`[BrainBridge] reconnecting in ${delay}ms`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_CAP_MS);
            this._openSocket();
        }, delay);
    }
}

// Singleton. One brain per Glass per ADR-002.
const brainBridge = new BrainBridge();

module.exports = brainBridge;
// Class also exported for future tests that want a fresh instance:
module.exports.BrainBridge = BrainBridge;
module.exports.PROTOCOL_VERSION = PROTOCOL_VERSION;
