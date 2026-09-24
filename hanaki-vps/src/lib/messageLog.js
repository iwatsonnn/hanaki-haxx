import { config } from '../config.js';

export async function getMessageLogChannel(guild) {
  const id = config.messageLogChannelId || config.modLogChannelId;
  if (!id) return null;
  const channel = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
  return channel?.isTextBased?.() ? channel : null;
}

export function formatContent(text, limit = 1000) {
  if (!text) return '_none_';
  const clipped = text.length > limit ? `${text.slice(0, limit)}… _(truncated)_` : text;
  const safe = clipped.replace(/```/g, '`​`​`');
  return `\`\`\`\n${safe}\n\`\`\``;
}

export function formatAttachments(attachments) {
  if (!attachments?.size) return '';
  return [...attachments.values()].map((a) => `[${a.name}](${a.url})`).join(', ');
}
