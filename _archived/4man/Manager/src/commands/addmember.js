import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { fail } from '../lib/replies.js';
import { addMemberToTicket } from '../tickets/ticketActions.js';

// Staff-role-only: must hold one of the configured ticket staff roles.
// Deliberately does NOT grant access via Administrator permission.
function isTicketStaff(member) {
  if (!member) return false;
  const staffRoles = config.tickets.staffRoleIds ?? [];
  return staffRoles.some((id) => member.roles.cache.has(id));
}

export const data = new SlashCommandBuilder()
  .setName('addmember')
  .setDescription('Add a specific member to the current ticket.')
  .addUserOption((o) => o.setName('member').setDescription('The member to add to this ticket').setRequired(true));

export async function execute(interaction) {
  if (!isTicketStaff(interaction.member)) {
    return interaction.reply(fail('⛔ Only staff can add members to tickets.'));
  }
  const member = await interaction.guild.members.fetch(interaction.options.getUser('member', true).id).catch(() => null);
  if (!member) return interaction.reply(fail('Could not find that member in this server.'));
  return addMemberToTicket(interaction, member);
}