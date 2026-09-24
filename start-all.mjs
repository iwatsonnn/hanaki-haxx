#!/usr/bin/env node
/**
 * Start every Hanaki bot with one command.
 *
 *   node start-all.mjs            start all bots
 *   node start-all.mjs --list     show what would start, then exit
 *   node start-all.mjs --only=admin,guild2
 *
 * Each bot is its own child process, so one crashing never takes the others
 * down; a crashed bot is restarted with a backoff. Ctrl+C stops all of them.
 *
 * IMPORTANT: every bot listed here must have its OWN Discord token. Two
 * processes sharing a token both receive every interaction and both rewrite the
 * same data files, which makes tickets "roll back" and Close fail with "This is
 * not a ticket channel". The preflight check below refuses to start when it
 * finds a duplicate token, and each bot also holds a lock on its own account.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const BOTS = [
  {
    key: 'manager',
    label: 'Hanaki Manager (EU · guild …46794)',
    dir: 'hanaki-vps',
    script: 'src/index.js',
    tokenVar: 'DISCORD_TOKEN',
    color: '\x1b[36m',
  },
  {
    key: 'guild2',
    label: 'Hanaki Manager (guild …93077)',
    dir: 'hanaki-guild2',
    script: 'src/index.js',
    tokenVar: 'DISCORD_TOKEN',
    color: '\x1b[35m',
  },
  {
    key: 'admin',
    label: 'Haxxor admin logger (RCON)',
    dir: 'HanakaiAdmin/Admintrack',
    script: 'index.js',
    tokenVar: 'TOKEN',
    color: '\x1b[33m',
  },
];

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null;

const selected = BOTS.filter((b) => !only || only.includes(b.key));

if (!selected.length) {
  console.error(`No bots matched --only=${only?.join(',')}. Known keys: ${BOTS.map((b) => b.key).join(', ')}`);
  process.exit(1);
}

/** Pull one variable out of a .env file without pulling in a dependency. */
function readEnvVar(dir, name) {
  const file = join(ROOT, dir, '.env');
  if (!existsSync(file)) return null;
  const match = readFileSync(file, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
}

// --- Preflight: every bot must exist, and no two may share a token ----------
const problems = [];
const seenTokens = new Map();

for (const bot of selected) {
  const entry = join(ROOT, bot.dir, bot.script);
  if (!existsSync(entry)) {
    problems.push(`${bot.key}: missing ${bot.dir}/${bot.script}`);
    continue;
  }
  if (!existsSync(join(ROOT, bot.dir, 'node_modules'))) {
    problems.push(`${bot.key}: dependencies not installed — run "npm install" in ${bot.dir}`);
  }

  const token = readEnvVar(bot.dir, bot.tokenVar);
  if (!token) {
    problems.push(`${bot.key}: ${bot.tokenVar} not set in ${bot.dir}/.env`);
    continue;
  }

  // Compare by hash so a token is never printed or held in full.
  const fingerprint = createHash('sha256').update(token).digest('hex').slice(0, 12);
  const clash = seenTokens.get(fingerprint);
  if (clash) {
    problems.push(
      `${bot.key} and ${clash} share the SAME bot token.\n` +
        '     They are one Discord account, not two bots. Running both is what\n' +
        '     causes tickets to roll back and Close to fail. Give one of them a\n' +
        `     different token, or drop it with --only=`,
    );
  } else {
    seenTokens.set(fingerprint, bot.key);
    bot.fingerprint = fingerprint;
  }
}

if (problems.length) {
  console.error('\n❌ Cannot start:\n');
  for (const p of problems) console.error(`   • ${p}`);
  console.error('');
  process.exit(1);
}

if (listOnly) {
  console.log('\nBots that would start:\n');
  for (const bot of selected) {
    console.log(`   ${bot.color}${bot.key.padEnd(8)}${RESET} ${bot.label}`);
    console.log(`   ${DIM}         ${bot.dir}/${bot.script}  · token ${bot.fingerprint}${RESET}`);
  }
  console.log('');
  process.exit(0);
}

// --- Run --------------------------------------------------------------------
const children = new Map();
let shuttingDown = false;

/** Prefix every line a bot prints so three logs stay readable interleaved. */
function pipe(bot, stream, target) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) target.write(`${bot.color}[${bot.key}]${RESET} ${line}\n`);
  });
}

function start(bot, attempt = 0) {
  if (shuttingDown) return;

  const child = spawn(process.execPath, [bot.script], {
    cwd: join(ROOT, bot.dir),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  children.set(bot.key, child);
  pipe(bot, child.stdout, process.stdout);
  pipe(bot, child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    children.delete(bot.key);
    if (shuttingDown) return;

    // Exit code 1 on startup is our own refusal (duplicate instance, bad token,
    // missing intents). Restarting on a loop would just spam the same error.
    if (code === 1 && attempt === 0) {
      console.error(`${bot.color}[${bot.key}]${RESET} exited during startup — not restarting. Fix the error above.`);
      if (!children.size) process.exit(1);
      return;
    }

    const delay = Math.min(30_000, 2_000 * 2 ** attempt);
    console.error(
      `${bot.color}[${bot.key}]${RESET} exited (${signal ?? `code ${code}`}) — restarting in ${delay / 1000}s`,
    );
    setTimeout(() => start(bot, attempt + 1), delay).unref();
  });

  child.on('error', (err) => console.error(`${bot.color}[${bot.key}]${RESET} failed to spawn:`, err.message));
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nStopping all bots...');
  for (const child of children.values()) child.kill('SIGINT');
  setTimeout(() => {
    for (const child of children.values()) child.kill('SIGKILL');
    process.exit(0);
  }, 5_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`\nStarting ${selected.length} bot(s). Press Ctrl+C to stop them all.\n`);
for (const bot of selected) {
  console.log(`   ${bot.color}${bot.key.padEnd(8)}${RESET} ${bot.label}`);
  start(bot);
}
console.log('');
