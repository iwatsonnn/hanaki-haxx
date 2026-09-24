import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { ok, fail } from '../lib/replies.js';
import { logAction } from '../lib/modlog.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Unban a user by their ID.')
  .addStringOption((o) => o.setName('user_id').setDescription('The ID of the user to unban').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason for the unban'))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function execute(interaction) {
  const userId = interaction.options.getString('user_id', true).trim();
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  if (!/^\d{16,20}$/.test(userId)) return interaction.reply(fail('That does not look like a valid user ID.'));

  const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
  if (!ban) return interaction.reply(fail('That user is not banned.'));

  try {
    await interaction.guild.members.unban(userId, reason);
  } catch (err) {
    console.error('[unban] failed:', err);
    return interaction.reply(fail('Failed to unban that user.'));
  }

  await interaction.reply(ok([`♻️ **Unbanned** ${ban.user.tag}`, `**Reason:** ${reason}`], config.colors.success));
  await logAction(interaction.guild, { action: 'Unban', emoji: '♻️', moderator: interaction.user, target: ban.user, reason, color: config.colors.success });
}
