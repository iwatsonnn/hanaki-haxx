import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { ok, fail } from '../lib/replies.js';
import { logAction } from '../lib/modlog.js';
import { clearWarnings } from '../lib/warnings.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('clearwarn')
  .setDescription("Clear all of a member's warnings.")
  .addUserOption((o) => o.setName('user').setDescription('The member whose warnings to clear').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction) {
  const target = interaction.options.getUser('user', true);
  const removed = clearWarnings(interaction.guild.id, target.id);

  if (removed === 0) return interaction.reply(fail('That member has no warnings to clear.'));

  await interaction.reply(ok([`🧹 Cleared **${removed}** warning(s) for ${target.tag}.`], config.colors.success));
  await logAction(interaction.guild, { action: 'Warnings cleared', emoji: '🧹', moderator: interaction.user, target, extra: [`**Removed:** ${removed}`], color: config.colors.success });
}
