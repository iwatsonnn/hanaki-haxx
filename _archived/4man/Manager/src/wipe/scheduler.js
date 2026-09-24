import { read, write } from '../lib/store.js';
import { renderReminder, renderLive } from './wipeMessage.js';

const STORE = 'wipes';
const TICK_MS = 30_000;
const PRUNE_AFTER_S = 24 * 60 * 60;

let timer = null;

export function loadWipes() {
  const data = read(STORE, []);
  return Array.isArray(data) ? data : [];
}

export function saveWipes(wipes) {
  write(STORE, wipes);
}

export function addWipe(wipe) {
  const wipes = loadWipes();
  wipes.push(wipe);
  saveWipes(wipes);
  return wipe;
}

async function sendTo(client, channelId, message) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send(message).catch((err) => console.error('[wipe] send failed:', err));
}

async function tick(client) {
  const wipes = loadWipes();
  if (wipes.length === 0) return;

  const now = Math.floor(Date.now() / 1000);
  let dirty = false;

  for (const wipe of wipes) {
    wipe.firedReminders ??= [];

    if (now < wipe.unix) {
      for (const offset of wipe.reminderOffsets ?? []) {
        if (wipe.firedReminders.includes(offset)) continue;
        if (now >= wipe.unix - offset) {
          await sendTo(client, wipe.channelId, renderReminder(wipe, wipe.unix - now));
          wipe.firedReminders.push(offset);
          dirty = true;
        }
      }
    } else if (!wipe.liveFired) {

      wipe.firedReminders = [...(wipe.reminderOffsets ?? [])];
      await sendTo(client, wipe.channelId, renderLive(wipe));
      wipe.liveFired = true;
      dirty = true;
    }
  }

  const kept = wipes.filter((w) => !(w.liveFired && now > w.unix + PRUNE_AFTER_S));
  if (kept.length !== wipes.length) {
    saveWipes(kept);
  } else if (dirty) {
    saveWipes(wipes);
  }
}

export function startWipeScheduler(client) {
  if (timer) clearInterval(timer);

  tick(client).catch((err) => console.error('[wipe] initial tick failed:', err));
  timer = setInterval(() => tick(client).catch((err) => console.error('[wipe] tick failed:', err)), TICK_MS);
  timer.unref?.();
  console.log('[wipe] scheduler started.');
}
