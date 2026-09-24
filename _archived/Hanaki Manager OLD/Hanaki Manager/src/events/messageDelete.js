import { config } from '../config.js';
import { simple } from '../lib/cv2.js';
import { discordTime } from '../lib/timeParse.js';
import { getMessageLogChannel, formatContent, formatAttachments } from '../lib/messageLog.js';

export const name = 'messageDelete';

export async function execute(message) {
  if (config.messageLog?.logDeletes === false) return;
  if (message.partial) return;
  if (!message.guild) return;
  if (config.messageLog?.ignoreBots !== false && message.author?.bot) return;

  console.log(`[messageLog] delete by ${message.author?.tag ?? 'unknown'} in #${message.channel?.name ?? message.channelId}`);

  const logChannel = await getMessageLogChannel(message.guild);
  if (!logChannel) {
    console.warn('[messageLog] no log channel resolved — set messageLogChannelId or modLogChannelId.');
    return;
  }

  const lines = [
    '## 🗑️ Message deleted',
    `**Author:** ${message.author ? `<@${message.author.id}> (\`${message.author.tag}\`)` : 'Unknown'}`,
    `**Channel:** <#${message.channel.id}>`,
    `**Sent:** ${discordTime(Math.floor(message.createdTimestamp / 1000), 'f')}`,
  ];

  const attachments = formatAttachments(message.attachments);
  if (message.content || !attachments) lines.push(`**Content:**\n${formatContent(message.content)}`);
  if (attachments) lines.push(`**Attachments:** ${attachments}`);

  await logChannel
    .send({ ...simple({ accent: config.colors.danger, lines }), allowedMentions: { parse: [] } })
    .catch((err) => console.error('[messageLog] delete log failed:', err));
}
