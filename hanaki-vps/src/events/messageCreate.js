import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { getWords, findMatch, bumpViolation, resetViolation } from '../lib/blacklist.js';
import { getTag } from '../lib/tags.js';
import { logAction } from '../lib/modlog.js';
import { simple, payload, td } from '../lib/cv2.js';
import { formatDuration } from '../lib/timeParse.js';
import { handleAutoTranslate } from '../lib/autoTranslate.js';

export const name = 'messageCreate';

async function handlePop(message) {
  const id = config.popChannelId;
  if (!id) return;
  const channel = message.guild.channels.cache.get(id) ?? (await message.guild.channels.fetch(id).catch(() => null));
  if (!channel) {
    return message.channel
      .send(simple({ accent: config.colors.danger, lines: ['⚠️ Population channel is not set up correctly (`popChannelId`).'] }))
      .catch(() => {});
  }

  const nums = (channel.name.match(/\d+/g) || []).map(Number);
  const lines = ['## 🌐 Server Population'];
  if (nums.length >= 2) lines.push(`🌐 **${nums[0]}** online   •   ⏰ **${nums[1]}** in queue`);
  else if (nums.length === 1) lines.push(`🌐 **${nums[0]}** online`);
  else lines.push(`\`${channel.name}\``);

  return message.channel
    .send(simple({ accent: config.colors.primary, lines }))
    .catch((err) => console.error('[pop] send failed:', err));
}

export async function execute(message) {
  if (!message.inGuild() || message.author.bot || message.system) return;

  const prefix = config.prefix || '!';
  if (message.content?.startsWith(prefix)) {
    const word = message.content.slice(prefix.length).trimStart().split(/\s+/)[0]?.toLowerCase();
    if (word === 'pop') return handlePop(message);
    if (word) {

      const response = getTag(message.guild.id, word);
      if (response) {
        return message.channel
          .send({ ...payload(td(response)), allowedMentions: { parse: [] } })
          .catch((err) => console.error('[tag] send failed:', err));
      }
    }

  }

  const staffExempt =
    config.blacklist.ignoreStaff !== false &&
    message.member?.permissions.has(PermissionFlagsBits.ManageMessages);

  const words = staffExempt ? [] : getWords(message.guild.id);
  const matched = words.length
    ? findMatch(message.content, words, config.blacklist.matchMode)
    : null;

  // Clean message: nothing to moderate, so consider it for translation instead.
  if (!matched) return handleAutoTranslate(message);

  if (config.blacklist.deleteMessage) {
    await message.delete().catch(() => {});
  }

  if (config.blacklist.warnUser) {
    const notice = await message.channel
      .send({ ...simple({ accent: config.colors.warning, lines: [`<@${message.author.id}>, that message contained a blacklisted word and was removed.`] }), allowedMentions: { users: [message.author.id] } })
      .catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 6000);
  }

  const extra = [`**Channel:** <#${message.channel.id}>`, `**Word:** \`${matched}\``];

  const threshold = config.blacklist.autoTimeoutAfter ?? 0;
  if (threshold > 0) {
    const count = bumpViolation(message.guild.id, message.author.id);
    extra.push(`**Violations:** ${count}`);
    if (count >= threshold && message.member?.moderatable) {
      const ms = config.blacklist.autoTimeoutMs ?? 600000;
      await message.member.timeout(ms, `Blacklist auto-timeout: ${count} violations`).catch(() => {});
      extra.push(`⚠️ **Auto-timeout:** ${formatDuration(ms)}`);
      resetViolation(message.guild.id, message.author.id);
    }
  }

  await logAction(message.guild, {
    action: 'Blacklisted word',
    emoji: '🚫',
    moderator: message.client.user,
    target: message.author,
    reason: `Used a blacklisted word: \`${matched}\``,
    extra,
    color: config.colors.warning,
  });
}
