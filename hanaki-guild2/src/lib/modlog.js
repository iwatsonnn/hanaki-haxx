import { config } from '../config.js';
import { simple } from './cv2.js';
import { discordTime } from './timeParse.js';

export async function logAction(guild, entry) {
  const channelId = config.modLogChannelId;
  if (!channelId) return;

  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased?.()) return;

  const lines = [`## ${entry.emoji ?? '🔨'} ${entry.action}`];
  if (entry.target) lines.push(`**Member:** ${entry.target} (\`${entry.target.tag ?? entry.target.id}\`)`);
  lines.push(`**Moderator:** ${entry.moderator} (\`${entry.moderator.tag ?? entry.moderator.id}\`)`);
  if (entry.reason) lines.push(`**Reason:** ${entry.reason}`);
  for (const line of entry.extra ?? []) lines.push(line);
  lines.push(`-# ${discordTime(Math.floor(Date.now() / 1000), 'f')}`);

  await channel
    .send(simple({ accent: entry.color ?? config.colors.danger, lines }))
    .catch((err) => console.error('[modlog] Failed to send log entry:', err));
}
