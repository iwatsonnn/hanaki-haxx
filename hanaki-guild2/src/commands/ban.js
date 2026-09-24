import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { ok, fail, dmUser } from '../lib/replies.js';
import { logAction } from '../lib/modlog.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban a member from the server.')
  .addUserOption((o) => o.setName('user').setDescription('The member to ban').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason for the ban'))
  .addIntegerOption((o) =>
    o.setName('delete_days').setDescription("Days of the user's messages to delete (0-7)").setMinValue(0).setMaxValue(7),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function execute(interaction) {
  const target = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') ?? 'No reason provided';
  const deleteDays = interaction.options.getInteger('delete_days') ?? 0;

  if (target.id === interaction.user.id) return interaction.reply(fail('You cannot ban yourself.'));
  if (target.id === interaction.client.user.id) return interaction.reply(fail('I cannot ban myself.'));

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (member && !member.bannable) return interaction.reply(fail('I cannot ban this member (they may have a higher role than me).'));
  if (member && interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
    return interaction.reply(fail('You cannot ban a member with an equal or higher role than you.'));
  }

  await dmUser(target, [`You have been **banned** from **${interaction.guild.name}**.`, `**Reason:** ${reason}`], config.colors.danger);

  try {
    await interaction.guild.members.ban(target.id, { reason, deleteMessageSeconds: deleteDays * 86400 });
  } catch (err) {
    console.error('[ban] failed:', err);
    return interaction.reply(fail('Failed to ban that member.'));
  }

  await interaction.reply(ok([`🔨 **Banned** ${target.tag}`, `**Reason:** ${reason}`], config.colors.danger));
  await logAction(interaction.guild, { action: 'Ban', emoji: '🔨', moderator: interaction.user, target, reason, extra: deleteDays ? [`**Messages deleted:** ${deleteDays}d`] : [] });
}
