import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { ok, fail, dmUser } from '../lib/replies.js';
import { logAction } from '../lib/modlog.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick a member from the server.')
  .addUserOption((o) => o.setName('user').setDescription('The member to kick').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason for the kick'))
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

export async function execute(interaction) {
  const target = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  if (target.id === interaction.user.id) return interaction.reply(fail('You cannot kick yourself.'));

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) return interaction.reply(fail('That user is not in this server.'));
  if (!member.kickable) return interaction.reply(fail('I cannot kick this member (they may have a higher role than me).'));
  if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
    return interaction.reply(fail('You cannot kick a member with an equal or higher role than you.'));
  }

  await dmUser(target, [`You have been **kicked** from **${interaction.guild.name}**.`, `**Reason:** ${reason}`], config.colors.danger);

  try {
    await member.kick(reason);
  } catch (err) {
    console.error('[kick] failed:', err);
    return interaction.reply(fail('Failed to kick that member.'));
  }

  await interaction.reply(ok([`👢 **Kicked** ${target.tag}`, `**Reason:** ${reason}`], config.colors.warning));
  await logAction(interaction.guild, { action: 'Kick', emoji: '👢', moderator: interaction.user, target, reason, color: config.colors.warning });
}
