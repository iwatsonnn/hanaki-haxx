import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { fail } from '../lib/replies.js';
import { closeTicketCommand } from '../tickets/ticketActions.js';

// Staff-role-only: must hold one of the configured ticket staff roles.
// Deliberately does NOT grant access via Administrator permission.
function isTicketStaff(member) {
  if (!member) return false;
  const staffRoles = config.tickets.staffRoleIds ?? [];
  return staffRoles.some((id) => member.roles.cache.has(id));
}

export const data = new SlashCommandBuilder()
  .setName('close')
  .setDescription('Close the current ticket.')
  .addStringOption((o) => o.setName('reason').setDescription('Optional reason for closing'));

export async function execute(interaction) {
  if (!isTicketStaff(interaction.member)) {
    return interaction.reply(fail('⛔ Only staff can close tickets.'));
  }
  const reason = interaction.options.getString('reason') ?? '';
  return closeTicketCommand(interaction, reason);
}