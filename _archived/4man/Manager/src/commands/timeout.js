import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { ok, fail, dmUser } from '../lib/replies.js';
import { logAction } from '../lib/modlog.js';
import { parseDuration, formatDuration, discordTime } from '../lib/timeParse.js';
import { config } from '../config.js';

const MAX_MS = 28 * 24 * 60 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Temporarily mute (timeout) a member.')
  .addUserOption((o) => o.setName('user').setDescription('The member to time out').setRequired(true))
  .addStringOption((o) => o.setName('duration').setDescription('Duration, e.g. 10m, 1h, 1d (max 28d)').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason for the timeout'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction) {
  const target = interaction.options.getUser('user', true);
  const durationStr = interaction.options.getString('duration', true);
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  const ms = parseDuration(durationStr);
  if (!ms) return interaction.reply(fail('Invalid duration. Use formats like `10m`, `1h`, `1d`.'));
  if (ms > MAX_MS) return interaction.reply(fail('Timeouts cannot be longer than 28 days.'));

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) return interaction.reply(fail('That user is not in this server.'));
  if (!member.moderatable) return interaction.reply(fail('I cannot time out this member (they may have a higher role than me).'));
  if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
    return interaction.reply(fail('You cannot time out a member with an equal or higher role than you.'));
  }

  try {
    await member.timeout(ms, reason);
  } catch (err) {
    console.error('[timeout] failed:', err);
    return interaction.reply(fail('Failed to time out that member.'));
  }

  const until = Math.floor((Date.now() + ms) / 1000);
  await dmUser(target, [`You have been **timed out** in **${interaction.guild.name}** for ${formatDuration(ms)}.`, `**Reason:** ${reason}`], config.colors.warning);
  await interaction.reply(ok([`🔇 **Timed out** ${target.tag} for **${formatDuration(ms)}**`, `**Until:** ${discordTime(until, 'F')}`, `**Reason:** ${reason}`], config.colors.warning));
  await logAction(interaction.guild, { action: 'Timeout', emoji: '🔇', moderator: interaction.user, target, reason, extra: [`**Duration:** ${formatDuration(ms)}`, `**Until:** ${discordTime(until, 'f')}`], color: config.colors.warning });
}
