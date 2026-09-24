import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(name) {
  return join(DATA_DIR, `${name}.json`);
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
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

export function update(name, fallback, mutate) {
  const current = read(name, fallback);
  const result = mutate(current);
  const toSave = result === undefined ? current : result;
  write(name, toSave);
  return toSave;
}
