const { openSync, closeSync, existsSync, readFileSync, writeFileSync, unlinkSync } = require('fs');
const { join } = require('path');

/**
 * Refuse to start when this bot account is already running.
 *
 * Two processes sharing one Discord token both receive every message, so
 * !hammer runs twice and every admin action is logged twice. The lock is keyed
 * on the token rather than the folder so a copied project folder is caught too,
 * and it lives in the OS temp dir where every copy can see the same file.
 */

const LOCK_DIR = process.env.TEMP || process.env.TMPDIR || '/tmp';

function pidAlive(pid) {
    try {
        // Signal 0 checks for the process without delivering anything.
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === 'EPERM';
    }
}

function claimSingleInstance(token, label = 'bot') {
    if (!token) return () => {};

    // Key on the account, never the secret: the token itself must not hit disk.
    const fingerprint = token.split('.')[0] || token.slice(0, 24);
    const lockFile = join(LOCK_DIR, `hanaki-bot-${fingerprint.replace(/[^A-Za-z0-9_-]/g, '')}.lock`);

    if (existsSync(lockFile)) {
        const prev = Number.parseInt(readFileSync(lockFile, 'utf8').trim(), 10);
        if (Number.isInteger(prev) && prev !== process.pid && pidAlive(prev)) {
            console.error(
                `\n✗ ${label} is already running (pid ${prev}).\n\n` +
                '  This bot token is logged in by another process. Running it twice\n' +
                '  logs every admin action twice and runs !hammer twice.\n\n' +
                `  Stop the other process first, or delete ${lockFile}\n` +
                '  if you are certain it is stale.\n'
            );
            process.exit(1);
        }
        try {
            unlinkSync(lockFile);
        } catch {}
    }

    closeSync(openSync(lockFile, 'w'));
    writeFileSync(lockFile, String(process.pid));

    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        try {
            if (existsSync(lockFile) && readFileSync(lockFile, 'utf8').trim() === String(process.pid)) {
                unlinkSync(lockFile);
            }
        } catch {}
    };

    process.on('exit', release);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.on(sig, () => {
            release();
            process.exit(0);
        });
    }

    return release;
}

module.exports = { claimSingleInstance };
