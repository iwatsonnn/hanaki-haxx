import { read, write } from '../lib/store.js';
import { renderTimedMessage } from './timedMessage.js';

const STORE = 'timedmsgs';
const TICK_MS = 30_000;

let timer = null;

export function loadTimedMessages() {
  const data = read(STORE, []);
  return Array.isArray(data) ? data : [];
}

export function saveTimedMessages(list) {
  write(STORE, list);
}

export function addTimedMessage(msg) {
  const list = loadTimedMessages();
  list.push(msg);
  saveTimedMessages(list);
  return msg;
}

export function removeTimedMessage(id) {
  const list = loadTimedMessages();
  const kept = list.filter((m) => m.id !== id);
  if (kept.length === list.length) return false;
  saveTimedMessages(kept);
  return true;
}

async function sendTo(client, channelId, payload) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  await channel.send(payload).catch((err) => console.error('[timedmsg] send failed:', err));
  return true;
}

async function tick(client) {
  const list = loadTimedMessages();
  if (list.length === 0) return;

  const now = Date.now();
  let dirty = false;

  for (const msg of list) {
    if (now >= (msg.nextRun ?? 0)) {
      await sendTo(client, msg.channelId, renderTimedMessage(msg));
      // Advance to the next run, skipping any missed intervals so we don't spam.
      const interval = msg.intervalMs;
      let next = (msg.nextRun ?? now) + interval;
      if (next <= now) next = now + interval;
      msg.nextRun = next;
      dirty = true;
    }
  }

  if (dirty) saveTimedMessages(list);
}

export function startTimedMessageScheduler(client) {
  if (timer) clearInterval(timer);
  tick(client).catch((err) => console.error('[timedmsg] initial tick failed:', err));
  timer = setInterval(() => tick(client).catch((err) => console.error('[timedmsg] tick failed:', err)), TICK_MS);
  timer.unref?.();
  console.log('[timedmsg] scheduler started.');
}
