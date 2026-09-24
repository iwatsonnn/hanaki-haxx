import { config } from '../config.js';
import { simple } from '../lib/cv2.js';
import { getMessageLogChannel, formatContent } from '../lib/messageLog.js';

export const name = 'messageUpdate';

export async function execute(oldMessage, newMessage) {
  if (config.messageLog?.logEdits === false) return;
  if (!newMessage.guild) return;

  if (newMessage.partial) newMessage = await newMessage.fetch().catch(() => null);
  if (!newMessage) return;
  if (config.messageLog?.ignoreBots !== false && newMessage.author?.bot) return;

  const before = oldMessage.partial ? null : oldMessage.content;
  const after = newMessage.content;

  if (before === after) return;
  if (!before && !after) return;

  console.log(`[messageLog] edit by ${newMessage.author?.tag ?? 'unknown'} in #${newMessage.channel?.name ?? newMessage.channelId}`);

  const logChannel = await getMessageLogChannel(newMessage.guild);
  if (!logChannel) {
    console.warn('[messageLog] no log channel resolved — set messageLogChannelId or modLogChannelId.');
    return;
  }

  const lines = [
    '## ✏️ Message edited',
    `**Author:** <@${newMessage.author.id}> (\`${newMessage.author.tag}\`)`,
    `**Channel:** <#${newMessage.channel.id}> • [Jump](${newMessage.url})`,
    `**Before:**\n${before === null ? '_not cached_' : formatContent(before)}`,
    `**After:**\n${formatContent(after)}`,
  ];

  await logChannel
    .send({ ...simple({ accent: config.colors.warning, lines }), allowedMentions: { parse: [] } })
    .catch((err) => console.error('[messageLog] edit log failed:', err));
}
