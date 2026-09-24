import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(name) {
  return join(DATA_DIR, `${name}.json`);
}

// --- Cross-process write lock -------------------------------------------------
//
// Every writer here rewrites a whole JSON file, so two processes doing
// read-modify-write at the same time silently lose one side's changes. An
// exclusive lockfile ('wx' fails if it already exists) makes the
// read-modify-write in update() atomic between processes.
//
// A lock older than STALE_MS is assumed to be from a crashed process and
// broken, so a hard kill can never wedge the bot permanently.
const STALE_MS = 10_000;

function lockPath(name) {
  return join(DATA_DIR, `${name}.lock`);
}

function acquire(name) {
  const path = lockPath(name);
  const deadline = Date.now() + 5_000;

  for (;;) {
    try {
      closeSync(openSync(path, 'wx'));
      return path;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      try {
        if (Date.now() - statSync(path).mtimeMs > STALE_MS) {
          unlinkSync(path);
          continue;
        }
      } catch {
        continue; // lock vanished between the two calls — retry for it
      }

      if (Date.now() > deadline) {
        console.warn(`[store] Timed out waiting for ${name}.lock — proceeding without it.`);
        return null;
      }

      // Busy-wait briefly. These writes are sub-millisecond, so contention is rare.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
}

function release(path) {
  if (path) {
    try {
      unlinkSync(path);
    } catch {}
  }
}

export function read(name, fallback) {
  const file = fileFor(name);
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[store] Failed to parse ${name}.json — using fallback.`, err);
    return fallback;
  }
}

export function write(name, data) {
  ensureDir();
  const file = fileFor(name);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

export function update(name, fallback, mutate) {
  ensureDir();
  const lock = acquire(name);
  try {
    const current = read(name, fallback);
    const result = mutate(current);
    const toSave = result === undefined ? current : result;
    write(name, toSave);
    return toSave;
  } finally {
    release(lock);
  }
}
