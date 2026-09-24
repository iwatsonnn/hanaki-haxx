import { openSync, closeSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Refuse to start when this bot account is already running.
 *
 * Two processes sharing one Discord token both receive every interaction and
 * both rewrite the whole of tickets.json, so each silently undoes the other's
 * writes — tickets "roll back" and Close fails on a ticket the other process
 * created. A copied project folder is the usual way this happens, so the lock
 * is keyed on the token (not the folder) and lives in the OS temp dir, where
 * every copy on the machine can see the same file.
 */

const LOCK_DIR = process.env.TEMP || process.env.TMPDIR || '/tmp';

function pidAlive(pid) {
  try {
    // Signal 0 performs the permission/existence check without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function claimSingleInstance(token, label = 'bot') {
  if (!token) return () => {};

  // Key on the account, never the secret: the token itself must not hit disk.
  const fingerprint = token.split('.')[0] ?? token.slice(0, 24);
  const lockFile = join(LOCK_DIR, `hanaki-bot-${fingerprint.replace(/[^A-Za-z0-9_-]/g, '')}.lock`);

  if (existsSync(lockFile)) {
    const prev = Number.parseInt(readFileSync(lockFile, 'utf8').trim(), 10);
    if (Number.isInteger(prev) && prev !== process.pid && pidAlive(prev)) {
      console.error(
        `\n❌ ${label} is already running (pid ${prev}).\n\n` +
          '   This bot token is logged in by another process. Running it twice\n' +
          '   makes both copies fight over the same data files: tickets get\n' +
          '   rolled back and "This is not a ticket channel" appears on Close.\n\n' +
          `   Stop the other process first, or delete ${lockFile}\n` +
          '   if you are certain it is stale.\n',
      );
      process.exit(1);
    }
    // Previous owner is gone — its lock is stale.
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
