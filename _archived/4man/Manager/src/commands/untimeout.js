import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { ok, fail } from '../lib/replies.js';
import { logAction } from '../lib/modlog.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('untimeout')
  .setDescription('Remove a timeout from a member.')
  .addUserOption((o) => o.setName('user').setDescription('The member to un-timeout').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction) {
  const target = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) return interaction.reply(fail('That user is not in this server.'));
  if (!member.isCommunicationDisabled()) return interaction.reply(fail('That member is not currently timed out.'));

  try {
    await member.timeout(null, reason);
  } catch (err) {
    console.error('[untimeout] failed:', err);
    return interaction.reply(fail('Failed to remove the timeout.'));
  }

  await interaction.reply(ok([`🔊 **Removed timeout** for ${target.tag}`, `**Reason:** ${reason}`], config.colors.success));
  await logAction(interaction.guild, { action: 'Timeout removed', emoji: '🔊', moderator: interaction.user, target, reason, color: config.colors.success });
}
