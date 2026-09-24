const WebSocket = require('ws');
const EventEmitter = require('events');

/**
 * Persistent Rust/Oxide RCON log listener.
 *
 * helpers/rcon.js opens a socket per command and closes it — right for one-shot
 * teleports, useless for logging. Rust pushes console output as *unsolicited*
 * frames (Identifier 0 / -1) on a live connection, so admin logging needs a
 * socket that stays open and reconnects on its own.
 *
 * Emits:
 *   'line'  ({ server, message, type, stacktrace }) — every console line
 *   'up'    ({ server })   — connection established
 *   'down'  ({ server, reason }) — connection lost
 */

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;

// Give up on a connect attempt that never completes. Without this we wait on
// the OS TCP timeout (~21s on Windows, longer elsewhere), so a firewalled or
// dead host stalls the backoff cycle instead of reporting promptly.
const CONNECT_TIMEOUT_MS = 10000;
// Rust's RCON sends no protocol-level ping. If nothing arrives at all for this
// long the socket is presumed dead — a quiet server still emits periodic
// console noise, so total silence means the link is gone, not idle.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

class RconListener extends EventEmitter {
    /**
     * @param {string} serverKey Config key, e.g. 'eu' — tags every emitted line
     * @param {{host: string, port: string|number, password: string}} rconConfig
     */
    constructor(serverKey, rconConfig) {
        super();
        this.serverKey = serverKey;
        this.config = rconConfig;
        this.ws = null;
        this.stopped = false;
        this.attempts = 0;
        this.reconnectTimer = null;
        this.idleTimer = null;
        this.connectTimer = null;
    }

    start() {
        this.stopped = false;
        this.connect();
    }

    stop() {
        this.stopped = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.teardownSocket();
    }

    teardownSocket() {
        if (!this.ws) return;

        const ws = this.ws;
        this.ws = null;

        ws.removeAllListeners();

        // Keep a no-op error handler attached: tearing down can emit 'error'
        // asynchronously, and with no listener ws re-throws it as an uncaught
        // exception. This socket is already abandoned, so swallow it.
        ws.on('error', () => {});

        // terminate() on a CONNECTING socket throws "WebSocket was closed
        // before the connection was established" — the state this hits on
        // every reconnect that times out mid-connect. close() is correct there.
        try {
            if (ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            } else {
                ws.terminate();
            }
        } catch { /* already gone */ }
    }

    /** Reset the silence watchdog — called on every frame received. */
    bumpIdleTimer() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            this.handleDrop('idle timeout — no console output received');
        }, IDLE_TIMEOUT_MS);
    }

    connect() {
        if (this.stopped) return;

        const { host, port, password } = this.config;
        const url = `ws://${host}:${port}/${encodeURIComponent(password)}`;

        try {
            this.ws = new WebSocket(url);
        } catch (err) {
            return this.handleDrop(`could not open socket: ${err.message}`);
        }

        this.connectTimer = setTimeout(() => {
            this.handleDrop('connection timed out');
        }, CONNECT_TIMEOUT_MS);

        this.ws.on('open', () => {
            if (this.connectTimer) {
                clearTimeout(this.connectTimer);
                this.connectTimer = null;
            }
            this.attempts = 0;
            this.bumpIdleTimer();
            this.emit('up', { server: this.serverKey });
        });

        this.ws.on('message', (raw) => {
            this.bumpIdleTimer();

            let payload;
            try {
                payload = JSON.parse(raw.toString());
            } catch {
                // Non-JSON frame — nothing useful to log.
                return;
            }

            const message = typeof payload.Message === 'string' ? payload.Message : '';
            if (!message.trim()) return;

            this.emit('line', {
                server: this.serverKey,
                message,
                type: payload.Type || 'Generic',
                stacktrace: payload.Stacktrace || ''
            });
        });

        this.ws.on('error', (err) => {
            this.handleDrop(err.message);
        });

        this.ws.on('close', () => {
            this.handleDrop('connection closed');
        });
    }

    /**
     * Tear down and schedule a reconnect with exponential backoff.
     * Guarded so a socket that fires both 'error' and 'close' only backs off once.
     */
    handleDrop(reason) {
        if (this.stopped) return;
        if (this.reconnectTimer) return;

        this.teardownSocket();
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this.connectTimer) {
            clearTimeout(this.connectTimer);
            this.connectTimer = null;
        }

        this.emit('down', { server: this.serverKey, reason });

        const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, this.attempts),
            RECONNECT_MAX_MS
        );
        this.attempts += 1;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }
}

module.exports = { RconListener };
