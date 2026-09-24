import { read, write } from '../lib/store.js';
import { config } from '../config.js';
import { buildPanel } from './panel.js';

const STORE = 'ticketPanel';

function panelSignature() {
  return JSON.stringify({
    title: config.tickets.panelTitle,
    description: config.tickets.panelDescription,
    categories: config.tickets.categories,
    accent: config.colors.primary,
  });
}

async function fetchPanelChannel(client) {
  const channelId = config.tickets.panelChannelId;
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn(`[tickets] panelChannelId ${channelId} is missing or not a text channel.`);
    return null;
  }
  return channel;
}

export async function ensurePanel(client) {
  const channel = await fetchPanelChannel(client);
  if (!channel) return;

  const saved = read(STORE, {});
  const signature = panelSignature();

  if (saved.channelId === channel.id && saved.messageId && saved.signature === signature) {
    const existing = await channel.messages.fetch(saved.messageId).catch(() => null);
    if (existing) return;
  }

  if (saved.channelId === channel.id && saved.messageId) {
    await channel.messages.delete(saved.messageId).catch(() => {});
  }

  const msg = await channel.send(buildPanel()).catch((err) => {
    console.error('[tickets] failed to post ticket panel:', err);
    return null;
  });
  if (msg) {
    write(STORE, { channelId: channel.id, messageId: msg.id, signature });
    console.log(`[tickets] panel posted in #${channel.name}.`);
  }
}
