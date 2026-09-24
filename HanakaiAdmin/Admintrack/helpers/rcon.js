const WebSocket = require('ws');

/**
 * Minimal Rust/Oxide WebSocket RCON client.
 *
 * Rust servers expose RCON over WebSocket at ws://host:port/password.
 * Commands are sent as JSON { Identifier, Message, Name } and the server
 * replies with JSON { Identifier, Message, Type } — we correlate the reply
 * using a unique Identifier per command.
 *
 * Connections are opened per-command and closed immediately: ticket teleports
 * are rare, so a persistent pool isn't worth the reconnect/backoff complexity.
 */

const CONNECT_TIMEOUT_MS = 8000;
const COMMAND_TIMEOUT_MS = 8000;

// Identifiers must be positive ints; keep a rolling counter well under 2^31.
let identifierCounter = 1;
function nextIdentifier() {
    identifierCounter = (identifierCounter % 2000000) + 1;
    return identifierCounter;
}

/**
 * Send a single RCON command and resolve with the server's response text.
 *
 * @param {{host: string, port: string|number, password: string}} rconConfig
 * @param {string} command Raw console command, e.g. `printpos "PlayerName"`
 * @returns {Promise<string>} The server's response message
 */
function sendRconCommand(rconConfig, command) {
    return new Promise((resolve, reject) => {
        if (!rconConfig || !rconConfig.host || !rconConfig.port || !rconConfig.password) {
            return reject(new Error('RCON is not configured for this server.'));
        }

        const identifier = nextIdentifier();
        const url = `ws://${rconConfig.host}:${rconConfig.port}/${encodeURIComponent(rconConfig.password)}`;

        let ws;
        let settled = false;
        let connectTimer = null;
        let commandTimer = null;

        const cleanup = () => {
            if (connectTimer) clearTimeout(connectTimer);
            if (commandTimer) clearTimeout(commandTimer);
            if (!ws) return;

            ws.removeAllListeners();

            // Keep a no-op error handler attached. Tearing down a socket can
            // emit 'error' asynchronously (notably terminate() while still
            // CONNECTING), and with no listener ws re-throws it as an uncaught
            // exception. We are already settled by this point, so swallow it.
            ws.on('error', () => {});

            // terminate() on a CONNECTING socket throws "WebSocket was closed
            // before the connection was established". close() is the correct
            // call in that state and still frees the handle; terminate() is
            // right once the connection is actually up, since we never need a
            // clean closing handshake.
            try {
                if (ws.readyState === WebSocket.CONNECTING) {
                    ws.close();
                } else {
                    ws.terminate();
                }
            } catch { /* already gone */ }
        };

        const finish = (err, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (err) reject(err);
            else resolve(value);
        };

        try {
            ws = new WebSocket(url);
        } catch (err) {
            return finish(new Error(`Could not open RCON connection: ${err.message}`));
        }

        connectTimer = setTimeout(() => {
            finish(new Error('RCON connection timed out.'));
        }, CONNECT_TIMEOUT_MS);

        ws.on('open', () => {
            if (connectTimer) clearTimeout(connectTimer);

            try {
                ws.send(JSON.stringify({
                    Identifier: identifier,
                    Message: command,
                    Name: 'SaturnManager'
                }));
            } catch (err) {
                return finish(new Error(`Could not send RCON command: ${err.message}`));
            }

            commandTimer = setTimeout(() => {
                finish(new Error('RCON command timed out (no response from server).'));
            }, COMMAND_TIMEOUT_MS);
        });

        ws.on('message', (raw) => {
            let payload;
            try {
                payload = JSON.parse(raw.toString());
            } catch {
                // Rust also emits unsolicited chat/log frames that aren't our reply.
                return;
            }

            // Ignore broadcasts and replies to other commands.
            if (payload.Identifier !== identifier) return;

            finish(null, typeof payload.Message === 'string' ? payload.Message : '');
        });

        ws.on('error', (err) => {
            finish(new Error(`RCON error: ${err.message}`));
        });

        ws.on('close', () => {
            finish(new Error('RCON connection closed before a response was received.'));
        });
    });
}

/**
 * Parse the coordinates out of a `printpos` response.
 *
 * Rust replies in the form `(x, y, z)`, e.g. `(1234.5, 12.0, -678.9)`.
 * Returns null when no coordinate triple is present (e.g. player offline,
 * or the server echoed an error string instead).
 *
 * @param {string} response
 * @returns {{x: string, y: string, z: string}|null}
 */
function parsePrintPos(response) {
    if (!response) return null;

    const match = response.match(
        /\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/
    );
    if (!match) return null;

    return { x: match[1], y: match[2], z: match[3] };
}

/**
 * Escape a player name for use inside a double-quoted console argument.
 * Rust has no escape syntax for embedded quotes, so they are stripped.
 */
function quotePlayerName(name) {
    return `"${String(name).replace(/"/g, '')}"`;
}

module.exports = {
    sendRconCommand,
    parsePrintPos,
    quotePlayerName
};
